# Setup — from zero to deployed

Do **Track A** first, start to finish (about 20 minutes). Start **Track B** the moment you're done with A — it has a 1–4 week wait baked in, so the sooner it's in Meta's queue, the sooner you're fully autonomous. Everything runs and queues correctly without Track B; you'll just be tapping "Post manually" on the review screen until it clears.

---

## Track A — the app (today)

### 1. Supabase
1. [supabase.com](https://supabase.com) → **New project**. Pick a region close to you, save the DB password somewhere.
2. Once it's provisioned: **SQL Editor** → **New query** → paste the entire contents of `supabase/migrations/0001_init.sql` → **Run**.
3. **Project Settings → API** → copy:
   - `Project URL` → this is `SUPABASE_URL`
   - `service_role` secret (not `anon`) → this is `SUPABASE_SERVICE_ROLE_KEY`

The service_role key bypasses row-level security — that's intentional, it's only ever used server-side from your Vercel functions, never shipped to a browser.

### 2. fal.ai
1. [fal.ai](https://fal.ai) → sign up → **Dashboard → Keys** → create a key.
2. That's `FAL_KEY`. No approval process, pay-as-you-go per generation.

### 3. Anthropic
1. [console.anthropic.com](https://console.anthropic.com) → **API Keys** → create one.
2. That's `ANTHROPIC_API_KEY`. Add a few dollars of credit — idea generation and the critic run on this.

### 4. Push the code
```bash
cd apex-engine
git init && git add -A && git commit -m "apex engine"
gh repo create apex-engine --private --source=. --push
# no gh CLI? create an empty repo on github.com, then:
# git remote add origin https://github.com/<you>/apex-engine.git
# git branch -M main && git push -u origin main
```

### 5. Deploy to Vercel
1. [vercel.com/new](https://vercel.com/new) → import the `apex-engine` repo.
2. **Environment Variables** — add everything from `.env.example` *except* `CRON_SECRET` and `PUBLIC_URL`:
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `FAL_KEY`.
3. **Deploy.** Vercel auto-generates `CRON_SECRET` the moment it sees `crons` in `vercel.json` — you don't set it.
4. After the first deploy, copy your production URL (`apex-engine-xyz.vercel.app` or your custom domain).
5. **Settings → Environment Variables** → add `PUBLIC_URL` = that URL → **Deployments → ⋯ → Redeploy** (this is the one chicken-and-egg step: fal's webhook needs to know where to call back, and that address doesn't exist until after the first deploy).

At this point: visit `yourapp.vercel.app/review` — it'll show "Nothing to review" because the planner hasn't run yet.

### 6. Fire the planner manually once, so you don't wait for Monday
```bash
curl -H "Authorization: Bearer <your CRON_SECRET, from Vercel env vars tab>" \
  https://yourapp.vercel.app/api/cron/plan
```
Then trigger generation:
```bash
curl -H "Authorization: Bearer <CRON_SECRET>" https://yourapp.vercel.app/api/cron/generate
```
Give it a few minutes — fal generates, calls the webhook, the critic runs — then refresh `/review`. First frames should appear.

**Vercel plan note:** Hobby's cron minimum is once/day, so the hourly `harvest` schedule in `vercel.json` will fail to deploy on Hobby. Either upgrade to Pro ($20/mo — also buys you Fluid compute, useful since the critic call can run 10–20s), or edit `vercel.json` before deploying:
```json
{ "path": "/api/cron/harvest", "schedule": "0 14 * * *" }
```

---

## Track B — Instagram publishing (start now, finishes in the background)

You're on a personal account. Three conversions, then a review queue.

**B1. Convert to a Professional account.** In the Instagram app: profile → menu (☰) → **Settings and activity → Account type and tools → Switch to professional account** → choose **Business** (not Creator — Creator accounts can't use the publishing API) → pick any category, it's cosmetic.

**B2. Create or link a Facebook Page.** Same flow offers to connect a Page. If you don't have one, choose **Create a new Page** right there — it can be minimal, it exists only as the API's authentication anchor. You must be an Admin on it.

**B3. Create the Meta app.**
1. [developers.facebook.com](https://developers.facebook.com) → **My Apps → Create App** → type **Business**.
2. Add the **Instagram Graph API** product from the dashboard (without it the Instagram-specific permission scopes won't even appear during OAuth).
3. **App Roles → Roles**, add yourself as an Instagram Tester if prompted, so you can test against your own account before review.

**B4. Get a token and your IG user ID.** Use the **Graph API Explorer** (linked from your app dashboard): select your app, generate a User Access Token with `pages_show_list`, `instagram_basic`, and the publish/insights scopes below, then call `GET /me/accounts` to find your Page, then `GET /{page-id}?fields=instagram_business_account` to get your IG user ID. Exchange the short-lived token for a long-lived one (60 days, refreshable) per Meta's token guide linked from the Explorer.
- `IG_USER_ID` = the ID you got back
- `IG_ACCESS_TOKEN` = the long-lived token

Add both to Vercel's env vars now — this lets you test publishing to your *own* account immediately, before review finishes, since Meta allows up to 25 test users pre-review.

**B5. Submit for App Review.** Request `instagram_basic` and the content-publish + insights permissions (Meta's exact scope name has shifted between `instagram_content_publish` and `instagram_business_content_publish` over the past year — your app dashboard will show the current name live, use whichever it lists). Each permission needs its own screencast showing the real flow: your `/review` screen, tapping approve, the post landing on Instagram. Budget **2–4 weeks**.

Until it's approved, `harvest` will fail to publish for anyone but you as a tester — which, since this is your own account, is actually fine for now.

---

## Sanity checklist before you walk away

- [ ] `/review` loads and shows the empty state, not an error
- [ ] Manual `plan` → `generate` produced at least one card with a passing critic scorecard
- [ ] Approving a card flips its status (check the `posts` table in Supabase)
- [ ] `runs` table in Supabase has rows with `ok: true` — this is your dead-man's switch. If a cron silently stops, you'll see it stop appending here before you see it anywhere else.
- [ ] Instagram: at minimum B1–B4 done, so `harvest` can publish to your own account as a tester while B5 is in flight
