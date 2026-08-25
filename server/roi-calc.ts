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
  programCost12Mo: 90000,
  paidCacBaseline: 350,
  rationale: {
    dealSize:
      "B2B mid-market benchmark deal size when client-specific data was unavailable.",
    conversionRates:
      "Industry averages from B2B SaaS content marketing benchmarks (First Page Sage, Ahrefs).",
    trafficRamp:
      "4-month ramp reflects typical time-to-rank for well-optimized SEO/AEO content in competitive B2B categories.",
    programCost:
      "12-month equivalent of the Brex mid-market fractional CMO retainer plus content operations.",
  },
};
