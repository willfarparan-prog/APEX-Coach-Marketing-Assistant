import { db } from "@/lib/core";

/**
 * Bulk-clears reference images for a variant so future generations stop being
 * influenced by them. Scoped to explicit ids passed from the client (the set the
 * user actually saw) rather than a blind delete-all-by-variant, so a concurrent
 * upload from another tab can't get silently wiped.
 *
 * SECURITY: currently unauthenticated. Anyone with the URL can wipe all
 * reference photos. Phase 1 of the blueprint addresses this.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const variant: string = body?.variant;
  const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];
  if (!variant) return Response.json({ ok: false, error: "variant required" }, { status: 400 });

  const query = db.from("reference_images").delete().eq("variant", variant);
  const { error } = ids.length ? await query.in("id", ids) : await query;
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}
