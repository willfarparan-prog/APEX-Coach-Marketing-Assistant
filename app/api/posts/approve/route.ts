import { db } from "@/lib/core";

export async function POST(req: Request) {
  const { id, decision, note, caption } = await req.json();
  if (!["approved", "rejected"].includes(decision))
    return Response.json({ error: "decision must be approved or rejected" }, { status: 400 });

  const patch: any = { status: decision };
  if (note) patch.rejected_note = note;
  if (caption) patch.caption_final = caption;

  await db.from("posts").update(patch).eq("id", id);

  // A declined post goes back for another attempt (up to 4) and its note
  // becomes training signal via humanTastePatches().
  if (decision === "rejected") {
    const { data: p } = await db.from("posts").select("attempts").eq("id", id).maybeSingle();
    if ((p?.attempts ?? 0) < 4) await db.from("posts").update({ status: "critique_failed" }).eq("id", id);
  }
  return Response.json({ ok: true });
}
