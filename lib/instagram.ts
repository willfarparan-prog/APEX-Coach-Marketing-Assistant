/**
 * Instagram Graph API. Requires a Business account linked to a Facebook Page,
 * a long-lived Page access token, and app review for instagram_content_publish
 * + instagram_manage_insights. Publishing cap is 50 API posts / 24h — far above
 * anything this engine will ever need.
 */
const V = "v25.0"; // current stable as of mid-2026 — bump per Meta's ~2x/year release cadence
const BASE = `https://graph.facebook.com/${V}`;

function token() { return process.env.IG_ACCESS_TOKEN!; }
function igUser() { return process.env.IG_USER_ID!; }

/** Two-step: create a container, then publish it. */
export async function publishPost(opts: { imageUrl: string; caption: string }) {
  const create = await fetch(`${BASE}/${igUser()}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_url: opts.imageUrl, caption: opts.caption, access_token: token(),
    }),
  }).then(r => r.json());
  if (create.error) throw new Error(create.error.message);

  // Containers need a moment to finish server-side processing.
  await new Promise(r => setTimeout(r, 4000));

  const pub = await fetch(`${BASE}/${igUser()}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: create.id, access_token: token() }),
  }).then(r => r.json());
  if (pub.error) throw new Error(pub.error.message);

  const meta = await fetch(`${BASE}/${pub.id}?fields=permalink&access_token=${token()}`)
    .then(r => r.json());
  return { id: pub.id as string, permalink: meta.permalink as string | undefined };
}

const METRICS = ["reach", "saved", "shares", "likes", "comments", "profile_visits", "follows"];

export async function fetchInsights(mediaId: string) {
  const res = await fetch(
    `${BASE}/${mediaId}/insights?metric=${METRICS.join(",")}&access_token=${token()}`
  ).then(r => r.json());

  const get = (k: string) =>
    res?.data?.find((d: any) => d.name === k)?.values?.[0]?.value ?? null;

  return {
    reach: get("reach"), saves: get("saved"), shares: get("shares"),
    likes: get("likes"), comments: get("comments"),
    profile_visits: get("profile_visits"), follows: get("follows"),
    raw: res,
  };
}
