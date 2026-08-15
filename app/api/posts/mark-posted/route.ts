import { db } from "@/lib/core";

export async function POST(req: Request) {
  const { id } = await req.json();
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  await db.from("posts").update({ status: "published", published_at: new Date().toISOString() }).eq("id", id);
  return Response.json({ ok: true });
}
