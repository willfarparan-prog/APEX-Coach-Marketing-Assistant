"use client";
import { useState } from "react";

export default function Actions({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  async function decide(decision: "approved" | "rejected") {
    setBusy(true);
    const note = decision === "rejected"
      ? window.prompt("What's wrong with it? (optional — this is the highest-signal note in the system)") ?? undefined
      : undefined;
    await fetch("/api/posts/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, decision, note }),
    });
    setDone(decision === "approved" ? "Scheduled" : "Sent back for a re-roll");
  }

  if (done) return <div className="actions"><button disabled>{done}</button></div>;

  return (
    <div className="actions">
      <button className="reject" disabled={busy} onClick={() => decide("rejected")}>Re-roll</button>
      <button className="approve" disabled={busy} onClick={() => decide("approved")}>Schedule</button>
    </div>
  );
}
