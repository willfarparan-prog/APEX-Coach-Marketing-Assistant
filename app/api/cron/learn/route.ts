import { db, askJSON, withRun, authorised, MODELS } from "@/lib/core";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * DORMANT — READ BEFORE TUNING.
 *
 * This is a complete within-week z-scored statistical learning system, but it
 * consumes `metrics` rows that only exist once posts are published and their
 * engagement is harvested from Instagram. Instagram integration is currently
 * out of scope, so this cron runs and finds nothing every week. That is
 * expected, not a bug.
 *
 * Do not lower thresholds to "make it work" — without real engagement data
 * there is nothing to learn from. The feedback loop that DOES function today
 * is humanTastePatches() in lib/critic.ts, which runs off your own decline
 * reasons. (The automated critic — and the critic-score-derived features this
 * cron used to mine below — was removed; see lib/critic.ts.)
 */

const MIN_OBSERVATIONS = 5;
const MIN_EFFECT = 0.35;
const OBJECTIVE = { saves: 0.5, shares: 0.3, reach: 0.2 };

export async function GET(req: Request) {
  if (!authorised(req)) return new Response("no", { status: 401 });

  return Response.json(await withRun("learn", async () => {
    const obs = await buildObservations();
    const { promoted, demoted, active } = await rollUpLessons();
    await applyWeights();
    return { observations_written: obs, promoted, demoted, active_lessons: active };
  }));
}

async function buildObservations() {
  const { data: posts } = await db.from("posts")
    .select("id, published_at, feature_vector, backplate_url, metrics(hours_since_publish, saves, shares, reach)")
    .eq("status", "published").not("published_at", "is", null);
  if (!posts?.length) return 0;

  const weeks = new Map<string, any[]>();
  for (const p of posts as any[]) {
    const m = p.metrics?.find((x: any) => x.hours_since_publish === 72);
    if (!m) continue;
    const wk = weekStart(p.published_at);
    if (!weeks.has(wk)) weeks.set(wk, []);
    weeks.get(wk)!.push({ ...p, m });
  }

  const rows: any[] = [];
  for (const [wk, group] of weeks) {
    if (group.length < 2) continue;
    const z = (vals: number[]) => {
      const mu = vals.reduce((a, b) => a + b, 0) / vals.length;
      const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mu) ** 2, 0) / vals.length) || 1;
      return (v: number) => (v - mu) / sd;
    };
    const zs = z(group.map(g => g.m.saves ?? 0));
    const zh = z(group.map(g => g.m.shares ?? 0));
    const zr = z(group.map(g => g.m.reach ?? 0));

    for (const g of group) {
      for (const [feature, level] of Object.entries(g.feature_vector ?? {}))
        rows.push({
          post_id: g.id, feature, level: String(level), week_start: wk,
          z_saves: zs(g.m.saves ?? 0), z_shares: zh(g.m.shares ?? 0), z_reach: zr(g.m.reach ?? 0),
        });
    }
  }
  if (!rows.length) return 0;
  await db.from("observations").delete().neq("post_id", "00000000-0000-0000-0000-000000000000");
  await db.from("observations").insert(rows);
  return rows.length;
}

async function rollUpLessons() {
  const { data: obs } = await db.from("observations").select("*");
  const groups = new Map<string, any[]>();
  for (const o of obs ?? []) {
    const k = `${o.feature}::${o.level}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(o);
  }

  let promoted = 0, demoted = 0, active = 0;
  for (const [k, rows] of groups) {
    const [feature, level] = k.split("::");
    const scores = rows.map(r =>
      OBJECTIVE.saves * (r.z_saves ?? 0) + OBJECTIVE.shares * (r.z_shares ?? 0) + OBJECTIVE.reach * (r.z_reach ?? 0));
    const n = scores.length;
    const effect = scores.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(scores.reduce((a, b) => a + (b - effect) ** 2, 0) / Math.max(n - 1, 1));
    const stdErr = sd / Math.sqrt(n);

    const qualifies = n >= MIN_OBSERVATIONS && Math.abs(effect) >= MIN_EFFECT && Math.abs(effect) > stdErr;
    const status = qualifies ? "active" : "hypothesis";

    const { data: prior } = await db.from("lessons")
      .select("status, statement").eq("feature", feature).eq("level", level).maybeSingle();
    if (prior?.status !== "active" && status === "active") promoted++;
    if (prior?.status === "active" && status !== "active") demoted++;
    if (status === "active") active++;

    const statement = status === "active"
      ? (prior?.status === "active" && prior.statement ? prior.statement : await writeStatement(feature, level, n, effect))
      : `Hypothesis only — ${n} observation${n === 1 ? "" : "s"}, effect ${effect.toFixed(2)}. Not enough evidence to act on.`;

    await db.from("lessons").upsert({
      feature, level, n, effect, std_err: stdErr, status, statement,
      weight_delta: qualifies ? Math.max(-0.4, Math.min(0.4, effect * 0.25)) : 0,
      last_updated: new Date().toISOString(),
    }, { onConflict: "feature,level" });
  }
  return { promoted, demoted, active };
}

async function writeStatement(feature: string, level: string, n: number, effect: number) {
  const out = await askJSON<{ statement: string }>({
    model: MODELS.cheap,
    maxTokens: 300,
    system: `Write one sentence describing a measured content finding for a social account. State direction and magnitude, cite n. Do not speculate about WHY unless obvious. No marketing language. Return {"statement": "..."}.`,
    user: `feature=${feature}, level=${level}, n=${n}, effect=${effect.toFixed(2)} (within-week SDs on a weighted saves/shares/reach objective).`,
  });
  return out.statement;
}

/** Proven pillar performance nudges that pillar's weekly quota weight. */
async function applyWeights() {
  const { data: lessons } = await db.from("lessons")
    .select("level, weight_delta").eq("feature", "pillar").eq("status", "active");
  for (const l of lessons ?? []) {
    const { data: p } = await db.from("pillars").select("weight").eq("code", l.level).maybeSingle();
    if (p) await db.from("pillars")
      .update({ weight: Math.max(0.5, Math.min(1.8, 1 + Number(l.weight_delta))) })
      .eq("code", l.level);
  }
}

function weekStart(iso: string) {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
