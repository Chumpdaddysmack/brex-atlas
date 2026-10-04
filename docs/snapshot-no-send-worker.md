# Atlas snapshot no-send worker

Status: built and tested locally, not deployed or imported by production routes. This stage has no subscription-write, CRM-write, workflow-enrollment, send, or production-ledger mutation port.

## Run the synthetic demonstration

```sh
npx tsx scripts/run-snapshot-no-send-demo.ts
npx tsx scripts/run-snapshot-no-send-demo.ts --run-no-send --output=/absolute/path/results.json
```

Without the explicit flag the script reports disabled. With the flag it uses six synthetic `example.invalid` recipients, an ephemeral encryption key, a temporary local queue, and injected evidence; it has no network transport. The optional output lists scenario names and decisions, not email addresses or private snapshot links. Temporary storage is removed after the demonstration.

## Implemented modules

- `snapshot-dry-run-queue.ts`: isolated SQLite staging queue; request uniqueness, recipient HMAC index, AES-256-GCM receipt encryption with request ID as authenticated data, key fingerprint verification, atomic transaction claims, 30-second leases, fenced completion, bounded read retries, and review holds. Finished/blocked jobs discard encrypted payloads but retain deduplication metadata.
- `snapshot-dry-run-worker.ts`: trusted stored-receipt loader, token-hash verification, explicit staging cutoff, rejection of historical/test receipts, bounded batch processing, ten-second evidence-read timeout, and fail-closed eligibility plans.
- `snapshot-readiness.ts`: public-recipient read-only evaluator. Separates eligible-no-send, needs-preparation, blocked, and review outcomes. Proposed preparation never means a subscription or marketing-status change occurred.
- `snapshot-readonly-inputs.ts`: injectable GET-only HubSpot evidence adapter. Reads category/global preferences and contact data; reviewed-email and verified-billing readers are mandatory dependencies. A confirmed missing contact is distinct from a read failure. No production transport or credentials are wired in this stage.
- `snapshot-readonly-reconciliation.ts`: complete bounded pagination and timeouts for already-bound provider messages. It returns proposed ledger events only. Unknown message binding, paging gaps, conflicts, and provider outages produce a hold.

## Safety boundaries

The queue is a distinct local staging store, not the installed Supabase production ledger. A local `completed` means evaluation completed, never email sent. An `eligible_no_send` result is not a launch authorization. Local SQLite provides same-filesystem concurrency, not multi-host or multi-region guarantees.

Retries are safe only because all external operations are reads. Do not copy lease-expiry retries into a real sender: a dispatched message must retain its durable claim until exact provider reconciliation. Unknown actual send outcomes remain review-only.

Billing input includes current count, reserved admissions, cap verification, and freshness. This worker evaluates those inputs but does not obtain a real cap reservation, alter the account limit, or mark contacts marketing. A production admission mechanism still needs integration and separate verification.

The receipt encryption key must be provided separately from the database and retained for restart recovery. Tests and the demonstration generate local ephemeral keys. No production key has been provisioned, and no real user key is stored in source. Production needs an approved secret-management and rotation plan.

Review jobs retain the recipient hold. There is intentionally no automatic manual-review release, resend, or conversion of a no-send job into a live send. A future controlled send requires a new, separately authorized request path, not mutation of a completed dry run.

## Verification

The latest suite passed 67 application tests and 8 tests against the existing isolated local PostgreSQL database. TypeScript passed. The production build also passed during this implementation, with the existing large-bundle warning.

New checks include six independent worker processes contending for one local request, encrypted-at-rest payload checks, key mismatch, tampered ciphertext, duplicate immutable receipt protection, restart lease recovery, stale-worker fencing, read timeouts, three-attempt retry limits, review locks, expiry before provider reads, opt-outs, marketing-cap reservations, wrong links, ambiguous send state, partial preferences, provider pagination loops, and incomplete provider reads.

The six-scenario demonstration returned:

| Scenario | Outcome |
|---|---|
| Eligible existing contact | Eligible, no send |
| New contact | Propose request-field sync, snapshot-only opt-in, and marketing status; apply none |
| Existing opt-out | Block |
| Marketing cap reached | Block |
| Mismatched link | Hold for review |
| Unknown previous send | Hold for review |

## Still required before deployment or live sending

1. Wire and verify authenticated read-only staging inputs, especially billing-cap and reviewed-email evidence. An old screenshot or saved count cannot pass as a fresh live read.
2. Design the production multi-instance queue, protected link storage, durable worker recovery, account admission, and shared abuse controls. Do not deploy this local SQLite staging store as the public multi-instance queue.
3. Implement exact request-to-message binding and safe repeat-request orchestration; the reconciler deliberately cannot invent a binding.
4. Prepare the protected public route and no-send deployment configuration without falling back into legacy sync.
5. Obtain approval for any production migration/deployment, then a scoped canary, then separate public activation. Do not remove the Kenny restriction or restore legacy senders during this work.
