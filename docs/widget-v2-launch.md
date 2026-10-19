# One-page Growth Snapshot V2: Launch Checks

## Scope

Replace the homepage `/widget` embed after production readiness is verified. Keep `/excavate-v1` for the original widget and `/excavate-v2` for the new version. Preserve all existing paid-report functionality and do not merge the paused private verification branch.

## Implementation boundaries

- V2 uses the existing Railway Perplexity search and Anthropic credentials, not the private preview's development credentials.
- Four-question readiness is recalculated on the server and stored as `growth`, never in legacy marketing-health or service-fit fields.
- Capture is stored in the existing private `lead_capture` JSON before research. Public snapshot JSON excludes identity/contact fields.
- Existing 10-day fragment-token access and consent-aware, duplicate-protected email delivery are retained. No new database schema is required.
- V2 internal inquiry notifications contain the readiness summary even if research later fails or is abandoned.
- Old and new email copy must be compatible before making V2 the default.
- Reuse approved source tagging, preserve existing Original Lead Source, and make no subscription change on ordinary form submission.

## QA inventory

Check the 256 answer combinations, unknown/pending, zero constraints, tampered client scores, exact quote rejection, two-sided competitor evidence, conservative potential labels, unsupported weakness omission, provider errors, early private capture, receipt reuse, cached research, stale request cancellation, 10-day results reload, legacy-link fallback, email permission, duplicate send protection, CTA, copy/download, responsive views and iframe resizing. Unit fixtures are not live provider or email verification.

## Production gates

1. Source archive pair saved: V1 `a6cd8b0`, private preview V2 `e937925`.
2. Build, typecheck and regression checks.
3. Approve and apply compatible internal-alert and prospect email copy, with workflow fingerprint updates.
4. Deploy V2 path while old default remains; verify source research and a bounded owner-requested email.
5. Switch default only after those checks pass and verify the homepage frame.

## Preparation results: October 19

- Clean worktree branched from production `a6cd8b0`, not the paused private report branch.
- Build and TypeScript check pass.
- Widget/snapshot suite: 127 tests passed, 0 failed, 12 database-dependent tests skipped.
- Local browser fixtures verified immediate readiness, streamed progress, early receipt, persisted result reload, no contact details in shared results, consent default unchecked, requested-email control and real scheduling-link navigation at desktop/375px.
- No CRM or prospect email was sent by those fixtures; production provider behavior is not yet signed off.
- Homepage source currently embeds `https://atlas.brexconsulting.com/widget`, so switching the Atlas route changes its widget without editing WordPress. Its current fixed 900px iframe may still use internal scrolling; V2 emits both existing height-message formats but cannot force the parent page to resize without a listener.
- V2 default remains false. No source has been pushed to production while live-message copy approval is pending.

## Approved copy: publication gate

Kenny approved both message revisions on October 19 at 2:36 PM PDT.
The approved prospect HTML was saved to the draft buffer of email `406150193876`
and read back exactly. Its live version remains unchanged.
`POST /marketing/emails/2026-03/406150193876/publish` returned HTTP 403,
`MISSING_SCOPES`, requiring `transactional-email` or `marketing-email`.
Do not retry with another credential or change subscription type to work around it.

Next required action: Kenny publishes/updates the existing automated email in HubSpot.
Then read the live email, verify exact approved content and unchanged sender/subscription,
update `COMBINED_EMAIL_UPDATED_AT`, apply the approved internal-alert body through
`scripts/widget-v2-approved-copy.ts apply-alert`, update `ALERT_WORKFLOW.hash`,
and deploy promptly so the fail-closed workers recognize the approved revisions.
The internal alert has NOT yet been edited, avoiding an unnecessary worker pause while awaiting email publication.

No production source push, no V2 live submission, no email test and no homepage cutover have occurred.
The approved copy operator is separate from runtime code; it does not enroll or send to contacts.
