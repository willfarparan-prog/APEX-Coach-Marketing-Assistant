/**
 * Instagram publishing + insights.
 *
 * STATUS: OUT OF SCOPE / DORMANT.
 * This module is fully written but never runs, because IG_ACCESS_TOKEN and
 * IG_USER_ID are intentionally unset. The harvest cron checks for those vars
 * and skips this entire path when absent.
 *
 * Consequence to be aware of: the Learn loop (observations -> lessons) depends
 * on metrics produced here. Until publishing is enabled, Learn has no data and
 * cannot promote any lesson. Do not spend time tuning Learn thresholds until
 * this is live.
 */
const V = "v25.0";
const BASE = `https://graph.facebook.com/${V}`;

function token() { return process.env.IG_ACCESS_TOKEN!; }
function igUser() { return process.env.IG_USER_ID!; }

export async function publishPost(opts: { imageUrl: string; caption: string }) {
  const create = await fetch(`${BASE}/${igUser()}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_url: opts.imageUrl, caption: opts.caption, access_token: token() }),
  }).then(r => r.json());
  if (create.error) throw new Error(create.error.message);

  await new Promise(r => setTimeout(r, 4000));

  const pub = await fetch(`${BASE}/${igUser()}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: create.id, access_token: token() }),
  }).then(r => r.json());
  if (pub.error) throw new Error(pub.error.message);

  const meta = await fetch(`${BASE}/${pub.id}?fields=permalink&access_token=${token()}`).then(r => r.json());
  return { id: pub.id as string, permalink: meta.permalink as string | undefined };
}

const METRICS = ["reach", "saved", "shares", "likes", "comments", "profile_visits", "follows"];

export async function fetchInsights(mediaId: string) {
  const res = await fetch(`${BASE}/${mediaId}/insights?metric=${METRICS.join(",")}&access_token=${token()}`).then(r => r.json());
  const get = (k: string) => res?.data?.find((d: any) => d.name === k)?.values?.[0]?.value ?? null;
  return {
    reach: get("reach"), saves: get("saved"), shares: get("shares"),
    likes: get("likes"), comments: get("comments"),
    profile_visits: get("profile_visits"), follows: get("follows"), raw: res,
  };
}
