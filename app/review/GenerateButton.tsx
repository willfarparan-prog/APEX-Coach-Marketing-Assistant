"use client";
import { useState } from "react";

export default function GenerateButton() {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [status, setStatus] = useState("");

  async function go() {
    setState("busy");
    setStatus("");
    try {
      const r = await fetch("/api/posts/generate-more", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: 5 }),
      });
      const data = await r.json();
      if (!data.ok) {
        setStatus(data.error ?? "Something went wrong.");
        setState("idle");
        return;
      }
      setStatus(`${data.fired}/${data.scheduled} firing — refreshing in ~20s…`);
      setState("done");
      setTimeout(() => window.location.reload(), 20000);
    } catch {
      setStatus("Network error — try again.");
      setState("idle");
    }
  }

  return (
    <div className="generate-row">
      <button className="generate-btn" onClick={go} disabled={state !== "idle"}>
        {state === "idle" ? "Generate 5 more" : state === "busy" ? "Starting…" : "Generating…"}
      </button>
      {status && <span className="generate-status">{status}</span>}
    </div>
  );
}
