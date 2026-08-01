import { db } from "@/lib/core";
import Actions from "./Actions";

export const dynamic = "force-dynamic";

export default async function Review() {
  const { data: posts } = await db
    .from("posts")
    .select("id, pillar, post_type, format, slot_at, backplate_url, caption_final, idea:ideas(overlay_text, hook_archetype), generations(critic_scores, attempt)")
    .eq("status", "awaiting_approval")
    .order("slot_at");

  return (
    <main className="wrap">
      <header className="masthead">
        <span className="mark">APEX Engine</span>
        <span className="pending">{posts?.length ?? 0} awaiting</span>
      </header>

      {!posts?.length && (
        <div className="empty">
          <h2>Nothing to review.</h2>
          <p>The planner runs Monday 06:00 UTC.<br />Frames appear here once they pass the critic.</p>
        </div>
      )}

      {posts?.map((p: any) => {
        const s = p.generations?.sort((a: any, b: any) => b.attempt - a.attempt)[0]?.critic_scores ?? {};
        return (
          <article className="card" key={p.id}>
            <div className="frame">
              {p.backplate_url && <img src={p.backplate_url} alt="" />}
              {p.idea?.overlay_text && <div className="overlay">{p.idea.overlay_text}</div>}
            </div>

            <div className="meta">
              <span className="tag pillar">Pillar {p.pillar}</span>
              <span className="tag">{p.post_type}</span>
              <span className="tag">{p.format}</span>
              <span className="tag">{p.idea?.hook_archetype}</span>
              <span className="tag">{new Date(p.slot_at).toUTCString().slice(0, 16)}</span>
            </div>

            {/* The scorecard: what the critic measured, not what it felt */}
            <dl className="scorecard">
              <div className="score">
                <dt>Shadow</dt>
                <div className="bar"><span style={{ width: `${(s.shadow_ratio ?? 0) * 100}%` }} /></div>
                <dd>{s.shadow_ratio != null ? `${Math.round(s.shadow_ratio * 100)}%` : "—"}</dd>
              </div>
              <div className="score"><dt>Saturated hues</dt><dd>{s.saturated_hue_count ?? "—"}</dd></div>
              <div className="score"><dt>Ember</dt><dd>{s.ember_accent_present ? "present" : "missing"}</dd></div>
              <div className="score"><dt>Faces</dt><dd>{s.faces_visible ? "detected" : "none"}</dd></div>
            </dl>

            <p className="caption">{p.caption_final}</p>
            <Actions id={p.id} />
          </article>
        );
      })}
    </main>
  );
}
