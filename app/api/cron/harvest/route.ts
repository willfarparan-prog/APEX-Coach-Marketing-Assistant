import { db, withRun, authorised } from "@/lib/core";
import { fetchInsights, publishPost } from "@/lib/instagram";

export const maxDuration = 300;

/**
 * Two jobs on one schedule:
 *   1. Push anything you approved whose slot has arrived.
 *   2. Pull insights at +24h and +72h. 72h is what the learner uses.
 */
export async function GET(req: Request) {
  if (!authorised(req)) return new Response("no", { status: 401 });

  return Response.json(await withRun("harvest", async () => {
    let published = 0, harvested = 0;

    const { data: readyToPost } = await db.from("posts")
      .select("id, composite_url, backplate_url, caption_final")
      .eq("status", "approved").lte("slot_at", new Date().toISOString()).limit(5);

    for (const p of readyToPost ?? []) {
      try {
        const res = await publishPost({
          imageUrl: p.composite_url ?? p.backplate_url!,
          caption: p.caption_final ?? "",
        });
        await db.from("posts").update({
          status: "published", ig_media_id: res.id, ig_permalink: res.permalink,
          published_at: new Date().toISOString(),
        }).eq("id", p.id);
        published++;
      } catch (e: any) {
        await db.from("posts").update({ status: "failed", rejected_note: String(e.message) }).eq("id", p.id);
      }
    }

    const { data: live } = await db.from("posts")
      .select("id, ig_media_id, published_at").eq("status", "published").not("ig_media_id", "is", null);

    for (const p of live ?? []) {
      const age = (Date.now() - new Date(p.published_at!).getTime()) / 36e5;
      for (const mark of [24, 72]) {
        if (age < mark || age > mark + 30) continue;
        const { data: exists } = await db.from("metrics")
          .select("id").eq("post_id", p.id).eq("hours_since_publish", mark).maybeSingle();
        if (exists) continue;
        const m = await fetchInsights(p.ig_media_id!);
        await db.from("metrics").insert({ post_id: p.id, hours_since_publish: mark, ...m });
        harvested++;
      }
    }
    return { published, harvested };
  }));
}
