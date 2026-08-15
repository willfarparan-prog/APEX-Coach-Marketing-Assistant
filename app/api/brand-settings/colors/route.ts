import { db } from "@/lib/core";

/** Retire-and-insert: never edit constitution rows in place. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const variant: string = body?.variant;
  const palette = body?.palette;
  if (!variant || !palette) return Response.json({ ok: false, error: "variant and palette required" }, { status: 400 });

  const hexOk = (v: any) => typeof v !== "string" || v === "" || /^#[0-9a-fA-F]{6}$/.test(v);
  for (const k of ["base_hex", "surface_hex", "text_hex", "text_secondary_hex", "accent_hex"]) {
    if (!hexOk(palette[k])) return Response.json({ ok: false, error: `${k} is not a valid hex color` }, { status: 400 });
  }

  try {
    const { data: current, error: readErr } = await db.from("constitution")
      .select("value").eq("key", "palette").eq("variant", variant).eq("status", "active").maybeSingle();
    if (readErr || !current) return Response.json({ ok: false, error: "could not load current palette" }, { status: 500 });

    const merged = { ...current.value, ...palette };

    await db.from("constitution").update({ status: "retired" })
      .eq("key", "palette").eq("variant", variant).eq("status", "active");

    const { error: insErr } = await db.from("constitution").insert({
      key: "palette", value: merged, status: "active", variant,
      proposed_by: "human", rationale: "Updated via Brand Settings colour form.",
    });
    if (insErr) return Response.json({ ok: false, error: insErr.message }, { status: 500 });

    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
