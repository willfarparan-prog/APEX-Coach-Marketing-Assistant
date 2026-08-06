import Link from "next/link";
import { db } from "@/lib/core";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ tab?: string }>;

const tabs = [
  { id: "posts", label: "Post Queue" },
  { id: "insights", label: "Insights" },
  { id: "runs", label: "Runs" },
  { id: "brand", label: "Brand Style" },
];

const shell = { maxWidth: 920, margin: "0 auto", padding: "34px 18px 80px" } as const;
const panel = { border: "1px solid var(--edge)", borderRadius: 4, background: "var(--surface)" } as const;
const mono = { fontFamily: "var(--data)", fontSize: 12, color: "var(--ash)" } as const;

const brandRules = [
  ["Voice", "Direct, earned, and exact. Write from repetitions and results, not theory or hype."],
  ["Visual system", "Void ground, bone type, ember emphasis. The visual language stays restrained and high-contrast."],
  ["Type", "Use the display face for declarations. Use the data face for proof, labels, and operational detail."],
  ["Imagery", "Real training environments, controlled shadow, saturated hues, and no generic stock fitness imagery."],
];

export default async function Operations({ searchParams }: { searchParams: SearchParams }) {
  const { tab = "posts" } = await searchParams;
  const normalizedTab = tab === "queue" ? "posts" : tab;
  const activeTab = tabs.some((item) => item.id === normalizedTab) ? normalizedTab : "posts";

  const [{ data: posts }, { data: metrics }, { data: runs }] = await Promise.all([
    db.from("posts").select("id, pillar, post_type, format, slot_at, status, caption_final").order("slot_at").limit(30),
    db.from("metrics").select("reach, saves, shares, likes, captured_at").order("captured_at", { ascending: false }).limit(100),
    db.from("runs").select("id, job, ok, started_at, error").order("started_at", { ascending: false }).limit(20),
  ]);

  const totals = (metrics ?? []).reduce((sum: any, row: any) => ({
    reach: sum.reach + (row.reach ?? 0),
    saves: sum.saves + (row.saves ?? 0),
    shares: sum.shares + (row.shares ?? 0),
    likes: sum.likes + (row.likes ?? 0),
  }), { reach: 0, saves: 0, shares: 0, likes: 0 });

  return (
    <main style={shell}>
      <header style={{ display: "flex", alignItems: "end", justifyContent: "space-between", gap: 16, marginBottom: 30 }}>
        <div>
          <p style={{ ...mono, letterSpacing: ".16em", textTransform: "uppercase", marginBottom: 8 }}>APEX Engine / Operations</p>
          <h1 style={{ fontSize: "clamp(26px, 6vw, 42px)", letterSpacing: "-.04em", lineHeight: 1 }}>Control room</h1>
        </div>
        <span style={mono}>{new Date().toUTCString().slice(0, 16)} UTC</span>
      </header>

      <nav aria-label="Operations sections" style={{ display: "flex", gap: 8, marginBottom: 22, overflowX: "auto" }}>
        {tabs.map((item) => (
          <Link key={item.id} href={"/operations?tab=" + item.id} style={{
            padding: "10px 14px", border: "1px solid " + (activeTab === item.id ? "var(--ember)" : "var(--edge)"),
            color: activeTab === item.id ? "var(--bone)" : "var(--ash)", background: activeTab === item.id ? "var(--ember-dim)" : "transparent",
            textDecoration: "none", fontFamily: "var(--data)", fontSize: 12, letterSpacing: ".08em", textTransform: "uppercase", borderRadius: 3, whiteSpace: "nowrap",
          }}>{item.label}</Link>
        ))}
      </nav>

      {activeTab === "posts" && (
        <section style={panel}>
          <div style={{ padding: 20, borderBottom: "1px solid var(--edge)", display: "flex", justifyContent: "space-between", gap: 16 }}>
            <div><h2 style={{ fontSize: 18 }}>Post queue</h2><p style={{ ...mono, marginTop: 6 }}>Every scheduled item, from plan through publish.</p></div>
            <span style={{ ...mono, color: "var(--ember)" }}>{posts?.length ?? 0} tracked</span>
          </div>
          <div>
            {(posts ?? []).map((post: any) => (
              <article key={post.id} style={{ padding: "16px 20px", borderBottom: "1px solid var(--edge)", display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 14 }}>
                <div>
                  <p style={{ fontSize: 14, lineHeight: 1.4 }}>{post.caption_final || "Creative in progress"}</p>
                  <p style={{ ...mono, marginTop: 8 }}>Pillar {post.pillar} · {post.post_type} · {post.format}</p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span style={{ ...mono, color: post.status === "published" ? "var(--bone)" : "var(--ember)" }}>{post.status.replaceAll("_", " ")}</span>
                  <p style={{ ...mono, marginTop: 8 }}>{new Date(post.slot_at).toUTCString().slice(0, 16)}</p>
                </div>
              </article>
            ))}
            {!posts?.length && <p style={{ padding: 28, ...mono }}>The post queue is empty. The planner will refill it on its next run.</p>}
          </div>
        </section>
      )}

      {activeTab === "insights" && (
        <section>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))", gap: 12, marginBottom: 18 }}>
            {[["Reach", totals.reach], ["Saves", totals.saves], ["Shares", totals.shares], ["Likes", totals.likes]].map(([label, value]) => (
              <div key={String(label)} style={{ ...panel, padding: 20 }}><p style={mono}>{label}</p><strong style={{ display: "block", fontSize: 28, marginTop: 8 }}>{Number(value).toLocaleString()}</strong></div>
            ))}
          </div>
          <div style={{ ...panel, padding: 22 }}>
            <h2 style={{ fontSize: 18 }}>Learning signal</h2>
            <p style={{ ...mono, marginTop: 10, lineHeight: 1.7 }}>Metrics are collected at +24h and +72h. The learner promotes patterns only after enough within-week evidence exists.</p>
            <Link href="/review" style={{ display: "inline-block", marginTop: 20, color: "var(--bone)", fontFamily: "var(--data)", fontSize: 12 }}>Open approval queue →</Link>
          </div>
        </section>
      )}

      {activeTab === "runs" && (
        <section style={panel}>
          <div style={{ padding: 20, borderBottom: "1px solid var(--edge)" }}><h2 style={{ fontSize: 18 }}>Automation runs</h2><p style={{ ...mono, marginTop: 6 }}>Cron health and failures from the engine audit trail.</p></div>
          {(runs ?? []).map((run: any) => (
            <article key={run.id} style={{ padding: "15px 20px", borderBottom: "1px solid var(--edge)", display: "flex", justifyContent: "space-between", gap: 16 }}>
              <div><strong style={{ fontSize: 14 }}>{run.job}</strong>{run.error && <p style={{ ...mono, color: "var(--ember)", marginTop: 6 }}>{run.error}</p>}</div>
              <div style={{ textAlign: "right" }}><span style={{ ...mono, color: run.ok === false ? "var(--ember)" : "var(--bone)" }}>{run.ok === false ? "failed" : run.ok ? "complete" : "running"}</span><p style={{ ...mono, marginTop: 6 }}>{new Date(run.started_at).toUTCString().slice(0, 16)}</p></div>
            </article>
          ))}
          {!runs?.length && <p style={{ padding: 28, ...mono }}>No automation runs recorded yet.</p>}
        </section>
      )}

      {activeTab === "brand" && (
        <section style={panel}>
          <div style={{ padding: 20, borderBottom: "1px solid var(--edge)" }}>
            <p style={{ ...mono, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--ember)" }}>Creative guardrails</p>
            <h2 style={{ fontSize: 24, marginTop: 8 }}>Brand style</h2>
            <p style={{ ...mono, marginTop: 8, lineHeight: 1.7 }}>A working reference for keeping generated posts recognizably APEX.</p>
          </div>
          {brandRules.map(([label, rule]) => (
            <article key={label} style={{ padding: "18px 20px", borderBottom: "1px solid var(--edge)", display: "grid", gridTemplateColumns: "minmax(130px, .3fr) 1fr", gap: 18 }}>
              <strong style={{ fontFamily: "var(--data)", fontSize: 12, color: "var(--bone)", letterSpacing: ".08em", textTransform: "uppercase" }}>{label}</strong>
              <p style={{ fontSize: 14, lineHeight: 1.55, color: "var(--ash)" }}>{rule}</p>
            </article>
          ))}
          <div style={{ padding: 20 }}><Link href="/review" style={{ color: "var(--bone)", fontFamily: "var(--data)", fontSize: 12 }}>Apply these guardrails in Review →</Link></div>
        </section>
      )}
    </main>
  );
}
