# Company & Positioning Snapshot

Approved September 28, 2026. This replaces the widget's inferred score-led UI,
not the full-report generation pipeline.

## Public experience

Company name + website + explicit entity confirmation → fresh public-source
research → company introduction, one positioning observation, tentative
interpretation and question. References are visible before email capture.
The widget never reads internal analyses, paid reports, or private snapshots.
No inferred score, service tier or claimed benchmark appears.

Both company facts and positioning must reference the official company domain.
Source indexes are validated against provider-returned URLs. A second model pass
checks the candidate against retrieved research; this is an automated consistency
check, not independent or human verification. Missing research, entity ambiguity,
unsupported claims or failed audits produce an error, never inferred substitutes.

Links last ten days from generation. Access uses a random 256-bit bearer token,
stored only as a hash. Browser links carry the token in a fragment; view requests
POST it rather than putting it in URL logs. Links contain public research, never
the requesting email or consent details. Anyone holding a link can view it until
expiry. It is not a password-protected paid report.

## CRM and consent

The three approved contact fields are `atlas_snapshot_url`, `atlas_snapshot_id`
and `atlas_snapshot_requested_at`. The canonical Lead Source Tag remains
`Atlas Excavator Widget`; Original Lead Source gets `Website` only when blank.
Existing company/website data is not overwritten. Legacy diagnostic IDs, scores,
tiers, lifecycle/qualification and deals are untouched by this pipeline.

Email-copy requests persist their permission receipt before CRM operations.
No marketing subscription is inferred from an unchecked checkbox. Checked
permission is a form assertion, not verified email ownership or an automatic
HubSpot subscription. Retries preserve the first request receipt; successful
requests do not re-write the contact trigger. In-process locking prevents
concurrent double submission; multi-container exactly-once delivery is not claimed.

HubSpot marketing email delivery must obey subscription/marketing-contact rules.
The UI says request recorded, not email sent. A downloadable text copy preserves
all claims and source URLs when email is unavailable.

## Release gates

- Apply `20260928_widget_snapshots.sql` only after specific database approval.
- Two new tables, both RLS enabled with service-role-only access. No existing
  table, report or workflow is changed by the migration.
- Prepare a separate snapshot workflow; do not point legacy score recaps to it.
- Verify the new recap's subscription category and recipient eligibility before
  activation. Do not send to historic contacts.
- Research rate limit: five/IP/day; 40 total/hour; two concurrent per process.
  These limits are per single Railway container, not a distributed quota.
- Do not publish the live widget until storage is available and the delivery
  status is accurately represented.
