# PDF pricing layout correction

## Reported defect

The MG Financial CEO full-plan PDF screenshot showed wrapped service titles colliding with billing units, missing continuation headers, and a blended-rate note flowing vertically in the last column. This was in the shared pricing renderer, not the role-specific executive brief.

## Correction

- Measure service names, units, ranges, midpoint notes, prices, savings, and positioning labels before rendering each row.
- Increase the position-column width without changing catalog values.
- Position unit/midpoint labels below the measured preceding text.
- Keep each row together and repeat measured column headers after page breaks.
- Explicitly reset the note to the full 468-point content width and reserve its measured height.
- Restore the left prose cursor after the table.

## Validation

39 automated tests, TypeScript checks, and production build passed. The new layout regression checks table geometry at four starting page offsets, all catalog rows, continuation headers, note width, and subsequent prose cursor position.

Rendered fresh synthetic CEO, COO, CMO, and CFO full-plan PDFs plus the standard full, strategy, and summary exports. Inspected affected rendered pricing pages, including the full-width note. The four POV pricing page images are identical and have no visible overlap or clipping. Existing tests retain role-specific evidence, source URLs, all 120 calendar titles, and input immutability.

The customer's original MG Financial PDF was not attached; the supplied screenshot established the defect. These verification exports use synthetic test data and do not regenerate or modify the customer's saved report.

## Release status

Prepared locally; production deployment requires approval. Previously downloaded PDFs must be exported again after deployment to receive the correction.
