import { db, askJSON, MODELS, sniffMediaType, type Variant } from "@/lib/core";

export const maxDuration = 60;

const BATCH = 6;

/**
 * Drafts captions for training images missing one, via the same Claude
 * vision call already wired up for brand-settings/analyze. Same lessons
 * apply here as there (see that route's comment): fetch in PARALLEL and cap
 * the batch, or Vercel's 60s hard cap kills the function mid-request.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const variant = body?.variant as Variant;
  if (variant !== "dark" && variant !== "light") {
    return Response.json({ ok: false, error: "variant must be 'dark' or 'light'" }, { status: 400 });
  }

  const { data: rows, error } = await db.from("training_images")
    .select("id, url")
    .eq("variant", variant).eq("included", true).is("caption", null)
    .order("created_at", { ascending: false }).limit(BATCH);
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  if (!rows?.length) return Response.json({ ok: true, captioned: 0 });

  const fetched = await Promise.all(rows.map(async (r) => {
    try {
      const img = await fetch(r.url);
      if (!img.ok) return null;
      const buf = Buffer.from(await img.arrayBuffer());
      return { id: r.id, block: { type: "image", source: { type: "base64", media_type: sniffMediaType(buf), data: buf.toString("base64") } } };
    } catch {
      return null;
    }
  }));
  const usable = fetched.filter((f): f is NonNullable<typeof f> => f !== null);
  if (!usable.length) return Response.json({ ok: false, error: "none of the candidate images could be fetched" }, { status: 400 });

  let result: { captions: { index: number; caption: string }[] };
  try {
    result = await askJSON<{ captions: { index: number; caption: string }[] }>({
      model: MODELS.cheap,
      maxTokens: 2000,
      system: `You caption images for a LoRA training dataset (fal.ai flux-lora-fast-training). Each caption should be one terse sentence describing composition, lighting, and subject in plain concrete terms -- what a photographer would call the shot, not marketing copy. Do not describe the brand or make claims about quality. Return {"captions": [{"index": 0, "caption": "..."}, ...]} with one entry per image, in the same order given.`,
      user: [
        ...usable.map((u, i) => [{ type: "text", text: `Image ${i}:` }, u.block]).flat(),
        { type: "text", text: `Caption each of the ${usable.length} image(s) above.` },
      ],
    });
  } catch (e: any) {
    return Response.json({ ok: false, error: "caption model call failed: " + String(e?.message ?? e) }, { status: 500 });
  }

  let captioned = 0;
  for (const c of result.captions ?? []) {
    const target = usable[c.index];
    if (!target || !c.caption) continue;
    const { error: updErr } = await db.from("training_images").update({ caption: c.caption }).eq("id", target.id);
    if (!updErr) captioned++;
  }

  return Response.json({ ok: true, captioned, attempted: usable.length });
}
