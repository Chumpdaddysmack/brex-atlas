// =============================================================
// Marketing Agency Pricing Benchmarks — 2026
// Sourced from Clutch, Ahrefs, Credo, DigitalApplied, and
// aggregated industry surveys. Update quarterly.
// =============================================================

export type Benchmark = {
  service: string;
  unit: string; // "per month" | "per post" | "per hour" | "% of spend"
  low: number;
  mean: number;
  high: number;
  brexPositioning: "boutique" | "mid-market" | "premium";
  sourceKey: string; // matches BENCHMARK_SOURCES
  notes?: string;
};

export type BenchmarkSource = {
  key: string;
  publisher: string;
  title: string;
  url: string;
  year: number;
};

export const BENCHMARK_SOURCES: BenchmarkSource[] = [
  {
    key: "clutch-ad-2026",
    publisher: "Clutch",
    title: "Advertising Agency Pricing Guide, August 2026",
    url: "https://clutch.co/agencies/pricing",
    year: 2026,
  },
  {
    key: "clutch-seo-2026",
    publisher: "Clutch",
    title: "SEO Agency Retainer Data (65,550 profiled companies)",
    url: "https://www.prismnews.com/topics/agency-seo-growth/clutch-data-reveals-seo-agency-retainers-average-3199",
    year: 2026,
  },
  {
    key: "ahrefs-seo-2026",
    publisher: "Ahrefs",
    title: "SEO Pricing Survey (439 providers)",
    url: "https://foundgrove.com/resources/seo-cost-calculator",
    year: 2026,
  },
  {
    key: "digitalapplied-2026",
    publisher: "Digital Applied",
    title: "Digital Marketing Pricing 2026: Agency Costs",
    url: "https://www.digitalapplied.com/blog/digital-marketing-pricing-2026-agency-costs",
    year: 2026,
  },
  {
    key: "windmill-b2b-2026",
    publisher: "Windmill Growth",
    title: "B2B Content Marketing Costs 2026 Pricing Benchmarks",
    url: "https://windmillgrowth.com/blogseo/b2b-content-marketing-costs-pricing-benchmarks-2026",
    year: 2026,
  },
  {
    key: "mightyquill-2026",
    publisher: "The Mighty Quill",
    title: "B2B Blog Content Cost Guide 2026",
    url: "https://www.themightyquill.com/how-much-should-b2b-blog-content-cost-in-2026-complete-pricing-guide/",
    year: 2026,
  },
  {
    key: "gofractional-2026",
    publisher: "Go Fractional",
    title: "Fractional CMO Cost: 2026 Rates by Engagement Type",
    url: "https://www.gofractional.com/blog/fractional-cmo-salary",
    year: 2026,
  },
  {
    key: "markcmo-2026",
    publisher: "MarkCMO",
    title: "Fractional CMO Cost 2026: Rates by Company Size",
    url: "https://markcmo.com/fractional-cmo-cost",
    year: 2026,
  },
  {
    key: "averi-2026",
    publisher: "Averi",
    title: "Fractional CMO vs. Full-Time CMO 2026 Cost Breakdown",
    url: "https://www.averi.ai/blog/fractional-cmo-vs-full-time-cmo-cost-analysis-the-complete-2025-guide",
    year: 2026,
  },
  {
    key: "remarkable-linkedin-2026",
    publisher: "The Remarkable Agency",
    title: "LinkedIn Ads Agency Cost 2026",
    url: "https://theremarkableagency.com/blog/linkedin-ads-agency-cost-2026/",
    year: 2026,
  },
  {
    key: "stackmatix-linkedin-2026",
    publisher: "Stackmatix",
    title: "LinkedIn Ads Cost 2026: CPC & Management Fees",
    url: "https://www.stackmatix.com/blog/linkedin-ads-cost",
    year: 2026,
  },
  {
    key: "searchbloom-seo-2026",
    publisher: "SearchBloom",
    title: "SEO Company Pricing 2026",
    url: "https://www.searchbloom.com/blog/how-much-does-it-cost-to-hire-an-seo-company/",
    year: 2026,
  },
  {
    key: "arvow-blog-2026",
    publisher: "Arvow",
    title: "Blog Post Cost 2026 (Siege Media data)",
    url: "https://arvow.com/blog/how-much-does-a-blog-post-cost-in-2026",
    year: 2026,
  },
];

// =============================================================
// Benchmarks table — Brex is positioned mid-market/premium
// =============================================================

export const PRICING_BENCHMARKS: Benchmark[] = [
  {
    service: "Blog content (per post, full-service B2B)",
    unit: "per post",
    low: 500,
    mean: 1200,
    high: 2500,
    brexPositioning: "premium",
    sourceKey: "windmill-b2b-2026",
    notes:
      "Full-service = strategy + writing + SEO/AEO + images. Brex includes editorial brief, keyword targeting, and pillar alignment.",
  },
  {
    service: "SEO/AEO retainer — mid-market B2B",
    unit: "per month",
    low: 3000,
    mean: 7500,
    high: 15000,
    brexPositioning: "mid-market",
    sourceKey: "digitalapplied-2026",
    notes:
      "Mid-size agency SEO retainer band. Ahrefs median across 439 providers is $3,209/mo.",
  },
  {
    service: "Content strategy retainer (agency)",
    unit: "per month",
    low: 3000,
    mean: 7500,
    high: 15000,
    brexPositioning: "premium",
    sourceKey: "arvow-blog-2026",
    notes:
      "Typical monthly SEO content retainer for SMB-to-mid-market per Siege Media data.",
  },
  {
    service: "Fractional CMO retainer — mid-market ($10–50M rev)",
    unit: "per month",
    low: 8000,
    mean: 15000,
    high: 25000,
    brexPositioning: "mid-market",
    sourceKey: "averi-2026",
    notes:
      "Growth-stage companies ($10M-$50M revenue). Averi 2026 breakdown puts the midpoint at $10-15K/mo.",
  },
  {
    service: "LinkedIn Ads management",
    unit: "per month",
    low: 3000,
    mean: 6000,
    high: 12000,
    brexPositioning: "mid-market",
    sourceKey: "remarkable-linkedin-2026",
    notes:
      "Flat-fee model. Alternative: 15–20% of media spend (Stackmatix 2026). Cost-per-lead in B2B: $60–$150.",
  },
  {
    service: "LinkedIn Ads management — % of spend model",
    unit: "% of spend",
    low: 10,
    mean: 15,
    high: 20,
    brexPositioning: "mid-market",
    sourceKey: "stackmatix-linkedin-2026",
    notes:
      "Percentage-of-spend model most common. On $5K/mo media budget, expect $750-$1,000 in fees.",
  },
  {
    service: "Cold email sequence setup (per sequence)",
    unit: "per project",
    low: 1500,
    mean: 4000,
    high: 8000,
    brexPositioning: "premium",
    sourceKey: "digitalapplied-2026",
    notes:
      "3-touch B2B cold email sequence with ICP targeting, copywriting, and subject-line A/B variants.",
  },
  {
    service: "Landing page design + copy (per page)",
    unit: "per project",
    low: 1500,
    mean: 4500,
    high: 10000,
    brexPositioning: "mid-market",
    sourceKey: "digitalapplied-2026",
    notes:
      "AEO-optimized landing page with copy, hero, proof, CTA, and mobile responsive design.",
  },
  {
    service: "Agency hourly consulting rate (US)",
    unit: "per hour",
    low: 100,
    mean: 175,
    high: 300,
    brexPositioning: "mid-market",
    sourceKey: "clutch-ad-2026",
    notes:
      "Clutch US benchmark $100-$149/hr for advertising services. Fractional CMOs charge $200-$500/hr per Averi.",
  },
];

// =============================================================
// Helpers
// =============================================================

export function getSource(key: string): BenchmarkSource | undefined {
  return BENCHMARK_SOURCES.find((s) => s.key === key);
}

export function formatMoney(n: number, unit: string): string {
  if (unit === "% of spend") return `${n}%`;
  if (unit === "per hour") return `$${n}`;
  if (n >= 1000) return `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return `$${n.toLocaleString()}`;
}

export function positioningLabel(p: Benchmark["brexPositioning"]): string {
  return p === "premium"
    ? "Premium tier"
    : p === "mid-market"
      ? "Mid-market tier"
      : "Boutique tier";
}
