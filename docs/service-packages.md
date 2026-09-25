# Brex service packages

Approved September 25, 2026. These ranges supersede both the former fixed package fees and the AI-generated Foundation/Growth/Scale proposal options.

| Package | Monthly range |
| --- | --- |
| Advisor CMO | $3,500–$5,000 |
| Strategist CMO | $6,500–$8,000 |
| Full Fractional CMO | $9,500–$15,500 |

## Commercial rules

The engagement spans 12 months with an initial six-month commitment. The 90-day roadmap and 12-week calendar remain the on-ramp quarter.

Final fees depend on agreed scope, delivery volume, and complexity. Existing catalog inclusions describe the baseline service mix, not unlimited fulfillment or a guarantee that every strategic recommendation is included at every tier. Additional work, media spend, software, and third-party expenses require separate scoping and approval. Old fixed-discount claims have been removed.

`shared/brex-pricing.ts` stores the approved package names, range endpoints, and baseline inclusions. `shared/service-packages.ts` provides canonical labels, proposal normalization, and generation instructions. AI may suggest a package for review, but cannot invent a fee, narrow the range, or silently add scope. There is no automatic middle-tier recommendation.

## Saved proposals and exports

New SOWs use the catalog. Existing SOWs render and copy with current catalog packages without rewriting their stored JSON or signed agreements. The original strategy, research findings, and roadmap phases are retained. PDF and PowerPoint exports use the same catalog ranges; previously downloaded files must be exported again.

The internal `fractional` key and widget/CRM `full-fractional` key are preserved for compatibility; both represent Full Fractional CMO.

## Forecasts and new lead estimates

New or explicitly regenerated ROI scenarios use the preferred package, or a current valid model suggestion. With neither, Strategist CMO is an explicitly labeled illustrative planning scenario, not a recommendation. The scenario uses the range midpoint: Advisor $4,250/month, Strategist $7,250/month, or Full Fractional $12,500/month. These are assumptions, not final quotes.

Brex fees are program costs, not the prospect's average customer deal size. The latter must come from the prospect's own economics or be labeled as an unverified estimate. ROI cost rationale discloses excluded delivery and third-party costs. Manual cost overrides remain available. Existing forecasts are not silently changed and are flagged as predating the current ranges.

Future widget-created HubSpot leads use the appropriate range minimum as a labeled monthly estimate in the deal amount and include the full range in the description. No existing HubSpot deals, catalog products, QuickBooks records, invoices, or signed agreements were changed.

## Verification

Regression tests cover exact range endpoints, immutable legacy normalization, recommendation validity, monthly midpoint scenarios, separation of client revenue from Brex fees, and exported prices. Browser checks cover the three cards, copied brief, recommendation display, Demo mode, saved forecast warning, responsive tables, and mobile/dark layouts.
