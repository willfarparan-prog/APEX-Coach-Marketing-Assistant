import { db, askJSON, withRun, authorised, loadConstitution, constitutionBrief,
         normaliseHook, sha256, MODELS } from "@/lib/core";
import { ROUTE } from "@/lib/providers/fal";

export const maxDuration = 300;

const IDEA_BANK_FLOOR = 25;

export async function GET(req: Request) {
  if (!authorised(req)) return new Response("no", { status: 401 });

  return Response.json(await withRun("plan", async () => {
    const c = await loadConstitution();
    const { data: pillars } = await db.from("pillars").select("*").eq("active", true);

    // ── 1. Refill the idea bank if it's running dry ──────────────
    const { count } = await db.from("ideas").select("*", { count: "exact", head: true })
      .eq("status", "queued");
    let generated = 0;
    if ((count ?? 0) < IDEA_BANK_FLOOR) generated = await refillIdeas(c, pillars!);

    // ── 2. Schedule next week's slots ────────────────────────────
    const scheduled = await scheduleWeek(c, pillars!);
    return { idea_bank: count, generated, scheduled };
  }));
}

async function refillIdeas(c: any, pillars: any[]) {
  // Active lessons steer what gets generated. Hypotheses do NOT.
  const { data: lessons } = await db.from("lessons")
    .select("feature, level, effect, n, statement")
    .eq("status", "active").order("effect", { ascending: false });

  // Don't repeat ourselves: show the model what already exists.
  const { data: recent } = await db.from("ideas").select("hook")
    .order("created_at", { ascending: false }).limit(60);

  const out = await askJSON<{ ideas: any[] }>({
    model: MODELS.creative,
    maxTokens: 8000,
    system: `You write Instagram concepts for APEX Coach — an AI training and nutrition coach that rewrites a lifter's week from a two-minute Sunday check-in. Audience: serious lifters 25–40 and time-poor professionals. The account is faceless and product-led.

${constitutionBrief(c)}

PILLARS:
${pillars.map(p => `${p.code} — ${p.name}: ${p.intent}`).join("\n")}

${lessons?.length
  ? `PROVEN SO FAR (each backed by n>=5 posts — weight these):\n${lessons.map(l => `• ${l.statement} [${l.feature}=${l.level}, n=${l.n}, effect ${Number(l.effect).toFixed(2)}]`).join("\n")}`
  : `No proven lessons yet. Spread evenly across archetypes to generate signal — early posts are an experiment, not an exploitation.`}

ALREADY WRITTEN — do not restate these ideas in new words:
${(recent ?? []).map(r => "• " + r.hook).join("\n") || "(none)"}

Rules for the visual: subject_prompt describes ONLY the scene, no lighting or style language — a suffix carrying all the brand lighting is appended automatically. Never describe text, numbers, screens or UI in subject_prompt; those are composited later.
Captions are declarative and specific. No emoji, no hashtag spam, no "🔥 DM me". Write like an editorial ad, not a fitness influencer.`,
    user: `Write 20 new post concepts. Return {"ideas":[{pillar, hook, hook_archetype, subject_class, subject_prompt, post_type, format, caption, cta_type, overlay_text}]}.

hook_archetype ∈ accusation | time_decay | credential_inversion | reframe | permission | enumeration
subject_class ∈ anatomy_fragment | equipment_macro | empty_space | domestic_dark | desk | surface_texture
post_type ∈ atmosphere | data | statement
format ∈ single | carousel | reel | story
cta_type ∈ waitlist | save | follow | none
overlay_text is the line burned onto the image (null for pure atmosphere).`,
  });

  const rows = [];
  for (const i of out.ideas ?? []) {
    rows.push({ ...i, novelty_hash: await sha256(normaliseHook(i.hook)), score: 1.0 });
  }
  // novelty_hash unique index silently drops near-duplicates
  const { data } = await db.from("ideas").upsert(rows, { onConflict: "novelty_hash", ignoreDuplicates: true }).select("id");
  return data?.length ?? 0;
}

async function scheduleWeek(c: any, pillars: any[]) {
  const cycle: string[] = c.grid_rhythm.cycle;

  const { data: lastPost } = await db.from("posts")
    .select("post_type, grid_index").order("slot_at", { ascending: false }).limit(1).single();
  let gridIndex = (lastPost?.grid_index ?? -1) + 1;
  let lastType = lastPost?.post_type ?? null;

  // Quota-weighted pillar order for the week, learner weights applied.
  const slots: string[] = [];
  for (const p of pillars) {
    const n = Math.round(p.weekly_quota * p.weight);
    for (let i = 0; i < n; i++) slots.push(p.code);
  }
  slots.sort(() => Math.random() - 0.5);

  const start = new Date(); start.setDate(start.getDate() + 1); start.setUTCHours(17, 0, 0, 0);
  const created = [];

  for (let i = 0; i < slots.length; i++) {
    const pillar = pillars.find(p => p.code === slots[i])!;
    const wantType = cycle[gridIndex % cycle.length];
    // Enforce "never two of the same type adjacent" (playbook §1)
    const type = wantType === lastType ? cycle[(gridIndex + 1) % cycle.length] : wantType;

    const { data: idea } = await db.from("ideas").select("*")
      .eq("status", "queued").eq("pillar", pillar.code).eq("post_type", type)
      .order("score", { ascending: false }).limit(1).maybeSingle();
    if (!idea) continue;

    const slotAt = new Date(start); slotAt.setDate(start.getDate() + i * 1.4);

    const { data: post } = await db.from("posts").insert({
      idea_id: idea.id,
      pillar: pillar.code,
      post_type: type,
      format: idea.format,
      grid_index: gridIndex,
      slot_at: slotAt.toISOString(),
      seed: pillar.seed,                      // locked per pillar — this is what makes the grid cohere
      model: idea.format === "reel" ? ROUTE.motion : ROUTE.backplate,
      caption_final: idea.caption,
      // FROZEN AT PLAN TIME. The learner joins outcomes to exactly this.
      feature_vector: {
        pillar: pillar.code,
        hook_archetype: idea.hook_archetype,
        subject_class: idea.subject_class,
        post_type: type,
        format: idea.format,
        cta_type: idea.cta_type,
        caption_len_bucket: idea.caption.length < 180 ? "short" : idea.caption.length < 320 ? "medium" : "long",
        has_overlay: idea.overlay_text ? "yes" : "no",
      },
    }).select("id").single();

    await db.from("ideas").update({ status: "planned" }).eq("id", idea.id);
    created.push(post!.id);
    lastType = type; gridIndex++;
  }
  return created.length;
}
