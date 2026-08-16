"use client";
import { useEffect, useState } from "react";

type MetricCard = { label: string; value: string; unit?: string; bar_pct?: number };
type AnnotationCallout = { label: string };
type Post = {
  id: string;
  pillar: string;
  post_type: string;
  format: string;
  slot_at: string;
  variant?: string;
  backplate_url: string | null;
  caption_final: string | null;
  idea?: {
    overlay_text?: string | null; hook_archetype?: string | null;
    metric_cards?: MetricCard[] | null; annotation_callouts?: AnnotationCallout[] | null;
    eyebrow_text?: string | null;
  } | null;
};

/** Composited overlay — never AI-generated. */
function MetricRow({ cards }: { cards?: MetricCard[] | null }) {
  if (!cards?.length) return null;
  return (
    <div className="metric-row">
      {cards.slice(0, 3).map((m, i) => (
        <div className="metric-card" key={i}>
          <span className="metric-label">{m.label}</span>
          <div><span className="metric-value">{m.value}</span>{m.unit && <span className="metric-unit">{m.unit}</span>}</div>
          {typeof m.bar_pct === "number" && (
            <div className="metric-bar-track"><div className="metric-bar-fill" style={{ width: `${Math.max(0, Math.min(100, m.bar_pct))}%` }} /></div>
          )}
        </div>
      ))}
    </div>
  );
}

/** Composited biomechanical annotation overlay — pillar B only. */
function AnnotationDiagram({ items }: { items?: AnnotationCallout[] | null }) {
  if (!items?.length) return null;
  return (
    <div className="annotation-stack">
      {items.slice(0, 4).map((a, i) => (
        <div className="annotation-row" key={i}>
          <span className="annotation-label">{a.label}</span>
          <span className="annotation-line" />
          <span className="annotation-dot" />
        </div>
      ))}
    </div>
  );
}

export default function ReviewGrid({ posts }: { posts: Post[] }) {
  const [items, setItems] = useState(posts);
  const [openId, setOpenId] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);

  const selected = items.find(p => p.id === openId) ?? null;

  function open(p: Post) {
    setOpenId(p.id);
    setCaption(p.caption_final ?? "");
  }
  function close() {
    if (!busy) setOpenId(null);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  async function decide(decision: "approved" | "rejected") {
    if (!selected) return;
    let note: string | undefined;
    // The decline reason is training signal — it feeds humanTastePatches().
    if (decision === "rejected") {
      note = window.prompt("What's wrong with it? (this becomes training signal for future generations)") ?? undefined;
    }
    setBusy(true);
    await fetch("/api/posts/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: selected.id,
        decision,
        note,
        caption: decision === "approved" ? caption : undefined,
      }),
    });
    setItems(prev => prev.filter(p => p.id !== selected.id));
    setBusy(false);
    setOpenId(null);
  }

  if (!items.length) {
    return (
      <div className="empty">
        <h2>Nothing to review.</h2>
        <p>Frames appear here as soon as they're generated.</p>
      </div>
    );
  }

  return (
    <>
      <div className="review-grid">
        {items.map(p => (
          <button className="grid-card" key={p.id} onClick={() => open(p)}>
            <div className="grid-frame">
              {p.backplate_url && <img src={p.backplate_url} alt="" />}
              {p.idea?.eyebrow_text && <div className="eyebrow">{p.idea.eyebrow_text}</div>}
              {p.idea?.overlay_text && <div className="overlay small">{p.idea.overlay_text}</div>}
              <span className="grid-pillar">{p.pillar}</span>
              {p.variant && <span className="grid-variant">{p.variant}</span>}
              <AnnotationDiagram items={p.idea?.annotation_callouts} />
              <MetricRow cards={p.idea?.metric_cards} />
            </div>
            <p className="grid-caption">{p.caption_final}</p>
          </button>
        ))}
      </div>

      {selected && (
        <div className="modal-overlay" onClick={close}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={close} aria-label="Close" disabled={busy}>×</button>

            <div className="modal-image-wrap">
              {selected.backplate_url && <img src={selected.backplate_url} alt="" />}
              {selected.idea?.eyebrow_text && <div className="eyebrow">{selected.idea.eyebrow_text}</div>}
              {selected.idea?.overlay_text && <div className="overlay">{selected.idea.overlay_text}</div>}
              <AnnotationDiagram items={selected.idea?.annotation_callouts} />
              <MetricRow cards={selected.idea?.metric_cards} />
            </div>

            <div className="modal-panel">
              <div className="meta">
                <span className="tag pillar">Pillar {selected.pillar}</span>
                <span className="tag">{selected.post_type}</span>
                <span className="tag">{selected.format}</span>
                <span className="tag">{selected.variant ?? "dark"}</span>
                <span className="tag">{selected.idea?.hook_archetype}</span>
              </div>

              <label className="field-label" htmlFor="caption-edit">Caption</label>
              <textarea
                id="caption-edit"
                className="caption-edit"
                value={caption}
                onChange={e => setCaption(e.target.value)}
                rows={6}
                disabled={busy}
              />

              <div className="modal-actions">
                <button className="reject" disabled={busy} onClick={() => decide("rejected")}>
                  {busy ? "…" : "Decline"}
                </button>
                <button className="approve" disabled={busy} onClick={() => decide("approved")}>
                  {busy ? "…" : "Approve"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
