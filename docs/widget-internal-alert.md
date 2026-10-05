# Atlas completed-assessment internal alert

Approved October 5, 2026 at 1:17 PM Pacific. Recipient: Kenny Peavy, kenny@brexconsulting.com, HubSpot internal user 78405166.

## Workflow and properties

[Atlas Completed Assessment — Kenny Internal Alert](https://app-na2.hubspot.com/workflows/242249577/platform/flow/5064375995/edit) is separate from prospect results delivery and the paused legacy Internal Review workflow. It has a scored branch and an incomplete-score branch, both notifying Kenny only, followed by a Queued property update. Queued is not proof of inbox delivery.

Created Contact properties:

| Property | Type | Settings |
|---|---|---|
| Atlas health score | Number | [Edit](https://app-na2.hubspot.com/property-settings/242249577/properties?type=0-1&action=edit&property=atlas_health_score) |
| Atlas health band | Dropdown | [Edit](https://app-na2.hubspot.com/property-settings/242249577/properties?type=0-1&action=edit&property=atlas_health_band) |
| Atlas CMO recommendation | Dropdown | [Edit](https://app-na2.hubspot.com/property-settings/242249577/properties?type=0-1&action=edit&property=atlas_cmo_recommendation) |
| Atlas revenue range | Dropdown | [Edit](https://app-na2.hubspot.com/property-settings/242249577/properties?type=0-1&action=edit&property=atlas_revenue_range) |
| Atlas assessment summary | Text | [Edit](https://app-na2.hubspot.com/property-settings/242249577/properties?type=0-1&action=edit&property=atlas_assessment_summary) |
| Atlas assessment ID | Text | [Edit](https://app-na2.hubspot.com/property-settings/242249577/properties?type=0-1&action=edit&property=atlas_assessment_id) |
| Atlas assessment completed at | Date and time | [Edit](https://app-na2.hubspot.com/property-settings/242249577/properties?type=0-1&action=edit&property=atlas_assessment_completed_at) |
| Atlas internal alert state | Dropdown | [Edit](https://app-na2.hubspot.com/property-settings/242249577/properties?type=0-1&action=edit&property=atlas_internal_alert_state) |

Standard name, company, email and website fields receive the submitted identity. Source tag is Atlas Excavator Widget; Original Lead Source is preserved when set and otherwise becomes Website.

## Delivery path

1. Research completes and its snapshot plus private lead capture are saved atomically. New rows get a versioned private pending alert receipt in the existing `lead_capture` JSONB column. No new database migration is required.
2. A 15-second worker verifies the exact workflow configuration and Kenny-only recipient, then claims a receipt atomically.
3. Same-email receipts are ordered; an unresolved earlier receipt blocks later writes to avoid replacing an in-flight notification's contact values.
4. The worker recomputes the score/tier from stored self-reported answers, stages CRM properties with alert state Pending, then reads all projected values back.
5. Before the one Ready write, the worker saves a durable Waiting checkpoint. An ambiguous Ready response is reconciled with reads, never blindly resent.
6. Workflow reaches Queued after the internal notification action; the worker observes it, waits a 60-second settling interval, then releases the next receipt. No claim of email delivery is inferred from Queued.

Incomplete scores clear any previous numeric score rather than writing zero. Recommendations remain preliminary. No old `atlas_fit_score`, `atlas_fit_tier`, deal, lifecycle, marketing-status, or subscription properties are written. No snapshot email request is required.

The assessment summary includes deterministic business-question labels, subscores, answer completeness, readiness/budget answers and recommendation reasons. It excludes identity and raw free-text goal/timeframe/industry values; it indicates whether goals and timeframe were provided. Original submitted answers remain in the assessment record.

## Safety and operations

- Only new version-marked receipts are processed. No historical backfill.
- Existing private storage RLS and public response exclusions remain unchanged.
- Worker interruptions or unconfirmed outcomes become Needs review in the private receipt. Later same-email receipts wait for operator review; do not manually reset Ready without investigating HubSpot execution history.
- Pause: set `SNAPSHOT_INTERNAL_ALERT_ENABLED=false` and redeploy. Existing already-enrolled HubSpot actions may still finish; pause the new workflow as well if all pending actions must stop.
- Editing the workflow changes its pinned hash and stops new app dispatches until reviewed and deployed with an updated pin.
- Do not reactivate legacy workflow 5014906568; the prospect results-email guard requires it to stay paused.

## Verification boundary

Automated tests use local fixtures with no CRM/email side effects. Deployment verification must confirm production worker readiness and unchanged results-email readiness. The first real notification should be tested by Kenny submitting a fresh assessment; do not mark email delivery verified until receipt is confirmed.

HubSpot action structure follows the [workflow action reference](https://developers.hubspot.com/docs/api-reference/legacy/automation/workflows/action-enrollment-reference).
