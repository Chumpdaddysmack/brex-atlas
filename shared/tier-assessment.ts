import { z } from "zod";
import { packageFor, packageMonthlyLabel, type PackageKey } from "./service-packages";

export const RECOMMENDATION_VERSION = "brex-evidence-v1";
export const RESEARCH_BASIS = [
  { title: "McKinsey: CEO–CMO alignment", url: "https://www.mckinsey.com/capabilities/growth-marketing-and-sales/our-insights/the-power-of-partnership-how-the-ceo-cmo-relationship-can-drive-outsize-growth",
    finding: "Only half of paired CEOs and CMOs agreed on marketing's primary role. Assess accountability and authority, not title alone.", limitation: "Observational research; not a test of Brex packages." },
  { title: "2026 CMO Survey", url: "https://cmosurvey.org/wp-content/uploads/2026/04/The_CMO_Survey-Highlights_and_Insights_Report-2026.pdf",
    finding: "Talent (34.5%), stakeholder alignment (22.3%), and operating model (19.4%) were first-ranked organic-growth factors.",
    limitation: "Reported priorities among surveyed marketing leaders, not causal effects or scoring weights." },
  { title: "Vorhies & Morgan: marketing capabilities", url: "https://neil-a-morgan.com/wp-content/uploads/2020/04/Vorhies-Morgan-JM-2005.pdf",
    finding: "A 230-firm study found positive relationships between marketing capabilities and performance, including planning and implementation.",
    limitation: "Does not establish staffing cutoffs or compare fractional services." },
  { title: "Shea et al.: organizational readiness", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC3904699/",
    finding: "Readiness distinguishes commitment to change from perceived ability to implement it.",
    limitation: "Psychometric research, not a validated Brex success predictor." },
  { title: "Robert Half: 2026 CMO salaries", url: "https://www.roberthalf.com/us/en/job-details/chief-marketing-officer",
    finding: "National starting-salary benchmarks: $170,500 / $204,250 / $248,750. Compare the relevant alternative, not a universal savings claim.",
    limitation: "Not an all-in employer-cost estimate or evidence of willingness to pay." },
];

export const QUESTIONS = [
  { key: "ownership", label: "Who owns executive marketing / growth decisions?", options: [["existing", "Capable owner retains accountability"], ["delegated", "Vacancy or separate remit delegated to Brex"], ["unknown", "Not confirmed"]] },
  { key: "need", label: "What responsibility is Brex being asked to take?", options: [["advice", "Senior advice and decision support"], ["strategy", "Strategy development and program guidance"], ["leadership", "Executive marketing leadership"], ["unknown", "Not confirmed"]] },
  { key: "sponsor", label: "Is there an engaged executive sponsor?", options: [["yes", "Yes"], ["no", "No"], ["unknown", "Not confirmed"]] },
  { key: "authority", label: "Are the appropriate decision rights agreed?", options: [["yes", "Yes"], ["no", "No"], ["unknown", "Not confirmed"]] },
  { key: "execution", label: "Is execution available or funded (team, agencies, or hiring)?", options: [["yes", "Yes"], ["no", "No"], ["unknown", "Not confirmed"]] },
  { key: "budget", label: "Is the service plus required execution budget viable?", options: [["yes", "Yes"], ["no", "No"], ["unknown", "Not confirmed"]] },
  { key: "readiness", label: "Does leadership accept change and access to business economics?", options: [["yes", "Yes"], ["no", "No"], ["unknown", "Not confirmed"]] },
  { key: "capacity", label: "Can Brex meet the remit within fractional capacity?", options: [["yes", "Yes"], ["no", "No"], ["unknown", "Not confirmed"]] },
  { key: "scope", label: "How extensive is the documented work?", options: [["bounded", "Focused remit and straightforward coordination"], ["expanded", "Multiple distinct workstreams / heavier governance"], ["unknown", "Not yet scoped"]] },
] as const;
export type QuestionKey = typeof QUESTIONS[number]["key"];
export const evidenceSchema = z.object({
  value: z.string().max(40), note: z.string().max(1200),
  kind: z.enum(["client-confirmed", "public-source"]),
  url: z.string().max(2000).default(""), asOf: z.string().max(30),
}).strict();
export const assessmentInputSchema = z.object({
  facts: z.record(z.string(), evidenceSchema),
  growthGoal: z.string().max(1600), scopeNotes: z.string().max(2000),
}).strict().superRefine((data, ctx) => {
  for (const [key, fact] of Object.entries(data.facts)) {
    const question = QUESTIONS.find(q => q.key === key);
    if (!question || !question.options.some(o => o[0] === fact.value)) ctx.addIssue({ code: "custom", message: "Invalid decision value", path: ["facts", key] });
    if (fact.value !== "unknown" && (!fact.note.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(fact.asOf)))
      ctx.addIssue({ code: "custom", message: "Record supporting evidence and its date", path: ["facts", key] });
    if (fact.kind === "public-source" && fact.value !== "unknown" && !safeHttp(fact.url))
      ctx.addIssue({ code: "custom", message: "A public fact needs an http(s) source URL", path: ["facts", key, "url"] });
  }
});
export type AssessmentInput = z.infer<typeof assessmentInputSchema>;
export type AssessmentDecision = {
  version: string; tier: PackageKey | null; status: "ready-for-review" | "discovery-required" | "readiness-first";
  reasons: string[]; missing: string[]; price: string | null; scopePosition: string; alternatives: string;
};
export type AssessmentRecord = { input: AssessmentInput; decision: AssessmentDecision; approvedAt: string | null; updatedAt: string };
export function safeHttp(value: unknown): string | null {
  try { const u = new URL(String(value)); return ["https:", "http:"].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; }
}
export function assessTier(input: AssessmentInput): AssessmentDecision {
  const missing: string[] = [], reasons: string[] = [];
  const value = (k: QuestionKey) => input.facts[k]?.value ?? "unknown";
  const gates: QuestionKey[] = ["sponsor", "authority", "execution", "budget", "readiness", "capacity"];
  for (const q of QUESTIONS.filter(q => q.key !== "scope")) {
    const f = input.facts[q.key];
    if (!f || f.value === "unknown" || !f.note.trim() || !f.asOf ||
      f.kind !== "client-confirmed") missing.push(q.label);
  }
  if (!input.growthGoal.trim()) missing.push("Confirm the growth goal, baseline / unknowns, and time horizon.");
  const blocked = gates.filter(k => value(k) === "no" && input.facts[k]?.kind === "client-confirmed");
  let tier: PackageKey | null = null;
  if (!missing.length && !blocked.length) {
    if (value("ownership") === "existing" && value("need") === "advice") tier = "advisor";
    else if (value("ownership") === "existing" && value("need") === "strategy") tier = "strategist";
    else if (value("ownership") === "delegated" && value("need") === "leadership") tier = "fractional";
    else missing.push("Resolve the mismatch between existing ownership and the responsibility requested of Brex.");
  }
  if (tier === "advisor") reasons.push("A capable internal owner retains executive accountability; the confirmed need is senior advice.");
  if (tier === "strategist") reasons.push("Executive accountability stays with the client; Brex is needed for strategy and program guidance.");
  if (tier === "fractional") reasons.push("A vacant or separately delegated executive remit needs Brex leadership, with authority and execution resources confirmed.");
  for (const k of blocked) reasons.push(`${QUESTIONS.find(q => q.key === k)!.label} Answer: No. Resolve this before a retainer recommendation.`);
  const t = packageFor(tier);
  return { version: RECOMMENDATION_VERSION, tier, status: blocked.length ? "readiness-first" : tier ? "ready-for-review" : "discovery-required",
    reasons, missing, price: t ? packageMonthlyLabel(t) : null,
    scopePosition: value("scope") === "bounded" ? "Lower-end candidate: verify the scoped workload before quoting."
      : value("scope") === "expanded" ? "Upper-end candidate: document additional workload and capacity before quoting."
      : "Position within range requires scope review.",
    alternatives: tier === "advisor" ? "Do not add strategy production or executive ownership unless the remit changes."
      : tier === "strategist" ? "Advisory alone under-serves the strategy-development need; a second executive owner would duplicate the client's remit."
      : tier === "fractional" ? "Advisory or strategy guidance alone would leave the confirmed executive accountability gap unfilled."
      : "No package is selected while essential evidence or readiness is unresolved." };
}
