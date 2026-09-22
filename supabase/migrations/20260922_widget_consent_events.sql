-- Consent is an evidence record, not an instruction to subscribe or bill a contact.
create table public.widget_consent_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  diagnostic_id uuid not null references public.widget_diagnostics(id),
  email text not null check (email = lower(trim(email)) and length(email) <= 254),
  decision text not null check (decision in ('accepted', 'not_selected', 'not_presented')),
  policy_version text not null,
  consent_text text not null,
  subscription_type_id text not null,
  source text not null,
  email_verified boolean not null default false check (email_verified = false),
  unique (diagnostic_id, email, policy_version, decision),
  check (
    (decision = 'not_presented' and policy_version = 'not-presented' and consent_text = '')
    or (decision in ('accepted', 'not_selected') and length(consent_text) > 0 and policy_version <> 'not-presented')
  )
);
comment on table public.widget_consent_events is
  'Append-only widget permission evidence. Accepted is a form assertion, not email ownership verification or a HubSpot subscription. Not selected does not revoke previous consent.';
alter table public.widget_consent_events enable row level security;
revoke all on public.widget_consent_events from anon, authenticated, service_role;
grant select, insert on public.widget_consent_events to service_role;
create index widget_consent_events_email_created_idx
  on public.widget_consent_events(email, created_at desc);
