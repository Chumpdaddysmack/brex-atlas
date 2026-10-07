# Executive POV PDF editions

## User story

As a Brex report owner, I can export additional CEO, COO, CMO, and CFO editions so each executive receives a relevant decision-making brief alongside the same supporting report.

## Scope

Content Studio > Export PDF retains Full plan, Strategy only, and Executive summary. Four additional choices under “Full plan + executive POV” download the full plan preceded by the selected executive brief.

- CEO: growth, strategic priorities, and competitive position.
- COO: execution, capacity, and delivery accountability.
- CMO: positioning, buyer relevance, and demand generation.
- CFO: capital allocation, financial evidence, and downside risk.

The executive brief reuses the Overview tab's saved-finding projection. It changes framing and selected evidence, not underlying research, pricing, service recommendations, or the report body. Available citations are printed as full clickable URLs. Missing evidence and estimates remain explicitly labeled. No new research or LLM calls are performed.

The PDF cover, metadata, and filename identify the role. A CEO full export uses `Company-full-plan-ceo-perspective.pdf`. Original filenames remain unchanged.

The authenticated PDF endpoint accepts optional `pov=CEO|COO|CMO|CFO`; unsupported, empty, or repeated values are rejected with HTTP 400. Standard calls omit `pov`. Public/demo access is unchanged and does not gain a full-report export endpoint. Existing slide exports are unaffected.

## QA inventory

- Four menu items: each generates a real PDF, matching query parameter, filename, cover label, and role-specific brief.
- Existing three menu items: keep the original scopes, filenames, and unpersonalized body.
- Pending export: disable PDF trigger; successful and failed requests both restore it.
- Desktop and mobile: inspect dropdown placement, scrolling, legibility, and viewport overflow; test light and dark appearance.
- Unsupported POV: reject instead of silently exporting CEO.
- Missing financial evidence: display an explicit gap, with no synthetic revenue.
- Long evidence: permit multipage flow without clipping or losing the final passage.
- Source links: preserve complete URL and clickable PDF annotation.
- Original content: all 120 fixture post titles present; input objects unchanged after every render.
- Calendar recovery tests: continue to pass.

## Release boundary

Local QA uses synthetic fixtures with no database, research, CRM, or email access. Deployment requires separate user approval. Exporting an existing ready report does not require regenerating that report.

## Verification result

All 22 tests passed across calendar recovery, shared executive summaries, and PDF perspectives. TypeScript, production build, and diff checks passed. Browser QA downloaded all four POV editions and all three existing scopes, plus a CFO download on mobile. Invalid POV returned 400; a simulated server error displayed a useful message and restored the download control. No browser runtime errors were observed.

Cover and brief-page visual checks passed. CFO financial and market citations and COO company references retained clickable annotations. Fixture exports contained all 120 post titles without mutating the input. Missing-evidence and long-passage cases passed. The UI was inspected at 1440px and 390px, including dark mode and a scrollable mobile dropdown.
