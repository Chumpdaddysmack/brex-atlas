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

## Production staging: October 19, 22:48 UTC

- Kenny published the compatible email; verified published/AUTOMATED, unchanged sender and subscription `3750294688`, live update `2026-10-19T22:38:26.996Z`. His final signature reads “Lead CMO”; preserved.
- Applied the approved alert bodies/subjects without enrollment/audience changes. New pinned hash: `b9a19689bc0e2c49edb3f00b6474a761f9216d3ba0953286dcb3d38976337b9d`.
- Deployed `fdda953713aa785c95a379f9c70312e97fe7a94e` to GitHub main/Railway. Railway status is success.
- `/excavate-v2` loads the new widget in a fresh desktop/mobile browser context with no page errors or horizontal overflow observed. Submit control enabled.
- Public config confirms `emailDeliveryReady: true` and internal alerts `enabled: true, ready: true`.
- `/widget` still serves V1; `/excavate-v1` also serves V1. The main app sign-in works.
- Remote tag `atlas-widget-v1-before-one-page` preserves original production source `a6cd8b0`.
- Post-copy targeted tests: 32 passed. Earlier full widget/snapshot suite: 127 passed, 12 skipped.
- Next: Kenny submits his own actual answers at `/excavate-v2`, then explicitly requests his email. Verify research, saved result, private inquiry/HubSpot alert, and email outcome before flipping `WIDGET_V2_DEFAULT`.
- No V2 live submission or email send has yet been performed by the assistant. Homepage cutover is still pending.

## Owner submission and format recovery

- Owner submitted October 19 at 23:01 UTC: readiness 75, internal alert queued. No prospect-email request was recorded.
- Research was unavailable. A safe diagnostic-only release identified the next retry failure as `RESEARCH_FORMAT_INVALID` during “Preparing the snapshot from retrieved sources…” after 51 seconds.
- Release `ae8de78` adds an explicit provider JSON schema and one bounded format-repair attempt. Exact quotation, entity, semantic-review, competitor and weakness gates remain unchanged.
- TypeScript check and 34 targeted tests passed. This is not yet a successful production research retest.
- Kenny reports that his run looked successful; asked whether this included company summary, competitor, SWOT and strategy or only the immediate score. Do not dismiss his observation or equate the score screen with completed research.
- Homepage remains V1. After deployment, retry the existing receipt rather than creating a fresh inquiry; verify resulting research and requested email before cutover.

## October 20 wording and recommendation revision

- `591523e` recovered Brex research successfully at 15:12 UTC. It preserved readiness 75 and did not send emails.
- Kenny approved correcting market/strength wording and refining competitor/strategy checks.
- `a686e4f` now narrows targeting to current explicit buyers, disallows biography-to-targeting inference and unverified company-only superiority.
- Competitor recovery is schema-constrained and separately reviewed against both official sources. Potential vs direct-candidate labels preserve geography and actual-rivalry uncertainty.
- A separate strategy proposal/review path distinguishes a cited factual basis from a conditional action, measurable test and assumptions; no invented deficits, metrics, offerings or promised results.
- A failed refresh of a ready result preserves the previous research. No contact/alert/email changes.
- Typecheck, build, 38 targeted tests and desktop/mobile fixture QA pass; production retest pending.
- One exact saved Brex snapshot (`4000c425-3394-4ee7-9bd4-fea38be5225a`) has a requested one-shot research refresh.
- As of 18:21 UTC, main is a686e4f but Railway has not registered a deployment or commit status for it; production still serves the previous frontend. Do not describe these changes as live or change the homepage default until deployed and verified.

## October 22 post-rotation research-only check

- Kenny created the October 22 workspace-scoped Claude key, installed it in Railway and confirmed disabling the October 13 key.
- `6121677` deployed successfully and completed research at 20:29 UTC with a potential competitor and proposed strategy.
- Kenny subsequently explicitly requested a fresh check without another prospect email or internal alert. This checkpoint triggers the existing one-shot startup recovery, not a homepage cutover.
- Reuse snapshot `4000c425-3394-4ee7-9bd4-fea38be5225a`; do not create a new capture or email request.
- Baseline: 26 snapshots; this snapshot has 0 email requests; private-capture fingerprint `879b3d86f744dadee4070e499ebed611`.
- Internal alert was already queued at October 19 23:03:19.344 UTC; its state and timestamp must remain unchanged.
- No functional code change. `WIDGET_V2_DEFAULT=false` remains in place.

## October 22 homepage cutover

- Post-rotation check passed at 22:38:16 UTC on release `bc3dc05`.
- Snapshot count remained 26; email requests for the test stayed 0; capture fingerprint and October 19 alert timestamp were unchanged.
- Kenny then explicitly approved switching the homepage to V2 (“lets do it”).
- Only routing default changes from false to true. Existing homepage iframe is `/widget`; no WordPress edit required.
- Preserve `/excavate-v1` and remote backup tag. No fresh form submission, email request, notification or database migration for this cutover.
- Deployment and fresh desktop/mobile homepage verification must complete before reporting live.

## October 23 Perplexity credential verification

- Kenny reported deploying a replacement `PERPLEXITY_API_KEY` after the Railway security incident.
- Use the existing one-shot research recovery on the owner's saved Brex snapshot, without a new lead or email request.
- Baseline snapshot count: 27. Owner snapshot email requests: 0. Existing private-capture fingerprint and alert timestamp remain the same as the October 22 baseline.
- This documentation-only checkpoint restarts the service to invoke that recovery. No application code, homepage routing, workflow or credential value is changed here.
- A completed fresh research run requires the production Perplexity discovery response; static page/configuration readiness alone is not provider-key verification.
- Old Perplexity key revocation remains pending user action after this check.
