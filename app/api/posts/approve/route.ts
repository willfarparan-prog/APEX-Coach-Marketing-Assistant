import { db } from "@/lib/core";

/** One tap from the review screen. A rejection reason is optional but it is the
 *  highest-signal data in the system — it is human judgement the critic missed. */
export async function POST(req: Request) {
  const { id, decision, note, caption } = await req.json();
  if (!["approved", "rejected"].includes(decision))
    return Response.json({ error: "decision must be approved or rejected" }, { status: 400 });

  const patch: any = { status: decision };
  if (note) patch.rejected_note = note;
  if (caption) patch.caption_final = caption;

  await db.from("posts").update(patch).eq("id", id);

  // Rejected frames go back for another roll rather than being dropped.
  if (decision === "rejected") {
    const { data: p } = await db.from("posts").select("attempts").eq("id", id).single();
    if ((p?.attempts ?? 0) < 4) await db.from("posts").update({ status: "critique_failed" }).eq("id", id);
  }
  return Response.json({ ok: true });
}
