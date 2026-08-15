import { db, authorised, loadConstitutions } from "@/lib/core";
import { refillIdeas, scheduleWeek } from "@/lib/plan";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const IDEA_BANK_FLOOR = 10;
const IDEA_BATCH_SIZE = 8;

export async function GET(req: Request) {
  if (!authorised(req)) return new Response("no", { status: 401 });

  try {
    const constitutions = await loadConstitutions();
    const { data: pillars, error: pErr } = await db.from("pillars").select("*").eq("active", true);
    if (pErr) throw new Error("pillars load failed: " + pErr.message);
    if (!pillars?.length) throw new Error("no active pillars");

    const { count } = await db.from("ideas").select("*", { count: "exact", head: true }).eq("status", "queued");
    let generated = 0;
    if ((count ?? 0) < IDEA_BANK_FLOOR) generated = await refillIdeas(constitutions.dark, pillars, IDEA_BATCH_SIZE);

    const scheduled = await scheduleWeek(constitutions, pillars);
    return Response.json({ ok: true, summary: { idea_bank_before: count ?? 0, generated, scheduled } });
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
