import { z } from "zod";

/** Deterministic Brex screening rubric, not a validated psychometric instrument.
 * Public research never supplies these answers. No CRM/LLM side effects.
 */
export const HEALTH_VERSION = "brex-marketing-health-v1-2026-10-04";
export const HEALTH_SOURCES = [
  { id: "capabilities", title: "Vorhies & Morgan (2005): Marketing capabilities",
    url: "https://neil-a-morgan.com/wp-content/uploads/2020/04/Vorhies-Morgan-JM-2005.pdf",
    finding: "The study examines product development, pricing, channels, communications, selling, market information, planning, and implementation in relation to business performance.",
    limitation: "Informs the topics, not these questions, equal weights, bands, or service tiers. This is not a replication of its competitor-relative instrument." },
  { id: "alignment", title: "McKinsey (2023): CEO–CMO alignment",
    url: "https://www.mckinsey.com/capabilities/growth-marketing-and-sales/our-insights/the-power-of-partnership-how-the-ceo-cmo-relationship-can-drive-outsize-growth",
    finding: "Recommends clarity of marketing remit, executive alignment, resources, and metrics tied to business outcomes.",
    limitation: "Observational findings and practitioner recommendations, not causal proof or validation of Brex package assignments." },
  { id: "readiness", title: "Shea et al. (2014): Readiness for change",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC3904699/",
    finding: "Distinguishes commitment to change from perceived collective ability to implement it.",
    limitation: "This short single-respondent screening is not ORIC and cannot establish organization-wide readiness or predict engagement success." },
] as const;
export const HEALTH_DIMENSIONS = [
  { key: "positioning", label: "Positioning clarity", source: "capabilities" },
  { key: "offer", label: "Offer structure", source: "capabilities" },
  { key: "buyer", label: "Buyer alignment", source: "capabilities" },
  { key: "growth", label: "Growth execution & measurement", source: "alignment" },
] as const;
export const HEALTH_QUESTIONS = [
  { key: "audience", dimension: "positioning", label: "How clearly have you defined your priority customer segment?",
    options: ["No defined segment", "Informal assumptions about our target", "Documented segment and buying needs", "Documented and reviewed using recent customer evidence"],
    next: "Document a priority customer segment and test the assumptions with customer evidence." },
  { key: "difference", dimension: "positioning", label: "How do you establish why a buyer should choose you?",
    options: ["No clear reason documented", "Broad claims about quality or service", "Specific differentiation supported by proof", "Differentiation and proof tested with buyers and reviewed"],
    next: "Connect a specific difference to proof buyers can verify, then test whether it matters to them." },
  { key: "offer", dimension: "offer", label: "How clearly is your main offer defined?",
    options: ["Scope and outcome are unclear", "Defined differently for each opportunity", "Documented outcome, scope, and buying process", "Documented offer refined using conversion and customer feedback"],
    next: "Clarify the offer's outcome, scope, and buying process, then review customer feedback." },
  { key: "pricing", dimension: "offer", label: "How are pricing and profitability decisions made?",
    options: ["No defined process", "Mainly habit, cost-plus, or ad hoc discounting", "Documented process considers customer value and margin", "Value, margin, and win/loss evidence regularly inform pricing"],
    next: "Review customer value, margin, and win/loss evidence together before changing prices." },
  { key: "insight", dimension: "buyer", label: "How do customer insights influence marketing?",
    options: ["No deliberate collection", "Occasional informal feedback", "Regular feedback is documented and informs decisions", "Structured research and win/loss insights routinely change decisions"],
    next: "Establish a repeatable way to collect customer and win/loss insights and use them in decisions." },
  { key: "journey", dimension: "buyer", label: "How do marketing and sales support the buying journey?",
    options: ["No shared process", "Activities exist but handoffs are inconsistent", "Documented stages, content, and sales handoffs", "Stage conversion and feedback regularly improve the shared process"],
    next: "Agree on buying stages and sales handoffs, then review where prospects stall." },
  { key: "plan", dimension: "growth", label: "How is your growth plan executed?",
    options: ["No defined plan", "Activities planned without clear owners or resources", "Prioritized plan with owners, resources, and dates", "Plan is reviewed regularly and resources change with results"],
    next: "Tie a prioritized plan to accountable owners, resources, dates, and regular review." },
  { key: "metrics", dimension: "growth", label: "How do you evaluate marketing's business contribution?",
    options: ["No consistent tracking", "Mostly activity or visibility metrics", "Agreed funnel and business-outcome measures", "Shared outcome measures guide decisions, with attribution limits acknowledged"],
    next: "Agree on business-outcome measures and use them in decisions without overstating attribution." },
] as const;
export const TIER_QUESTIONS = [
  { key: "ownership", label: "Who will own executive marketing decisions?",
    options: [["existing", "A capable internal leader retains accountability"], ["delegated", "A vacant or separate executive remit can be delegated"], ["unknown", "Not sure"]] },
  { key: "need", label: "What support do you need from Brex?",
    options: [["advice", "Senior advice and decision support"], ["strategy", "Strategy development and program guidance"], ["leadership", "Executive marketing leadership"], ["unknown", "Not sure"]] },
  { key: "sponsor", label: "Are executive sponsorship and decision authority available?",
    options: [["yes", "Engaged sponsor and appropriate decision authority"], ["pending", "Sponsor is engaged; authority still needs agreement"], ["no", "No engaged sponsor"], ["unknown", "Not sure"]] },
  { key: "execution", label: "Who will implement the work?",
    options: [["funded", "An available team/agency or funded implementation plan"], ["planned", "Resources identified but not funded"], ["none", "No resources or implementation plan"], ["unknown", "Not sure"]] },
  { key: "budget", label: "Monthly budget for CMO leadership alone (USD)?",
    options: [["below", "Below $3,500"], ["advisor", "$3,500–$6,499"], ["strategist", "$6,500–$9,499"], ["fractional", "$9,500 or more"], ["pending", "Budget approval pending"], ["unknown", "Not sure"]] },
  { key: "readiness", label: "Can you share relevant business economics and act on findings?",
    options: [["yes", "Yes, with appropriate confidentiality"], ["pending", "Willing, but data or preparations are incomplete"], ["no", "Not willing at this time"], ["unknown", "Not sure"]] },
] as const;
const level = z.enum(["0", "1", "2", "3", "unknown"]).default("unknown");
export const widgetAssessmentInputSchema = z.object({
  health: z.object({ audience: level, difference: level, offer: level, pricing: level,
    insight: level, journey: level, plan: level, metrics: level }).strict().default({
      audience: "unknown", difference: "unknown", offer: "unknown", pricing: "unknown",
      insight: "unknown", journey: "unknown", plan: "unknown", metrics: "unknown",
    }),
  fit: z.object({
    ownership: z.enum(["existing", "delegated", "unknown"]).default("unknown"),
    need: z.enum(["advice", "strategy", "leadership", "unknown"]).default("unknown"),
    sponsor: z.enum(["yes", "pending", "no", "unknown"]).default("unknown"),
    execution: z.enum(["funded", "planned", "none", "unknown"]).default("unknown"),
    budget: z.enum(["below", "advisor", "strategist", "fractional", "pending", "unknown"]).default("unknown"),
    readiness: z.enum(["yes", "pending", "no", "unknown"]).default("unknown"),
    growthGoal: z.string().trim().max(600).default(""),
    timeframe: z.string().trim().max(100).default(""),
  }).strict().default({ ownership: "unknown", need: "unknown", sponsor: "unknown",
    execution: "unknown", budget: "unknown", readiness: "unknown", growthGoal: "", timeframe: "" }),
  context: z.object({ industry: z.string().trim().max(100).default(""),
    // Preserve historical snapshots; new mandatory intake uses the five
    // approved ranges, validated separately in widget-lead-capture.
    revenueBand: z.enum(["unknown", "under1m", "1m5m", "5m25m", "25mplus",
      "under500k", "500k1m", "5m50m", "50m250m"]).default("unknown") })
    .strict().default({ industry: "", revenueBand: "unknown" }),
}).strict();
export type WidgetAssessmentInput = z.infer<typeof widgetAssessmentInputSchema>;
export const HEALTH_NOTE = "Research-informed Brex rubric applied to your self-reported answers, not a verified audit, industry percentile, or prediction of growth. Sources support the criteria, not the numerical weights or thresholds. A higher health score does not mean a higher service tier.";
const catalog = {
  advisor: { label: "Advisor CMO", price: "$3,500–$5,000/month",
    reason: "You report that an internal leader retains accountability and needs senior advice." },
  strategist: { label: "Strategist CMO", price: "$6,500–$8,000/month",
    reason: "You report that an internal leader retains accountability and needs strategy and program guidance." },
  full_fractional: { label: "Full Fractional CMO", price: "$9,500–$15,500/month",
    reason: "You report a vacant or delegated executive remit and a need for marketing leadership." },
} as const;
export function assessWidget(raw: unknown) {
  const answers = widgetAssessmentInputSchema.parse(raw);
  const items = HEALTH_QUESTIONS.map(q => {
    const value = answers.health[q.key];
    return { key: q.key, dimension: q.dimension, label: q.label, points: value === "unknown" ? null : Number(value),
      answer: value === "unknown" ? "Not sure / not provided" : q.options[Number(value)],
      provenance: "self-reported" as const, next: q.next };
  });
  const subScores = HEALTH_DIMENSIONS.map(d => {
    const group = items.filter(i => i.dimension === d.key);
    return { ...d, score: group.every(i => i.points !== null)
      ? Math.round(group.reduce((s, i) => s + i.points!, 0) / 6 * 100) : null, items: group };
  });
  const known = items.filter(i => i.points !== null).length;
  const score = known === 8 ? Math.round(items.reduce((s, i) => s + i.points!, 0) / 24 * 100) : null;
  const band = score === null ? "Needs more information" : score < 40 ? "Foundational gaps"
    : score < 60 ? "Developing" : score < 80 ? "Established" : "Managed & improving";
  const f = answers.fit;
  let candidate: keyof typeof catalog | null = null;
  if (f.ownership === "existing" && f.need === "advice") candidate = "advisor";
  if (f.ownership === "existing" && f.need === "strategy") candidate = "strategist";
  if (f.ownership === "delegated" && f.need === "leadership") candidate = "full_fractional";
  const missing: string[] = [], concerns: string[] = [];
  for (const q of TIER_QUESTIONS) if (f[q.key] === "unknown") missing.push(q.label);
  if (!f.growthGoal) missing.push("Growth outcome");
  if (!f.timeframe) missing.push("Growth timeframe");
  if (!candidate && f.ownership !== "unknown" && f.need !== "unknown")
    missing.push("Resolve the mismatch between executive ownership and the support requested.");
  if (f.sponsor === "no") concerns.push("Executive sponsorship is not available.");
  if (f.execution === "none") concerns.push("No implementation resources or plan is available.");
  if (f.execution === "planned") concerns.push("Implementation resources still need funding.");
  if (f.readiness === "no") concerns.push("Willingness to share relevant economics and act needs discussion.");
  if (f.budget === "below") concerns.push("The stated budget is below the minimum CMO retainer range.");
  const budgetRank = { advisor: 1, strategist: 2, fractional: 3 };
  const needed = candidate === "advisor" ? 1 : candidate === "strategist" ? 2 : candidate === "full_fractional" ? 3 : null;
  if (needed && f.budget in budgetRank && budgetRank[f.budget as keyof typeof budgetRank] < needed)
    concerns.push("The stated leadership budget does not reach the minimum for the requested responsibility. Do not substitute a cheaper tier that leaves the remit unmet.");
  if (f.sponsor === "pending") missing.push("Confirm decision authority.");
  if (f.budget === "pending") missing.push("Confirm leadership budget approval.");
  if (f.readiness === "pending") missing.push("Confirm data access and preparation.");
  const recommended = concerns.length || missing.length ? null : candidate;
  const tier = recommended ? catalog[recommended] : null;
  return { version: HEALTH_VERSION, assessedAt: new Date().toISOString(), answers,
    health: { score, band, answered: known, total: 8, subScores,
      formula: "100 × total answer points ÷ 24; each answer earns 0, 1, 2, or 3. Four dimensions have equal 25% weight. All eight answers are needed for the overall score.",
      note: HEALTH_NOTE,
      priorities: items.filter(i => i.points !== null && i.points < 3).sort((a, b) => a.points! - b.points!).slice(0, 3) },
    fit: { tier: recommended, label: tier?.label ?? "Not yet recommended", price: tier?.price ?? null,
      status: concerns.length ? "readiness_first" : recommended ? "preliminary" : "needs_information",
      reason: tier?.reason ?? "Resolve the listed gaps before selecting a service tier.",
      missing, concerns, sourceIds: ["alignment", "readiness"],
      note: "Potential tier for discussion, based on self-reported responsibility and readiness. Final suitability, scope, price, and Brex capacity require Kenny's review. Budget excludes execution, media, software, and third-party costs." },
    sources: HEALTH_SOURCES };
}
export type WidgetAssessment = ReturnType<typeof assessWidget>;
export const WIDGET_HEALTH_CONFIG = { version: HEALTH_VERSION, dimensions: HEALTH_DIMENSIONS,
  questions: HEALTH_QUESTIONS, tierQuestions: TIER_QUESTIONS, note: HEALTH_NOTE, sources: HEALTH_SOURCES };
