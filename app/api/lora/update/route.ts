import { db } from "@/lib/core";

/**
 * Single flexible update for a lora_models row: tune scale/notes, or
 * activate/deactivate. Activating enforces one-active-per-variant by
 * deactivating siblings first (matches the partial unique index in the
 * 0003 migration) and requires status='ready' -- can't promote a model
 * that hasn't finished training.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const id: string = body?.id;
  if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });

  if (typeof body?.is_active === "boolean") {
    const { data: row, error: readErr } = await db.from("lora_models").select("variant, status").eq("id", id).maybeSingle();
    if (readErr || !row) return Response.json({ ok: false, error: readErr?.message ?? "not found" }, { status: 404 });

    if (body.is_active && row.status !== "ready") {
      return Response.json({ ok: false, error: "only a ready LoRA can be activated" }, { status: 400 });
    }
    if (body.is_active) {
      await db.from("lora_models").update({ is_active: false }).eq("variant", row.variant).eq("is_active", true);
    }
    const { error } = await db.from("lora_models").update({ is_active: body.is_active }).eq("id", id);
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  const patch: Record<string, any> = {};
  if (body?.scale != null) {
    const scale = Number(body.scale);
    if (!(scale > 0 && scale <= 1.5)) return Response.json({ ok: false, error: "scale must be between 0 and 1.5" }, { status: 400 });
    patch.scale = scale;
  }
  if (typeof body?.notes === "string") patch.notes = body.notes;

  if (Object.keys(patch).length) {
    const { error } = await db.from("lora_models").update(patch).eq("id", id);
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}
