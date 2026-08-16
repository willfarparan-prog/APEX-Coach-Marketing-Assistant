import { db, assemblePrompt, loadConstitutions, type Variant } from "./core";
import { humanTastePatches } from "./critic";
import { submitImage, estimateCost, ROUTE } from "./providers/fal";

type ActiveLora = { weight_url: string; scale: number; trigger_token: string };

async function referenceUrlsByVariant(): Promise<Record<Variant, string[]>> {
  const { data } = await db.from("reference_images").select("variant, url").order("created_at", { ascending: false });
  const out: Record<Variant, string[]> = { dark: [], light: [] };
  for (const r of (data ?? []) as any[]) {
    const v = r.variant as Variant;
    if (v === "dark" || v === "light") out[v].push(r.url);
  }
  return out;
}

/**
 * Resolved fresh on every generation call (not stored on the post) so a
 * newly-promoted or deactivated LoRA takes effect immediately, including on
 * retries of posts that were planned before the promotion.
 */
async function activeLoraByVariant(): Promise<Record<Variant, ActiveLora | null>> {
  const { data } = await db.from("lora_models")
    .select("variant, weight_url, scale, trigger_token")
    .eq("is_active", true).eq("status", "ready");
  const out: Record<Variant, ActiveLora | null> = { dark: null, light: null };
  for (const r of (data ?? []) as any[]) {
    const v = r.variant as Variant;
    if ((v === "dark" || v === "light") && r.weight_url) out[v] = r;
  }
  return out;
}

export async function generateForPosts(postIds: string[]) {
  if (!postIds.length) return { fired: 0, errors: [], patches_in_use: 0 };

  const constitutions = await loadConstitutions();
  const [patches, refs, loraByVariant] = await Promise.all([
    humanTastePatches(), referenceUrlsByVariant(), activeLoraByVariant(),
  ]);

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
    const seed = attempt === 1 ? p.seed : p.seed + attempt * 7919;

    // Resolve LoRA fresh here rather than trusting the model planned onto the
    // post: it may have been promoted/deactivated since planning. A post
    // planned for ROUTE.lora with no active LoRA left falls back the same
    // way pickModel() would have at plan time.
    let model = p.model as string;
    let loras: { path: string; scale: number }[] | undefined;
    let effectiveSubject = subject;
    let cForPrompt = c;
    if (model === ROUTE.lora) {
      const lora = loraByVariant[variant];
      if (lora) {
        loras = [{ path: lora.weight_url, scale: lora.scale }];
        effectiveSubject = `${lora.trigger_token}, ${subject}`;
        // A trained LoRA already knows the look; a heavy descriptive suffix
        // fights the weights instead of helping. Use the shorter override
        // suffix if one has been set for this variant.
        if (c.prompt_suffix_lora) cForPrompt = { ...c, prompt_suffix: c.prompt_suffix_lora };
      } else {
        model = refs[variant].length ? ROUTE.composite : ROUTE.hero;
      }
    }

    const prompt = [assemblePrompt(effectiveSubject, cForPrompt, p.idea?.overlay_text), ...patches].join(" ");

    // Reference images only work on the edit endpoint.
    const referenceImages = model === ROUTE.composite ? refs[variant].slice(0, 5) : undefined;

    try {
      const ref = await submitImage({ model, prompt, seed, aspect: "9:16", postId: p.id, attempt, referenceImages, loras });
      await db.from("generations").insert({
        post_id: p.id, attempt, model, prompt, seed,
        provider_ref: ref, cost_usd: estimateCost(model),
      });
      await db.from("posts").update({ status: "generating", attempts: attempt, prompt_full: prompt, model }).eq("id", p.id);
      fired++;
    } catch (e: any) {
      errors.push(String(e?.message ?? e).slice(0, 300));
    }
  }
  return { fired, errors, patches_in_use: patches.length };
}
