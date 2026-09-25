# Company introduction

The Overview tab begins with an Introduction card before Positioning, in both the full and read-only Demo views. It presents a sourced company-background paragraph rather than a recommendation or an inferred growth strategy.

## Research scope

- Company background, year founded, industry, specialist expertise, ownership.
- Annual revenue with currency, reporting year, and estimate status.
- Employee count or range with reporting period.
- Operating location count and geography, distinguished from dealer networks and markets served.
- Current documented marketing strategy, or explicitly labeled observations of public marketing activity.

Source-backed facts are stored under `extraction.companyProfile`, so no database migration is required. Unsupported details are omitted from the paragraph and listed as not verified. Research requires live cited web results; it does not fall back to model memory. Company-history research removes the default one-year recency limit, without changing other callers' defaults.

## Existing and new reports

New analyses attempt company research during extraction; a research outage does not fail the core report. Existing completed analyses expose Research introduction / Refresh introduction, calling the authenticated `POST /api/analyses/:id/company-profile` route.

The endpoint merges only `extraction.companyProfile`. It preserves the existing strategy, positioning, frameworks, assumptions, SOW, and content plan. It rejects duplicate in-process requests, running/malformed reports, and reports whose extraction changes during research. Failed research preserves the last successful introduction.

Demo mode receives an allowlisted public profile, with safe source URLs and no generation control. This is an Overview feature; PDF, PowerPoint, and Markdown exports are unchanged.

## Verification

- 49 regression tests passed, including ten company-profile tests.
- Production client/server build passed.
- Type checking retains only the pre-existing top-level-await error in `scripts/render-pdf-from-json.ts:55`.
- Playwright fixture QA passed for placement above Positioning, successful research and refresh, pending/disabled state, failed refresh preserving prior text, source links, unknown and estimate labels, full/demo/full mode changes, malformed legacy data, desktop and 390px mobile rendering, and dark mode.
- Browser tests used illustrative company data and mocked research responses, not a live prospect research call. No existing production report was backfilled during deployment.
- The sandbox's Code Mode tool failed before execution, preventing the usual Perplexity preview deployment. Production delivery uses the existing GitHub-to-Railway release path.
