-- Approved and applied Oct 5, 2026. Additive only: no backfill or CRM/email action.
-- Existing RLS denies anon/authenticated access to widget_snapshots.
-- Public handlers explicitly select only the shareable snapshot, not this
-- private field. It records an inquiry, NEVER email subscription permission.
alter table public.widget_snapshots
  add column if not exists lead_capture jsonb;
alter table public.widget_snapshots
  add constraint widget_snapshots_lead_capture_object
  check (lead_capture is null or jsonb_typeof(lead_capture) = 'object');
comment on column public.widget_snapshots.lead_capture is
  'Private completed-assessment inquiry details. Excluded from public results responses. Not permission to send results or promotional email.';
