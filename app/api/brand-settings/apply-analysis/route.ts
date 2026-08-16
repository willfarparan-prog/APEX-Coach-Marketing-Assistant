import { db } from "@/lib/core";

/**
 * Writes a previously-proposed analysis permanently into the constitution.
 * Once applied, these rules persist independent of whether the raw reference
 * photos stay uploaded or get cleared via /api/references/clear.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const variant: string = body?.variant;
  const proposal = body?.proposal;
  if (!variant || !proposal) return Response.json({ ok: false, error: "variant and proposal required" }, { status: 400 });

  const rows = [
    { key: "palette", value: proposal.palette },
    { key: "lighting_law", value: proposal.lighting_law },
    { key: "subject_law", value: proposal.subject_law },
    { key: "prompt_suffix", value: proposal.prompt_suffix },
  ].filter(r => r.value != null);

  try {
    for (const r of rows) {
      await db.from("constitution").update({ status: "retired" })
        .eq("key", r.key).eq("variant", variant).eq("status", "active");

      const { error } = await db.from("constitution").insert({
        key: r.key, value: r.value, status: "active", variant,
        proposed_by: "human", rationale: proposal.rationale ?? "Applied from reference-photo analysis.",
      });
      if (error) return Response.json({ ok: false, error: `failed writing ${r.key}: ${error.message}` }, { status: 500 });
    }
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
