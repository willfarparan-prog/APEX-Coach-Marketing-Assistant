import { MODELS, db, askJSON, sniffMediaType, type Constitution, constitutionBrief } from "./core";

export type CriticResult = {
  scores: {
    faces_visible: 0 | 1;
    saturated_hue_count: number;
    shadow_ratio: number;
    legible_text_present: 0 | 1;
    ember_accent_present: 0 | 1;
    warm_black_drift: 0 | 1;
    subject_matches_brief: 0 | 1;
    face_realism_ok?: 0 | 1;
  };
  verdict: "pass" | "fail";
  failed_laws: string[];
  notes: string;
  prompt_patch: string | null;
};

function baseToneInstruction(base: string) {
  const b = base.toLowerCase();
  if (b.includes("warm")) {
    return `base_tone_drift: 1 if the base reads COOL/blue-tinted rather than warm ("${base}"). This brand's base tone is intentionally warm — flag drift toward blue/cool.`;
  }
  if (b.includes("cool")) {
    return `base_tone_drift: 1 if the base reads WARM/brown-tinted rather than cool ("${base}"). This brand's base tone is intentionally cool — flag drift toward warm/brown.`;
  }
  return `base_tone_drift: 1 if the base tone visibly departs from "${base}" in either direction.`;
}

function textInstruction(c: Constitution) {
  if (c.text_rendering?.in_frame_text) {
    return `legible_text_present: This brand ENCOURAGES clean in-frame text (style: ${c.text_rendering.text_style ?? "on-brand typography"}). Score this 1 (fail-relevant) ONLY if text is garbled, misspelled, illegible, or clearly off-brand styling. Correctly-spelled, on-brand, legible text is EXPECTED — score 0 in that case, do not penalize it. This is a genuine quality bar, not leniency — garbled or misspelled words are a real defect and should still fail.`;
  }
  return `legible_text_present: 1 if ANY readable character, digit, logo or UI element appears. Hard fail, no leniency — this brand's law is no in-frame text at all.`;
}

function faceInstruction(c: Constitution) {
  if (c.subject_law?.faces_allowed) {
    return `faces_visible: NOT a failure condition for this brand — faces are explicitly permitted and encouraged, styled like premium athletic-apparel campaign photography (natural, diverse, approachable). Still report 1/0 for whether a face is visible, purely informational.
- face_realism_ok: 1 if any visible face looks genuinely photorealistic — natural proportions, coherent features, real skin texture, no AI-generation tells (warped eyes, asymmetric distortion, uncanny-valley smoothness, extra/malformed features). 0 if there's no face in frame, OR the face present is obviously distorted/fake-looking. FAIL the frame if a visible face is distorted or uncanny — that's a real quality defect, not a style call, so this stays strict.
- Body type / physique is NEVER a failure condition on its own — it's a soft style preference, not a defect. If a physique looks more hypertrophied/bodybuilder than the brief's "approachable-athletic" direction, mention it in notes but do not fail the frame for it alone.`;
  }
  return `faces_visible: 1 if any face is clearly identifiable/recognizable, even partially. Hard fail, no leniency — this is a brand-safety rule, not a style preference. This one stays strict deliberately — it's the anonymity guarantee for this variant, not an aesthetic call.`;
}

const CRITIC_LEARNABLE_FEATURES = ["shadow_bucket", "ember_accent_present"];

async function performanceGuidance(): Promise<string> {
  const { data } = await db.from("lessons")
    .select("feature, level, statement, n, effect")
    .eq("status", "active")
    .in("feature", CRITIC_LEARNABLE_FEATURES);
  if (!data?.length) return "";
  return `\n\nEMPIRICAL PERFORMANCE SIGNAL (measured from real engagement on published posts, n>=5 each — treat as a soft tiebreaker on borderline calls only; the binding laws above always win):\n${data.map(d => `• ${d.statement}`).join("\n")}`;
}

export async function critique(opts: {
  imageUrl: string;
  intendedSubject: string;
  constitution: Constitution;
}): Promise<CriticResult> {
  const img = await fetch(opts.imageUrl);
  const buf = Buffer.from(await img.arrayBuffer());
  const b64 = buf.toString("base64");
  const mediaType = sniffMediaType(buf);

  const minShadow = opts.constitution.lighting_law.min_shadow_ratio;
  const guidance = await performanceGuidance();

  return askJSON<CriticResult>({
    model: MODELS.critic,
    maxTokens: 1800,
    system: `You are the brand compliance critic for APEX Coach. You judge generated images against a binding constitution. You allow generous stylistic variance — a frame doesn't need to be perfect, only compliant with the binding laws below. Reserve FAIL for real, visible violations of a binding law — never for minor aesthetic preference, incidental background details, or close-call numbers.

${constitutionBrief(opts.constitution)}

Scoring rules:
- shadow_ratio: fraction of frame area in deep shadow. Must be >= ${minShadow}. This is a genuinely loose floor — lean PASS whenever the frame is within roughly 20% relative of it (e.g. if the floor is ${minShadow}, treat anything from ${(minShadow * 0.8).toFixed(2)} up as a pass). Only fail if the frame is clearly, obviously under.
- saturated_hue_count: distinct saturated colour families. Must be <= ${opts.constitution.palette.accent_count_max}. Do NOT count small, out-of-focus, or background-only saturated elements against this (a sliver of wood floor tone, a soft glow on a blurred laptop screen, a distant unfocused object) — only count colours that are prominent, in-focus, and draw the eye. The one exception: a real, recognisable trademarked brand logo (fast food, soda, apparel, etc) in frame still counts and still fails, regardless of how small — that's a legal/trademark issue, not a style call.
- ${baseToneInstruction(opts.constitution.palette.base)}
- ${textInstruction(opts.constitution)}
- ${faceInstruction(opts.constitution)}
- lighting_law.sources: this brand wants ${opts.constitution.lighting_law.sources} source(s), but a secondary soft/ambient fill light that doesn't create its own competing hard-edged shadow pattern is fine and should NOT be scored as a second source. Only fail if there are genuinely two dominant, competing light sources creating conflicting shadows.
- prompt_patch: if failing, ONE concrete phrase to add or remove next attempt. Null if passing.

Verdict is "fail" only for real, clearly-visible violations of a binding law above — when in doubt on a close call, lean PASS. EVERY field in the JSON schema below is REQUIRED on every response, including when the verdict is a clean pass — always populate scores, notes, and failed_laws (empty array if none), never omit or shorten them just because the frame obviously passes.${guidance}

Return warm_black_drift in your JSON as an alias carrying the same value as base_tone_drift, for backward compatibility with existing records.`,
    user: [
      { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
      { type: "text", text: `Intended subject was: "${opts.intendedSubject}"\n\nJudge this frame.` },
    ],
  });
}

export async function learnedPromptPatches(limit = 8): Promise<string[]> {
  const { data } = await db
    .from("generations")
    .select("critic_notes, critic_scores")
    .eq("critic_verdict", "fail")
    .order("created_at", { ascending: false })
    .limit(60);
  if (!data?.length) return [];

  const patches = await askJSON<{ patches: string[] }>({
    model: MODELS.cheap,
    system: `You read a log of image-generation failures and extract RECURRING failure modes only. A failure mode counts only if it appears at least 3 times. Return {"patches": [...]} — at most ${limit} short imperative prompt clauses. If nothing recurs, return an empty array. Do not invent patterns from single incidents.`,
    user: JSON.stringify(data),
    maxTokens: 800,
  });
  return patches.patches ?? [];
}

export async function humanTastePatches(limit = 6): Promise<string[]> {
  const { data } = await db
    .from("posts")
    .select("rejected_note")
    .not("rejected_note", "is", null)
    .order("created_at", { ascending: false })
    .limit(40);
  const notes = (data ?? []).map((d: any) => d.rejected_note).filter(Boolean);
  if (notes.length < 3) return [];

  const patches = await askJSON<{ patches: string[] }>({
    model: MODELS.cheap,
    system: `You read a log of a human's stated reasons for declining generated marketing images. Extract RECURRING taste preferences only — a preference counts only if it appears (even worded differently) at least 2 times. Return {"patches": [...]} — at most ${limit} short imperative prompt clauses that would satisfy this person's taste next time. If nothing recurs, return an empty array. Do not invent patterns from a single comment.`,
    user: JSON.stringify(notes),
    maxTokens: 500,
  });
  return patches.patches ?? [];
}
