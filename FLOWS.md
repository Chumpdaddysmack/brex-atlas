# Widget V2 deployment checks

## Current production baseline
- Homepage embeds `/widget`; after the approved cutover this serves Growth Snapshot V2.
- V1 has required inquiry fields, assessment, source research, internal alert, ten-day results and separately requested email.
- Paid Atlas report routes, executive exports and authentication are unchanged by the widget release.

## V2 intake and progress
- Enter website, name, company email and revenue; answer four questions.
- Expect immediate self-reported readiness, private inquiry receipt, real research stages and cited company findings.
- Unknown answers remain Pending; no service-tier recommendation is inferred.
- Retry preserves receipt/answers; Edit cancels prior work and new answers create a new assessment.

## V2 retention and delivery
- Copy results link, download text, reload saved results without contact details.
- Both permission checkboxes start unchecked.
- Email is requested only after checking snapshot permission; promotional permission stays separate.
- Discuss My Growth Snapshot opens the established HubSpot meeting page.

## Wording and proposed strategy
- Market uses explicitly stated current buyers, not the founder's career history.
- Strength describes a sourced capability without unverified industry-wide superiority.
- Competitor candidates require both businesses' official evidence of overlapping offering and buyers.
- Unconfirmed service geography produces a potential label, not an assertion of direct rivalry.
- Strategy shows Evidence basis, Proposed experiment, How to test it, and Assumptions to confirm.
- Proposed actions are not presented as current company practices or guaranteed results.
- Existing ready snapshots survive a failed optional research refresh.

## Compatibility and launch
- Verify published email wording, internal workflow recipient and unchanged enrollment.
- V1 remains reachable at `/excavate-v1`.
- `/widget`, `/widget.html` and `/excavate` serve V2 after cutover; `/excavate-v1` preserves V1.
- Verify the homepage iframe displays V2 only after the final switch.
- Backend authentication and paid report app landing still load; no new paid-report generation or export is part of this change.

## Limits of completed checks
- Local browser fixtures and 127 tests passed before deployment; 12 database-dependent tests skipped.
- Production research-only check completed October 22 at 22:38:16 UTC after old Claude key was disabled.
- Private contact capture fingerprint, existing alert timestamp, 0 email requests, and 26 total snapshots remained unchanged.
- Delivery configuration checks passed; no new email or notification was sent for this cutover.
