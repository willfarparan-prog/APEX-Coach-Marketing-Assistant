import { db, assemblePrompt, loadConstitutions, type Variant } from "./core";
import { learnedPromptPatches, humanTastePatches } from "./critic";
import { submitImage, estimateCost } from "./providers/fal";

async function referenceUrlsByVariant(): Promise<Record<Variant, string[]>> {
  const { data } = await db.from("reference_images").select("variant, url").order("created_at", { ascending: false });
  const out: Record<Variant, string[]> = { dark: [], light: [] };
  for (const r of (data ?? []) as any[]) {
    const v = r.variant as Variant;
    if (v === "dark" || v === "light") out[v].push(r.url);
  }
  return out;
}

export async function generateForPosts(postIds: string[]) {
  if (!postIds.length) return { fired: 0, errors: [], patches_in_use: 0 };

  const constitutions = await loadConstitutions();
  const [critiquePatches, humanPatches, refs] = await Promise.all([
    learnedPromptPatches(), humanTastePatches(), referenceUrlsByVariant(),
  ]);
  const patches = [...critiquePatches, ...humanPatches];

  const { data: rows } = await db.from("posts")
    .select("id, seed, model, attempts, variant, idea:ideas(subject_prompt, overlay_text)")
    .in("id", postIds);

  let fired = 0;
  const errors: string[] = [];
  for (const p of (rows ?? []) as any[]) {
    const subject = p.idea?.subject_prompt;
    if (!subject) continue;
    const variant = (p.variant as Variant) ?? "dark";
    const c = constitutions[variant] ?? constitutions.dark;
    const attempt = (p.attempts ?? 0) + 1;
    const prompt = [assemblePrompt(subject, c, p.idea?.overlay_text), ...patches].join(" ");
    const seed = attempt === 1 ? p.seed : p.seed + attempt * 7919;

    // Reference images only work on the edit endpoint.
    const referenceImages = p.model === "fal-ai/nano-banana-pro/edit" ? refs[variant].slice(0, 5) : undefined;

    try {
      const ref = await submitImage({ model: p.model, prompt, seed, aspect: "9:16", postId: p.id, attempt, referenceImages });
      await db.from("generations").insert({
        post_id: p.id, attempt, model: p.model, prompt, seed,
        provider_ref: ref, cost_usd: estimateCost(p.model),
      });
      await db.from("posts").update({ status: "generating", attempts: attempt, prompt_full: prompt }).eq("id", p.id);
      fired++;
    } catch (e: any) {
      errors.push(String(e?.message ?? e).slice(0, 300));
    }
  }
  return { fired, errors, patches_in_use: patches.length };
}
