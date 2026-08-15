import { db, type Variant } from "@/lib/core";

/**
 * Pulls approved/published posts into the training-image candidate pool.
 * Per HANDOFF.md Phase 2: every post that passed the critic AND got human
 * approval is the highest-signal training data available -- it's been
 * accumulating for months. The unique index on source_post_id makes this
 * safe to re-run; already-promoted posts are silently skipped.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const variant = body?.variant as Variant;
  if (variant !== "dark" && variant !== "light") {
    return Response.json({ ok: false, error: "variant must be 'dark' or 'light'" }, { status: 400 });
  }

  const { data: posts, error: postsErr } = await db.from("posts")
    .select("id, backplate_url")
    .eq("variant", variant)
    .in("status", ["approved", "published"])
    .not("backplate_url", "is", null);
  if (postsErr) return Response.json({ ok: false, error: postsErr.message }, { status: 500 });
  if (!posts?.length) return Response.json({ ok: true, added: 0 });

  const { data: already } = await db.from("training_images")
    .select("source_post_id").eq("variant", variant).not("source_post_id", "is", null);
  const seen = new Set((already ?? []).map((r: any) => r.source_post_id));

  const rows = posts
    .filter((p: any) => !seen.has(p.id))
    .map((p: any) => ({
      variant, url: p.backplate_url, source: "approved_post", source_post_id: p.id, included: true,
    }));
  if (!rows.length) return Response.json({ ok: true, added: 0 });

  const { data: inserted, error: insErr } = await db.from("training_images").insert(rows)
    .select("id, variant, url, caption, source, included, created_at");
  if (insErr) return Response.json({ ok: false, error: insErr.message }, { status: 500 });

  return Response.json({ ok: true, added: rows.length, images: inserted ?? [] });
}
