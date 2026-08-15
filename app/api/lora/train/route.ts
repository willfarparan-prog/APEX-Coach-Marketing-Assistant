import { db, type Variant } from "@/lib/core";
import { submitTraining, uploadDataset } from "@/lib/providers/fal";
import JSZip from "jszip";

export const maxDuration = 60;

const MIN_IMAGES = 10;
const MAX_IMAGES = 40;

/**
 * Kicks off a real fal.ai training run -- costs ~$2-5 on the account's fal
 * billing. Only ever called from a human clicking "Start training" in the
 * UI; never triggered automatically by a cron or other server-side path.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const variant = body?.variant as Variant;
  if (variant !== "dark" && variant !== "light") {
    return Response.json({ ok: false, error: "variant must be 'dark' or 'light'" }, { status: 400 });
  }
  const triggerWord: string = (body?.triggerWord || `apex${variant}`).trim().replace(/[^a-zA-Z0-9]/g, "");
  const steps: number = Math.max(200, Math.min(4000, Number(body?.steps) || 1000));
  const isStyle: boolean = body?.isStyle !== false;

  const { data: images, error: imgErr } = await db.from("training_images")
    .select("id, url, caption")
    .eq("variant", variant).eq("included", true)
    .order("created_at", { ascending: false }).limit(MAX_IMAGES);
  if (imgErr) return Response.json({ ok: false, error: imgErr.message }, { status: 500 });
  if (!images || images.length < MIN_IMAGES) {
    return Response.json({ ok: false, error: `Need at least ${MIN_IMAGES} included images (have ${images?.length ?? 0}).` }, { status: 400 });
  }

  const { data: existing } = await db.from("lora_models").select("version").eq("variant", variant).order("version", { ascending: false }).limit(1);
  const version = (existing?.[0]?.version ?? 0) + 1;

  const zip = new JSZip();
  const fetched = await Promise.all(images.map(async (img, i) => {
    try {
      const res = await fetch(img.url);
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      const ct = res.headers.get("content-type") ?? "";
      const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
      return { i, buf, ext, caption: img.caption as string | null };
    } catch {
      return null;
    }
  }));
  const usable = fetched.filter((f): f is NonNullable<typeof f> => f !== null);
  if (usable.length < MIN_IMAGES) {
    return Response.json({ ok: false, error: `Only ${usable.length} of ${images.length} images could be fetched -- below the ${MIN_IMAGES} minimum.` }, { status: 400 });
  }
  for (const f of usable) {
    zip.file(`${f.i}.${f.ext}`, f.buf);
    if (f.caption) zip.file(`${f.i}.txt`, f.caption);
  }
  const zipBuf = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });

  let zipUrl: string;
  try {
    zipUrl = await uploadDataset(zipBuf, `${variant}-v${version}.zip`);
  } catch (e: any) {
    return Response.json({ ok: false, error: "dataset upload to fal failed: " + String(e?.message ?? e) }, { status: 500 });
  }

  const { data: row, error: insErr } = await db.from("lora_models").insert({
    variant, version, trigger_token: triggerWord, training_image_count: usable.length,
    steps, is_style: isStyle, status: "training",
  }).select("id").maybeSingle();
  if (insErr || !row) return Response.json({ ok: false, error: insErr?.message ?? "failed to create lora_models row" }, { status: 500 });

  try {
    const requestId = await submitTraining({ zipUrl, triggerWord, steps, isStyle, loraModelId: row.id });
    await db.from("lora_models").update({ request_id: requestId }).eq("id", row.id);
  } catch (e: any) {
    await db.from("lora_models").update({ status: "failed", notes: "submit failed: " + String(e?.message ?? e) }).eq("id", row.id);
    return Response.json({ ok: false, error: "training submit failed: " + String(e?.message ?? e) }, { status: 500 });
  }

  return Response.json({ ok: true, id: row.id, version, image_count: usable.length });
}
