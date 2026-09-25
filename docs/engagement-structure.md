# Engagement structure

Approved September 25, 2026.

## Commercial framing

- The growth engagement is planned across 12 months.
- An initial six-month commitment gives implementation, testing, and optimization time to work and results time to materialize.
- Results and timing vary. This is not a guarantee of a specific outcome or payback date.
- The existing 90-day roadmap and 12-week publishing calendar are the on-ramp quarter, covering months 1–3.
- Months 4–12 build on that foundation through ongoing execution, measurement, optimization, and quarterly planning.
- Billing cadence remains unchanged. Monthly pricing follows the approved ranges in `service-packages.md`. No new cancellation, renewal, notice, or penalty terms are implied.

## Implementation

`shared/engagement-terms.ts` is the canonical wording used by report views, Demo mode, copied briefs, generation prompts, and PDF/PowerPoint exports.

New SOW generation requests four quarterly phases across the year. The strategy roadmap and publishing calendar retain their existing first-quarter detail.

Legacy proposal wording is normalized on display and copy without mutating or backfilling stored historical JSON. Existing downloaded files do not change; users must export again. This release does not amend signed agreements, diagnostic or one-off project fees, CRM records, or billing records.

## Verification

Regression tests cover legacy wording, preserved prices and timelines, immutable normalization, and export content. A real saved report was exported to PDF and PowerPoint and reviewed for layout issues. Browser checks cover full and Demo views, copied content, mobile wrapping, and dark-mode readability.
