import { readCompanyProfile, safeSourceUrl } from "./company-profile";
import type { DemoReport } from "./demo-report";

export const EXECUTIVE_ROLES = ["CEO", "CFO", "COO", "CMO"] as const;
export type ExecutiveRole = typeof EXECUTIVE_ROLES[number];
export function executiveRole(value: unknown): ExecutiveRole {
  return EXECUTIVE_ROLES.includes(value as ExecutiveRole) ? value as ExecutiveRole : "CEO";
}
type Source = { title: string; url: string; date?: string };
type Evidence = { text: string; origin: string; status: string; sources: Source[] };
export type ExecutiveSummaryInput = {
  clientName?: string;
  extraction?: unknown;
  strategy?: unknown;
  swot?: unknown;
  porters?: unknown;
  customerInsights?: unknown;
};
export type ExecutiveSummary = {
  role: ExecutiveRole; company: string; focus: string; opening: string; demo: boolean;
  sections: { title: string; framing: string; evidence: Evidence | null; question: string }[];
};
// This is a read-only editorial projection, not another model-generated
// diagnosis. Keep source passages and uncertainty intact; never fabricate
// financials, staffing, impact estimates, or external citations.
const object = (value: unknown): any => {
  if (typeof value === "string") { try { value = JSON.parse(value); } catch { return {}; } }
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
};
const list = (value: unknown): any[] => Array.isArray(value) ? value : [];
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
function evidence(value: unknown, origin: string, status = "Saved report finding", sources: unknown = []): Evidence | null {
  const passage = text(value);
  if (!passage) return null;
  return { text: passage, origin, status, sources: list(sources).flatMap(s => {
    const url = safeSourceUrl(s?.url);
    return url ? [{ url, title: text(s.title) || new URL(url).hostname,
      ...(text(s.date) ? { date: text(s.date) } : {}) }] : [];
  }) };
}
type Basis = Partial<Record<"positioning" | "buyer" | "gap" | "roadmap" | "outcomes" |
  "risk" | "revenue" | "capacity" | "message" | "channel" | "conversion", Evidence | null>>;

function fullBasis(input: ExecutiveSummaryInput): Basis {
  const e = object(input.extraction), s = object(input.strategy), swot = object(input.swot);
  const ci = object(input.customerInsights), p = object(input.porters);
  const profile = readCompanyProfile(e.companyProfile);
  const fact = (key: string) => {
    const f = profile?.facts.find(f => f.key === key);
    return f ? evidence(f.sentence, "Company introduction", `${f.status} · researched ${profile!.researchedAt.slice(0, 10)}`, f.sources) : null;
  };
  const phase = object(list(s.ninetyDayPlan)[0]);
  const force = list(p.forces).find(f => f?.force === "buyerPower");
  const risk = object(list(swot.threats)[0]);
  const channel = object(list(s.channelMix).find(c => c?.priority === "High") ?? list(s.channelMix)[0]);
  return {
    positioning: evidence(e.positioningStatement, "Website positioning"),
    buyer: evidence(s.icp?.summary || ci.summary || e.targetAudience, "Buyer / ideal customer profile"),
    gap: evidence(list(s.positioningGaps)[0], "Strategy / positioning gaps", "Strategic assessment"),
    roadmap: evidence(phase.focus, `90-day on-ramp / ${text(phase.phase) || "opening phase"}`, "Proposed plan"),
    outcomes: evidence(list(phase.outcomes).filter(v => typeof v === "string").join("\n"), "90-day on-ramp / opening outcomes", "Target outcomes, not guaranteed results"),
    risk: force ? evidence(force.rationale, "Competitive forces / buyer power", "Strategic assessment", force.sources)
      : evidence(risk.evidence, `SWOT / ${text(risk.title) || "threat"}`, "Strategic assessment"),
    revenue: fact("annualRevenue"),
    capacity: fact("employees") || fact("locations"),
    message: evidence(list(s.messagingRecommendations)[0], "Strategy / messaging", "Recommendation"),
    channel: evidence(channel.role, `Channel strategy / ${text(channel.channel) || "selected channel"}`, "Recommendation"),
    conversion: evidence(e.ctaAudit, "Website / conversion review", "Strategic assessment"),
  };
}
function demoBasis(report: DemoReport): Basis {
  // Read ONLY the already-projected demo sections. Do not accept the original
  // analysis or use full-report visuals as a fallback.
  const pick = (id: string) => {
    const section = list(report.sections).find(s => s?.id === id);
    const item = list(section?.items)[0];
    return item ? evidence(item.text, `${text(section.title)} / selected excerpt`, "Demo excerpt", item.sources) : null;
  };
  return { positioning: pick("positioning"), buyer: pick("icp") || pick("buyer-summary"),
    gap: pick("gap"), roadmap: pick("roadmap"), risk: pick("porters") || pick("pestel"),
    message: pick("messaging"), channel: pick("channel"), conversion: pick("conversion") };
}
function compose(company: string, role: ExecutiveRole, b: Basis, demo: boolean): ExecutiveSummary {
  const section = (title: string, framing: string, basis: Evidence | null | undefined, question: string) =>
    ({ title, framing, evidence: basis ?? null, question });
  const perspectives: Record<ExecutiveRole, Omit<ExecutiveSummary, "role" | "company" | "demo">> = {
    CEO: {
      focus: "Growth, strategic focus, and competitive position",
      opening: `For ${company}, read this report as a choice about where to compete and where to concentrate leadership attention. Connect the market opportunity to a focused first-quarter agenda before expanding the commitment.`,
      sections: [
        section("Where to compete", "Start with the customer opportunity the report describes. Use it to decide which growth priorities deserve executive sponsorship.", b.buyer || b.positioning, "Which customer opportunity best supports our growth ambition?"),
        section("What to prioritize", "Treat this strategic finding as a choice about differentiation and focus, not a reason to pursue every initiative at once.", b.gap || b.message, "What will we prioritize, and what will we deliberately defer?"),
        section("What to sponsor first", "Use the opening roadmap priority to set direction, accountability, and the next executive review.", b.roadmap, "What evidence should leadership review before scaling the program?"),
      ],
    },
    CFO: {
      focus: "Capital allocation, financial evidence, and downside risk",
      opening: `For ${company}, the financial question is whether the proposed work justifies a staged investment. Separate source-reported figures, strategic recommendations, and target outcomes; none should be treated as realized cash flow or a guaranteed return.`,
      sections: [
        section("Financial baseline", "Use the available revenue evidence as context, not as a profitability or liquidity measure. Confirm the current financial baseline before underwriting the plan.", b.revenue, "What are our verified gross margin, acquisition cost, payback period, and cash requirements?"),
        section("Investment priority", "Evaluate this proposed priority as an allocation of scarce capital. Establish its cost, expected benefit, and measurement method before approval.", b.roadmap || b.gap, "What is the smallest funded milestone that can test the investment case?"),
        section("Downside and assumptions", "Stress-test the commercial issue below rather than converting it into a forecast. Preserve the distinction between an assessment and a verified financial result.", b.risk || b.conversion, "Which assumptions could weaken the business case, and what would trigger a spending review?"),
      ],
    },
    COO: {
      focus: "Execution, capacity, and delivery accountability",
      opening: `For ${company}, translate the report into an executable operating agenda. Start with the proposed sequence, check capacity and handoffs, and define observable acceptance criteria before expanding delivery.`,
      sections: [
        section("Opening workstream", "Turn this roadmap priority into an owned workstream with dependencies and a realistic delivery cadence.", b.roadmap, "Who owns this work, and which handoffs could delay it?"),
        section("Capacity to deliver", "Use any documented organizational context as a starting point. Headcount or location count alone does not establish available skills or execution capacity.", b.capacity, "Which people, systems, and approvals are actually available for the first phase?"),
        section("Definition of done", "Convert the proposed outcomes into acceptance criteria. An intended outcome is a delivery target, not evidence that it has already been achieved.", b.outcomes || b.message, "What must be demonstrably complete before the next phase begins?"),
      ],
    },
    CMO: {
      focus: "Positioning, buyer relevance, and demand generation",
      opening: `For ${company}, use the report to align the market promise, the buyer's needs, and the route to demand. Begin with the messaging decision, then connect channel activity to measurable buyer progression rather than output volume alone.`,
      sections: [
        section("Positioning and message", "Read this recommendation as the starting point for a clearer market promise. Validate its relevance with the intended buyer before rolling it out broadly.", b.message || b.gap || b.positioning, "What promise should we communicate, and what proof can we substantiate?"),
        section("Buyer relevance", "Use the report's customer definition to focus segmentation, proof, and content. Treat unvalidated buyer interpretations as hypotheses to test.", b.buyer, "Which buyer problem and decision trigger should our next campaign address?"),
        section("Route to demand", "Connect the proposed channel role to the buyer journey and the next conversion step. Channel activity alone is not evidence of pipeline impact.", b.channel || b.conversion, "Which leading indicators and qualified-pipeline measures will tell us whether this is working?"),
      ],
    },
  };
  return { role, company, demo, ...perspectives[role] };
}
export function buildExecutiveSummary(input: ExecutiveSummaryInput, role: ExecutiveRole): ExecutiveSummary {
  return compose(text(input.clientName) || "this company", executiveRole(role), fullBasis(input), false);
}
export function buildDemoExecutiveSummary(report: DemoReport, role: ExecutiveRole): ExecutiveSummary {
  return compose(text(report.clientName) || "this company", executiveRole(role), demoBasis(report), true);
}
