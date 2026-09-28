create table public.widget_snapshots (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  company_url text not null,
  ip_hash text not null,
  snapshot jsonb not null
);
create index widget_snapshots_expiry on public.widget_snapshots(expires_at);
create table public.widget_snapshot_requests (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.widget_snapshots(id),
  email text not null,
  requested_at timestamptz not null default now(),
  consent_evidence jsonb not null,
  sync_status text not null default 'pending'
    check(sync_status in ('pending','synced','failed')),
  contact_id text,
  unique(snapshot_id,email)
);
alter table public.widget_snapshots enable row level security;
alter table public.widget_snapshot_requests enable row level security;
revoke all on public.widget_snapshots, public.widget_snapshot_requests from anon, authenticated;
grant all on public.widget_snapshots, public.widget_snapshot_requests to service_role;
