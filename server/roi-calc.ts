// =============================================================
// ROI Projection Calculator
// Pure functions. Takes AI-inferred assumptions + plan post count,
// returns a 12-month projection with funnel, revenue, and payback.
//
// Modeling approach (deliberately conservative):
//   1. Posts go live at ~10/week = 40/month. Only posts published
//      more than `monthsToRank` months ago contribute mature traffic.
//   2. Newer posts contribute a linear ramp of traffic (0 -> full).
//   3. Monthly visitors -> leads -> MQL -> SQL -> won via cascading rates.
//   4. Revenue books when deal closes (SQL closes after sales cycle).
//   5. Gross profit = revenue * grossMargin.
//   6. Payback = first month where cumulative gross profit meets or
//      exceeds cumulative program cost (linearized across 12 months).
// =============================================================

import type {
  RoiAssumptions,
  RoiOutcomes,
  RoiMonthlyPoint,
  RoiProjections,
  ContentPlanPayload,
} from "@shared/schema";
import { PRICING_VERSION, packageFor } from "@shared/service-packages";

/** Deterministic catalog cost for newly inferred scenarios. Manual overrides
 * and already saved forecasts remain untouched. Never change avgDealSize. */
export function applyPackageCost(assumptions: RoiAssumptions, analysis: { sow?: unknown; assumptions?: unknown }): RoiAssumptions {
  let intake: any = {};
  try { intake = typeof analysis.assumptions === "string" ? JSON.parse(analysis.assumptions) : analysis.assumptions ?? {}; } catch {}
  const preferred = packageFor(intake?.preferredTier);
  const tier = preferred ?? packageFor("strategist")!;
  const monthly = (tier.monthly + tier.monthlyMax) / 2;
  const basis = preferred ? "Client-preferred package" : "Illustrative planning assumption, not a recommendation";
  return { ...assumptions, pricingVersion: PRICING_VERSION, programCost12Mo: monthly * 12,
    rationale: { ...assumptions.rationale, programCost:
      `${basis}: ${tier.name}, using the illustrative range midpoint of $${monthly.toLocaleString("en-US")}/month × 12 = $${(monthly * 12).toLocaleString("en-US")}. Approved range: $${tier.monthly.toLocaleString("en-US")}–$${tier.monthlyMax.toLocaleString("en-US")}/month. This midpoint is not a final quote. Additional execution, media, software, and third-party costs are excluded and must be budgeted before relying on ROI. This is a 12-month scenario, not the six-month minimum obligation.` } };
}

const POSTS_PER_MONTH = 40; // 10 posts/wk × 4 weeks
const PROJECTION_MONTHS = 12;

export function calculateRoiProjections(
  assumptions: RoiAssumptions,
  payload: ContentPlanPayload,
): RoiProjections {
  const totalPlannedPosts =
    payload.blogCalendar?.reduce((sum, w) => sum + (w.posts?.length ?? 0), 0) ?? 120;

  const monthly: RoiMonthlyPoint[] = [];
  let cumRevenue = 0;
  let cumGrossProfit = 0;
  const monthlyProgramCost = assumptions.programCost12Mo / 12;

  let paybackMonth: number | null = null;

  for (let month = 1; month <= PROJECTION_MONTHS; month++) {
    // Posts live at end of month (capped at total planned)
    const postsLive = Math.min(totalPlannedPosts, POSTS_PER_MONTH * month);

    // Traffic contribution — posts older than monthsToRank contribute full,
    // posts within the ramp window contribute linearly.
    let effectivePosts = 0;
    for (let publishMonth = 1; publishMonth <= month; publishMonth++) {
      const postsFromThisMonth = Math.min(
        POSTS_PER_MONTH,
        Math.max(0, totalPlannedPosts - POSTS_PER_MONTH * (publishMonth - 1)),
      );
      const ageMonths = month - publishMonth;
      let rampFactor = 0;
      if (ageMonths >= assumptions.monthsToRank) {
        rampFactor = assumptions.contentDecayFactor;
      } else {
        rampFactor = (ageMonths / assumptions.monthsToRank) * assumptions.contentDecayFactor;
      }
      effectivePosts += postsFromThisMonth * rampFactor;
    }

    const monthlyVisitors = Math.round(effectivePosts * assumptions.monthlyVisitorsPerPost);
    const monthlyLeads = Math.round(monthlyVisitors * assumptions.visitorToLeadRate);
    const monthlyMqls = Math.round(monthlyLeads * assumptions.leadToMqlRate);
    const monthlySqls = Math.round(monthlyMqls * assumptions.mqlToSqlRate);
    const monthlyClosedWon = Math.round(monthlySqls * assumptions.sqlToWonRate);
    const monthlyRevenue = Math.round(monthlyClosedWon * assumptions.avgDealSize);

    cumRevenue += monthlyRevenue;
    const monthlyGrossProfit = monthlyRevenue * assumptions.grossMargin;
    cumGrossProfit += monthlyGrossProfit;

    const cumProgramCost = monthlyProgramCost * month;
    if (paybackMonth === null && cumGrossProfit >= cumProgramCost && cumGrossProfit > 0) {
      paybackMonth = month;
    }

    monthly.push({
      month,
      postsLive,
      monthlyVisitors,
      monthlyLeads,
      monthlyMqls,
      monthlySqls,
      monthlyClosedWon,
      monthlyRevenue,
      cumulativeRevenue: Math.round(cumRevenue),
      cumulativeGrossProfit: Math.round(cumGrossProfit),
    });
  }

  const last = monthly[monthly.length - 1];
  const totalLeads = monthly.reduce((s, m) => s + m.monthlyLeads, 0);
  const totalMqls = monthly.reduce((s, m) => s + m.monthlyMqls, 0);
  const totalSqls = monthly.reduce((s, m) => s + m.monthlySqls, 0);
  const totalClosedWon = monthly.reduce((s, m) => s + m.monthlyClosedWon, 0);
  const totalRevenue = last.cumulativeRevenue;
  const totalGrossProfit = last.cumulativeGrossProfit;

  const paidEquivalentCost = Math.round(totalLeads * assumptions.paidCacBaseline);
  const savingsVsPaid = paidEquivalentCost - assumptions.programCost12Mo;

  const outcomes: RoiOutcomes = {
    month12MonthlyVisitors: last.monthlyVisitors,
    month12CumulativeVisitors: monthly.reduce((s, m) => s + m.monthlyVisitors, 0),
    totalLeads,
    totalMqls,
    totalSqls,
    totalClosedWon,
    totalRevenue,
    totalGrossProfit,
    brexCostPerLead: totalLeads > 0 ? Math.round(assumptions.programCost12Mo / totalLeads) : 0,
    brexCostPerSql: totalSqls > 0 ? Math.round(assumptions.programCost12Mo / totalSqls) : 0,
    paidEquivalentCost,
    savingsVsPaid,
    paybackMonth,
    roiMultiple:
      assumptions.programCost12Mo > 0
        ? Number((totalGrossProfit / assumptions.programCost12Mo).toFixed(2))
        : 0,
  };

  return {
    assumptions,
    outcomes,
    monthlyProjection: monthly,
    disclaimer:
      "Projections are conservative estimates based on industry benchmarks and assumptions inferred from the client's business context. Actual results depend on execution quality, market conditions, and product-market fit. This is a planning tool, not a guaranteed forecast.",
  };
}

// -----------------------------------------------------------------------------
// Shared ROI inference prompt.
//
// The prompt is the single source of truth used by BOTH the initial content-plan
// pipeline (server/content-pipeline.ts) and the on-demand recompute route
// (server/routes.ts). If you change the ROI methodology, change it here.
//
// Brex service fees belong only on the cost side. A prospect's customer revenue
// must come from that prospect's economics, never from the Brex SOW.
// -----------------------------------------------------------------------------
export const ROI_INFERENCE_SYSTEM_PROMPT = `You are a B2B revenue analyst inferring realistic, defensible ROI assumptions for a 12-month content marketing engagement.

Input: a client business analysis (industry, ICP, offerings, positioning, competitors) and Brex's proposed service packages (\`sow.priceTiers\`).

Output: numerical assumptions grounded in that specific client's economics.

════════════════════════════════════════════════════════════
═ HOW TO DERIVE avgDealSize — DO NOT USE GENERIC BENCHMARKS ═
════════════════════════════════════════════════════════════

The SOW priceTiers are what BREX charges the prospect. They are NOT what the prospect charges its customers.
Derive avgDealSize and dealType from the prospect's own products, services, buyer segment, and stated customer economics. Use verified customer pricing when available. If missing, identify the number explicitly as an unverified estimate to validate with the client; do not imply it was researched or supplied.
Never multiply a Brex service fee by 12 to infer a prospect's customer ACV.

════════════════════════════════════════════════════════════
═ OTHER FIELDS ═
════════════════════════════════════════════════════════════

- dealType: "acv" for retainers/subscriptions; "one-time" for implementation/hardware.
- grossMargin: 0.55–0.70 for services/consulting; 0.70–0.85 for SaaS; 0.30–0.45 for hardware/distribution.
- salesCycleDays: 30–60 SMB; 60–120 mid-market; 120–270 enterprise.
- visitorToLeadRate: 0.008–0.020 for B2B (mid-range of published benchmarks — not the floor).
- leadToMqlRate: 0.28–0.40.
- mqlToSqlRate: 0.30–0.45.
- sqlToWonRate: 0.18–0.28. USE THE HIGHER END when the client uses a paid diagnostic funnel (e.g. a $1,997 audit before retainer) — those buyers are pre-qualified and close at 25%+, not 17%.
- monthlyVisitorsPerPost: 30–80 for well-optimized SEO/AEO posts at maturity. Use the higher end for niches where the client is the framework owner or has a defensible category (e.g. trademarked methodology, thought-leader founder).
- monthsToRank: 3–5. Use 3 for established sites with existing domain authority, 4–5 for newer content programs.
- contentDecayFactor: 0.88–0.92.
- programCost12Mo: Brex's catalog cost will be set deterministically after inference. Use 87000 only as an illustrative Strategist CMO range-midpoint placeholder, not a quote, recommendation, or all-in delivery budget.
- paidCacBaseline: B2B CPL, $200–$800.

════════════════════════════════════════════════════════════
═ RATIONALE ═
════════════════════════════════════════════════════════════

Every field's rationale must reference the SPECIFIC client analysis (their offerings,
ICP, diagnostic model, etc.). Distinguish evidence from estimates and missing information.
Do not tune assumptions to achieve a desirable ROI. Negative or uncertain projections are valid planning outcomes.`;

// Fallback assumptions if LLM inference fails
export const FALLBACK_ASSUMPTIONS: RoiAssumptions = {
  avgDealSize: 25000,
  dealType: "one-time",
  grossMargin: 0.6,
  salesCycleDays: 90,
  visitorToLeadRate: 0.012,
  leadToMqlRate: 0.35,
  mqlToSqlRate: 0.4,
  sqlToWonRate: 0.2,
  monthlyVisitorsPerPost: 45,
  monthsToRank: 4,
  contentDecayFactor: 0.9,
  programCost12Mo: 87000,
  paidCacBaseline: 350,
  rationale: {
    dealSize:
      "B2B mid-market benchmark deal size when client-specific data was unavailable.",
    conversionRates:
      "Industry averages from B2B SaaS content marketing benchmarks (First Page Sage, Ahrefs).",
    trafficRamp:
      "4-month ramp reflects typical time-to-rank for well-optimized SEO/AEO content in competitive B2B categories.",
    programCost:
      "Illustrative Strategist CMO range midpoint of $7,250/month for 12 months, not a final quote. Additional scope and third-party costs excluded; validate before relying on ROI.",
  },
};
