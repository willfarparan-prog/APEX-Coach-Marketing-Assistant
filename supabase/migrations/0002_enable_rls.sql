-- Enables Row Level Security on the 10 core tables that had none, closing the
-- gap where anyone with the anon key could read or write every row via
-- PostgREST. Safe here: this app only ever talks to Supabase server-side
-- with SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS entirely, so no
-- policies are needed for the app itself to keep working. This deliberately
-- leaves the anon/authenticated roles with zero access.
--
-- Not yet applied — run manually via the Supabase SQL editor, or ask for it
-- to be applied via the Supabase MCP once reviewed.

ALTER TABLE public.constitution ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pillars ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ideas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reference_images ENABLE ROW LEVEL SECURITY;
