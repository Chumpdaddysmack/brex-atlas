# Atlas marketing health and service-fit rubric

Restores the score ring, four sub-scores, and potential service tier without restoring inferred scores or manufactured benchmarks. Version: `brex-marketing-health-v1-2026-10-04`.

## Health assessment

Eight behavior-anchored questions, each worth 0–3 points, form four equally weighted dimensions: positioning clarity, offer structure, buyer alignment, and growth execution and measurement. These are Brex-authored questions and scoring rules, informed by research rather than validated by it.

- **Overall score:** Round `100 × total points / 24` to the nearest integer, only when all eight answers are known.
- **Dimension score:** Round `100 × dimension points / 6` when both answers are known. Do not average the rounded dimension scores to calculate the total.
- **Bands:** 0–39 Foundational gaps; 40–59 Developing; 60–79 Established; 80–100 Managed & improving.
- **Unknown answers:** Not zero. Partial results show known dimension scores, answer coverage, and a pending overall score.
- **Interpretation:** Higher means more developed self-reported practices, not greater need for an expensive retainer, market percentile, revenue potential, or independently audited health.
- **Priorities:** Up to three lowest-scoring practices with next-step suggestions. Ties follow question order, not a claim of comparative business impact.

The marketing-capabilities study examines product development, pricing, channels, communications, selling, information, planning, and implementation in relation to performance. It informs our capability topics, not these exact questions, weights, thresholds, or conclusions about a particular prospect ([Vorhies and Morgan, 2005](https://neil-a-morgan.com/wp-content/uploads/2020/04/Vorhies-Morgan-JM-2005.pdf)).

McKinsey recommends clarity of remit, alignment, resources, and business-outcome metrics. Its observational findings do not validate Brex's 0–100 model or prove a causal outcome from buying a package ([McKinsey, 2023](https://www.mckinsey.com/capabilities/growth-marketing-and-sales/our-insights/the-power-of-partnership-how-the-ceo-cmo-relationship-can-drive-outsize-growth)).

## Service-tier screening

Service tier is independent of health score, revenue band, and industry. It is a preliminary suggestion for Kenny's review, not a final engagement recommendation.

| Responsibility requested | Accountability | Potential tier | Monthly range |
|---|---|---|---|
| Senior advice | Capable client owner retains executive responsibility | Advisor CMO | $3,500–$5,000 |
| Strategy and program guidance | Capable client owner retains executive responsibility | Strategist CMO | $6,500–$8,000 |
| Executive leadership | Vacant or separately delegated executive remit | Full Fractional CMO | $9,500–$15,500 |

These mappings and prices are Brex service-design decisions, not research-derived thresholds. A high score or revenue band never forces an upsell, and a mismatch between accountability and requested support requires discussion.

Before displaying a potential tier, require an engaged sponsor with appropriate authority; available or funded implementation resources; leadership budget reaching the requested tier's minimum; willingness to share economics and act; and a stated growth goal and timeframe. Unknowns or pending confirmation suppress the tier; known resource, budget, sponsorship, or willingness issues trigger a readiness-first result. Insufficient budget does not substitute a cheaper tier that leaves the requested remit unmet.

Readiness research distinguishes change commitment from collective efficacy, but a single respondent cannot establish organizational readiness. Our questions are preliminary screening, not an ORIC administration or validated prediction ([Shea et al., 2014](https://pmc.ncbi.nlm.nih.gov/articles/PMC3904699/)).

## Provenance and integration boundaries

- Answers are explicitly self-reported. The separate researched company snapshot retains its original citations and evidence audit.
- General studies support why a criterion matters; they do not substantiate any prospect's answers or business condition.
- Server computes the score and tier. Client-supplied scores, tiers, invalid choices, and unexpected properties are rejected.
- Input and result are stored inside the existing snapshot JSON, bound to its access token and original ten-day expiry. No database schema migration is needed.
- Historical snapshots remain unchanged and render without a score. The existing full-report human-approved tier assessment is unchanged.
- Existing results-link email delivery and consent remain unchanged. This release does not insert scores into the email body, create new HubSpot fields, activate internal alerts, or write old `atlas_fit_score` triggers.
- No new claims of salary savings, industry averages, top-quartile performance, or expected revenue improvement.
- Before the combined email rollout: separately approve the exact new CRM fields and email drafts, review revised request permission and immutable delivery projection, then test controlled delivery. Do not edit the pinned live email or workflow in place.

## QA inventory

Test 0/33/67/100 extremes, partial/unknown answers, the three remit mappings, same health with different tiers, revenue independence, insufficient budget, existing ownership/leadership mismatch, no implementation team, pending sponsor, malformed input, input lengths, server persistence, expired links, and legacy snapshots. Check all three form stages, back navigation, result explanations, research citations, source methodology, saved text, restart, config failure, and results-link reload at desktop and mobile widths. Use synthetic local research and no-send fixtures for browser QA; never issue real prospect emails in automated tests.
