import { MODELS, db, askJSON } from "./core";

/**
 * The automated vision critic (constitution scoring, pass/fail gating) was
 * removed by request: it was rejecting images the human reviewer actually
 * liked, and a critic-failed post had no path back into view -- it retried
 * twice (MAX_ATTEMPTS in cron/generate) and then dead-ended, never reaching
 * /review, only visible read-only in /gallery. Every generation now reaches
 * review directly; the human is the only gate.
 *
 * Lost along with it: the dark variant's automated face-visibility check,
 * garbled-text/logo detection, and learnedPromptPatches() (which mined
 * critic failures -- there are none to mine anymore). humanTastePatches()
 * is unaffected: it reads decline reasons from /review, a separate loop.
 */
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
