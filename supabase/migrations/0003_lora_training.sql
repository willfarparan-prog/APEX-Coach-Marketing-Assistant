-- Phase 3 (LoRA training), per HANDOFF.md. Two new apex-coach-specific
-- tables. NOTE: this Supabase project also hosts an unrelated app
-- ("flowforge") with its own workflows/executions/trained_loras tables --
-- do not confuse that trained_loras with this file's lora_models, they
-- share nothing.
--
-- RLS is enabled from creation (unlike the original 10 tables in
-- 0002_enable_rls.sql, which predate that convention) since this app only
-- ever talks to Supabase server-side with SUPABASE_SERVICE_ROLE_KEY, which
-- bypasses RLS -- no policies are needed for the app itself to keep working.

create table public.training_images (
  id uuid primary key default gen_random_uuid(),
  variant text not null check (variant = any (array['dark', 'light'])),
  url text not null,
  caption text,
  source text not null default 'uploaded_reference'
    check (source = any (array['approved_post', 'uploaded_reference'])),
  source_post_id uuid references public.posts(id) on delete set null,
  included boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.training_images enable row level security;

-- An approved post can only be promoted into the candidate pool once.
create unique index training_images_source_post_id_key
  on public.training_images (source_post_id)
  where source_post_id is not null;

create table public.lora_models (
  id uuid primary key default gen_random_uuid(),
  variant text not null check (variant = any (array['dark', 'light'])),
  version integer not null,
  weight_url text,
  trigger_token text not null,
  training_image_count integer,
  base_model text not null default 'fal-ai/flux-lora-fast-training',
  steps integer,
  is_style boolean not null default true,
  -- Inference-time LoRA strength (loras[].scale on the flux-lora endpoint).
  -- The main day-to-day tuning knob once a LoRA is trained.
  scale numeric not null default 0.9 check (scale > 0 and scale <= 1.5),
  status text not null default 'draft'
    check (status = any (array['draft', 'training', 'ready', 'failed'])),
  request_id text,
  trained_at timestamptz,
  notes text,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (variant, version)
);
alter table public.lora_models enable row level security;

-- At most one active (promoted) LoRA per variant, so pickModel() never has
-- to guess which one to route to.
create unique index lora_models_one_active_per_variant
  on public.lora_models (variant)
  where is_active;
