import { db } from "@/lib/core";

export async function POST(req: Request) {
  const { id } = await req.json().catch(() => ({}));
  if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });
  await db.from("reference_images").delete().eq("id", id);
  return Response.json({ ok: true });
}
