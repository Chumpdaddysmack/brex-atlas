# Required widget contact capture

Prepared October 5, 2026. Not activated in production.

## Required fields

First name, last name, company email, company website, and annual revenue. Existing company name and company/website confirmation remain required; industry remains optional.

Revenue options (USD):
- Under $500K
- $500K to under $1 Million
- $1 Million to under $5 Million
- $5 Million to under $50 Million
- $50 Million to $250 Million

Boundary values belong to the next range (for example exactly $1M belongs to $1M–under $5M). The top range includes $250M. No additional over-$250M range was requested or added.

Company email validation checks syntax and rejects a bounded set of common personal-email domains. It is not mailbox or ownership verification. Different company/parent domains remain permitted.

## Storage and permission separation

Completed assessments atomically store a private `widget_snapshots.lead_capture` object alongside the public snapshot JSON. Name and email never enter the public snapshot, research-provider input, or results-link response. Revenue remains contextual and does not modify health scoring or select a higher tier.

The private capture includes names, email, revenue range, company, website, capture time, source, and the exact inquiry notice/version. It is saved before results are returned, independently of an email-copy request. Failed research does not count as a completed assessment and does not save a completed lead.

Inquiry notice:
> Your contact details are required to view your assessment. By submitting, you provide Brex Consulting with your details and assessment for inquiry follow-up. This does not request an email copy or subscribe you to promotional emails; those choices remain separate.

No automatic change to HubSpot marketing status, results-email permission, or promotional subscriptions occurs when contact details are submitted. An email-copy request continues to require the existing explicit checkbox. The email input is prefilled only in the visitor's current browser memory, not exposed on reopening a shared result.

## Activation gate

The code defaults off behind `SNAPSHOT_REQUIRED_LEAD_CAPTURE_ENABLED=true`. Production activation requires approval of `20261005_widget_private_lead_capture.sql`, an additive migration introducing a nullable JSONB column and object-type constraint. Existing rows remain null, existing RLS/access grants remain unchanged, and there is no deletion, backfill, or automatic send.

Apply the approved migration before deploying/enabling the gate. Existing snapshot-view and explicit email-copy routes remain compatible.

## Not included in this staged change

- HubSpot contact creation from the required intake.
- The new internal completion-alert workflow.
- Scores inserted directly into the prospect's email.

Those integrations must consume the privately recorded completed assessment without treating inquiry capture as email subscription permission. Do not reactivate the old internal alert: its enabled state fails the current prospect-delivery safeguard.
