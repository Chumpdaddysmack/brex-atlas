/** Read-only visual projections. Never score, rank, summarize, or persist findings. */
export interface VisualField { label: string; values: string[] }
export interface VisualCompetitor {
  name: string; client: boolean; positioning: string[];
  signals: string[]; gaps: string[];
}
export interface VisualSwot {
  key: string; label: string; action: string; origin: string;
  findings: { title: string; evidence: string }[];
}
export interface VisualStage {
  label: string; question: string; mindset: string; channel: string;
  asset: string; cta: string; exit: string;
}
export interface VisualPhase { label: string; weeks: string; focus: string; outcomes: string[] }
export interface ReportVisuals {
  preview: boolean;
  positioning: VisualField[];
  competitors: VisualCompetitor[];
  swot: VisualSwot[];
  journey: VisualStage[];
  roadmap: VisualPhase[];
}
interface VisualInput {
  clientName?: unknown; extraction?: unknown; strategy?: unknown;
  competitors?: unknown; swot?: unknown; customerInsights?: unknown;
}
function decoded(v: any): any {
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return v; }
}
const object = (v: any): any => { v = decoded(v); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; };
const array = (v: any): any[] => { v = decoded(v); return Array.isArray(v) ? v : []; };
const text = (v: any): string => typeof v === "string" ? v.trim() : "";
export function buildReportVisuals(input: VisualInput, preview = false): ReportVisuals {
  // Entire selected strings are preserved. Oversized demo fields fail closed.
  const value = (v: any) => {
    const s = text(v);
    return preview && s.length > 2400 ? "" : s;
  };
  const strings = (v: any): string[] => (preview ? array(v).slice(0, 1) : array(v)).map(value).filter(Boolean);
  const scalar = (v: any) => { const s = value(v); return s ? [s] : []; };
  const e = object(input.extraction), s = object(input.strategy);
  const swot = object(input.swot), ci = object(input.customerInsights);
  const icp = object(s.icp);
  const positioning: VisualField[] = [
    { label: "Buyer", values: scalar(e.targetAudience || icp.summary) },
    { label: "Problem", values: strings(icp.painPoints) },
    { label: "Promise", values: scalar(e.positioningStatement) },
    { label: "Proof signals", values: strings(e.evidenceElements) },
  ];
  const rivals = preview ? array(input.competitors).slice(0, 1) : array(input.competitors);
  const competitors: VisualCompetitor[] = [
    { name: value(input.clientName) || "Your business", client: true,
      positioning: scalar(e.positioningStatement), signals: preview ? [] : strings(e.evidenceElements),
      gaps: preview ? [] : strings(s.positioningGaps) },
    ...rivals.map(object).map(c => ({
      name: value(c.name) || "Unnamed competitor", client: false,
      positioning: scalar(c.positioning), signals: preview ? [] : strings(c.strengths),
      gaps: preview ? [] : strings(c.weaknesses),
    })),
  ];
  const quadrants = [
    ["strengths", "Strengths", "Protect", "Internal"],
    ["weaknesses", "Weaknesses", "Improve", "Internal"],
    ["opportunities", "Opportunities", "Pursue", "External"],
    ["threats", "Threats", "Prepare", "External"],
  ];
  return {
    preview, positioning, competitors,
    swot: quadrants.map(([key, label, action, origin]) => ({
      key, label, action, origin,
      findings: (preview ? array(swot[key]).slice(0, 1) : array(swot[key])).map(object)
        .map(f => ({ title: value(f.title), evidence: value(f.evidence) }))
        .filter(f => !!f.title && !!f.evidence),
    })),
    journey: (preview ? array(ci.journeyStages).slice(0, 1) : array(ci.journeyStages)).map(object)
      .map(j => ({
        label: value(j.stage).replace(/-/g, " "), question: value(j.primaryQuestion),
        mindset: value(j.mindset), channel: preview ? "" : value(j.channel),
        asset: preview ? "" : value(j.contentAsset), cta: preview ? "" : value(j.cta),
        exit: preview ? "" : value(j.exitCriterion),
      })).filter(j => !!j.label && !!(j.question || j.mindset)),
    roadmap: (preview ? array(s.ninetyDayPlan).slice(0, 1) : array(s.ninetyDayPlan)).map(object)
      .map(p => ({
        label: value(p.phase), weeks: preview ? "" : value(p.weeks),
        focus: value(p.focus), outcomes: preview ? [] : strings(p.outcomes),
      })).filter(p => !!p.label && !!p.focus),
  };
}
