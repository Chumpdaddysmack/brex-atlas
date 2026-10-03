# Atlas Widget | Snapshot Formatting Hotfix

October 3, 2026. Status: reproduced on the live research-only endpoint; candidate recovery fix tested locally, not deployed.

## Observed failure

The user's screenshot showed the widget stopped at company research. A single research-only POST with the same company and website returned HTTP 503, `SNAPSHOT_FORMAT_INVALID`, and missing/wrong-type validation failures for `entityConfirmed`, `companyName`, `introduction`, `finding`, `interpretation`, and `question`.

This response occurs before snapshot email capture or HubSpot contact creation. The research route does not inspect HubSpot contacts, so the deleted contact is not the cause of this specific error. No email address was submitted in the diagnostic check and no lead/email workflow was triggered by it.

The observed error proves the structured result failed validation; it does not establish why the upstream model/provider produced that result. Production Railway logs were unavailable through the connected tools/browser. No claim is made that the provider's underlying failure has been conclusively identified.

## Candidate fix

- Add an optional JSON-text mode to the existing structured-response helper; all existing callers retain their default behavior.
- Use this different response path for the snapshot's existing single formatting retry instead of repeating the same tool-response path.
- Retain the same fetched source text and full JSON schema. Do not use model memory, relax the schema, fabricate fields, or remove the evidence audit.
- Replace the misleading company-name error for formatting failures with a technical-service explanation.
- Log bounded response-shape/validation metadata without raw company evidence or credentials.

This is a recovery improvement for the reproduced failure mode, not a proven live repair until deployed and checked with a fresh research-only request.

## Isolation

The fix is on `fix/snapshot-format-recovery`, based on remote main `64ab51715b946fc0c306f8d96182ed1e99bfd137`, in a separate local worktree. It excludes all pending consent controls, subscription integration, delivery-ledger application wiring, and no-send-pilot changes. No main-branch push has occurred.

## Validation

17 focused tests passed, including malformed/empty structured-response recovery, schema retention in JSON-text mode, unchanged default tool behavior for other report callers, rejected evidence, bounded retries, route privacy, no CRM action during research failure, and legacy snapshot contact synchronization. TypeScript, production build, and diff checks passed. Build warnings remain the existing non-blocking PostCSS and large-bundle notices.

Tests used mocked model responses; no claim is made that they reproduce the unavailable production provider logs. No interface structure was changed.

## Proposed deployment check

With explicit approval, push only this isolated fix to the Railway-connected main branch and verify the deployed release. Then run one research-only check with the same company details; do not submit an email address, create a HubSpot contact, publish the new email, or activate the new workflow.

The new no-send workflow is not connected to the live widget yet. A visitor who reaches and submits the old email form may still trigger the existing Kenny-only workflow; do not describe that as the new dry run.
