"use client";
import { useState } from "react";

type MetricCard = { label: string; value: string; unit?: string; bar_pct?: number };
type AnnotationCallout = { label: string };
type Post = {
  id: string;
  pillar: string;
  post_type: string;
  format: string;
  variant?: string;
  backplate_url: string | null;
  caption_final: string | null;
  idea?: {
    overlay_text?: string | null; metric_cards?: MetricCard[] | null;
    annotation_callouts?: AnnotationCallout[] | null; eyebrow_text?: string | null;
  } | null;
};

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

/**
 * Manual posting workflow. Download the image, copy the caption, post by hand,
 * then mark as posted. This is the standing workflow while Instagram API
 * integration is out of scope.
 *
 * NOTE: the composited overlays (eyebrow, headline, metric cards, annotations)
 * are CSS on top of the image and are NOT baked into the downloaded file. If
 * overlays are meant to appear in the published post, they need to be rendered
 * into the image server-side first — currently they are preview-only.
 */
export default function PostQueueClient({ posts }: { posts: Post[] }) {
  const [items, setItems] = useState(posts);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function download(p: Post) {
    if (!p.backplate_url) return;
    const res = await fetch(p.backplate_url);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `apex-${p.pillar}-${p.id.slice(0, 8)}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function copyCaption(p: Post) {
    await navigator.clipboard.writeText(p.caption_final ?? "");
    setCopiedId(p.id);
    setTimeout(() => setCopiedId(null), 1600);
  }

  async function markPosted(id: string) {
    setBusyId(id);
    await fetch("/api/posts/mark-posted", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setItems(prev => prev.filter(p => p.id !== id));
    setBusyId(null);
  }

  if (!items.length) {
    return (
      <div className="empty">
        <h2>Nothing ready yet.</h2>
        <p>Approve frames in Review — they land here for manual posting.</p>
      </div>
    );
  }

  return (
    <div className="review-grid">
      {items.map(p => (
        <div className="grid-card" key={p.id} style={{ cursor: "default" }}>
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
          <div className="queue-actions">
            <button onClick={() => download(p)}>Download</button>
            <button onClick={() => copyCaption(p)}>{copiedId === p.id ? "Copied" : "Copy caption"}</button>
          </div>
          <div className="mark-posted-row">
            <button disabled={busyId === p.id} onClick={() => markPosted(p.id)}>
              {busyId === p.id ? "…" : "Mark as posted"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
