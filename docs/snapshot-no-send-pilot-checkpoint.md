# Atlas Snapshot | No-Send Pilot Checkpoint

Updated October 3, 2026, after explicit production migration approval at 3:12 PM PDT. Duplicate protection is implemented and tested locally, and its production database schema is now installed. The application has not been deployed or connected to this new schema; the disabled, action-free Kenny-only workflow remains a no-send shell.

## Production database installation

The approved `snapshot_delivery_ledger` migration was applied successfully to Supabase project `dlidmsxiycnjdivzpzax` (Brex Atlas Project), recorded as version `20261003221247`.

Post-installation verification confirmed:

- Both new tables exist and have row-level security enabled.
- Anonymous and ordinary authenticated roles cannot select from or insert into either table.
- The backend service role has the required table access.
- All four functions exist, use invoker security with a fixed search path, deny execution to anonymous/authenticated roles, and allow execution to the backend service role.
- Request, attempt, event, provider-message, and single-active-email uniqueness indexes are present.
- Both new tables contain zero rows. No existing customer rows were changed by the migration.

The security advisor returned informational “RLS Enabled No Policy” notices, including the two new tables. This is intentional for these backend-only tables: no client-facing policy grants access, and table/function privileges are also denied to client roles. No WARN or ERROR security findings were returned in this check. [Supabase advisory explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

No workflow was activated, email published, contact enrolled, subscription changed, or app deployed in this installation step.

## What is in HubSpot

[Atlas Snapshot Delivery - Kenny Only NO SEND Test](https://app-na2.hubspot.com/workflows/242249577/platform/flow/5050995440/edit), workflow ID `5050995440`, was read back at revision 1 with `isEnabled: false`, zero actions, and re-enrollment off.

Its criteria restrict email to `kenny@brexconsulting.com` and require the snapshot/request/link/expiry fields, accepted snapshot permission, the current permission version, and delivery state `ready`. These are setup criteria, not a complete live sending gate. The full eligibility checks remain in the prepared backend. With zero actions this shell cannot send email even if accidentally enabled. Leave it off.

The existing workflow `5015673537` remains enabled at revision 22 and was not edited. Its current pilot continues to be separate from the new no-send shell. No contacts were enrolled, no subscriptions or marketing status were changed, and no email was published or sent.

## Duplicate protection

- **One immutable claim per request:** A repeated request cannot obtain another send claim, including after an application or database restart.
- **One active request per email:** Different requests for the same email cannot both be in flight. The unique database constraint and transaction lock enforce this across separate connections.
- **Unknown outcomes remain locked:** Dispatching, uncertain, and sent states do not expire into automatic retries. Reconciliation is required before another request proceeds.
- **Compare-and-set transitions:** A stale worker cannot release another worker's claim.
- **Message-bound events:** Provider events must match an explicitly bound provider message ID. Email address or timestamp alone is never used to infer which snapshot was sent.
- **Event deduplication:** Repeated event IDs cannot update a second request. Late SENT events do not regress DELIVERED.
- **Receipt verification:** The pilot loader uses stored consent and request evidence, and checks that the private snapshot link matches the stored token hash.
- **Private database access:** Both new tables have row-level security enabled, no anonymous/authenticated access, and backend-service-only function permissions.

These guarantees are local implementation/test results, not a claim of live end-to-end exactly-once email delivery. The eventual provider integration still needs authenticated event ingestion and a reliable message-ID-to-request binding.

## No-send test runner

`server/snapshot-pilot.ts` combines immutable receipt loading, the durable claim, read-only subscription checks, and the previously prepared eligibility guard. It requires an explicit enablement, Kenny's email, and a fresh-request cutoff. It has no send, enroll, publish, or subscription-write dependency.

A completed local check records `dry_run`, not `sent` or `delivered`. A failed pre-send read can release its claim as `blocked`; once a dispatch has begun, uncertainty never produces a blind resend. A real future test must use a fresh request, not replay a dry-run request.

## Validation completed

- 36 automated tests passed, including seven integration tests on a separate local PostgreSQL 18 database and one stored-receipt binding test.
- Six independent simultaneous connections claiming one request yielded one claim and five duplicates.
- Simultaneous different requests for the same email yielded one claim and one busy result.
- Anonymous/authenticated table and function access was denied.
- Unmatched events, duplicate events, contradictory event IDs, expiry, missing consent, non-Kenny requests, unpublished email, and failed data reads were exercised.
- A PostgreSQL server restart was performed; the existing uncertain request still returned `duplicate`.
- TypeScript and the production build passed. Existing non-blocking PostCSS and bundle-size warnings remain.

No interface changed, so no new visual QA was required for this backend stage. All integration fixtures were local; no customer records or real delivery events were used.

## Files prepared

- `supabase/migrations/20261003_snapshot_delivery_ledger.sql`: two new tables, indexes, and four service-only functions. Applied to production as `20261003221247`.
- `server/snapshot-delivery-ledger.ts`: typed RPC adapter and stable receipt digest.
- `server/snapshot-pilot.ts`: stored-receipt loader and send-disabled test runner.
- `server/snapshot-delivery-ledger.pg.test.ts`: local PostgreSQL integration tests.
- `scripts/create-snapshot-no-send-workflow.mjs`: prints a proposal by default; explicit creation option makes an off, action-free workflow and verifies it. It never edits or enables an existing workflow.

## Remaining rollout boundary

The production schema installation is complete. The next step is connecting the application to it for a controlled, no-send dry run using a fresh Kenny-only request.

The production adapter and provider correlation still need to be wired under controlled test settings. Application deployment, email publication, coordinated cutover from the old pilot, actual test sends, and public launch remain separate approval boundaries. Do not press “Turn on” or submit a prospect test expecting this new pipeline to run yet.
