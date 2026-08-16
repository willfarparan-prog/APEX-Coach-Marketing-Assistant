import { db } from "@/lib/core";

export const maxDuration = 60;

/** Same storage bucket as reference photos (under a training/ prefix) -- no new bucket needed. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const variant: string = body?.variant;
  const filename: string = body?.filename ?? "upload.jpg";
  const contentType: string = body?.contentType ?? "image/jpeg";
  const data: string = body?.data;

  if (!variant || !data) return Response.json({ ok: false, error: "variant and data are required" }, { status: 400 });

  try {
    const buf = Buffer.from(data, "base64");
    const ext = (filename.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const path = `training/${variant}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const base = (process.env.SUPABASE_URL ?? "").trim();
    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
    const uploadUrl = `${base}/storage/v1/object/references/${path}`;

    const res = await fetch(uploadUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": contentType, "x-upsert": "true" },
      body: buf,
    });
    if (!res.ok) return Response.json({ ok: false, error: "storage upload failed: " + (await res.text()) }, { status: 500 });

    const publicUrl = `${base}/storage/v1/object/public/references/${path}`;

    const { data: row, error } = await db.from("training_images")
      .insert({ variant, url: publicUrl, source: "uploaded_reference", included: true })
      .select("id, variant, url, caption, source, included").maybeSingle();
    if (error || !row) return Response.json({ ok: false, error: error?.message ?? "db insert failed" }, { status: 500 });

    return Response.json({ ok: true, image: row });
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
