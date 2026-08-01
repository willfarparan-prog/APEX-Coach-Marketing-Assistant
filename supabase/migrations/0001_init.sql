-- APEX Creative Engine — core schema
-- Every table here exists to serve one of two jobs:
--   (1) produce a post that obeys the brand constitution
--   (2) remember, with evidence, what worked

create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────
-- 1. CONSTITUTION — the immutable-ish brand laws.
-- The machine may PROPOSE amendments. Only a human sets status='active'.
-- This is the guardrail that stops engagement-chasing from eroding the brand.
-- ─────────────────────────────────────────────────────────────
create table constitution (
  id           uuid primary key default gen_random_uuid(),
  key          text not null,             -- 'prompt_suffix' | 'palette' | 'lighting_law' | 'subject_law' | 'grid_rhythm' | 'banned_models'
  value        jsonb not null,
  version      int  not null default 1,
  status       text not null default 'proposed'  check (status in ('active','proposed','retired')),
  proposed_by  text not null default 'human'     check (proposed_by in ('human','machine')),
  rationale    text,
  created_at   timestamptz not null default now()
);
create unique index constitution_active_key on constitution(key) where status = 'active';

-- ─────────────────────────────────────────────────────────────
-- 2. PILLARS — content strategy, with a locked seed each so the grid coheres.
-- ─────────────────────────────────────────────────────────────
create table pillars (
  code         text primary key,          -- 'A'..'E'
  name         text not null,
  intent       text not null,
  weekly_quota numeric not null,          -- posts per week
  seed         bigint not null,           -- locked per §6 "lock a seed per pillar"
  weight       numeric not null default 1.0,  -- MUTATED BY THE LEARNER
  active       boolean not null default true
);

-- ─────────────────────────────────────────────────────────────
-- 3. IDEA BANK — generated in batches, never on demand.
-- A starved queue is what produces slop.
-- ─────────────────────────────────────────────────────────────
create table ideas (
  id             uuid primary key default gen_random_uuid(),
  pillar         text not null references pillars(code),
  hook           text not null,
  hook_archetype text not null,   -- 'accusation'|'time_decay'|'credential_inversion'|'reframe'|'permission'|'enumeration'
  subject_class  text not null,   -- 'anatomy_fragment'|'equipment_macro'|'empty_space'|'domestic_dark'|'desk'|'surface_texture'
  subject_prompt text not null,   -- the [SUBJECT] slot only — suffix is appended at generate time
  post_type      text not null    check (post_type in ('atmosphere','data','statement')),
  format         text not null    check (format in ('single','carousel','reel','story')),
  caption        text not null,
  cta_type       text not null    check (cta_type in ('waitlist','save','follow','none')),
  overlay_text   text,            -- what the compositor burns in, null for pure atmosphere
  novelty_hash   text not null,   -- sha256 of normalised hook; blocks near-duplicates
  score          numeric,         -- planner's prior, seeded by active lessons
  status         text not null default 'queued' check (status in ('queued','planned','used','killed')),
  kill_reason    text,
  created_at     timestamptz not null default now()
);
create unique index ideas_novelty on ideas(novelty_hash);
create index ideas_pickable on ideas(status, pillar, score desc);

-- ─────────────────────────────────────────────────────────────
-- 4. POSTS — a scheduled slot. feature_vector is FROZEN at plan time:
-- this is what the learner joins outcomes back to. No vector, no learning.
-- ─────────────────────────────────────────────────────────────
create table posts (
  id             uuid primary key default gen_random_uuid(),
  idea_id        uuid references ideas(id),
  pillar         text not null references pillars(code),
  post_type      text not null,
  format         text not null,
  grid_index     int not null,             -- position in the 3-col rhythm, enforces "never two alike adjacent"
  slot_at        timestamptz not null,
  seed           bigint not null,
  model          text not null,
  prompt_full    text,
  status         text not null default 'planned'
                 check (status in ('planned','generating','critique_failed','awaiting_approval',
                                   'approved','rejected','publishing','published','failed')),
  backplate_url  text,
  composite_url  text,                     -- after type/UI overlay
  caption_final  text,
  attempts       int not null default 0,
  feature_vector jsonb not null default '{}'::jsonb,
  ig_media_id    text,
  ig_permalink   text,
  published_at   timestamptz,
  rejected_note  text,                     -- YOUR one-tap reason. High-signal training data.
  created_at     timestamptz not null default now()
);
create index posts_queue on posts(status, slot_at);

-- ─────────────────────────────────────────────────────────────
-- 5. GENERATIONS — every attempt, especially the failures.
-- Critic rejections are how the prompt template learns.
-- ─────────────────────────────────────────────────────────────
create table generations (
  id             uuid primary key default gen_random_uuid(),
  post_id        uuid not null references posts(id) on delete cascade,
  attempt        int not null,
  model          text not null,
  prompt         text not null,
  seed           bigint,
  provider       text not null default 'fal',
  provider_ref   text,
  image_url      text,
  critic_scores  jsonb,      -- {faces:0, hue_count:1, shadow_ratio:0.84, legible_text:0, ember_present:1}
  critic_verdict text        check (critic_verdict in ('pass','fail')),
  critic_notes   text,
  cost_usd       numeric,
  created_at     timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- 6. METRICS — harvested from Instagram Graph API at +24h and +72h.
-- ─────────────────────────────────────────────────────────────
create table metrics (
  id                  uuid primary key default gen_random_uuid(),
  post_id             uuid not null references posts(id) on delete cascade,
  hours_since_publish int not null,
  reach               int, saves int, shares int, likes int,
  comments            int, profile_visits int, follows int,
  raw                 jsonb,
  captured_at         timestamptz not null default now()
);
create unique index metrics_once on metrics(post_id, hours_since_publish);

-- ─────────────────────────────────────────────────────────────
-- 7. OBSERVATIONS — one row per (post × feature × level), normalised
-- WITHIN its publish week. Ranking within week controls for follower growth,
-- which would otherwise make every recent post look like a winner.
-- ─────────────────────────────────────────────────────────────
create table observations (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references posts(id) on delete cascade,
  feature     text not null,     -- 'pillar' | 'hook_archetype' | 'subject_class' | 'cta_type' | 'post_type' | 'model' | 'caption_len_bucket'
  level       text not null,
  week_start  date not null,
  z_saves     numeric,           -- z-score within week
  z_shares    numeric,
  z_reach     numeric,
  created_at  timestamptz not null default now()
);
create index observations_rollup on observations(feature, level);

-- ─────────────────────────────────────────────────────────────
-- 8. LESSONS — the memory. A lesson stays a HYPOTHESIS until it has
-- enough observations. This gate is the whole difference between a system
-- that learns and one that confidently invents a strategy from n=1.
-- ─────────────────────────────────────────────────────────────
create table lessons (
  id           uuid primary key default gen_random_uuid(),
  feature      text not null,
  level        text not null,
  n            int  not null default 0,
  effect       numeric,          -- mean z-score of the composite objective
  std_err      numeric,
  status       text not null default 'hypothesis'
               check (status in ('hypothesis','active','retired','contradicted')),
  statement    text,             -- plain-English, written by the model, GROUNDED in n and effect
  weight_delta numeric default 0,-- what it actually does to planner scoring
  first_seen   timestamptz not null default now(),
  last_updated timestamptz not null default now()
);
create unique index lessons_key on lessons(feature, level);

-- ─────────────────────────────────────────────────────────────
-- 9. RUNS — audit trail. If a cron silently stops, you find out here.
-- ─────────────────────────────────────────────────────────────
create table runs (
  id          uuid primary key default gen_random_uuid(),
  job         text not null,
  ok          boolean,
  summary     jsonb,
  error       text,
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);

-- ─────────────────────────────────────────────────────────────
-- SEED: constitution + pillars, transcribed from the playbook
-- ─────────────────────────────────────────────────────────────
insert into constitution (key, value, status, rationale) values
('prompt_suffix', to_jsonb('Cinematic still, single hard light source, 80% of frame in deep shadow, cool near-black environment (blue-black, not warm), one desaturated ember-red light accent, visible haze and dust particles in the light beam, shallow depth of field, 85mm lens, film grain, no faces visible, no text, no logos, no legible numbers, editorial ad campaign quality.'::text),
 'active', 'Playbook §1 reusable suffix. Appended to every still prompt.'),
('palette', '{"base_hue_range":[240,265],"base":"cool near-true-black","accent":"desaturated ember red","accent_count_max":1,"semantic_colors":"data only, never scene lighting"}'::jsonb,
 'active', 'Playbook §1. One saturated element per frame is the logo substitute.'),
('lighting_law', '{"sources":1,"hardness":"hard","min_shadow_ratio":0.80,"haze":true}'::jsonb,
 'active', 'Playbook §1. Evenly lit = off-brand.'),
('subject_law', '{"faces_allowed":false,"body_treatment":["silhouette","back_of_frame","anatomy_fragment"]}'::jsonb,
 'active', 'Playbook §1. No faces, ever.'),
('grid_rhythm', '{"cycle":["atmosphere","data","statement"],"rule":"never two of the same post_type adjacent"}'::jsonb,
 'active', 'Playbook §1.'),
('banned_models', '["seedream"]'::jsonb,
 'active', 'Playbook §5: Seedream lifts shadows and introduces a second colour.'),
('text_rendering', '{"in_frame_text":false,"exception":"wordmark on physical surface via nano-banana-pro only"}'::jsonb,
 'active', 'Playbook §0. All type composited, never generated.');

insert into pillars (code, name, intent, weekly_quota, seed) values
('A','The Uncomfortable Truth','Names the audience real problem. Highest save/share.', 2, 771001),
('B','Mechanism','Shows how the AI adapts. Converts skeptics.',                        1, 771002),
('C','Product Beauty','UI as art. Builds premium perception.',                          1, 771003),
('D','Build in Public','Solo non-technical founder shipping an AI coach.',              1, 771004),
('E','Atmosphere','Pure mood plus one line. Brand equity, low effort.',                 1.5, 771005);
