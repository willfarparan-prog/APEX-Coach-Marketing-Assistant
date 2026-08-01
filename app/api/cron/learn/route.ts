import { db, askJSON, withRun, authorised, MODELS } from "@/lib/core";

export const maxDuration = 300;

/**
 * The gate. A feature level needs this many observations before it is allowed
 * to influence anything. Below it, the finding lives in `lessons` as a
 * hypothesis and changes nothing.
 *
 * At ~5 posts/week you accumulate roughly 5 observations per feature level per
 * month. That is slow on purpose. The failure mode of every "self-improving"
 * content bot is an LLM confidently theorising from a single good post.
 */
const MIN_OBSERVATIONS = 5;
const MIN_EFFECT = 0.35;          // in within-week standard deviations
const OBJECTIVE = { saves: 0.5, shares: 0.3, reach: 0.2 };  // what "better" means

export async function GET(req: Request) {
  if (!authorised(req)) return new Response("no", { status: 401 });

  return Response.json(await withRun("learn", async () => {
    const obs = await buildObservations();
    const { promoted, demoted, active } = await rollUpLessons();
    await applyWeights();
    return { observations_written: obs, promoted, demoted, active_lessons: active };
  }));
}

/** Normalise each post against the others published the same week, then explode
 *  it into one row per feature. Ranking within week controls for follower
 *  growth — otherwise every recent post looks like a winner. */
async function buildObservations() {
  const { data: posts } = await db.from("posts")
    .select("id, published_at, feature_vector, metrics(hours_since_publish, saves, shares, reach)")
    .eq("status", "published").not("published_at", "is", null);
  if (!posts?.length) return 0;

  const weeks = new Map<string, any[]>();
  for (const p of posts as any[]) {
    const m = p.metrics?.find((x: any) => x.hours_since_publish === 72);
    if (!m) continue;                                   // not mature yet
    const wk = weekStart(p.published_at);
    if (!weeks.has(wk)) weeks.set(wk, []);
    weeks.get(wk)!.push({ ...p, m });
  }

  const rows: any[] = [];
  for (const [wk, group] of weeks) {
    if (group.length < 2) continue;                     // can't z-score a single post
    const z = (vals: number[]) => {
      const mu = vals.reduce((a, b) => a + b, 0) / vals.length;
      const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mu) ** 2, 0) / vals.length) || 1;
      return (v: number) => (v - mu) / sd;
    };
    const zs = z(group.map(g => g.m.saves ?? 0));
    const zh = z(group.map(g => g.m.shares ?? 0));
    const zr = z(group.map(g => g.m.reach ?? 0));

    for (const g of group)
      for (const [feature, level] of Object.entries(g.feature_vector ?? {}))
        rows.push({
          post_id: g.id, feature, level: String(level), week_start: wk,
          z_saves: zs(g.m.saves ?? 0), z_shares: zh(g.m.shares ?? 0), z_reach: zr(g.m.reach ?? 0),
        });
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

    // THE GATE
    const qualifies = n >= MIN_OBSERVATIONS && Math.abs(effect) >= MIN_EFFECT && Math.abs(effect) > stdErr;
    const status = qualifies ? "active" : "hypothesis";

    const { data: prior } = await db.from("lessons")
      .select("status, statement").eq("feature", feature).eq("level", level).maybeSingle();
    if (prior?.status !== "active" && status === "active") promoted++;
    if (prior?.status === "active" && status !== "active") demoted++;
    if (status === "active") active++;

    // Only write English for things that earned it. Everything else stays a bare number.
    const statement = status === "active"
      ? (prior?.status === "active" && prior.statement
          ? prior.statement
          : await writeStatement(feature, level, n, effect))
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
    system: `Write one sentence describing a measured content finding for an Instagram account. State the direction and magnitude, cite n. Do not speculate about WHY unless the mechanism is obvious. Do not use marketing language. Return {"statement": "..."}.`,
    user: `feature=${feature}, level=${level}, n=${n}, effect=${effect.toFixed(2)} (within-week standard deviations on a weighted saves/shares/reach objective).`,
  });
  return out.statement;
}

/** Active lessons about pillars nudge the planner's weekly mix. Nothing else
 *  touches the plan automatically — subject and archetype lessons enter as
 *  context for idea generation, where a human still sees the output. */
async function applyWeights() {
  const { data: lessons } = await db.from("lessons")
    .select("level, weight_delta").eq("feature", "pillar").eq("status", "active");
  for (const l of lessons ?? [])
    await db.rpc("bump_pillar_weight", { p_code: l.level, p_delta: l.weight_delta })
      .then(null, async () => {
        const { data: p } = await db.from("pillars").select("weight").eq("code", l.level).single();
        if (p) await db.from("pillars")
          .update({ weight: Math.max(0.5, Math.min(1.8, 1 + Number(l.weight_delta))) })
          .eq("code", l.level);
      });
}

function weekStart(iso: string) {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
