# APEX Coach — Content Engine

Autonomous Instagram content engine for a fitness coaching brand. Plans content, generates images, critiques them against versioned brand rules, and queues approved posts for manual posting.

**New here? Read `HANDOFF.md` first.** It contains full architecture context, hard-won gotchas, known bugs, and the phased rebuild plan. This README is just orientation.

---

## Quick start

```bash
npm install
cp .env.example .env.local   # fill in real values
npm run dev
```

Open `http://localhost:3000/review`.

---

## Stack

Next.js 15 (App Router) · React 19 · TypeScript · Vercel (Hobby) · Supabase · fal.ai · Anthropic Claude

---

## The pipeline

```
Constitution → Plan (weekly cron) → Generate (daily cron)
            → Critic (fal webhook) → Human review → Post queue
```

A fifth piece, the Learn cron, is built but **dormant** — it needs engagement metrics that require Instagram integration, which is intentionally out of scope. See `HANDOFF.md`.

---

## Pages

| Route | Purpose |
|---|---|
| `/review` | Approval queue. Approve/decline, edit captions, generate more. |
| `/post-queue` | Approved posts. Download image, copy caption, mark posted. |
| `/gallery` | Every generation, pass and fail, with critic notes. Debug view. |
| `/brand-settings` | Per-variant palette, reference photos, analyze, clear. |

---

## Two brand variants

- **`light`** (80% of posts) — clean, bright, faces allowed
- **`dark`** (20%) — anonymous, moody, **faces never permitted**

Each has its own complete constitution. Same pipeline, two rule sets.

---

## Three things that will bite you

1. **Vercel Hobby hard-caps functions at 60 seconds** regardless of `maxDuration`. Exceeding it kills the request mid-flight and surfaces as a misleading generic "network error" in the browser, not a clean HTTP error.

2. **Never trust Supabase Storage content-type headers.** They're set from the object name, not the bytes. Always use `sniffMediaType()` from `lib/core.ts` before sending images to Claude.

3. **Constitution rows are never edited in place.** Retire the active row, insert a new one. This preserves history and makes rollback trivial.

---

## Environment variables

See `.env.example`. Instagram vars are intentionally commented out — with them unset, the harvest cron runs and no-ops safely.

`ADMIN_USER` / `ADMIN_PASSWORD` gate every page and API route (except the crons and the fal webhook, which have their own secret) behind HTTP Basic Auth via `middleware.ts`. The site stays unauthenticated until both are set on Vercel.

---

## Cron schedule

Defined in `vercel.json`:

| Job | Schedule (UTC) |
|---|---|
| plan | Mon 06:00 |
| generate | daily 07:00 |
| harvest | daily 18:00 |
| learn | Mon 09:00 |

All cron routes require `Authorization: Bearer ${CRON_SECRET}`.

---

## Known open items

- Composited overlays are preview-only — not baked into downloaded images
- Learn loop dormant pending engagement data
- RLS is disabled on 10 core tables (migration `0002_enable_rls.sql` is written but not yet applied — see `HANDOFF.md`)

Details and fixes in `HANDOFF.md`.
