import { anthropic, MODELS, db, askJSON, type Constitution, constitutionBrief } from "./core";

export type CriticResult = {
  scores: {
    faces_visible: 0 | 1;
    saturated_hue_count: number;   // must be <= 1
    shadow_ratio: number;          // 0..1, must be >= lighting_law.min_shadow_ratio
    legible_text_present: 0 | 1;
    ember_accent_present: 0 | 1;
    warm_black_drift: 0 | 1;       // caught the model rendering charcoal/brown instead of blue-black
    subject_matches_brief: 0 | 1;
  };
  verdict: "pass" | "fail";
  failed_laws: string[];
  notes: string;
  prompt_patch: string | null;     // a concrete phrase to add/remove next attempt
};

/**
 * Runs on EVERY generated frame before it can reach your approval queue.
 * Two jobs: reject off-brand output, and — more valuable — record WHY,
 * so `prompt_patch` accumulates into a template that stops making that mistake.
 */
export async function critique(opts: {
  imageUrl: string;
  intendedSubject: string;
  constitution: Constitution;
}): Promise<CriticResult> {
  const img = await fetch(opts.imageUrl);
  const b64 = Buffer.from(await img.arrayBuffer()).toString("base64");
  const mediaType = img.headers.get("content-type")?.includes("png") ? "image/png" : "image/jpeg";

  const minShadow = opts.constitution.lighting_law.min_shadow_ratio;

  return askJSON<CriticResult>({
    model: MODELS.critic,
    maxTokens: 1200,
    system: `You are the brand compliance critic for APEX Coach. You judge generated images against a binding constitution. You are deliberately strict: a frame that is merely "nice" but off-law is a FAIL. Marketing that looks generically AI-generated is fatal for a product whose pitch is accuracy.

${constitutionBrief(opts.constitution)}

Scoring rules:
- shadow_ratio: estimate the fraction of frame area in deep shadow (near-black, little detail). Must be >= ${minShadow}.
- saturated_hue_count: count distinct saturated colour families present. Desaturated near-blacks and greys do not count. Must be <= ${opts.constitution.palette.accent_count_max}.
- warm_black_drift: 1 if the base black reads warm/brown/charcoal rather than blue-black.
- legible_text_present: 1 if ANY readable character, digit, logo or UI element appears.
- prompt_patch: if failing, give ONE concrete phrase to add to or remove from the prompt next attempt. Null if passing.

Verdict is "fail" if any binding law is violated.`,
    user: [
      { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
      { type: "text", text: `Intended subject was: "${opts.intendedSubject}"\n\nJudge this frame.` },
    ],
  });
}

/**
 * Accumulated critic failures become prompt guidance. After ~30 rejections you
 * learn the real failure mode of your generator (e.g. "flux drops the ember
 * accent on wide shots") instead of guessing at it.
 */
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
    system: `You read a log of image-generation failures and extract RECURRING failure modes only. A failure mode counts only if it appears at least 3 times. Return {"patches": [...]} — at most ${limit} short imperative prompt clauses that would prevent the recurring failures. If nothing recurs, return an empty array. Do not invent patterns from single incidents.`,
    user: JSON.stringify(data),
    maxTokens: 800,
  });
  return patches.patches ?? [];
}
