# Executive summary perspectives

The report Overview now includes a read-only executive summary directly after the existing company introduction and before positioning details. Its selector has exactly four options: CEO, CFO, COO, and CMO. CEO is the default; `?pov=CFO` (or another allowed role) restores the selection on reload. The role is presentation state, not contact or report data. Existing query parameters and report-access hash fragments are preserved.

## Scope

- CEO: growth focus, differentiation, and executive sponsorship.
- CFO: financial baseline, staged investment, and commercial risk.
- COO: opening workstream, delivery capacity, and acceptance criteria.
- CMO: messaging, buyer relevance, and route to demand.

Available in the authenticated analysis, presenter demo, and read-only full/demo client reports. Existing reports work without regeneration or a database migration. Published snapshots remain unchanged; the display projects only their already-approved data.

## Evidence and access boundaries

This implementation uses role-specific editorial framing around selected saved passages. It does not call a model, conduct new research, calculate ROI, choose a different service tier, or treat model findings as independently verified facts. Original passages, uncertainty, dates, and available source links are retained. Unsourced report findings are labeled by their report section rather than given fabricated citations. Missing financial or capacity evidence is stated explicitly.

Demo summaries read only the existing bounded demo section items. No additional API requests, full-report fields, hidden assumptions, financial models, or recommendation data are used. Access-code, expiry, and revocation checks remain unchanged.

PDF, PowerPoint, and existing copy/export outputs are unchanged. No workflow, pricing, widget, or publication audience changes are included.

## Verification

Run `node --import tsx --test shared/executive-summary.test.ts` and the existing report sharing/demo tests. Browser checks should cover all four roles, reload, tab switching, old/missing data, full/demo client access, mobile wrapping, dark mode, and zero generation/write requests when changing role.
