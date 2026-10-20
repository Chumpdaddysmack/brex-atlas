# Widget V2 deployment checks

## Current production baseline
- Homepage embeds `/widget`, currently the V1 marketing-health form.
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
- Stage at `/excavate-v2` first; keep default false until production research and delivery checks pass.
- Verify the homepage iframe displays V2 only after the final switch.
- Backend authentication and paid report app landing still load; no new paid-report generation or export is part of this change.

## Limits of completed checks
- Local browser fixtures and 127 tests passed before deployment; 12 database-dependent tests skipped.
- These do not prove production model responses, CRM receipt handling or actual email arrival.
