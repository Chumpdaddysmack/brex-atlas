# Snapshot permission tracking: local preparation

Prepared October 3, 2026. No production deployment, workflow activation, subscription changes, or test sends are authorized by this work.

## Scope

Six HubSpot contact fields were created and their schemas re-read successfully. Local integration adds an independent snapshot email checkbox, versioned evidence in the existing request receipt JSON, and mappings to the six fields.

`SNAPSHOT_PERMISSION_TRACKING_ENABLED` defaults off. When explicitly enabled in a local test:

- Email-copy requests require the new checkbox and current permission version.
- Optional promotional consent stays independent and unchecked by default.
- An earlier immutable receipt is not silently overwritten with new consent.
- The CRM receives receipt ID, original expiry, permission/version, marketing choice, and `pending` delivery state.
- A same-request retry does not regress a later state to pending.
- No code in this change subscribes a contact, sets marketing status, sends email, or enrolls a workflow directly.
- Configuration-load failure disables email requests, but leaves displayed research and text download available.
- The previously approved results-page CTA becomes “Schedule My Report Demo,” using the existing Kenny meeting URL.

No database migration is required: the original marketing evidence remains at the top level of `consent_evidence`; snapshot permission is appended as `snapshotDelivery`.

## Mandatory follow-on work before release

This is tracking preparation, not a production-ready sending pipeline. The follow-on local subscription adapter, pure workflow guard, tests, and disabled design are now documented in `snapshot-subscription-preparation.md`; they are not wired to production. The following remain release requirements:

1. Check HubSpot subscription/global opt-out/suppression state and record approved narrow subscription consent without forced resubscription.
2. Configure and publish the approved results-only draft after review.
3. Replace the live workflow's old snapshot-known gate with tested permission/subscription/readiness gates; keep Kenny-only until validation.
4. Verify the saved 2,000 marketing-contact maximum and test the cap-blocked path after the marketing-status action.
5. Implement readiness promotion only after eligibility checks, immutable per-request sending/deduplication, safe handling of concurrent requests, and provider-event reconciliation for sent/delivered.
6. Run explicitly approved test sends and negative cases before authorizing public enrollment.
7. Review any historical resend separately; do not enroll the backlog.

Enabling only this flag against the old public workflow is unsafe: that workflow does not check `pending` and may act on any known snapshot. Do not push to the Railway-connected main branch or change live environment variables until deployment is approved.

## QA inventory

- Unit tests: explicit/versioned snapshot permission, optional marketing independence, correct six-property mapping, no marketable/subscription writes, expiry validation, immutable retry evidence.
- CRM mocked tests: validate before side effects; new contact mapping; retry no-write; lookup failure does not create contact; no network requests to live HubSpot.
- Route tests: new config flag, missing checkbox rejection, receipt before sync, no false sent confirmation, cached legacy receipt conflict.
- Regression: existing snapshot/research/privacy/consent tests; flag-off behavior unchanged.
- Browser, mocked API only: desktop/mobile consent form and CTA; checkbox required; marketing unchecked; success message; config failure; legacy config hides new checkbox; text download; no overflow.
- Intentional exclusion: no production subscription changes, no real delivery tests, no new deployment/preview upload.
