import { db, authorised, askJSON, MODELS, sniffMediaType } from "@/lib/core";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * COLD-START ONBOARDING for a brand new brand. Distinct from
 * /api/brand-settings/analyze, which REFINES an existing constitution.
 * This one builds a constitution from scratch and writes rows as 'proposed'
 * (not active) for manual promotion.
 *
 * Not wired to any UI. Called manually. Kept because it is the fastest path to
 * standing up a second brand.
 */
export async function POST(req: Request) {
  if (!authorised(req)) return new Response("no", { status: 401 });

  const body = await req.json().catch(() => null);
  const brandName: string = body?.brand_name;
  const category: string = body?.category ?? "";
  const notes: string = body?.notes ?? "";
  const referenceUrls: string[] = Array.isArray(body?.reference_image_urls) ? body.reference_image_urls : [];

  if (!brandName || referenceUrls.length === 0) {
    return Response.json({ ok: false, error: "brand_name and at least one reference_image_urls entry are required" }, { status: 400 });
  }
  if (referenceUrls.length > 4) {
    return Response.json({ ok: false, error: "max 4 reference images" }, { status: 400 });
  }

  const imageBlocks: any[] = [];
  for (const url of referenceUrls) {
    try {
      const img = await fetch(url);
      if (!img.ok) continue;
      const buf = Buffer.from(await img.arrayBuffer());
      imageBlocks.push({ type: "image", source: { type: "base64", media_type: sniffMediaType(buf), data: buf.toString("base64") } });
    } catch { /* skip unreachable images */ }
  }
  if (!imageBlocks.length) {
    return Response.json({ ok: false, error: "none of the reference images could be fetched" }, { status: 400 });
  }

  type Proposal = {
    palette: { base: string; base_hue_range: [number, number]; accent: string; accent_count_max: number; semantic_colors: string };
    lighting_law: { sources: number; hardness: string; min_shadow_ratio: number; haze: boolean };
    subject_law: { faces_allowed: boolean; body_treatment: string[] };
    prompt_suffix: string;
    rationale: string;
  };

  const proposal = await askJSON<Proposal>({
    model: MODELS.critic,
    maxTokens: 2000,
    system: `You translate brand reference imagery into a precise, MACHINE-GRADABLE visual constitution for an AI image-generation pipeline. A vision-model critic will later score every future generated frame against the exact numbers you choose here — vague adjectives ("gritty", "bold") are useless downstream because nothing can measure them. Every field must be something a critic can literally count or measure in a frame.

From the reference image(s) for "${brandName}"${category ? ` (${category})` : ""}${notes ? `. Additional context: ${notes}` : ""}, determine:

- base_hue_range: the dominant background/base tone as an [min,max] HSL hue pair (0-360), or a wide neutral range if desaturated/black-dominant
- accent: is there ONE recurring saturated colour used sparingly as a highlight? Name it. accent_count_max is almost always 1 — that scarcity is what makes an accent read as intentional branding rather than noise
- lighting_law.sources: how many distinct light sources typically appear (usually 1 for premium/editorial, more for bright/energetic brands)
- lighting_law.min_shadow_ratio: estimate the typical fraction (0-1) of frame occupied by negative space / shadow / uncluttered background across the references
- subject_law: do people appear? If so, are faces shown, or are bodies fragmented/silhouetted/absent?
- prompt_suffix: ONE reusable sentence, in this exact terse technical-adjective convention, that a text-to-image model should append to every prompt to reliably reproduce this look. Model your phrasing on this working example (do not copy its content, only its structure and density):
  "Cinematic still, single hard light source, 80% of frame in deep shadow, cool near-black environment (blue-black, not warm), one desaturated ember-red light accent, visible haze and dust particles in the light beam, shallow depth of field, 85mm lens, film grain, no faces visible, no text, no logos, no legible numbers, editorial ad campaign quality."
- rationale: 2-3 sentences citing specifically what you observed in the reference image(s) that led to each major choice

Return strict JSON: {palette:{base,base_hue_range,accent,accent_count_max,semantic_colors}, lighting_law:{sources,hardness,min_shadow_ratio,haze}, subject_law:{faces_allowed,body_treatment}, prompt_suffix, rationale}`,
    user: [...imageBlocks, { type: "text", text: `Analyse these ${imageBlocks.length} reference image(s) for ${brandName} and propose the constitution.` }],
  });

  const rows = [
    { key: "palette", value: proposal.palette, rationale: proposal.rationale },
    { key: "lighting_law", value: proposal.lighting_law, rationale: proposal.rationale },
    { key: "subject_law", value: proposal.subject_law, rationale: proposal.rationale },
    { key: "prompt_suffix", value: proposal.prompt_suffix, rationale: proposal.rationale },
    {
      key: "text_rendering",
      value: { in_frame_text: false, exception: "wordmark on physical surface via nano-banana-pro only" },
      rationale: "System default, not image-derived: all type is composited, never generated.",
    },
    {
      key: "grid_rhythm",
      value: { cycle: ["atmosphere", "data", "statement"], rule: "never two of the same post_type adjacent" },
      rationale: "Starting default content rhythm; adjust once real content pillars are defined.",
    },
  ];

  const inserted: any[] = [];
  for (const r of rows) {
    const { data, error } = await db.from("constitution").insert({
      key: r.key, value: r.value, status: "proposed", proposed_by: "machine", rationale: r.rationale,
    }).select("id, key").maybeSingle();
    if (!error && data) inserted.push(data);
  }

  return Response.json({
    ok: true,
    brand_name: brandName,
    images_analysed: imageBlocks.length,
    proposed: inserted,
    proposal_preview: proposal,
    next_step: "Review each proposed row, then: update constitution set status='active' where key=<key> and status='proposed'; and retire any prior active row for the same key.",
  });
}
