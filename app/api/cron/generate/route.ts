import { db, authorised, loadConstitutions } from "@/lib/core";
import { generateForPosts } from "@/lib/generate";

export const maxDuration = 120;
export const dynamic = "force-dynamic";
const MAX_ATTEMPTS = 2;
const LEAD_DAYS = 14;
const PER_RUN_CAP = 4;

export async function GET(req: Request) {
  if (!authorised(req)) return new Response("no", { status: 401 });

  try {
    await loadConstitutions();
    const horizon = new Date(Date.now() + LEAD_DAYS * 864e5).toISOString();

    const { data: due, error } = await db.from("posts")
      .select("id, attempts")
      .in("status", ["planned", "critique_failed"])
      .lt("slot_at", horizon)
      .lt("attempts", MAX_ATTEMPTS)
      .limit(PER_RUN_CAP);
    if (error) throw new Error("posts query failed: " + error.message);

    const result = await generateForPosts((due ?? []).map((p: any) => p.id));
    return Response.json({ ok: true, summary: { candidates: due?.length ?? 0, ...result } });
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
