import { db, withRun, authorised, loadConstitution, assemblePrompt } from "@/lib/core";
import { learnedPromptPatches } from "@/lib/critic";
import { submitImage, estimateCost } from "@/lib/providers/fal";

export const maxDuration = 120;
const MAX_ATTEMPTS = 4;
const LEAD_DAYS = 5;   // generate this far ahead of the slot, so re-rolls have room

export async function GET(req: Request) {
  if (!authorised(req)) return new Response("no", { status: 401 });

  return Response.json(await withRun("generate", async () => {
    const c = await loadConstitution();
    const patches = await learnedPromptPatches();      // accumulated critic wisdom
    const horizon = new Date(Date.now() + LEAD_DAYS * 864e5).toISOString();

    const { data: due } = await db.from("posts")
      .select("id, seed, model, attempts, idea:ideas(subject_prompt)")
      .in("status", ["planned", "critique_failed"])
      .lt("slot_at", horizon)
      .lt("attempts", MAX_ATTEMPTS)
      .limit(10);

    let fired = 0;
    for (const p of (due ?? []) as any[]) {
      const attempt = p.attempts + 1;
      const subject = p.idea?.subject_prompt;
      if (!subject) continue;

      const prompt = [assemblePrompt(subject, c), ...patches].join(" ");
      // Vary the seed on retries — re-rolling an identical seed reproduces the same failure
      const seed = attempt === 1 ? p.seed : p.seed + attempt * 7919;

      const ref = await submitImage({
        model: p.model, prompt, seed, aspect: "9:16", postId: p.id, attempt,
      });

      await db.from("generations").insert({
        post_id: p.id, attempt, model: p.model, prompt, seed,
        provider_ref: ref, cost_usd: estimateCost(p.model),
      });
      await db.from("posts").update({ status: "generating", attempts: attempt, prompt_full: prompt })
        .eq("id", p.id);
      fired++;
    }
    return { fired, patches_in_use: patches.length };
  }));
}
