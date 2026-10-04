-- PREPARED ONLY. Requires separate production migration approval.
-- One isolated queue, four service-only RPCs. No existing rows are modified.
begin;
create table public.widget_snapshot_no_send_jobs (
  request_id uuid primary key references public.widget_snapshot_requests(id),
  recipient_hash text not null check(recipient_hash ~ '^[a-f0-9]{64}$'),
  receipt_digest text not null check(receipt_digest ~ '^[a-f0-9]{64}$'),
  encrypted_payload text,
  state text not null default 'queued' check(state in ('queued','checking','retry','review','completed','blocked')),
  attempts integer not null default 0 check(attempts between 0 and 3),
  next_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index snapshot_no_send_recipient_active on public.widget_snapshot_no_send_jobs(recipient_hash)
  where state in ('queued','checking','retry','review');
alter table public.widget_snapshot_no_send_jobs enable row level security;
revoke all on public.widget_snapshot_no_send_jobs from public,anon,authenticated;
grant all on public.widget_snapshot_no_send_jobs to service_role;

create function public.enqueue_snapshot_no_send(
 p_request_id uuid,p_recipient_hash text,p_digest text,p_ciphertext text,p_cutoff timestamptz)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare r public.widget_snapshot_requests%rowtype; s public.widget_snapshots%rowtype;
 j public.widget_snapshot_no_send_jobs%rowtype;
begin
 select * into r from public.widget_snapshot_requests where id=p_request_id;
 if not found or r.email<>'kenny@brexconsulting.com'
   or p_cutoff is null or p_cutoff>clock_timestamp() or r.requested_at<=p_cutoff
   or r.consent_evidence->>'websiteNoSend' is distinct from 'kenny-website-no-send-v1'
   or r.consent_evidence ? 'liveEmailTest' or r.consent_evidence ? 'noSendPilot'
   or r.consent_evidence#>>'{snapshotDelivery,decision}' is distinct from 'accepted'
   or r.consent_evidence#>>'{snapshotDelivery,policyVersion}' is distinct from 'atlas-snapshot-delivery-v1-2026-10-03'
   or r.consent_evidence#>>'{snapshotDelivery,subscriptionTypeId}' is distinct from '3750294688'
   or r.consent_evidence#>>'{snapshotDelivery,source}' is distinct from 'atlas-widget'
   or r.consent_evidence#>>'{snapshotDelivery,consentText}' is distinct from
     'Email me the Company & Positioning Snapshot I requested. This permission covers this snapshot and essential access help only, not promotional emails.'
   then return jsonb_build_object('status','invalid_receipt'); end if;
 if p_recipient_hash is null or p_recipient_hash!~'^[a-f0-9]{64}$'
   or p_digest is null or p_digest!~'^[a-f0-9]{64}$'
   or p_ciphertext is null or length(p_ciphertext) not between 100 and 12000
   then return jsonb_build_object('status','invalid_payload'); end if;
 select * into s from public.widget_snapshots where id=r.snapshot_id;
 if not found or s.expires_at<=clock_timestamp() then return jsonb_build_object('status','expired'); end if;
 perform pg_advisory_xact_lock(hashtextextended('website-no-send:'||r.email,0));
 select * into j from public.widget_snapshot_no_send_jobs where request_id=p_request_id;
 if found then return jsonb_build_object('status',case when j.receipt_digest=p_digest then 'duplicate' else 'receipt_mismatch' end,'state',j.state); end if;
 if exists(select 1 from public.widget_snapshot_no_send_jobs active_job
   join public.widget_snapshot_requests old_request on old_request.id=active_job.request_id
   where old_request.email=r.email and active_job.state in ('queued','checking','retry','review'))
   then return jsonb_build_object('status','recipient_busy'); end if;
 insert into public.widget_snapshot_no_send_jobs(request_id,recipient_hash,receipt_digest,encrypted_payload)
   values(p_request_id,p_recipient_hash,p_digest,p_ciphertext);
 return jsonb_build_object('status','queued');
end $$;

create function public.claim_snapshot_no_send()
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare j public.widget_snapshot_no_send_jobs%rowtype;
begin
 update public.widget_snapshot_no_send_jobs set state='review',lease_token=null,lease_until=null,
   result='{"status":"review","reason":"read_retry_limit","actions":[],"sendingEnabled":false}'::jsonb,updated_at=clock_timestamp()
   where state='checking' and lease_until<=clock_timestamp() and attempts>=3;
 select * into j from public.widget_snapshot_no_send_jobs
   where ((state in ('queued','retry') and next_at<=clock_timestamp())
      or (state='checking' and lease_until<=clock_timestamp())) and attempts<3
   order by created_at,request_id for update skip locked limit 1;
 if not found then return jsonb_build_object('status','idle'); end if;
 update public.widget_snapshot_no_send_jobs set state='checking',attempts=attempts+1,
   lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '90 seconds',updated_at=clock_timestamp()
   where request_id=j.request_id returning * into j;
 return jsonb_build_object('status','claimed','job',to_jsonb(j));
end $$;

create function public.finish_snapshot_no_send(p_request_id uuid,p_lease_token uuid,p_result jsonb)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare changed integer; target text;
begin
 if p_result is null or p_result->'sendingEnabled' is distinct from 'false'::jsonb
   or p_result->>'status' is null or p_result->>'status' not in ('eligible_no_send','needs_preparation','blocked','review')
   or p_result->>'reason' is null or p_result->>'reason'!~'^[a-z0-9_]{1,80}$'
   or jsonb_typeof(p_result->'actions') is distinct from 'array' then raise exception 'Invalid no-send result'; end if;
 if exists(select 1 from jsonb_array_elements_text(p_result->'actions') a where a not in ('sync_request_fields','subscribe_snapshot_only','mark_marketing_contact'))
   then raise exception 'Invalid proposed action'; end if;
 target:=case p_result->>'status' when 'review' then 'review' when 'blocked' then 'blocked' else 'completed' end;
 update public.widget_snapshot_no_send_jobs set state=target,result=p_result,
   encrypted_payload=case when target in ('completed','blocked') then null else encrypted_payload end,
   lease_token=null,lease_until=null,updated_at=clock_timestamp()
   where request_id=p_request_id and lease_token=p_lease_token and state='checking' and lease_until>clock_timestamp();
 get diagnostics changed=row_count;return changed=1;
end $$;

create function public.retry_snapshot_no_send(p_request_id uuid,p_lease_token uuid)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare changed integer;
begin
 update public.widget_snapshot_no_send_jobs set state=case when attempts>=3 then 'review' else 'retry' end,
   next_at=clock_timestamp()+interval '10 seconds',lease_token=null,lease_until=null,
   result=jsonb_build_object('status','review','reason',case when attempts>=3 then 'read_retry_limit' else 'read_temporarily_unavailable' end,
     'actions','[]'::jsonb,'sendingEnabled',false),updated_at=clock_timestamp()
   where request_id=p_request_id and lease_token=p_lease_token and state='checking' and lease_until>clock_timestamp();
 get diagnostics changed=row_count;return changed=1;
end $$;
revoke all on function public.enqueue_snapshot_no_send(uuid,text,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.claim_snapshot_no_send() from public,anon,authenticated;
revoke all on function public.finish_snapshot_no_send(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.retry_snapshot_no_send(uuid,uuid) from public,anon,authenticated;
grant execute on function public.enqueue_snapshot_no_send(uuid,text,text,text,timestamptz) to service_role;
grant execute on function public.claim_snapshot_no_send() to service_role;
grant execute on function public.finish_snapshot_no_send(uuid,uuid,jsonb) to service_role;
grant execute on function public.retry_snapshot_no_send(uuid,uuid) to service_role;
commit;
