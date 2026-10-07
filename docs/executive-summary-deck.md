# Executive Summary presentation export

## User story

As a Brex report owner, I want the primary slide export to present only the content covered by the Executive Summary PDF, rather than all detailed report sections.

## Behavior

Content Studio's primary deck button is “Executive Summary Deck.” A neighboring “More deck export options” dropdown retains “Full detailed deck (original).”

The authenticated deck endpoint accepts `scope=summary` or `scope=full`. No scope defaults to summary; invalid or repeated scope values return 400. Internal renderer calls without a scope retain the old full behavior for backward compatibility.

Summary filenames end in `-executive-summary-deck.pptx`; explicit full-deck filenames remain unchanged.

## Summary content

Cover, engagement structure, at-a-glance counts, strategic thesis, content pillars and mix, aggregate publishing timeline, retainer comparison and scope, compact investment benchmarks, week-one preview, compact ROI results and limitations with traffic/lead/payback charts when available, compact site architecture when available, relevant pricing references, and next steps.

Detailed SWOT, PESTEL, Porter's Five Forces, customer insights/persona/journey breakdowns, tactical service-rate tables, full page briefs, full ROI funnel/cost-comparison sections, and week-two-through-twelve post-level detail are not included in the summary presentation. The underlying report and all PDF exports remain unchanged.

This is an editable presentation of the summary content, not PDF-page screenshots. It does not invent findings, refresh research, or recompute saved financial projections. Slide count depends on report length; content continues rather than shrinking or clipping. Pricing-source footers and reference links are clickable, with full URLs retained in speaker notes.

## QA inventory

- Summary default, explicit full, invalid scope, filenames.
- Exact week-one titles retained; later-week titles excluded.
- Framework/customer/detail sentinel exclusions.
- Full renderer equality with legacy default; no input mutation.
- Text-region geometry, long content, actual-slide image inspection.
- Desktop/mobile summary download and separate full-deck download.
- Pending export and recoverable failure.
- Existing PDF POV and calendar recovery regression tests.

Production deployment requires user approval after QA. Existing ready reports can use this export without regeneration.

## Verification

37 automated tests passed, including summary-scope exclusions, preservation of the full renderer, PDF POV regression tests, calendar recovery, pagination, and PowerPoint packaging. TypeScript and production builds passed.

An existing Long May export fixture produced a 33-slide summary presentation with no text-region collisions. All rendered slides were reviewed via contact sheets; pricing slides were re-rendered and checked after adding explicit billing units. The deck contains native editable text, tables, and charts, with next steps last. The final PowerPoint passed the OOXML repair checker with no repairs needed.

Desktop summary and full downloads and a mobile summary download passed. Invalid scope returned 400; a simulated export failure showed a recoverable error and restored the button. No browser runtime errors or mobile horizontal overflow were observed. No live report was regenerated or modified during QA.
