import { db, loadConstitution } from "@/lib/core";
import { critique } from "@/lib/critic";

export const maxDuration = 120;

/**
 * fal calls this when a frame is ready. The critic runs HERE — nothing reaches
 * your approval queue without passing the constitution first.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("token") !== process.env.CRON_SECRET)
    return new Response("no", { status: 401 });

  const postId = url.searchParams.get("post")!;
  const attempt = Number(url.searchParams.get("attempt") ?? 1);
  const body: any = await req.json();

  const imageUrl = body?.payload?.images?.[0]?.url;
  if (body.status === "ERROR" || !imageUrl) {
    await db.from("posts").update({ status: "critique_failed" }).eq("id", postId);
    return Response.json({ ok: false });
  }

  const c = await loadConstitution();
  const { data: post } = await db.from("posts")
    .select("id, attempts, idea:ideas(subject_prompt, overlay_text)").eq("id", postId).single();

  const result = await critique({
    imageUrl,
    intendedSubject: (post as any)?.idea?.subject_prompt ?? "",
    constitution: c,
  });

  await db.from("generations").update({
    image_url: imageUrl,
    critic_scores: result.scores,
    critic_verdict: result.verdict,
    critic_notes: [result.notes, result.prompt_patch].filter(Boolean).join(" | "),
  }).eq("post_id", postId).eq("attempt", attempt);

  if (result.verdict === "pass") {
    await db.from("posts")
      .update({ status: "awaiting_approval", backplate_url: imageUrl }).eq("id", postId);
  } else {
    // back to the generate queue with the failure logged; it will re-roll with a new seed
    await db.from("posts").update({ status: "critique_failed" }).eq("id", postId);
  }
  return Response.json({ ok: true, verdict: result.verdict });
}
