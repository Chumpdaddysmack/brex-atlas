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
  RoiScenario,
  RoiSensitivity,
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
  // Float accumulators — sum unrounded values, round only for display totals.
  // Prevents Math.round-to-zero cascades at low monthly volumes (e.g.
  // 0.4 monthly deals rounding to 0 every month = $0 annual revenue).
  const floatTotals = { visitors: 0, leads: 0, mqls: 0, sqls: 0, closedWon: 0, revenue: 0 };

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

    // Keep math as floats internally; round only for the display-facing `monthly` array.
    const monthlyVisitorsF = effectivePosts * assumptions.monthlyVisitorsPerPost;
    const monthlyLeadsF = monthlyVisitorsF * assumptions.visitorToLeadRate;
    const monthlyMqlsF = monthlyLeadsF * assumptions.leadToMqlRate;
    const monthlySqlsF = monthlyMqlsF * assumptions.mqlToSqlRate;
    const monthlyClosedWonF = monthlySqlsF * assumptions.sqlToWonRate;
    const monthlyRevenueF = monthlyClosedWonF * assumptions.avgDealSize;

    cumRevenue += monthlyRevenueF;
    const monthlyGrossProfit = monthlyRevenueF * assumptions.grossMargin;
    cumGrossProfit += monthlyGrossProfit;

    const cumProgramCost = monthlyProgramCost * month;
    if (paybackMonth === null && cumGrossProfit >= cumProgramCost && cumGrossProfit > 0) {
      paybackMonth = month;
    }

    monthly.push({
      month,
      postsLive,
      monthlyVisitors: Math.round(monthlyVisitorsF),
      monthlyLeads: Math.round(monthlyLeadsF),
      monthlyMqls: Math.round(monthlyMqlsF),
      monthlySqls: Math.round(monthlySqlsF),
      monthlyClosedWon: Math.round(monthlyClosedWonF),
      monthlyRevenue: Math.round(monthlyRevenueF),
      cumulativeRevenue: Math.round(cumRevenue),
      cumulativeGrossProfit: Math.round(cumGrossProfit),
    });

    floatTotals.visitors += monthlyVisitorsF;
    floatTotals.leads += monthlyLeadsF;
    floatTotals.mqls += monthlyMqlsF;
    floatTotals.sqls += monthlySqlsF;
    floatTotals.closedWon += monthlyClosedWonF;
    floatTotals.revenue += monthlyRevenueF;
  }

  const last = monthly[monthly.length - 1];
  // Totals from float accumulators, not from re-summing rounded monthly buckets.
  const totalLeads = Math.round(floatTotals.leads);
  const totalMqls = Math.round(floatTotals.mqls);
  const totalSqls = Math.round(floatTotals.sqls);
  const totalClosedWon = Math.round(floatTotals.closedWon);
  const totalRevenue = Math.round(floatTotals.revenue);
  const totalGrossProfit = Math.round(floatTotals.revenue * assumptions.grossMargin);

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

  const sensitivity = calculateSensitivity(assumptions, payload, outcomes);

  return {
    assumptions,
    outcomes,
    monthlyProjection: monthly,
    sensitivity,
    disclaimer:
      "Projections are conservative estimates based on industry benchmarks and assumptions inferred from the client's business context. Actual results depend on execution quality, market conditions, and product-market fit. This is a planning tool, not a guaranteed forecast.",
  };
}

// =============================================================
// Sensitivity analysis
//
// Runs the SAME deterministic math three times: once with the 5 highest-
// leverage variables flexed DOWN by SENSITIVITY_FLEX_PCT, once with the
// central AI-inferred assumptions, once flexed UP. Result is a defensible
// RANGE of ROI outcomes rather than a false-precision point estimate.
//
// The 5 flexed variables are the ones that most directly drive the funnel
// output (monthlyVisitorsPerPost and the four conversion cascade rates).
// avgDealSize, grossMargin, programCost, and monthsToRank are held constant
// because they are pricing/timing assumptions grounded in the SOW rather
// than uncertainty about market response.
// =============================================================

const SENSITIVITY_FLEX_PCT = 20; // +/- 20% flex on each variable
const FLEXED_VARIABLES = [
  "monthlyVisitorsPerPost",
  "visitorToLeadRate",
  "leadToMqlRate",
  "mqlToSqlRate",
  "sqlToWonRate",
];

// Clamp a rate to the schema's [0,1] range. A -20% flex on 0.30 is fine
// (0.24) but a +20% flex on 0.90 would blow past the 1.0 cap for MQL
// conversion rates, which is nonsensical.
function clampRate(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function flexAssumptions(
  base: RoiAssumptions,
  direction: -1 | 0 | 1,
): RoiAssumptions {
  if (direction === 0) return base;
  const factor = 1 + direction * (SENSITIVITY_FLEX_PCT / 100);
  return {
    ...base,
    // Traffic driver — unclamped, purely multiplicative
    monthlyVisitorsPerPost: Math.max(5, base.monthlyVisitorsPerPost * factor),
    // Cascade rates — clamped to the schema bounds so we never produce a
    // >100% conversion rate or a negative rate on aggressive flexes.
    visitorToLeadRate: clampRate(base.visitorToLeadRate * factor, 0.001, 0.1),
    leadToMqlRate: clampRate(base.leadToMqlRate * factor, 0.05, 0.9),
    mqlToSqlRate: clampRate(base.mqlToSqlRate * factor, 0.05, 0.9),
    sqlToWonRate: clampRate(base.sqlToWonRate * factor, 0.05, 0.6),
  };
}

function runScenario(
  label: string,
  flexPercent: number,
  assumptions: RoiAssumptions,
  payload: ContentPlanPayload,
): RoiScenario {
  // Recursion-safe: this internal path uses a dedicated scenario runner that
  // deliberately does NOT re-invoke calculateSensitivity (which would loop).
  const outcomes = runProjection(assumptions, payload);
  return {
    label,
    flexPercent,
    totalRevenue: outcomes.totalRevenue,
    totalGrossProfit: outcomes.totalGrossProfit,
    totalLeads: outcomes.totalLeads,
    totalClosedWon: outcomes.totalClosedWon,
    roiMultiple: outcomes.roiMultiple,
    paybackMonth: outcomes.paybackMonth,
  };
}

// Inner projection runner — same math as calculateRoiProjections but returns
// only the RoiOutcomes and does not compute sensitivity (avoiding recursion).
// Kept as a separate function rather than refactoring calculateRoiProjections
// so the existing public API (and every consumer's persisted analyses) stays
// byte-identical for the central scenario.
function runProjection(
  assumptions: RoiAssumptions,
  payload: ContentPlanPayload,
): RoiOutcomes {
  const totalPlannedPosts =
    payload.blogCalendar?.reduce((sum, w) => sum + (w.posts?.length ?? 0), 0) ?? 120;

  const monthly: RoiMonthlyPoint[] = [];
  let cumRevenue = 0;
  let cumGrossProfit = 0;
  const monthlyProgramCost = assumptions.programCost12Mo / 12;
  let paybackMonth: number | null = null;
  // Float accumulators — sum unrounded values so pessimistic scenario
  // doesn't cascade to $0 revenue via Math.round-to-zero.
  const floatTotals = { visitors: 0, leads: 0, mqls: 0, sqls: 0, closedWon: 0, revenue: 0 };

  for (let month = 1; month <= PROJECTION_MONTHS; month++) {
    const postsLive = Math.min(totalPlannedPosts, POSTS_PER_MONTH * month);
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
    const monthlyVisitorsF = effectivePosts * assumptions.monthlyVisitorsPerPost;
    const monthlyLeadsF = monthlyVisitorsF * assumptions.visitorToLeadRate;
    const monthlyMqlsF = monthlyLeadsF * assumptions.leadToMqlRate;
    const monthlySqlsF = monthlyMqlsF * assumptions.mqlToSqlRate;
    const monthlyClosedWonF = monthlySqlsF * assumptions.sqlToWonRate;
    const monthlyRevenueF = monthlyClosedWonF * assumptions.avgDealSize;

    cumRevenue += monthlyRevenueF;
    const monthlyGrossProfit = monthlyRevenueF * assumptions.grossMargin;
    cumGrossProfit += monthlyGrossProfit;

    const cumProgramCost = monthlyProgramCost * month;
    if (paybackMonth === null && cumGrossProfit >= cumProgramCost && cumGrossProfit > 0) {
      paybackMonth = month;
    }

    monthly.push({
      month,
      postsLive,
      monthlyVisitors: Math.round(monthlyVisitorsF),
      monthlyLeads: Math.round(monthlyLeadsF),
      monthlyMqls: Math.round(monthlyMqlsF),
      monthlySqls: Math.round(monthlySqlsF),
      monthlyClosedWon: Math.round(monthlyClosedWonF),
      monthlyRevenue: Math.round(monthlyRevenueF),
      cumulativeRevenue: Math.round(cumRevenue),
      cumulativeGrossProfit: Math.round(cumGrossProfit),
    });

    floatTotals.visitors += monthlyVisitorsF;
    floatTotals.leads += monthlyLeadsF;
    floatTotals.mqls += monthlyMqlsF;
    floatTotals.sqls += monthlySqlsF;
    floatTotals.closedWon += monthlyClosedWonF;
    floatTotals.revenue += monthlyRevenueF;
  }

  const last = monthly[monthly.length - 1];
  const totalLeads = Math.round(floatTotals.leads);
  const totalMqls = Math.round(floatTotals.mqls);
  const totalSqls = Math.round(floatTotals.sqls);
  const totalClosedWon = Math.round(floatTotals.closedWon);
  const totalRevenue = Math.round(floatTotals.revenue);
  const totalGrossProfit = Math.round(floatTotals.revenue * assumptions.grossMargin);
  const paidEquivalentCost = Math.round(totalLeads * assumptions.paidCacBaseline);

  return {
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
    savingsVsPaid: paidEquivalentCost - assumptions.programCost12Mo,
    paybackMonth,
    roiMultiple:
      assumptions.programCost12Mo > 0
        ? Number((totalGrossProfit / assumptions.programCost12Mo).toFixed(2))
        : 0,
  };
}

export function calculateSensitivity(
  assumptions: RoiAssumptions,
  payload: ContentPlanPayload,
  centralOutcomes: RoiOutcomes,
): RoiSensitivity {
  const pessimistic = runScenario(
    "Pessimistic",
    -SENSITIVITY_FLEX_PCT,
    flexAssumptions(assumptions, -1),
    payload,
  );
  // Central scenario reuses the outcomes we already computed — no duplicated math.
  const central: RoiScenario = {
    label: "Central (AI-inferred)",
    flexPercent: 0,
    totalRevenue: centralOutcomes.totalRevenue,
    totalGrossProfit: centralOutcomes.totalGrossProfit,
    totalLeads: centralOutcomes.totalLeads,
    totalClosedWon: centralOutcomes.totalClosedWon,
    roiMultiple: centralOutcomes.roiMultiple,
    paybackMonth: centralOutcomes.paybackMonth,
  };
  const optimistic = runScenario(
    "Optimistic",
    SENSITIVITY_FLEX_PCT,
    flexAssumptions(assumptions, 1),
    payload,
  );
  return {
    scenarios: [pessimistic, central, optimistic],
    flexedVariables: FLEXED_VARIABLES,
    flexPercent: SENSITIVITY_FLEX_PCT,
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
- visitorToLeadRate: 0.008–0.018 for B2B. Middle of the range (0.011–0.013) is the default; only go higher when the client has a differentiated lead magnet or an active retargeting stack.
- leadToMqlRate: 0.25–0.38.
- mqlToSqlRate: 0.28–0.42.
- sqlToWonRate: 0.15–0.22 for B2B services and mid-market ERP-style deals WITHOUT a paid diagnostic funnel. Use 0.22–0.28 ONLY when the client explicitly uses a paid diagnostic (e.g. a $1,997 audit) before retainer — those buyers are pre-qualified and close higher. Never go above 0.22 without evidence in the analysis.
- monthlyVisitorsPerPost: 25–55 for well-optimized SEO/AEO posts at maturity. Middle of the range (35–45) is the default. Use the top of the range (50–55) ONLY when the client is a documented category framework owner (trademarked methodology WITH published traction, established thought-leader founder WITH proof of audience). Trademarked terms alone do not justify the top of the range — cite the specific traction signal in the rationale.
- monthsToRank: 3–5. Use 3 for established sites with existing domain authority, 4–5 for newer content programs.
- contentDecayFactor: 0.88–0.92.
- programCost12Mo: Read this from \`sow.priceTiers\` too — take the SAME anchor tier and multiply by 12. If not available, use the mid-market retainer band $75k–$120k.
- paidCacBaseline: B2B CPL, $200–$800.

════════════════════════════════════════════════════════════
═ RATIONALE ═
════════════════════════════════════════════════════════════

Every field's rationale must reference the SPECIFIC client analysis (their offerings,
ICP, priceTiers, diagnostic model, etc.), not generic benchmarks. One tight sentence each.

DEFAULT TO THE MIDDLE of every range. Going to the top of a range requires a
specific evidence signal from the client analysis — cite it in the rationale.
Going to the bottom requires an equivalent negative signal. Middle-of-range is
the honest starting point for a services program with no measured baseline; it
is better to under-project and beat expectations than to over-project and lose
trust when actuals lag.`;

// Fallback assumptions if LLM inference fails
export const FALLBACK_ASSUMPTIONS: RoiAssumptions = {
  avgDealSize: 25000,
  dealType: "one-time",
  grossMargin: 0.6,
  salesCycleDays: 90,
  visitorToLeadRate: 0.012,
  leadToMqlRate: 0.32,
  mqlToSqlRate: 0.35,
  sqlToWonRate: 0.18,
  monthlyVisitorsPerPost: 35,
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
