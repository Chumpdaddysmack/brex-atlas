# Atlas Snapshot | Subscription and Workflow Safeguards

Prepared October 3, 2026. Status: local implementation and workflow design only. No deployment, subscription changes, contact-status changes, workflow edits, email publishing, enrollments, or sends were performed.

## Prepared implementation

- `server/snapshot-subscriptions.ts`: injectable HubSpot preference adapter and receipt-based subscription coordinator. The default is dry-run. Controlled execution requires an explicit pilot enablement, Kenny's exact email, a request-time cutoff, valid immutable receipt evidence, and a fresh eligibility read.
- `server/snapshot-workflow-guard.ts`: pure, tested pre-send guard. It validates the current request, original expiry, subscription, suppressions, actual marketing-contact status, billing-cap verification, approved email, and caller-supplied durable send claim. It does not itself acquire a database claim or send a message.
- `docs/snapshot-workflow-draft.json`: disabled workflow design with enrollment and action requirements. This is intentionally not a HubSpot API payload and has not been uploaded.
- `server/snapshot-subscriptions.test.ts`: ten new tests, including table-driven negative cases. These use mocks only; fixtures labeled published/subscribed are not live account changes.

The modules are not imported by the widget routes. No flag or deployment alone connects this stage to live subscriptions or sends. The existing stage-one permission flag remains off by default.

## Subscription safeguards

Use v4 reads to distinguish explicit `SUBSCRIBED`, `UNSUBSCRIBED`, and `NOT_SPECIFIED` preferences. An unspecified preference is not treated as explicit consent. Read global/brand status separately and stop on missing, ambiguous, stale, partial, or unrecognized responses. These states and read endpoints follow the [HubSpot communication-preferences API guide](https://developers.hubspot.com/docs/api-reference/legacy/communication-preferences/guide).

For a new, explicitly permitted snapshot request with `NOT_SPECIFIED`, the prepared coordinator can use only the dedicated subscription ID `3750294688`, with `CONSENT_WITH_NOTICE` and the canonical wording, request ID, request timestamp, and wording version. The selected v3 subscribe endpoint cannot resubscribe a previously opted-out contact, providing an additional safeguard against an opt-out race. The coordinator rereads preferences immediately before and after the write. [HubSpot v3 subscribe constraints](https://developers.hubspot.com/docs/api-reference/legacy/communication-preferences/v3/guide.md).

An existing snapshot opt-out or global/brand opt-out stops the operation. No resubscribe, unsubscribe-all, or promotional subscription endpoint is used. The optional promotional choice remains recorded evidence only; this stage does not implement promotional opt-in processing.

A timeout after a write is reported as an unconfirmed mutation, not as “nothing changed.” Later reconciliation must read current status rather than blindly replaying the write. A verified subscription still does not mean the recipient is a marketing contact, is eligible to send, or received an email.

## Prepared workflow safeguards

- Kenny-only pilot and fresh-request cutoff; no backlog enrollment.
- Valid receipt, matching contact request ID, canonical consent version, exact snapshot URL, and original unexpired access period.
- Fresh explicit snapshot subscription, no global/brand unsubscribe.
- Fail closed on invalid address, hard-bounce reason, or quarantine.
- Require saved marketing-contact cap verification and actual marketing-status readback after the native Set marketing contact status action.
- Require a durable per-contact lock and per-request claim supplied by the future orchestration layer.
- Never use the old promotional email; allow only the reviewed results-only email `405101719239` under subscription `3750294688`.
- Prevent sent/delivered/failed requests from being blindly reenrolled.
- Record actual sent/delivered outcomes only from request-correlated provider events.

The existing HubSpot workflow was read as enabled, revision 22, still Kenny-only, with the old email. It was not edited. At the eventual approved cutover, that sender must be paused before a replacement pilot starts, otherwise the same request could produce two emails.

## Verified schema and API observations

The account's contact schema includes `hs_email_optout`, `hs_email_bad_address`, `hs_email_hard_bounce_reason_enum`, `hs_email_quarantined`, and `hs_marketable_status`. The guessed name without `_enum` was not present and is not used.

Read-only calls verified access to v4 category status, v4 global status, and subscription definitions. A successful empty global-status result was observed. The code accepts that as no recorded global status while still requiring explicit category subscription; any nonempty, unfamiliar global-response shape stops processing.

The historic Kenny contact ID was no longer retrievable during preparation, and an email search returned no CRM record. No contact was recreated. A fresh explicitly authorized pilot submission must establish the current contact before end-to-end validation.

## Validation

28 automated tests passed across the new subscription tests, consent mapping, widget snapshot routes/research, and optional marketing consent tests. TypeScript validation and the production build passed. The build retained non-blocking PostCSS and large-bundle warnings; no deployment was performed.

Coverage includes default no-write behavior, wrong-recipient and old-request blocking, scoped snapshot-only writes in mocks, opt-out races, unknown mutation outcomes, readback confirmation, expiry, stale/partial API responses, suppression, non-marketing/cap-blocked cases, wrong email/category, duplicate states, and disabled workflow design.

No UI changed in this stage. Desktop/mobile widget checks completed in the previous stage remain applicable; this stage adds backend-only modules that are not wired into production.

## Still required before a controlled send

1. Implement and validate the durable request/contact claim, immutable send binding, and provider-event reconciliation in the production orchestration layer. The pure policy tests do not prove distributed exactly-once delivery.
2. Connect the coordinator to stored receipts and authenticated transport with explicit pilot-only rollout controls. Recheck inactive/deleted subscription definitions at activation.
3. Verify the saved account contact cap and test its blocked branch. A historic usage count is not a reservation.
4. Create/read back the replacement workflow while disabled; publish the reviewed results-only draft only with approval.
5. Obtain approval for the exact Kenny-only test email and cutoff; coordinate pausing the old sender before enabling the new pilot.
6. Confirm inbox receipt, exact snapshot link, expiry, opt-out behavior, duplicate handling, and cap behavior before separately considering public enrollment.

This is preparation, not a declaration of public-launch readiness.
