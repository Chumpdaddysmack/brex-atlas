-- Brex Atlas — Supabase schema
-- Paste this into the Supabase SQL editor once your project is created.
-- All JSON columns use jsonb for indexability; timestamps use bigint (ms since epoch) to match the existing app.

-- =========================================================================
-- analyses: one row per client URL run through the pipeline
-- =========================================================================
create table if not exists public.analyses (
  id            text primary key,
  client_name   text not null,
  client_url    text not null,
  industry      text,
  revenue_band  text,
  goals         text,
  budget_band   text,
  notes         text,

  status        text not null,               -- queued | extracting | competitors | strategy | sow | done | error
  progress      integer not null default 0,  -- 0-100
  current_step  text,
  error_message text,

  extraction    jsonb,
  competitors   jsonb,
  strategy      jsonb,
  sow           jsonb,

  created_at    bigint not null
);

create index if not exists analyses_created_at_idx on public.analyses (created_at desc);
create index if not exists analyses_status_idx     on public.analyses (status);

-- =========================================================================
-- content_plans: one plan per analysis (12-week integrated content plan)
-- =========================================================================
create table if not exists public.content_plans (
  id            text primary key,
  analysis_id   text not null references public.analyses(id) on delete cascade,

  status        text not null,               -- queued | generating | ready | error
  progress      integer not null default 0,
  current_step  text,
  error_message text,

  plan_json     jsonb,

  created_at    bigint not null
);

create index if not exists content_plans_analysis_id_idx on public.content_plans (analysis_id);
create index if not exists content_plans_status_idx      on public.content_plans (status);

-- =========================================================================
-- content_pieces: individual blog / social / ad / landing-page entries
-- =========================================================================
create table if not exists public.content_pieces (
  id             text primary key,
  plan_id        text not null references public.content_plans(id) on delete cascade,
  analysis_id    text not null references public.analyses(id)      on delete cascade,

  channel        text not null,              -- blog | linkedin | instagram | x | meta_ad | linkedin_ad | landing_page
  title          text not null,
  week_number    integer,
  scheduled_date text,
  pillar         text,
  target_query   text,

  brief_json     jsonb,
  draft_json     jsonb,                       -- null in strategy-only mode

  status         text not null,              -- planned | drafting | drafted | approved | rejected | error
  review_notes   text,
  error_message  text,

  created_at     bigint not null,
  updated_at     bigint not null
);

create index if not exists content_pieces_plan_id_idx     on public.content_pieces (plan_id);
create index if not exists content_pieces_analysis_id_idx on public.content_pieces (analysis_id);
create index if not exists content_pieces_channel_idx     on public.content_pieces (channel);
create index if not exists content_pieces_status_idx      on public.content_pieces (status);

-- =========================================================================
-- Row Level Security
-- =========================================================================
-- The app talks to Supabase using the anon key from the Node backend.
-- The published Perplexity sandbox does NOT expose auth to end users, so RLS
-- would break every read/write. We keep RLS disabled here on purpose. If you
-- ever add user auth, enable RLS and add policies.
alter table public.analyses       disable row level security;
alter table public.content_plans  disable row level security;
alter table public.content_pieces disable row level security;
