# Atlas Widget | No-Send Website Test Deployment

Status: prepared and locally tested; no production migration, GitHub push, Railway variable change, or live deployment has occurred. This package is for a Kenny-only website test, not public email delivery.

## Proposed database change

Target: existing Supabase project `dlidmsxiycnjdivzpzax`.

Apply `supabase/migrations/20261004_snapshot_website_no_send.sql`:

- Add one table, `widget_snapshot_no_send_jobs`, referencing existing request IDs.
- Add four functions: `enqueue_snapshot_no_send`, `claim_snapshot_no_send`, `finish_snapshot_no_send`, and `retry_snapshot_no_send`.
- Enable row-level security and restrict table/function access to the backend service role. Anonymous and ordinary authenticated users receive no access.
- Store encrypted request payloads, recipient HMAC, immutable receipt digest, processing state, lease, bounded read-attempt count, and no-send result.
- Leave existing contacts, report data, request rows, and delivery-ledger rows unchanged by the migration.

Fresh website submissions will subsequently add their permission receipt to the existing requests table and one job to the new queue. The worker writes its findings only to the new queue. Completed or blocked jobs discard the encrypted payload; review cases remain held. No job is converted into a real send.

## Proposed application change

Deployment target: `atlas.brexconsulting.com`, through the existing `Chumpdaddysmack/brex-atlas` repository and Railway deployment path. Keep the WordPress/Bricks embed address unchanged.

- Add a separate website-no-send mode that takes priority over the older capture modes.
- Restrict submissions to `kenny@brexconsulting.com`; require a fresh request after the configured activation timestamp.
- Reject earlier live-email, old dry-run, or other-mode receipts before capture.
- Show “Test your website connection” and a blue “Run Website Test” button, with explicit no-email/no-CRM-change wording.
- Store the encrypted job and process it with a background worker using only authenticated GET requests to HubSpot.
- Read subscription preferences, suppression fields, current contact data, and the exact reviewed results email. Require the published email version observed at `2026-10-03T23:40:04.983Z`; drift produces review.
- Never call contact updates, subscription writes, marketing-status changes, workflow enrollment, or email-send endpoints.
- Keep public email delivery disabled. Do not restore any paused sender or alert.

Acknowledgement shown after a valid submission:

> Your website test is recorded for read-only checks. No email will be sent, and no HubSpot contact or subscription will be changed. Kenny will review the test result. This test request cannot be used to send a later email.

The first goal is verifying website → permission receipt → durable queue → read-only checks. A recorded request is not an email promise or a claim that every launch check passed.

## Configuration required before deployment

Retain the existing Supabase and HubSpot server credentials. Configure these additional variables on the Atlas Railway service:

| Variable | Required value or handling |
|---|---|
| `SNAPSHOT_WEBSITE_NO_SEND_ENABLED` | `true` only for the approved no-send website test |
| `SNAPSHOT_WEBSITE_NO_SEND_AFTER` | Exact UTC activation cutoff, recorded when activating; never a backdated bulk-enrollment cutoff |
| `SNAPSHOT_QUEUE_ENCRYPTION_KEY` | New cryptographically random 32-byte key encoded as 64 hexadecimal characters, stored only as a server secret |

There is no Railway connector available in this session. Its secret/configuration step needs the user's assistance in Railway or separately authorized Railway API access. No secret has been generated for production, requested in ordinary chat, committed to source, or installed in Railway.

Missing or invalid key, cutoff, or HubSpot credential causes the test to remain unavailable. It must not fall back into the legacy CRM path. Setting the feature flag alone is not sufficient.

Retain the encryption key while jobs are active. Rotation needs an explicit plan; incorrect keys put jobs into review rather than exposing plaintext or retrying a send.

## Honest billing boundary

The supplied screenshot verifies the saved 2,000 maximum and matching 2,000 tier at 6:18:46 PM PDT, with 1,023 current contacts. It is not a permanent programmatic cap reservation.

This no-send worker therefore records `billing_guard_unknown` when it reaches that unresolved automated gate. That is expected and deliberately conservative. It does not substitute a fabricated count, pretend to mark a contact marketing, or label the request ready for live sending. Earlier checks can instead stop on opt-out, suppression, email drift, or another active request.

No automatic paid-tier change or new marketing-contact admission is included in this deployment.

## Verification completed

- 73 application tests passed, including the new HTTP mode, GET-only transport, encrypted payload, and old-receipt rejection tests.
- 5 new tests passed against an isolated local PostgreSQL database; 8 existing ledger tests also passed.
- Six independent database connections contending for one queued request produced one claim.
- Tests verified role restrictions, expired-lease recovery, stale-worker fencing, three-attempt read retry limits, recipient protection even after a key/hash change, terminal duplicate protection, and rejection of live-send-like results.
- TypeScript and production build passed; existing non-blocking bundle-size warnings remain.
- Desktop 1280px and mobile 375px visual checks passed for the notice, required/optional checkboxes, blue button, error state, and success acknowledgement. No horizontal mobile overflow or text overlap was observed.
- Browser QA used a clearly labeled synthetic local fixture with no external research or CRM/email calls.

The migration was applied only to the disposable local QA database, not Supabase production. Local fixtures do not prove production deployment or live API availability from Railway.

## Activation order after approval

1. Apply the additive migration; verify its security and zero initial job count.
2. Configure the server-side key and cutoff through Railway's secret mechanism.
3. Push the reviewed isolated application changes to the Railway-connected branch and verify the deployed release/configuration.
4. Read back `websiteNoSend=true`, `websiteTestConfigured=true`, `liveTestCapture=false`, and `emailDeliveryReady=false`.
5. Confirm paused HubSpot senders remain off.
6. Ask Kenny to run one fresh company snapshot and submit his own email with the real permission checkbox.
7. Inspect the stored request and no-send job; confirm the link/expiry binding, processing result, and absence of HubSpot mutations or email sends.

## Rollback

Pause the new worker and disable website-no-send submission, then restore the prior approved release/configuration if necessary. Retain the queue and immutable receipts for review; do not drop tables, convert jobs to sends, replay uncertain work, or reactivate legacy workflows. Leaving the feature unconfigured must keep test submission closed.

## Approval requested

Authorize the additive production migration and the conditional Kenny-only no-send deployment described above, once the required Railway secret/configuration is in place. This approval would not authorize public enrollment, email sends, HubSpot contact changes, subscription changes, marketing-contact changes, or activation of internal alerts.
