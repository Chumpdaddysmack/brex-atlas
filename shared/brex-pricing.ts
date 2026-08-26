// =============================================================
// Brex Consulting — Locked Pricing (Tactical CMO line items + tiers)
// Approved 2026-08-26. Blended hourly $225. Bundle discounts:
// Advisor 17%, Strategist 24%, Fractional 32%.
// Sources are cited so every claim is defensible.
// =============================================================

export type BrexLineItem = {
  key: string;
  service: string;
  brexPrice: number; // dollars (monthly rate for retainers, unit price for projects)
  brexUnit: string; // "per month" | "per project" | "per hour" | "per article" | "per event" | "% of spend" | "one-time"
  benchmarkLow: number;
  benchmarkMid: number;
  benchmarkHigh: number;
  benchmarkUnit: string; // same as brexUnit unless noted
  sourceUrls: string[]; // industry benchmark URLs
  positioning: "below-floor" | "at-floor" | "mid-market" | "premium";
  notes?: string;
};

// Blended hourly rate underlying all Brex pricing.
export const BREX_BLENDED_HOURLY = 225;

export const BREX_LINE_ITEMS: BrexLineItem[] = [
  {
    key: "diagnostic",
    service: "Profit Excavation Diagnostic™",
    brexPrice: 1997,
    brexUnit: "one-time",
    benchmarkLow: 1500,
    benchmarkMid: 3250,
    benchmarkHigh: 5000,
    benchmarkUnit: "one-time",
    sourceUrls: [
      "https://swapbiswas.com/blog/how-much-does-an-seo-audit-cost/",
      "https://spaceandstory.co/compare/aeo-cost",
    ],
    positioning: "at-floor",
    notes: "5-day written diagnostic. Credit applied toward retainer within 30 days.",
  },
  {
    key: "advisory-hour",
    service: "Strategic advisory (1:1)",
    brexPrice: 300,
    brexUnit: "per hour",
    benchmarkLow: 200,
    benchmarkMid: 350,
    benchmarkHigh: 500,
    benchmarkUnit: "per hour",
    sourceUrls: [
      "https://salaryguide.com/blog/fractional-cmo-rates",
      "https://o-cmo.com/blog/fractional-cmo-cost/",
    ],
    positioning: "mid-market",
    notes: "Senior fractional CMO hourly (US) $200–$500; most common $200–$350.",
  },
  {
    key: "web-audit",
    service: "Website + AEO/SEO teardown",
    brexPrice: 3500,
    brexUnit: "per project",
    benchmarkLow: 2000,
    benchmarkMid: 5000,
    benchmarkHigh: 8000,
    benchmarkUnit: "per project",
    sourceUrls: [
      "https://www.ultraseosolutions.com/how-much-does-an-seo-audit-cost/",
      "https://theremarkableagency.com/blog/aeo-geo-agency-cost/",
    ],
    positioning: "at-floor",
    notes: "Full technical + AEO/GEO teardown; SMB/B2B $2K–$8K.",
  },
  {
    key: "competitive-analysis",
    service: "Competitive market analysis",
    brexPrice: 2500,
    brexUnit: "per project",
    benchmarkLow: 5000,
    benchmarkMid: 12500,
    benchmarkHigh: 25000,
    benchmarkUnit: "per project",
    sourceUrls: [
      "https://waveup.com/blog/top-10-go-to-market-consulting-firms/",
      "https://gtm.quest/articles/gtm-consultant-pricing-guide",
    ],
    positioning: "below-floor",
    notes: "Boutique GTM competitive deep-dive $5K–$25K.",
  },
  {
    key: "messaging-sprint",
    service: "Messaging + positioning sprint",
    brexPrice: 4500,
    brexUnit: "per project",
    benchmarkLow: 8000,
    benchmarkMid: 15000,
    benchmarkHigh: 25000,
    benchmarkUnit: "per project",
    sourceUrls: [
      "https://gtm-labs.co/go-to-market-strategy-consultant",
      "https://gtm.quest/articles/gtm-consultant-pricing-guide",
    ],
    positioning: "below-floor",
    notes: "GTM strategy dev $8K–$25K. 2-week Brex sprint.",
  },
  {
    key: "content-pillar",
    service: "Content pillar buildout (Big Rock Method™)",
    brexPrice: 3500,
    brexUnit: "per project",
    benchmarkLow: 3000,
    benchmarkMid: 9000,
    benchmarkHigh: 15000,
    benchmarkUnit: "per project",
    sourceUrls: [
      "https://www.digitalapplied.com/blog/digital-marketing-pricing-2026-agency-costs",
      "https://windmillgrowth.com/blogseo/b2b-content-marketing-costs-pricing-benchmarks-2026",
    ],
    positioning: "at-floor",
    notes: "Pillar + supporting cluster; content strategy retainer $3K–$15K/mo equivalent.",
  },
  {
    key: "case-study",
    service: "Case study asset (research + write + design)",
    brexPrice: 1500,
    brexUnit: "per project",
    benchmarkLow: 1500,
    benchmarkMid: 3250,
    benchmarkHigh: 5000,
    benchmarkUnit: "per project",
    sourceUrls: [
      "https://windmillgrowth.com/blogseo/b2b-content-marketing-costs-pricing-benchmarks-2026",
    ],
    positioning: "at-floor",
    notes: "B2B case study $1.5K–$5K industry range.",
  },
  {
    key: "blog-article",
    service: "Blog / pillar article (1,500 words, full-service AEO)",
    brexPrice: 650,
    brexUnit: "per article",
    benchmarkLow: 500,
    benchmarkMid: 1200,
    benchmarkHigh: 2500,
    benchmarkUnit: "per article",
    sourceUrls: [
      "https://arvow.com/blog/how-much-does-a-blog-post-cost-in-2026",
      "https://windmillgrowth.com/blogseo/b2b-content-marketing-costs-pricing-benchmarks-2026",
    ],
    positioning: "at-floor",
    notes: "Full-service B2B blog post $500–$2,500; Brex at low end.",
  },
  {
    key: "landing-page",
    service: "Landing page (copy + AEO + design)",
    brexPrice: 2500,
    brexUnit: "per project",
    benchmarkLow: 1500,
    benchmarkMid: 4500,
    benchmarkHigh: 10000,
    benchmarkUnit: "per project",
    sourceUrls: [
      "https://www.digitalapplied.com/blog/digital-marketing-pricing-2026-agency-costs",
    ],
    positioning: "at-floor",
    notes: "AEO landing page $1.5K–$10K.",
  },
  {
    key: "hubspot-setup",
    service: "HubSpot setup + workflow build",
    brexPrice: 4500,
    brexUnit: "per project",
    benchmarkLow: 7000,
    benchmarkMid: 16000,
    benchmarkHigh: 25000,
    benchmarkUnit: "per project",
    sourceUrls: [
      "https://www.trooinbound.com/blog/how-much-does-hubspot-implementation-cost-in-2026/",
      "https://insidea.com/blog/hubspot/hubspot-implementation-cost",
    ],
    positioning: "below-floor",
    notes: "Mid-market HubSpot implementation $7K–$25K.",
  },
  {
    key: "linkedin-outbound",
    service: "LinkedIn outbound program (setup + mgmt/mo)",
    brexPrice: 2500,
    brexUnit: "per month",
    benchmarkLow: 3000,
    benchmarkMid: 6000,
    benchmarkHigh: 12000,
    benchmarkUnit: "per month",
    sourceUrls: [
      "https://theremarkableagency.com/blog/linkedin-ads-agency-cost-2026/",
    ],
    positioning: "below-floor",
    notes: "Includes ICP list build, sequence copy, weekly execution, reporting.",
  },
  {
    key: "webinar",
    service: "Webinar production + promotion (per event)",
    brexPrice: 3500,
    brexUnit: "per event",
    benchmarkLow: 5000,
    benchmarkMid: 7500,
    benchmarkHigh: 10000,
    benchmarkUnit: "per event",
    sourceUrls: [
      "https://contentallies.com/learn/top-b2b-webinar-companies",
      "https://www.geisheker.com/b2b-webinar-thousands-attendees/",
    ],
    positioning: "below-floor",
    notes: "Agency-managed B2B webinar $5K–$10K.",
  },
  {
    key: "executive-coaching",
    service: "Executive coaching / LinkedIn training",
    brexPrice: 350,
    brexUnit: "per hour",
    benchmarkLow: 300,
    benchmarkMid: 375,
    benchmarkHigh: 450,
    benchmarkUnit: "per hour",
    sourceUrls: [
      "https://o-cmo.com/blog/fractional-cmo-cost/",
    ],
    positioning: "mid-market",
    notes: "Senior 1:1 coaching $300–$450/hr per Brex positioning.",
  },
  {
    key: "scorecard",
    service: "Marketing scorecard + dashboard build",
    brexPrice: 3500,
    brexUnit: "per project",
    benchmarkLow: 5000,
    benchmarkMid: 10000,
    benchmarkHigh: 15000,
    benchmarkUnit: "per project",
    sourceUrls: [
      "https://upliftgtm.com/blog/gtm-agency-cost-pricing-guide",
    ],
    positioning: "below-floor",
    notes: "RevOps/GTM dashboard build $5K–$15K.",
  },
];

// =============================================================
// Bundled tiers (built from line items, then discounted)
// Advisor 17%, Strategist 24%, Fractional 32% off à la carte
// =============================================================

export type BrexTier = {
  key: "advisor" | "strategist" | "fractional";
  name: string;
  monthly: number; // Brex price
  aLaCarteMonthly: number; // sum of monthly-equivalent line items
  discountPct: number; // savings vs à la carte
  bestFor: string;
  includes: string[];
  industryLow: number;
  industryMid: number;
  industryHigh: number;
  industrySourceUrls: string[];
};

export const BREX_TIERS: BrexTier[] = [
  {
    key: "advisor",
    name: "Advisor CMO",
    monthly: 3500,
    aLaCarteMonthly: 4200,
    discountPct: 17,
    bestFor:
      "Founders and CEOs who need senior clarity, a documented roadmap, and monthly recalibration before scaling spend.",
    includes: [
      "2 strategic advisory hours per month ($600 value)",
      "Quarterly Profit Excavation refresh ($170/mo amortized)",
      "Quarterly review + marketing scorecard readout ($1,200/mo blended)",
      "Ongoing Slack/email advisory access",
      "Annual planning session included",
    ],
    industryLow: 5000,
    industryMid: 10000,
    industryHigh: 15000,
    industrySourceUrls: [
      "https://www.pitchkitchen.com/blog/consulting-rates-2026-what-b2b-messaging-branding-and-gtm-work-costs",
      "https://rankedcmo.com/fractional-cmo-cost",
    ],
  },
  {
    key: "strategist",
    name: "Strategist CMO",
    monthly: 6500,
    aLaCarteMonthly: 8600,
    discountPct: 24,
    bestFor:
      "Companies ready to formalize positioning, build content authority, and enable an in-house team with a senior CMO in the room.",
    includes: [
      "Everything in Advisor CMO",
      "6 strategic advisory hours per month ($1,800 value)",
      "Quarterly messaging/positioning sprint (amortized $1,500/mo)",
      "2 blog pillars per month ($1,300 value)",
      "Quarterly case study asset ($500/mo amortized)",
      "HubSpot workflow oversight",
      "Monthly marketing scorecard",
    ],
    industryLow: 8000,
    industryMid: 15000,
    industryHigh: 25000,
    industrySourceUrls: [
      "https://treetopgrowthstrategy.com/2026-fractional-executive-pricing-report",
      "https://www.averi.ai/blog/fractional-cmo-vs-full-time-cmo-cost-analysis-the-complete-2025-guide",
    ],
  },
  {
    key: "fractional",
    name: "Full Fractional CMO",
    monthly: 9500,
    aLaCarteMonthly: 13900,
    discountPct: 32,
    bestFor:
      "Growth-stage B2B companies replacing a full-time CMO hire with senior owner-operator leadership and full-stack execution.",
    includes: [
      "Everything in Strategist CMO",
      "10 strategic advisory hours per month ($3,000 value)",
      "LinkedIn outbound program running ($2,500/mo)",
      "4 blog pillars per month ($2,600 value)",
      "1 landing page per month ($2,500 value)",
      "Quarterly webinar production ($1,170/mo amortized)",
      "Full paid media oversight",
      "Full HubSpot administration",
    ],
    industryLow: 8000,
    industryMid: 15000,
    industryHigh: 25000,
    industrySourceUrls: [
      "https://treetopgrowthstrategy.com/2026-fractional-executive-pricing-report",
      "https://markcmo.com/fractional-cmo-cost",
    ],
  },
];

// =============================================================
// Helpers
// =============================================================

export function formatBrexPrice(price: number, unit: string): string {
  if (unit === "% of spend") return `${price}%`;
  if (price >= 1000) {
    const k = price / 1000;
    return `$${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  return `$${price.toLocaleString()}`;
}

export function computeSavings(
  brexPrice: number,
  benchmarkMid: number,
): { deltaPct: number; label: string } {
  if (benchmarkMid <= 0) return { deltaPct: 0, label: "—" };
  const deltaPct = Math.round(((benchmarkMid - brexPrice) / benchmarkMid) * 100);
  const sign = deltaPct >= 0 ? "-" : "+";
  return { deltaPct, label: `${sign}${Math.abs(deltaPct)}%` };
}

export function positioningColor(
  positioning: BrexLineItem["positioning"],
): { hex: string; label: string } {
  switch (positioning) {
    case "below-floor":
      return { hex: "#0F766E", label: "Below market floor" };
    case "at-floor":
      return { hex: "#0891B2", label: "At market floor" };
    case "mid-market":
      return { hex: "#4B5563", label: "Mid-market" };
    case "premium":
      return { hex: "#B45309", label: "Premium" };
  }
}
