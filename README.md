# APEX Engine

An autonomous Instagram content machine for APEX Coach. It plans, generates, self-critiques, publishes, measures, and revises its own priors — with exactly one human touchpoint: a tap on `/review`.

## The five loops

| Loop | Schedule (UTC) | What it does |
|---|---|---|
| **plan** | Mon 06:00 | Refills the idea bank when it drops below 25. Schedules the week's slots against pillar quotas and the 3-column grid rhythm. Freezes a `feature_vector` on every post. |
| **generate** | Daily 07:00 | Assembles `subject + suffix + learned patches`, fires fal jobs 5 days ahead of slot. Varies seed on retries. |
| **critic** | on fal webhook | Vision-checks every frame against the constitution. Pass → your queue. Fail → re-roll, reason logged. |
| **harvest** | Hourly | Publishes approved posts at their slot. Pulls Instagram insights at +24h and +72h. |
| **learn** | Mon 09:00 | Z-scores each post *within its publish week*, explodes it into feature observations, promotes findings to lessons only past the evidence gate. |

## Setup order

1. **Supabase** — new project, run `supabase/migrations/0001_init.sql`. Seeds the constitution and pillars from the playbook.
2. **fal.ai** — grab `FAL_KEY`. No approval process, pay per image.
3. **Anthropic** — `ANTHROPIC_API_KEY`.
4. **Vercel** — import the repo, set env vars from `.env.example`, deploy. `CRON_SECRET` is auto-provisioned; copy it into `PUBLIC_URL`-adjacent config for the fal webhook.
5. **Instagram** — this is the slow one, start it first. Business account → linked Facebook Page → Meta app → App Review for `instagram_content_publish` and `instagram_manage_insights`. Allow one to three weeks. Until it clears, the machine runs end-to-end and stops at `approved`; you post manually from the review screen.

**Vercel plan:** the hourly `harvest` cron needs Pro. On Hobby, drop it to daily and accept that insights land in a wider window — the learner only reads the +72h mark, so nothing breaks.

## What "self-refining" actually means here

Two feedback loops, deliberately different in speed and trust.

**Fast loop — the critic.** Every rejected frame logs a `prompt_patch`. `learnedPromptPatches()` reads the last 60 failures and extracts only patterns appearing 3+ times, appending them to future prompts. This fixes generator drift within days and needs no human input.

**Slow loop — the learner.** A feature level must clear **5 observations**, an effect of **0.35 within-week standard deviations**, and effect > standard error before it becomes an `active` lesson. Below that it sits in the table as a `hypothesis` and changes nothing.

That gate is the point. At five posts a week the temptation is to let a model read last week's numbers and write a strategy. It will happily do that from n=1, and what you get is confident fiction that compounds. Here, findings accumulate as numbers first and become English only once they've earned it.

The learner can adjust **pillar weights** automatically. It cannot touch the **constitution** — it can only propose amendments with `status='proposed'`, which you promote by hand. That asymmetry is what stops engagement-chasing from slowly eroding the brand into whatever performs this month.

## Honest limits

- **Statistical power is low by design.** Expect the first `active` lesson around week 6–8. Anything faster would be noise.
- **Carousels and Reels** publish through different container flows than the single-image path in `lib/instagram.ts`. Single images work today; the other two need their own builders.
- **The compositor is not built yet** — `composite_url` is wired through but nothing populates it. Until then the review screen previews overlay text in CSS and publishes the raw backplate. Next build step.
- **Real APEX UI** (Pillars B and C) needs screenshots on disk. Point the `/edit` route at them via `referenceImages` once you have a capture flow.
- **Nothing here posts without you.** By design, per your choice. Flipping to full auto is one line in `harvest`.
