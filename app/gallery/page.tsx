import { db } from "@/lib/core";

export const dynamic = "force-dynamic";

/** Debug view: every generation, pass and fail, with critic notes. */
export default async function Gallery() {
  const { data: gens } = await db
    .from("generations")
    .select("id, post_id, attempt, model, archived_url, image_url, critic_verdict, critic_notes, created_at, posts(variant)")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <main className="wrap wide">
      <nav className="top-nav"><a href="/review">Review</a><a href="/post-queue">Post Queue</a><a href="/gallery">Gallery</a><a href="/brand-settings">Brand Settings</a></nav>
      <header className="masthead">
        <span className="mark">APEX Engine — Gallery</span>
        <span className="pending">{gens?.length ?? 0} generations</span>
      </header>

      {!gens?.length && (
        <div className="empty">
          <h2>Nothing generated yet.</h2>
          <p>Every attempt — pass or fail — will show up here once generation runs.</p>
        </div>
      )}

      <div className="review-grid">
        {gens?.map((g: any) => (
          <div className="grid-card" key={g.id} style={{ cursor: "default" }}>
            <div className="grid-frame">
              {(g.archived_url || g.image_url) && <img src={g.archived_url ?? g.image_url ?? ""} alt="" />}
              <span className={`grid-pillar ${g.critic_verdict === "pass" ? "" : "fail"}`}>
                {g.critic_verdict === "pass" ? "PASS" : g.critic_verdict === "fail" ? "FAIL" : "…"}
              </span>
              {g.posts?.variant && <span className="grid-variant">{g.posts.variant}</span>}
            </div>
            <p className="grid-caption">{g.critic_notes || "—"}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
