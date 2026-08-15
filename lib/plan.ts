import { db, askJSON, MODELS, normaliseHook, sha256, type Constitution, type Variant, constitutionBrief } from "./core";
import { ROUTE } from "./providers/fal";

const VOICE = `Pragmatic, biomechanics-literate, systematic, principle-driven, high-signal, value-first, authority. This is a coach who explains the WHY behind a method in mechanical, testable terms — never vibes, never motivational-poster language. Every claim should trace back to a principle (leverage, load, recovery, adaptation) rather than an assertion. Cut anything that doesn't carry information — no filler, no hype adjectives, no rhetorical questions used as filler. If a sentence could appear on a wellness influencer's page verbatim, rewrite it.

Delivery: bold, condensed, direct-address, short declarative sentences, no soft wellness language, no corporate hedging, no emoji. Say what it means in as few words as possible.`;

export async function refillIdeas(c: Constitution, pillars: any[], batchSize = 8) {
  const { data: lessons } = await db.from("lessons")
    .select("feature, level, effect, n, statement")
    .eq("status", "active").order("effect", { ascending: false });

  const { data: recent } = await db.from("ideas").select("hook")
    .order("created_at", { ascending: false }).limit(60);

  const wantsText = !!c.text_rendering?.in_frame_text;

  const out = await askJSON<{ ideas: any[] }>({
    model: MODELS.creative,
    maxTokens: 7000,
    system: `You write Instagram concepts for APEX Coach — an AI training and nutrition coach that rewrites a lifter's week from a two-minute Sunday check-in. Audience: real athletes and working people 25–35, time-poor but serious about training.

${constitutionBrief(c)}

VOICE:
${VOICE}

IMPORTANT: subject_prompt must describe ONLY the scene itself — no lighting or palette language, no "dark" or "bright", no style words at all. The brand's visual identity (which varies between a dark faceless/moody variant and a light clean variant with real people) is appended automatically afterward. A generic scene description like "a stack of weight plates on a bench" must work equally well rendered either way; a scene like "an athlete tying their shoe" works whether or not a face ends up in frame.

PILLARS:
${pillars.map(p => `${p.code} — ${p.name}: ${p.intent}`).join("\n")}

${lessons?.length
  ? `PROVEN SO FAR (each backed by n>=5 posts — weight these):\n${lessons.map(l => `• ${l.statement} [${l.feature}=${l.level}, n=${l.n}]`).join("\n")}`
  : `No proven lessons yet. Spread evenly across archetypes to generate signal — early posts are an experiment, not an exploitation.`}

ALREADY WRITTEN — do not restate these in new words:
${(recent ?? []).map(r => "• " + r.hook).join("\n") || "(none)"}

overlay_text: SHORT, ALL-CAPS, headline-weight. ${wantsText ? "Rendered directly into the generated image by the model — include it for MOST posts. Leave null only for rare pure-mood pieces." : "Composited on top of the image afterwards."}

eyebrow_text: OPTIONAL, small caps line above the main headline (e.g. "APEX" or the pillar name). Composited, not baked into the image. Use for maybe 1 in 3 posts — don't overdo it.

metric_cards: OPTIONAL, only for post_type='data' pieces where a data-tracker aesthetic fits (roughly 1 in 4 data posts). Array of 2-3 {label, value, unit, bar_pct}. Composited afterward, not AI-generated — keep numbers plausible for fitness/recovery (heart rate 40-70, HRV 40-100ms, recovery/readiness 0-100%).

annotation_callouts: OPTIONAL, a technical/biomechanical diagram overlay — 2-4 short ALL-CAPS labels (e.g. "HIP ROTATION", "FRONTAL PLANE STABILITY", "FULL FOOT PRESSURE", "CENTRE OF MASS") that read like a coaching cue or biomechanics breakdown, styled like a technical annotation diagram with dotted leader lines. Composited, not AI-generated. ONLY use this for pillar B (Mechanism) post_type='data' or 'statement' pieces, roughly 1 in 3 of those. Never combine annotation_callouts with metric_cards on the same post.

Captions: apply VOICE directly — pragmatic, systematic, principle-driven, high-signal. Write like a no-nonsense expert talking straight to one person, not an editorial or a wellness brand.`,
    user: `Write ${batchSize} new post concepts. Return {"ideas":[{pillar, hook, hook_archetype, subject_class, subject_prompt, post_type, format, caption, cta_type, overlay_text, eyebrow_text, metric_cards, annotation_callouts}]}.

pillar ∈ A | B | C | D | E
hook_archetype ∈ accusation | time_decay | credential_inversion | reframe | permission | enumeration
subject_class ∈ anatomy_fragment | equipment_macro | empty_space | domestic_dark | desk | surface_texture | athlete_motion | athlete_silhouette | athlete_portrait
post_type ∈ atmosphere | data | statement
format ∈ single | carousel | reel | story
cta_type ∈ waitlist | save | follow | none

Spread post_type roughly evenly across pillars.`,
  });

  const valid = (out.ideas ?? []).filter(i =>
    i && ["A","B","C","D","E"].includes(i.pillar) &&
    ["atmosphere","data","statement"].includes(i.post_type) &&
    ["single","carousel","reel","story"].includes(i.format) &&
    ["waitlist","save","follow","none"].includes(i.cta_type) &&
    i.hook && i.subject_prompt && i.caption
  );

  let inserted = 0;
  for (const i of valid) {
    const row = {
      pillar: i.pillar, hook: i.hook, hook_archetype: i.hook_archetype,
      subject_class: i.subject_class, subject_prompt: i.subject_prompt,
      post_type: i.post_type, format: i.format, caption: i.caption,
      cta_type: i.cta_type, overlay_text: i.overlay_text ?? null,
      eyebrow_text: i.eyebrow_text ?? null,
      metric_cards: Array.isArray(i.metric_cards) && i.metric_cards.length ? i.metric_cards : null,
      annotation_callouts: Array.isArray(i.annotation_callouts) && i.annotation_callouts.length ? i.annotation_callouts : null,
      novelty_hash: await sha256(normaliseHook(i.hook)), score: 1.0,
    };
    const { error } = await db.from("ideas").insert(row);
    if (!error) inserted++;
  }
  return inserted;
}

/**
 * Model routing.
 *
 * NOTE: reference-image guidance (image_urls) is an EDIT-ENDPOINT-ONLY feature.
 * Plain text-to-image endpoints silently ignore it. That is why the presence of
 * reference images forces the composite (edit) route.
 *
 * PHASE 3 (LoRA): insert a branch ABOVE the hasReferenceImages check —
 *   if an active LoRA exists for this variant, route to ROUTE.lora and pass
 *   the trained weight URL. Reference images then become the fallback.
 */
function pickModel(c: Constitution, idea: any, hasReferenceImages: boolean) {
  const wantsText = !!c.text_rendering?.in_frame_text;
  if (idea.format === "reel") return ROUTE.motion;
  if (hasReferenceImages) return ROUTE.composite;
  if (wantsText && idea.overlay_text) return ROUTE.hero;
  if (c.subject_law?.faces_allowed) return ROUTE.hero;
  return ROUTE.backplate;
}

const LIGHT_VARIANT_WEIGHT = 0.8;
function pickVariant(): Variant {
  return Math.random() < LIGHT_VARIANT_WEIGHT ? "light" : "dark";
}

async function referenceCounts(): Promise<Record<Variant, number>> {
  const { data } = await db.from("reference_images").select("variant");
  const counts: Record<Variant, number> = { dark: 0, light: 0 };
  for (const r of (data ?? []) as any[]) {
    const v = r.variant as Variant;
    if (v === "dark" || v === "light") counts[v]++;
  }
  return counts;
}

export async function scheduleWeek(constitutions: Record<Variant, Constitution>, pillars: any[]) {
  const c = constitutions.dark;
  const cycle: string[] = c.grid_rhythm.cycle;
  const refCounts = await referenceCounts();

  const { data: lastPost } = await db.from("posts")
    .select("post_type, grid_index").order("slot_at", { ascending: false }).limit(1).maybeSingle();
  let gridIndex = (lastPost?.grid_index ?? -1) + 1;
  let lastType = lastPost?.post_type ?? null;

  const slots: string[] = [];
  for (const p of pillars) {
    const n = Math.max(1, Math.round(Number(p.weekly_quota) * Number(p.weight)));
    for (let i = 0; i < n; i++) slots.push(p.code);
  }
  slots.sort(() => Math.random() - 0.5);

  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 1);
  start.setUTCHours(17, 0, 0, 0);
  let created = 0;

  for (let i = 0; i < slots.length; i++) {
    const pillar = pillars.find(p => p.code === slots[i])!;
    const wantType = cycle[gridIndex % cycle.length];
    const type = wantType === lastType ? cycle[(gridIndex + 1) % cycle.length] : wantType;

    let { data: idea } = await db.from("ideas").select("*")
      .eq("status", "queued").eq("pillar", pillar.code).eq("post_type", type)
      .order("score", { ascending: false }).limit(1).maybeSingle();

    if (!idea) {
      const alt = await db.from("ideas").select("*")
        .eq("status", "queued").eq("pillar", pillar.code)
        .order("score", { ascending: false }).limit(1).maybeSingle();
      idea = alt.data;
    }
    if (!idea) continue;

    const variant = pickVariant();
    const cv = constitutions[variant];
    const slotAt = new Date(start.getTime() + i * 1.4 * 864e5);

    const { data: post, error } = await db.from("posts").insert({
      idea_id: idea.id, pillar: pillar.code, post_type: idea.post_type, format: idea.format,
      grid_index: gridIndex, slot_at: slotAt.toISOString(), seed: pillar.seed,
      model: pickModel(cv, idea, refCounts[variant] > 0), variant, caption_final: idea.caption,
      feature_vector: {
        pillar: pillar.code, hook_archetype: idea.hook_archetype, subject_class: idea.subject_class,
        post_type: idea.post_type, format: idea.format, cta_type: idea.cta_type, variant,
        caption_len_bucket: idea.caption.length < 180 ? "short" : idea.caption.length < 320 ? "medium" : "long",
        has_overlay: idea.overlay_text ? "yes" : "no",
      },
    }).select("id").maybeSingle();

    if (error || !post) continue;
    await db.from("ideas").update({ status: "planned" }).eq("id", idea.id);
    created++;
    lastType = idea.post_type; gridIndex++;
  }
  return created;
}

export async function scheduleOnDemand(constitutions: Record<Variant, Constitution>, pillars: any[], count: number) {
  const c = constitutions.dark;
  const cycle: string[] = c.grid_rhythm.cycle;
  const refCounts = await referenceCounts();
  const { data: lastPost } = await db.from("posts")
    .select("post_type, grid_index").order("slot_at", { ascending: false }).limit(1).maybeSingle();
  let gridIndex = (lastPost?.grid_index ?? -1) + 1;
  let lastType = lastPost?.post_type ?? null;

  const pillarOrder = [...pillars].sort(() => Math.random() - 0.5);
  const now = new Date();
  const ids: string[] = [];
  let tries = 0;

  while (ids.length < count && tries < count * 4) {
    const pillar = pillarOrder[tries % pillarOrder.length];
    tries++;
    const wantType = cycle[gridIndex % cycle.length];
    const type = wantType === lastType ? cycle[(gridIndex + 1) % cycle.length] : wantType;

    let { data: idea } = await db.from("ideas").select("*")
      .eq("status", "queued").eq("pillar", pillar.code).eq("post_type", type)
      .order("score", { ascending: false }).limit(1).maybeSingle();
    if (!idea) {
      const alt = await db.from("ideas").select("*")
        .eq("status", "queued").eq("pillar", pillar.code)
        .order("score", { ascending: false }).limit(1).maybeSingle();
      idea = alt.data;
    }
    if (!idea) continue;

    const variant = pickVariant();
    const cv = constitutions[variant];
    const slotAt = new Date(now.getTime() + ids.length * 36e5);

    const { data: post, error } = await db.from("posts").insert({
      idea_id: idea.id, pillar: pillar.code, post_type: idea.post_type, format: idea.format,
      grid_index: gridIndex, slot_at: slotAt.toISOString(), seed: pillar.seed,
      model: pickModel(cv, idea, refCounts[variant] > 0), variant, caption_final: idea.caption,
      feature_vector: {
        pillar: pillar.code, hook_archetype: idea.hook_archetype, subject_class: idea.subject_class,
        post_type: idea.post_type, format: idea.format, cta_type: idea.cta_type, variant,
        caption_len_bucket: idea.caption.length < 180 ? "short" : idea.caption.length < 320 ? "medium" : "long",
        has_overlay: idea.overlay_text ? "yes" : "no",
      },
    }).select("id").maybeSingle();

    if (error || !post) continue;
    await db.from("ideas").update({ status: "planned" }).eq("id", idea.id);
    ids.push(post.id);
    lastType = idea.post_type; gridIndex++;
  }
  return ids;
}
