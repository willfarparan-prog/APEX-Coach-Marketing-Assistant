import { db } from "@/lib/core";
import PostQueueClient from "./PostQueueClient";

export const dynamic = "force-dynamic";

export default async function PostQueue() {
  const { data: posts } = await db
    .from("posts")
    .select("id, pillar, post_type, format, variant, backplate_url, caption_final, idea:ideas(overlay_text, metric_cards, annotation_callouts, eyebrow_text)")
    .eq("status", "approved")
    .order("slot_at");

  return (
    <main className="wrap wide">
      <nav className="top-nav"><a href="/review">Review</a><a href="/post-queue">Post Queue</a><a href="/gallery">Gallery</a><a href="/brand-settings">Brand Settings</a><a href="/lora">LoRA</a></nav>
      <header className="masthead">
        <span className="mark">APEX Engine — Ready to Post</span>
        <span className="pending">{posts?.length ?? 0} approved</span>
      </header>
      <PostQueueClient posts={(posts as any) ?? []} />
    </main>
  );
}
