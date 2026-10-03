-- PREPARED ONLY. Apply to production only after explicit migration approval.
-- No workflow, contact, subscription or email effects.
begin;

create table public.widget_snapshot_delivery_attempts (
  request_id uuid primary key references public.widget_snapshot_requests(id),
  attempt_id uuid not null unique default gen_random_uuid(),
  email text not null check (email = lower(trim(email))),
  receipt_digest text not null check (receipt_digest ~ '^[a-f0-9]{64}$'),
  state text not null default 'prepared'
    check (state in ('prepared','dispatching','uncertain','sent','delivered','blocked','failed','dry_run')),
  reason text,
  provider_message_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- No expiring lease: uncertain or in-flight sends retain the lock until a
-- correlated provider event or an explicit operator reconciliation resolves it.
create unique index widget_snapshot_one_active_email
  on public.widget_snapshot_delivery_attempts(email)
  where state in ('prepared','dispatching','uncertain','sent');

create table public.widget_snapshot_delivery_events (
  event_id text primary key check(length(event_id) between 1 and 300),
  attempt_id uuid not null references public.widget_snapshot_delivery_attempts(attempt_id),
  provider_message_id text not null,
  event_type text not null check(event_type in ('SENT','DELIVERED','BOUNCE','DROPPED')),
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now()
);
alter table public.widget_snapshot_delivery_attempts enable row level security;
alter table public.widget_snapshot_delivery_events enable row level security;
revoke all on public.widget_snapshot_delivery_attempts, public.widget_snapshot_delivery_events from anon, authenticated;
grant all on public.widget_snapshot_delivery_attempts, public.widget_snapshot_delivery_events to service_role;

create function public.claim_snapshot_delivery(p_request_id uuid, p_receipt_digest text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare r public.widget_snapshot_requests%rowtype;
        s public.widget_snapshots%rowtype;
        a public.widget_snapshot_delivery_attempts%rowtype;
begin
  select * into r from public.widget_snapshot_requests where id=p_request_id;
  if not found then return jsonb_build_object('status','missing_request'); end if;
  if r.email <> lower(trim(r.email)) or p_receipt_digest is null or p_receipt_digest !~ '^[a-f0-9]{64}$'
     or r.consent_evidence#>>'{snapshotDelivery,decision}' is distinct from 'accepted'
     or r.consent_evidence#>>'{snapshotDelivery,policyVersion}' is distinct from 'atlas-snapshot-delivery-v1-2026-10-03'
     or r.consent_evidence#>>'{snapshotDelivery,subscriptionTypeId}' is distinct from '3750294688'
     then return jsonb_build_object('status','invalid_receipt'); end if;
  -- Serialize every claim for an email, including claims for different snapshots.
  perform pg_advisory_xact_lock(hashtextextended(r.email,0));
  select * into a from public.widget_snapshot_delivery_attempts where request_id=p_request_id;
  if found then
    return jsonb_build_object('status',case when a.receipt_digest=p_receipt_digest then 'duplicate' else 'receipt_mismatch' end,
      'state',a.state);
  end if;
  select * into s from public.widget_snapshots where id=r.snapshot_id;
  if not found or s.expires_at<=clock_timestamp() then return jsonb_build_object('status','expired'); end if;
  if exists(select 1 from public.widget_snapshot_delivery_attempts where email=r.email
    and state in ('prepared','dispatching','uncertain','sent')) then
    return jsonb_build_object('status','email_busy');
  end if;
  insert into public.widget_snapshot_delivery_attempts(request_id,email,receipt_digest)
    values(p_request_id,r.email,p_receipt_digest) returning * into a;
  return jsonb_build_object('status','claimed','attemptId',a.attempt_id,'state',a.state);
end $$;

create function public.transition_snapshot_delivery(
  p_request_id uuid, p_attempt_id uuid, p_from text, p_to text, p_reason text default null)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare changed integer;
begin
  -- Only pre-send rejection or dry-run completion may release a claim locally.
  -- Once dispatch starts, failures are uncertain until correlated reconciliation.
  if not ((p_from='prepared' and p_to in ('dispatching','blocked','dry_run'))
      or (p_from='dispatching' and p_to='uncertain')) then
    raise exception 'Unsupported delivery transition';
  end if;
  update public.widget_snapshot_delivery_attempts
    set state=p_to,reason=left(p_reason,200),updated_at=clock_timestamp()
    where request_id=p_request_id and attempt_id=p_attempt_id and state=p_from;
  get diagnostics changed=row_count;
  return changed=1;
end $$;

create function public.bind_snapshot_delivery_message(
  p_request_id uuid,p_attempt_id uuid,p_provider_message_id text)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare a public.widget_snapshot_delivery_attempts%rowtype;
begin
  if p_provider_message_id is null or length(p_provider_message_id) not between 1 and 300
    then raise exception 'Invalid provider message id'; end if;
  select * into a from public.widget_snapshot_delivery_attempts
    where request_id=p_request_id and attempt_id=p_attempt_id for update;
  if not found or a.state not in ('dispatching','uncertain','sent','delivered') then return false; end if;
  if a.provider_message_id is not null then return a.provider_message_id=p_provider_message_id; end if;
  update public.widget_snapshot_delivery_attempts
    set provider_message_id=p_provider_message_id,updated_at=clock_timestamp()
    where request_id=p_request_id;
  return true;
end $$;

-- Backend only. Upstream MUST authenticate and validate the provider event.
-- This RPC intentionally refuses to infer correlation from an email or timestamp.
create function public.record_snapshot_delivery_event(
  p_event_id text,p_provider_message_id text,p_event_type text,p_occurred_at timestamptz)
returns text language plpgsql security invoker set search_path=public,pg_temp as $$
declare a public.widget_snapshot_delivery_attempts%rowtype;
        e public.widget_snapshot_delivery_events%rowtype;
        target text;
begin
  if p_event_id is null or length(p_event_id) not between 1 and 300
    or p_event_type is null or p_event_type not in ('SENT','DELIVERED','BOUNCE','DROPPED')
    or p_occurred_at is null or p_occurred_at>clock_timestamp()+interval '5 minutes'
    then raise exception 'Invalid provider event'; end if;
  select * into a from public.widget_snapshot_delivery_attempts
    where provider_message_id=p_provider_message_id for update;
  if not found then return 'unmatched'; end if;
  if p_occurred_at<a.created_at then return 'event_predates_attempt'; end if;
  insert into public.widget_snapshot_delivery_events(event_id,attempt_id,provider_message_id,event_type,occurred_at)
    values(p_event_id,a.attempt_id,p_provider_message_id,p_event_type,p_occurred_at)
    on conflict(event_id) do nothing;
  if not found then
    select * into e from public.widget_snapshot_delivery_events where event_id=p_event_id;
    if e.attempt_id<>a.attempt_id or e.provider_message_id<>p_provider_message_id
      or e.event_type<>p_event_type or e.occurred_at<>p_occurred_at then return 'event_conflict'; end if;
    return 'duplicate_event';
  end if;
  -- Late delivery confirmation may resolve uncertain/sent. Delayed SENT never
  -- regresses a delivered or failed result. Conflicting terminal events are
  -- retained for operator review instead of automatically releasing/resending.
  if a.state in ('delivered','failed','blocked','dry_run') then return 'terminal_preserved'; end if;
  target:=case p_event_type when 'DELIVERED' then 'delivered' when 'SENT' then 'sent' else 'failed' end;
  if a.state not in ('dispatching','uncertain','sent') then return 'unexpected_state'; end if;
  update public.widget_snapshot_delivery_attempts
    set state=target,reason='provider_'||lower(p_event_type),updated_at=clock_timestamp()
    where request_id=a.request_id;
  return target;
end $$;

revoke all on function public.claim_snapshot_delivery(uuid,text) from public,anon,authenticated;
revoke all on function public.transition_snapshot_delivery(uuid,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.bind_snapshot_delivery_message(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.record_snapshot_delivery_event(text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.claim_snapshot_delivery(uuid,text) to service_role;
grant execute on function public.transition_snapshot_delivery(uuid,uuid,text,text,text) to service_role;
grant execute on function public.bind_snapshot_delivery_message(uuid,uuid,text) to service_role;
grant execute on function public.record_snapshot_delivery_event(text,text,text,timestamptz) to service_role;
commit;
