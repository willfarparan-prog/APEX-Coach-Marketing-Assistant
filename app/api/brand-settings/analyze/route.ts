import { db, askJSON, MODELS, loadConstitution, sniffMediaType, type Variant } from "@/lib/core";

export const maxDuration = 60;

/**
 * Reads the reference photos already uploaded for a variant plus that variant's
 * CURRENT constitution, and proposes a refined palette/lighting/subject/
 * prompt_suffix. Does NOT write anything — apply-analysis does that, after the
 * human reviews the proposal.
 *
 * This endpoint has been the source of three separate production bugs. All three
 * fixes are load-bearing; do not "simplify" them away:
 *
 * 1. TIMEOUT. Vercel Hobby hard-caps every function at 60s regardless of the
 *    maxDuration value above. Fetching + base64-encoding 8 images sequentially
 *    blew past that before the Anthropic call even started; the platform killed
 *    the function mid-request and the browser saw a raw connection failure that
 *    surfaced as a misleading generic "network error". Fix: fetch in PARALLEL
 *    (Promise.all) and cap the batch at 4.
 *
 * 2. MEDIA TYPE. Supabase Storage content-type headers do not reliably match the
 *    actual image bytes. Anthropic strictly rejects mismatches with a 500. Fix:
 *    sniffMediaType() reads magic bytes instead of trusting the header.
 *
 * 3. JSON TRUNCATION. The response was coming back empty or cut off, producing
 *    "Unexpected end of JSON input". Fix: maxTokens raised to 3000 and askJSON
 *    now does brace-matching extraction and reports stop_reason on failure.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const variant = body?.variant as Variant;
  if (variant !== "dark" && variant !== "light") {
    return Response.json({ ok: false, error: "variant must be 'dark' or 'light'" }, { status: 400 });
  }

  const { data: refs, error: refErr } = await db.from("reference_images")
    .select("url").eq("variant", variant).order("created_at", { ascending: false }).limit(4);
  if (refErr) return Response.json({ ok: false, error: refErr.message }, { status: 500 });
  if (!refs?.length) return Response.json({ ok: false, error: "no reference photos uploaded for this variant yet" }, { status: 400 });

  let current: Record<string, any>;
  try {
    current = await loadConstitution(variant);
  } catch (e: any) {
    return Response.json({ ok: false, error: "could not load current constitution: " + String(e?.message ?? e) }, { status: 500 });
  }

  const fetched = await Promise.all(refs.map(async (r) => {
    try {
      const img = await fetch(r.url);
      if (!img.ok) return null;
      const buf = Buffer.from(await img.arrayBuffer());
      return { type: "image", source: { type: "base64", media_type: sniffMediaType(buf), data: buf.toString("base64") } };
    } catch {
      return null;
    }
  }));
  const imageBlocks = fetched.filter((b): b is NonNullable<typeof b> => b !== null);
  if (!imageBlocks.length) return Response.json({ ok: false, error: "none of the reference photos could be fetched" }, { status: 400 });

  type Proposal = {
    palette: {
      base: string; base_hue_range: [number, number]; accent: string; accent_count_max: number; semantic_colors: string;
      base_hex: string; surface_hex: string; text_hex: string; text_secondary_hex: string; accent_hex: string;
    };
    lighting_law: { sources: number; hardness: string; min_shadow_ratio: number; haze: boolean };
    subject_law: { faces_allowed: boolean; body_treatment: string[]; note?: string };
    prompt_suffix: string;
    rationale: string;
  };

  let proposal: Proposal;
  try {
    proposal = await askJSON<Proposal>({
      model: MODELS.critic,
      maxTokens: 3000,
      system: `You refine an existing visual brand constitution for an AI image-generation pipeline based on newly uploaded reference photos for the "${variant}" variant. A vision-model critic will later grade every future generated frame against the exact values you choose here — be precise and measurable, never vague adjectives.

CURRENT CONSTITUTION FOR THIS VARIANT (your starting point — refine it, don't discard it wholesale, unless the reference photos clearly contradict a specific part of it):
${JSON.stringify(current, null, 2)}

From the ${imageBlocks.length} reference photo(s) provided, propose an UPDATED constitution:
- palette: adjust base/accent descriptions AND exact hex values (base_hex, surface_hex, text_hex, text_secondary_hex, accent_hex) to match what you actually see in the photos
- lighting_law: sources, hardness, min_shadow_ratio (0-1), haze
- subject_law: faces_allowed, body_treatment array, optional note
- prompt_suffix: ONE reusable sentence, terse technical-adjective convention, that a text-to-image model appends to every prompt to reproduce this look
- rationale: 2-3 sentences citing what you SPECIFICALLY observed in these reference photos that drove each change — be concrete, not generic

Return strict JSON: {palette:{base,base_hue_range,accent,accent_count_max,semantic_colors,base_hex,surface_hex,text_hex,text_secondary_hex,accent_hex}, lighting_law:{sources,hardness,min_shadow_ratio,haze}, subject_law:{faces_allowed,body_treatment,note}, prompt_suffix, rationale}`,
      user: [...imageBlocks, { type: "text", text: `Analyse these ${imageBlocks.length} reference photo(s) for the ${variant} variant and propose an updated constitution.` }],
    });
  } catch (e: any) {
    return Response.json({ ok: false, error: "analysis model call failed: " + String(e?.message ?? e) }, { status: 500 });
  }

  return Response.json({ ok: true, variant, images_analysed: imageBlocks.length, proposal });
}
