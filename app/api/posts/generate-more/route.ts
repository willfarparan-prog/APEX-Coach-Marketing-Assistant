import { db, loadConstitutions } from "@/lib/core";
import { refillIdeas, scheduleOnDemand } from "@/lib/plan";
import { generateForPosts } from "@/lib/generate";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const count = Math.min(Math.max(Number(body?.count) || 5, 1), 10);

  try {
    const constitutions = await loadConstitutions();
    const { data: pillars, error: pErr } = await db.from("pillars").select("*").eq("active", true);
    if (pErr || !pillars?.length) throw new Error("no active pillars");

    const { count: queuedCount } = await db.from("ideas").select("*", { count: "exact", head: true }).eq("status", "queued");
    let ideasGenerated = 0;
    if ((queuedCount ?? 0) < count) ideasGenerated = await refillIdeas(constitutions.dark, pillars, Math.max(count, 8));

    const scheduledIds = await scheduleOnDemand(constitutions, pillars, count);
    const result = await generateForPosts(scheduledIds);

    return Response.json({ ok: true, ideas_generated: ideasGenerated, scheduled: scheduledIds.length, ...result });
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
