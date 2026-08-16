import { db, archiveImage } from "@/lib/core";

export const maxDuration = 60;

/**
 * fal.ai calls this when a generation completes. Archives the image to
 * Supabase Storage and sends it straight to human review -- no automated
 * critic gate. "critique_failed" as a status name predates that removal;
 * it now only means "fal.ai itself errored or returned no image," which
 * cron/generate retries up to MAX_ATTEMPTS same as before.
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

  await db.from("generations").update({
    image_url: imageUrl, archived_url: archivedUrl,
  }).eq("post_id", postId).eq("attempt", attempt);

  await db.from("posts").update({ status: "awaiting_approval", backplate_url: imageUrl }).eq("id", postId);

  return Response.json({ ok: true, archived: !!archivedUrl });
}
