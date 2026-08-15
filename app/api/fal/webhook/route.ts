import { db, loadConstitution, archiveImage, type Variant } from "@/lib/core";
import { critique } from "@/lib/critic";

export const maxDuration = 120;

/**
 * fal.ai calls this when a generation completes. Archives the image to Supabase
 * Storage, runs the critic, and routes the post to review or retry.
 *
 * Note the catch block: if the critic itself errors, the frame is passed
 * through to human review rather than lost. A critic outage should not silently
 * discard generated work.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("token") !== (process.env.CRON_SECRET ?? "").trim())
    return new Response("no", { status: 401 });

  const postId = url.searchParams.get("post")!;
  const attempt = Number(url.searchParams.get("attempt") ?? 1);
  const body: any = await req.json();

  const imageUrl = body?.payload?.images?.[0]?.url;
  if (body.status === "ERROR" || !imageUrl) {
    await db.from("posts").update({ status: "critique_failed" }).eq("id", postId);
    return Response.json({ ok: false, reason: "no image in payload" });
  }

  const archivedUrl = await archiveImage(imageUrl, `${postId}/attempt-${attempt}-${Date.now()}.jpg`);

  try {
    const { data: post } = await db.from("posts")
      .select("id, attempts, variant, idea:ideas(subject_prompt, overlay_text)").eq("id", postId).maybeSingle();

    const variant = ((post as any)?.variant as Variant) ?? "dark";
    const c = await loadConstitution(variant);

    const result = await critique({
      imageUrl,
      intendedSubject: (post as any)?.idea?.subject_prompt ?? "",
      constitution: c,
    });

    await db.from("generations").update({
      image_url: imageUrl,
      archived_url: archivedUrl,
      critic_scores: result.scores,
      critic_verdict: result.verdict,
      critic_notes: [result.notes, result.prompt_patch].filter(Boolean).join(" | "),
    }).eq("post_id", postId).eq("attempt", attempt);

    if (result.verdict === "pass") {
      await db.from("posts").update({ status: "awaiting_approval", backplate_url: imageUrl }).eq("id", postId);
    } else {
      await db.from("posts").update({ status: "critique_failed" }).eq("id", postId);
    }
    return Response.json({ ok: true, verdict: result.verdict, archived: !!archivedUrl, variant });
  } catch (e: any) {
    await db.from("generations").update({
      image_url: imageUrl, archived_url: archivedUrl,
      critic_notes: "critic error: " + String(e?.message ?? e),
    }).eq("post_id", postId).eq("attempt", attempt);
    await db.from("posts").update({ status: "awaiting_approval", backplate_url: imageUrl }).eq("id", postId);
    return Response.json({ ok: true, verdict: "critic_error_passed_through", archived: !!archivedUrl });
  }
}
