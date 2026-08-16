# APEX Coach — Project Handoff & Rebuild Blueprint

**Purpose of this document:** complete context transfer. Assume the reader knows nothing about this project. Everything needed to resume work is here.

**Scope note:** Instagram API integration, publishing automation, business verification, and any commercial/multi-tenant work are **deliberately out of scope**. The goal right now is making the generation engine itself work well. Posting stays manual.

Written August 2026. Prices verified at time of writing.

---

## PART 1 — What this project is

### The product

APEX Coach is an autonomous Instagram content engine for a fitness coaching brand, built and operated by a single person (William). It plans content, generates images, critiques them against brand rules, and queues approved posts for manual posting.

The brand voice is: pragmatic, biomechanics-literate, systematic, principle-driven, high-signal, value-first, authoritative. A coach who explains the *why* in mechanical, testable terms — never wellness-influencer language, never motivational-poster copy. Delivery is bold, condensed, direct-address, short declarative sentences, no emoji.

### Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router), React 19, TypeScript |
| Hosting | Vercel (Hobby plan) |
| Database + Storage | Supabase (project `bmmwvxgxmesmgnrncoaj`) |
| Image generation | fal.ai |
| Text + vision AI | Anthropic Claude |

Vercel project: `apex-coach-marketing-assistant`
Team: `team_noJOrCO7vnks6t0AlduWoMVk`
Production URL: `https://apex-coach-marketing-assistant.vercel.app`

---

## PART 2 — Current architecture

### The pipeline

```
Constitution (brand rules, per variant, in DB)
        ↓
Plan        — weekly cron, Mon 06:00 UTC
              writes ideas, schedules posts
        ↓
Generate    — daily cron, 07:00 UTC
              fal.ai renders each post
        ↓
Critic      — fal webhook fires on completion
              Claude vision scores against constitution
              fail → retry (max 2 attempts)
        ↓
Human review — /review page, approve or decline
              decline reason feeds future prompts
        ↓
Post queue  — /post-queue, manual posting
```

A fourth cron, **Learn** (Mon 09:00 UTC), reads engagement metrics on published posts and feeds results back into Plan and Critic. **It is currently dormant** — see "Known gaps" below.

### Dual-variant brand system

Every post is randomly assigned a variant, weighted 80/20 via `LIGHT_VARIANT_WEIGHT` in `lib/plan.ts`:

- **`light`** (80%) — clean, bright, premium athletic-apparel photography. Faces allowed and encouraged.
- **`dark`** (20%) — anonymous, moody, near-black. Faces *never* permitted (this is a hard brand-safety rule, not a style preference).

Each variant has its own complete constitution: palette, lighting law, subject law, prompt suffix. Same pipeline, two rule sets.

### The constitution

Brand rules live in a `constitution` table as versioned rows — never edited in place. Updates use a **retire-and-insert** pattern: set the current `status='active'` row to `'retired'`, then insert a new active row. This gives full history and rollback.

Keys: `palette`, `lighting_law`, `subject_law`, `prompt_suffix`, `text_rendering`, `grid_rhythm`. Each row has a `variant` column.

`constitutionBrief()` in `lib/core.ts` renders the constitution into the prompt text used by both the idea writer and the critic.

### Model routing

`pickModel()` in `lib/plan.ts` decides which fal.ai endpoint to use:

| Condition | Model | Cost |
|---|---|---|
| `format === 'reel'` | `fal-ai/kling-video/v3/pro/image-to-video` | — |
| Reference images exist for variant | `fal-ai/nano-banana-pro/edit` | $0.08 |
| Text in frame wanted + overlay text | `fal-ai/nano-banana-pro` | $0.08 |
| Faces allowed | `fal-ai/nano-banana-pro` | $0.08 |
| Otherwise | `fal-ai/flux-2-pro` | $0.04 |

**Important API detail:** `flux-2-pro` uses an `image_size` enum; `nano-banana-pro` variants use an `aspect_ratio` string. Handled by `sizingParam()` in `lib/providers/fal.ts`.

**Confirmed via fal docs:** reference-image guidance (`image_urls`) is an **edit-endpoint-only** feature. Plain text-to-image endpoints silently ignore it. This is why uploading reference photos changes the routing.

### Reference photos

Uploaded per-variant in Brand Settings. Two distinct mechanisms people confuse:

1. **Runtime conditioning** — while photos are uploaded, up to 5 are sent as literal `image_urls` on *every single generation* for that variant. Ongoing influence, ongoing cost, requires the edit endpoint. "Clear all" stops this immediately.
2. **One-time analysis** — the "Analyze reference photos" button reads up to 4 photos with Claude vision and proposes updated palette/lighting/subject/prompt-suffix values. On "Apply," these are written permanently into the constitution and persist regardless of whether the raw photos stay uploaded.

### Composited overlays

Text elements are **never** AI-generated — they're CSS-composited on top of the image afterward:
- `overlay_text` — main headline, ALL-CAPS
- `eyebrow_text` — small caps line above headline (~1 in 3 posts)
- `metric_cards` — 2–3 data cards (HRV, recovery %, heart rate) for `post_type='data'`
- `annotation_callouts` — biomechanical diagram labels with dotted leader lines; pillar B only, never combined with metric_cards

### Feedback loops

- `humanTastePatches()` — reads your decline reasons, extracts recurring taste preferences (min 2 occurrences), appends as prompt clauses
- `learnedPromptPatches()` — reads critic failure logs, extracts recurring failure modes (min 3 occurrences), appends as prompt clauses

---

## PART 3 — File structure

```
lib/
  core.ts              db client, MODELS, askJSON, sniffMediaType,
                       loadConstitution(s), constitutionBrief,
                       assemblePrompt, archiveImage, withRun, authorised
  critic.ts            critique(), learnedPromptPatches, humanTastePatches
  plan.ts              VOICE const, refillIdeas, pickModel, pickVariant,
                       referenceCounts, scheduleWeek, scheduleOnDemand
  generate.ts          referenceUrlsByVariant, generateForPosts
  providers/fal.ts     ROUTE map, submitImage, sizingParam, estimateCost
  instagram.ts         publishPost, fetchInsights  [dormant, out of scope]

app/
  layout.tsx
  globals.css
  review/              page.tsx, ReviewGrid.tsx, GenerateButton.tsx
  post-queue/          page.tsx, PostQueueClient.tsx
  gallery/             page.tsx
  brand-settings/      page.tsx, BrandSettingsClient.tsx
  api/
    cron/{plan,generate,harvest,learn}/route.ts
    posts/{approve,generate-more,mark-posted}/route.ts
    references/{upload,delete,clear}/route.ts
    brand-settings/{colors,analyze,apply-analysis}/route.ts
    fal/webhook/route.ts
    onboard/analyze/route.ts
    diag/route.ts

vercel.json            cron schedules
package.json
tsconfig.json
```

Total: ~35 files.

### UI pages

- **`/review`** — approval queue. Grid of pending posts, click for lightbox with editable caption, Approve/Decline. Declining prompts for a reason (feeds `humanTastePatches`). "Generate 5 more" button for on-demand generation.
- **`/post-queue`** — approved posts ready for manual posting. Download (blob-based), Copy Caption, Mark as Posted.
- **`/gallery`** — all generations, pass and fail, with critic verdict badges and notes. This is your debugging view.
- **`/brand-settings`** — per-variant panels: hex color pickers, base/accent descriptions, reference photo dropzone (supports drag-drop of individual files, multiple files, or entire folders via `webkitGetAsEntry` recursive walk), "Analyze reference photos," "Clear all."

All pages share a nav: Review | Post Queue | Gallery | Brand Settings.

### Database tables

`constitution` (key, value, status, variant, proposed_by, rationale)
`pillars` (code, name, intent, weight, weekly_quota, seed, active)
`ideas` (pillar, hook, hook_archetype, subject_class, subject_prompt, post_type, format, caption, cta_type, overlay_text, eyebrow_text, metric_cards, annotation_callouts, novelty_hash, score, status)
`posts` (idea_id, pillar, post_type, format, variant, grid_index, slot_at, seed, model, caption_final, backplate_url, feature_vector, status, attempts, rejected_note, prompt_full)
`generations` (post_id, attempt, model, prompt, seed, provider_ref, image_url, archived_url, critic_scores, critic_verdict, critic_notes, cost_usd)
`reference_images` (variant, url, label)
`metrics`, `observations`, `lessons`, `runs`

Storage buckets: `references` (public), `generations` (public)

### Tuning constants

```
IDEA_BANK_FLOOR = 10        IDEA_BATCH_SIZE = 8
MAX_ATTEMPTS = 2            PER_RUN_CAP = 4
LEAD_DAYS = 14              LIGHT_VARIANT_WEIGHT = 0.8
MIN_OBSERVATIONS = 5        MIN_EFFECT = 0.35
OBJECTIVE = { saves: 0.5, shares: 0.3, reach: 0.2 }
```

---

## PART 4 — Hard-won gotchas

**Read this section before changing anything.** Every item here cost real debugging time.

### Deploy mechanics (the big one)

The project has historically been deployed via an MCP tool that requires **the complete ~35-file tree on every single call.** There is no incremental deploy. Consequences:

- The local sandbox (`/home/claude/apex-engine/`) is **not** synced to what's live. `str_replace` and file reads against local paths fail.
- Every change requires reconstructing the entire tree from memory.
- **Features built in earlier sessions have silently vanished** when a later deploy was assembled without them. This happened twice with the "Analyze reference photos" feature.
- `projectSettings: {"framework": "nextjs"}` must be passed on **every** deploy call. Omitting it once caused a real failed deploy (missing public output directory) even though the Next.js build itself succeeded.

**This is the root cause of most bugs in this project's history and Phase 1 exists to eliminate it.**

### Vercel Hobby plan

- Every serverless function is **hard-capped at 60 seconds** regardless of `maxDuration` in code. Setting a higher value does nothing.
- When the cap is hit, the platform kills the function mid-request. The browser receives a raw connection failure, **not** a clean HTTP error — this surfaces as a generic "network error" and is genuinely misleading.
- Workaround pattern: fetch external resources in parallel (`Promise.all`), keep batch sizes small, and have the client check for `status === 504 || status === 408` to show accurate messaging.
- This is why the analyze endpoint fetches 4 images in parallel rather than 8 sequentially.

### Supabase Storage content types

**Never trust the `content-type` header on stored images.** Supabase sets it from the object name, which can disagree with the actual bytes — a `.jpg`-named object can contain PNG data. Anthropic's API strictly rejects any media-type/bytes mismatch with a 500.

Fix in place: `sniffMediaType(buf)` in `lib/core.ts` reads magic bytes and returns the real type. Used by the critic, the analyze endpoint, and onboarding. **Any new code path sending images to Claude must use it.**

### Deployment verification

- `get_deployment_build_logs` with `direction: tail` is the reliable way to check status.
- The `claude-in-chrome` connector is unreliable and times out around 4 minutes. Use `Vercel:web_fetch_vercel_url` to confirm live page content instead.

### Security posture

Infrastructure operations should go through Vercel and Supabase MCP tools, not CLI commands — particularly anything involving credentials or unreviewed migrations.

---

## PART 5 — Known gaps and open bugs

### Fixed: `askJSON` truncation on analyze

**Symptom was:** `analysis model call failed: Unexpected end of JSON input`
**Cause:** Claude's response came back empty or truncated, so `JSON.parse` failed in the `askJSON` wrapper in `lib/core.ts`.
**Fix applied** in `lib/core.ts` / `app/api/brand-settings/analyze/route.ts`:
1. `maxTokens` for the analyze call raised 1400 → 3000
2. Brace-matching JSON extraction (`extractJSON`) so stray text around the object doesn't break parsing
3. Raw response length and `stop_reason` surfaced in the error so the next failure is diagnostic rather than vague

**Status:** fixed in code well before this was noticed, but never actually live — see "Deploy regression" below. Needs re-verification once deployed.

### Fixed: null critic scores

Some passing generations were storing `null` in `critic_scores` with empty `critic_notes` — the critic returned a verdict but omitted the scoring fields.

**Fix applied** in `lib/critic.ts`: `maxTokens` raised to 1800, and the system prompt now explicitly states every JSON field is required on every response including clean passes.

**Status:** same as above — fixed in code, never live, needs re-verification with fresh generations once deployed.

Impact when it does recur: blanks the score bars in the review lightbox, and starves the Learn loop (which needs `critic_scores` at learn time). Blocks nothing operationally today.

### Deploy regression discovered 2026-08-15

The live production app was running a build assembled from small GitHub-web-UI PRs (`willfarparan-prog-patch-1` through `-5`) that forked off the **old** pre-rebuild codebase, not the fuller tree described in this document. Confirmed by visiting the live site: `/brand-settings` and `/gallery` both 404'd, and the nav instead pointed at an `/operations?tab=...` control-room page that doesn't exist in the current architecture at all. In effect, months of work (Brand Settings, Gallery, Post Queue, references API, `plan.ts`/`generate.ts`, both bug fixes above) was live-coded correctly but never actually deployed to production.

This is exactly the failure mode "Deploy mechanics" above warns about, just via a second, uncoordinated deploy path (ad-hoc GitHub web edits) rather than the old full-tree MCP path. Fixed by pushing the complete current tree as a proper branch/PR against `willfarparan-prog/APEX-Coach-Marketing-Assistant` and removing the stale `app/operations` control room and `app/review/Actions.tsx` in favor of the real pages. Also added while in there: `app/page.tsx` (root → `/review` redirect, preserving the one good idea from the stale branch), and `middleware.ts` (Basic Auth gate via `ADMIN_USER`/`ADMIN_PASSWORD`, closing PART 5's "No authentication" gap for $0).

### Dormant: the Learn loop

The Learn cron and its whole statistical apparatus (`observations` → `lessons` → pillar weight adjustment) is fully built but has **never had real data**, because engagement metrics come from Instagram's API, which is deliberately out of scope right now.

**Be honest about this when planning:** until posting/metrics exist, Learn cannot do anything. Don't spend effort tuning it. The parts that *do* work without Instagram are the two prompt-patch loops (`humanTastePatches`, `learnedPromptPatches`), which run off your own decline reasons and critic failures.

### Fixed: no authentication

Every route and API endpoint was unauthenticated beyond the cron secret — anyone with the URL could approve posts, change brand settings, or wipe all reference photos via `/api/references/clear`.

**Fix applied:** `middleware.ts` gates every page and API route except `/api/cron/*` and `/api/fal/webhook` (which already carry their own secret) behind HTTP Basic Auth. Fails open — i.e. stays unauthenticated — until `ADMIN_USER` and `ADMIN_PASSWORD` are set on Vercel, so set them promptly after this deploys.

### RLS disabled on 10 core tables

`constitution`, `pillars`, `ideas`, `posts`, `generations`, `metrics`, `observations`, `lessons`, `runs`, `reference_images` have Row Level Security disabled — fully exposed to the anon/authenticated PostgREST roles. Not currently exploitable through this app's own UI (everything goes through Next.js API routes using the service-role key, which always bypasses RLS), but anyone with the anon key from `.env`/client bundle could hit Supabase's REST API directly.

`supabase/migrations/0002_enable_rls.sql` enables RLS on all ten with no policies — safe for this app since nothing needs anon-role access to these tables. Written, not yet applied.

### Housekeeping

Duplicate empty Vercel projects from early build — flagged for deletion, status unconfirmed.

---

## PART 6 — Recent work completed

For context on what's already been tried:

- **Brand voice update** — the 7-word tone summary folded into `VOICE` in `lib/plan.ts` as primary tone, layered over pre-existing sentence-level delivery guidance.
- **Brand Settings page built** — hex pickers, reference upload, per-variant panels.
- **Critic loosening** — after querying real failure data (69 fail / 86 pass / 8 null). Genuinely loosened: shadow floor tolerance widened ~20% relative, incidental/background saturated colors no longer count against the accent limit (real trademarked logos still fail), physique never fails a frame alone, soft ambient fill light no longer counts as a second light source. Kept deliberately strict: garbled/misspelled text, distorted faces, dark-variant anonymity.
- **Root-cause fix for the dominant failure mode** — roughly half of all rejections were light-variant frames rendering dark/moody. Fixed at the cause by strengthening the light-variant `prompt_suffix` with an explicit negative constraint, *not* by loosening the critic.
- **Clear references + folder drag-drop upload** — per-variant "Clear all" scoped to explicit IDs (avoids wiping concurrent uploads); dropzone supports folders via recursive directory walk.
- **Analyze photos feature** — built, silently dropped in a redeploy, rebuilt.
- **Timeout fix** — parallel image fetch + 4-image cap on the analyze endpoint.
- **Media-type fix** — `sniffMediaType` magic-byte detection.

---

# PART 7 — The rebuild blueprint

Ordered by value per dollar. Each phase is independently useful.

---

## Phase 1 — Foundation (Week 1) — **$0**

Nothing here costs money. Everything here prevents future bugs.

### 1.1 Get the code into git properly

A GitHub repo exists but is unused for deploys. Push the current tree, connect Vercel's native git integration, and abandon the full-tree MCP deploy path entirely.

Verify by pushing a one-line change and watching it deploy. That loop being reliable is the entire point of this phase.

### 1.2 Branch strategy

`main` → production, `dev` → preview. Preview deploys are free on Hobby. Every change lands on `dev` first.

### 1.3 Environment parity

Document every variable in `.env.example`:
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `FAL_KEY`, `CRON_SECRET`, `PUBLIC_URL`

### 1.4 Add authentication

Cheapest real option: Supabase Auth (free tier, already in the stack) with a single admin user. Alternative: Vercel's built-in password protection.

Five-minute fix that closes a real hole — `/api/references/clear` will currently wipe 40 reference photos for anyone who finds the URL.

### 1.5 Fix the two open bugs

Apply the `askJSON` fix (maxTokens 3000, brace-matching extraction, diagnostic errors) and re-verify the critic null-scores fix with fresh generations.

**Phase 1 outcome:** reliable deploys, no open endpoints, no known bugs. Everything after this is much easier.

---

## Phase 2 — Build the training dataset (Week 2) — **$0**

This is prep for Phase 3 and costs nothing but attention.

### 2.1 Add a `training_images` table

```
training_images
  id, variant, url, caption,
  source (approved_post | uploaded_reference),
  included_in_version, created_at
```

### 2.2 Backfill from approved posts

Every post that passed the critic **and** got human approval is a training candidate. You have been accumulating this dataset for months without realizing it — it's the highest-signal data available because it cleared both an automated brand check and your own taste.

### 2.3 Add a curation UI

A simple grid on Brand Settings: every candidate image, per variant, with an include/exclude toggle and an editable caption field. This is where the real work of Phase 3 happens, so make it pleasant to use.

### 2.4 Auto-caption

You already have Claude vision wired up via the analyze endpoint. Reuse it to draft captions for each training image, then hand-correct. Use a consistent trigger token per variant (`apexlight`, `apexdark`).

**Phase 2 outcome:** a curated, captioned, versioned dataset ready to train on.

---

## Phase 3 — LoRA training (Weeks 3–4) — **~$10–25 total**

The core upgrade. Much cheaper than most people expect.

### 3.1 Why this matters here

Right now brand consistency is enforced two ways, both at inference time:
- Prompt engineering (`prompt_suffix`)
- Reference-image conditioning (`image_urls` on every call)

Neither is a trained model. Both are steering an off-the-shelf model every single time, which is exactly why the light variant kept drifting dark despite an explicit prompt telling it not to.

A LoRA is trained once and applied cheaply. It also frees you from the edit endpoint ($0.08/image), which you're currently forced onto purely because reference images require it.

### 3.2 Training costs (verified August 2026)

| Endpoint | Price | Notes |
|---|---|---|
| `fal-ai/flux-lora-fast-training` | *approx* $2/run | Fastest; style + subject; commercial rights included |
| `fal-ai/turbo-flux-trainer` | $2.40 / 1000 steps | 2000 steps = $4.80 |
| `fal-ai/flux-lora-general-training` | $0.005 / step | ~$5 for 1000 steps |
| `fal-ai/flux-lora-portrait-trainer` | $0.0024 / step, 1000 min | Portrait-optimized — relevant for the light variant |
| `fal-ai/flux-kontext-trainer` | $2.50 / 1000 steps, 500 min | Trains on before/after *pairs*, not single images |

Industry consensus matches: **$2–$5 per FLUX style LoRA run.** Budget 3–5 runs while dialing in hyperparameters → **$10–25 all-in.**

Worth knowing: OpenAI announced in May 2026 that its self-serve fine-tuning platform is winding down, with no new fine-tuning jobs accepted after January 2027. Open-model LoRA on infrastructure you control is now the durable path — this project is already on the right side of that.

### 3.3 Dataset requirements

**20–40 images per variant.** Quality massively over quantity — 25 excellent on-brand images beat 100 mediocre ones.

Rules:
- **Consistency is the whole game.** Every image should share the lighting, palette, and composition language you want learned. One off-brand image in 25 measurably pollutes the result.
- **Train two separate LoRAs**, one per variant. Never mix light and dark into one model — you'll get a muddy average of both. The existing variant separation makes this clean.
- **Exclude anything with baked-in text.** Your text is composited afterward; you don't want the model learning to hallucinate letterforms.
- Caption consistently, with the variant's trigger token.

### 3.4 Where training runs

Training takes minutes to hours and **cannot run in a Vercel function** (60s hard cap). Options, cheapest first:

1. **Manual ($0)** — trigger training from fal's dashboard or CLI, paste the resulting weight URL into a `lora_models` row by hand. Entirely reasonable at your volume; you'll retrain maybe monthly.
2. **Job queue (free tier)** — Trigger.dev (Apache-2.0, self-hostable) or Inngest. Free tier limits were reported inconsistently across every source I checked (anywhere from 1k to 50k runs/month) — **check trigger.dev/pricing and inngest.com/pricing directly before relying on a number.**
3. **Simplest queue** — Upstash QStash (~500 messages/day free) if all you need is "kick off a job, poll it," which is genuinely all this requires.

Start with option 1. Only add infrastructure when manual becomes annoying.

### 3.5 New table

```
lora_models
  id, variant, version, weight_url, trigger_token,
  training_image_count, base_model, steps, status,
  trained_at, notes, is_active
```

### 3.6 Wire into generation

Modify `pickModel()` / `submitImage()` with this precedence:

1. Active LoRA for variant → `fal-ai/flux-lora` with `loras: [{ path: weight_url, scale: 0.8–1.0 }]`
2. No LoRA but reference images exist → current edit-endpoint behavior (fallback)
3. Neither → current base-model behavior

Then **shorten `prompt_suffix` dramatically.** A trained model already knows the look; a heavy descriptive suffix now fights the weights instead of helping. Keep the negative constraints (no logos, no garbled text, no faces for dark variant), drop most of the descriptive styling.

### 3.7 Evaluation — do not skip

Before promoting any LoRA to active:

1. Generate 10 images with the new LoRA and 10 with current setup, identical prompts.
2. Run both sets through the existing critic.
3. Compare pass rates and failure categories.
4. Promote only on measured improvement.

**You already have an automated brand-compliance scorer.** That's an unusually strong position for evaluating a fine-tune — most people training LoRAs are eyeballing results. Use it.

Keep prior versions with `is_active=false` rather than deleting. Instant rollback.

**Phase 3 outcome:** brand consistency from trained weights rather than prompt-wrangling; likely lower per-image cost; the light-variant drift problem addressed at the root.

---

## Phase 4 — Hardening (Month 2) — **$0–20/month**

Only as actual need appears.

- **Error tracking** — Sentry free tier. Today `console.error` goes nowhere anyone reads; the media-type bug was only found by manually pulling runtime logs.
- **Cron health monitoring** — healthchecks.io free tier. Each cron pings on success; you get alerted when a ping doesn't arrive. A dead cron currently fails silently and invisibly.
- **Vercel Pro ($20/mo)** — **don't buy yet.** Phase 3's job queue removes the main reason you'd want it, and the 60s cap only ever hurt the analyze endpoint, which is now fixed within the limit.
- **Audit trail** — who approved what, when, and which model version produced it. Cheap now, painful to retrofit.

---

## Cost summary

**Today:**
- Vercel Hobby, Supabase free tier: $0
- fal.ai: $0.04–0.08 per image
- Anthropic: pennies per post

**After Phase 3:**
- One-time LoRA training: $10–25
- Occasional retraining: $2–5, roughly monthly
- Job queue: $0 (free tier or manual)
- **Net: roughly +$5/month, with likely *lower* per-image cost** once off the edit endpoint

**The expensive input is curation time, not compute.** LoRA training is remarkably cheap in 2026. Spend your effort picking the right 25 images per variant, not optimizing training spend.

---

## Condensed sequence

1. Push to git, wire Vercel git deploys
2. Add auth
3. Fix `askJSON` truncation; re-verify critic null-scores
4. Add `training_images` table, backfill from approved posts
5. Build curation UI, auto-caption, hand-correct
6. Curate 20–40 images per variant ← *the real work*
7. Train two LoRAs (~$5 each)
8. Evaluate against current setup using the existing critic
9. Wire LoRA into `pickModel`, shorten `prompt_suffix`
10. Add Sentry + cron healthchecks when silent failures next bite

Steps 1–3 are a weekend and eliminate the class of bug that has dominated this project's history. Steps 4–9 are the interesting part and cost less than a nice dinner.

---

## Explicitly deferred

Do not build these yet. Listed so they're not forgotten:

- Instagram API integration and automated publishing
- Meta App Review / business verification
- The Learn loop (dormant until engagement data exists)
- Multi-tenant / `tenant_id` on tables
- Billing, Stripe, any commercial layer
- Adopting a third-party scheduler (Postiz et al.) — relevant only at multi-platform or multi-brand scale

---

## Reference material

- fal.ai model pages for current training prices — **re-check before budgeting, these change**
- `gitroomhq/postiz-app` — mature self-hosted scheduler, for whenever publishing comes back into scope
- `inbharatai/SocialFlow` — Scout → Planner → Creator → Reviewer → Publisher → Analyst pipeline; maps closely onto this project's cron structure and is useful for stage-boundary naming

**Verify before committing budget:** background-job free tiers were reported inconsistently across every source consulted. Check vendor pricing pages directly.
