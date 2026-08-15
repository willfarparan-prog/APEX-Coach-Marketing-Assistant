import { db } from "@/lib/core";

/** Toggle "included" and/or edit the caption for a single training-image candidate. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const id: string = body?.id;
  if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });

  const patch: Record<string, any> = {};
  if (typeof body?.included === "boolean") patch.included = body.included;
  if (typeof body?.caption === "string") patch.caption = body.caption;
  if (!Object.keys(patch).length) return Response.json({ ok: false, error: "nothing to update" }, { status: 400 });

  const { error } = await db.from("training_images").update(patch).eq("id", id);
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
