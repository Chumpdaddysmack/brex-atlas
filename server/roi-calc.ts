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

// -----------------------------------------------------------------------------
// Shared ROI inference prompt.
//
// The prompt is the single source of truth used by BOTH the initial content-plan
// pipeline (server/content-pipeline.ts) and the on-demand recompute route
// (server/routes.ts). If you change the ROI methodology, change it here.
//
// CRITICAL: The client's own SOW/priceTiers is the strongest ACV signal we have.
// If Brex sold a $6,500/mo retainer, ACV is $78k — not a generic $25k benchmark.
// Failing to anchor on priceTiers was the source of the "AI thinks the client
// will lose money" bug (ROI multiple of 0.96x on a plan that should model 2–3x).
// -----------------------------------------------------------------------------
export const ROI_INFERENCE_SYSTEM_PROMPT = `You are a B2B revenue analyst inferring realistic, defensible ROI assumptions for a 12-month content marketing engagement.

Input: a client business analysis (industry, ICP, offerings, positioning, competitors) AND — critically — the client's own Statement of Work (\`sow.priceTiers\` and \`sow.engagementSummary\`).

Output: numerical assumptions grounded in that specific client's economics.

════════════════════════════════════════════════════════════
═ HOW TO DERIVE avgDealSize — DO NOT USE GENERIC BENCHMARKS ═
════════════════════════════════════════════════════════════

If the analysis contains \`sow.priceTiers\` (an array of pricing tiers with a
\`monthlyPrice\` or \`price\` string like "$6,500/mo"):

  1. Parse the numeric monthly price from each tier.
  2. Take the MIDDLE tier's monthly price (or the tier tagged "Recommended" if
     present) as the anchor monthly retainer.
  3. Multiply by 12 to get ACV.
  4. Set dealType = "acv".
  5. Set grossMargin = 0.60–0.70 (services retainer margin).

Example: priceTiers = [{$3,500/mo}, {$6,500/mo, Recommended}, {$9,500/mo}]
         → anchor = $6,500/mo → avgDealSize = $78,000 → dealType = "acv".

Only if \`sow.priceTiers\` is missing or unparseable should you fall back to
generic benchmarks. In that case say so explicitly in the dealSize rationale.

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
- programCost12Mo: Read this from \`sow.priceTiers\` too — take the SAME anchor tier and multiply by 12. If not available, use the mid-market retainer band $75k–$120k.
- paidCacBaseline: B2B CPL, $200–$800.

════════════════════════════════════════════════════════════
═ RATIONALE ═
════════════════════════════════════════════════════════════

Every field's rationale must reference the SPECIFIC client analysis (their offerings,
ICP, priceTiers, diagnostic model, etc.), not generic benchmarks. One tight sentence each.

DO NOT default to the lowest end of every range "just to be conservative" — that
produces a projection so pessimistic it makes profitable engagements look like
losers, which is worse than being aggressive. Use the middle of the range unless
you have a specific reason (from the analysis) to go lower.`;

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
