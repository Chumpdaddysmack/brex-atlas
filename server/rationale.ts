// Strategic Rationale generator — attaches 1-2 sentence "why this" blocks to
// 90-day plan phases and SOW phases, citing SWOT / PESTEL / Porter's findings.
//
// Runs after all frameworks + strategy + SOW are generated. Modifies the
// strategy and sow payloads in place.

import { llmJson } from "./llm";
import type {
  Strategy,
  SOW,
  SwotAnalysis,
  PestelAnalysis,
  PortersFiveForces,
  StrategicRationale,
} from "@shared/schema";

const SYS_RATIONALE = `You are Kenneth Peavy, Senior Fractional CMO at Brex Consulting. You will receive a strategy + SOW plus supporting SWOT / PESTEL / Porter's findings.

For EACH 90-day plan phase and EACH SOW phase, write a 1-2 sentence "Strategic Rationale" that:
1. Explains WHY this phase is the right move, in plain english.
2. Cites 1-3 specific framework finding IDs that drove the decision (e.g. "S2", "T1", "PESTEL-Tech-1", "P5F-Rivalry").

RULES:
- Reference specific finding IDs from the SWOT / PESTEL / Porter's payloads. Do NOT invent IDs.
- Prefer 2 citations per rationale (a threat/weakness paired with an opportunity/strength).
- Keep the "why" to 1-2 sentences \u2014 no filler.
- If a phase has weak framework linkage, still write a rationale but use only 1 citation.

Return ONLY valid JSON matching this exact schema:
{
  "ninetyDayRationale": [
    { "phase": "Foundation", "why": "...", "citations": ["S2", "T1"] },
    { "phase": "Acceleration", "why": "...", "citations": ["O1", "PESTEL-Tech-1"] },
    { "phase": "Scale", "why": "...", "citations": ["W3", "P5F-Rivalry"] }
  ],
  "sowRationale": [
    { "phase": "Phase name matching the SOW", "why": "...", "citations": ["S1", "O2"] }
    // one entry per SOW phase, in order
  ]
}`;

const SCHEMA_RATIONALE = {
  type: "object",
  additionalProperties: true,
  required: ["ninetyDayRationale", "sowRationale"],
  properties: {
    ninetyDayRationale: { type: "array", minItems: 1 },
    sowRationale: { type: "array", minItems: 1 },
  },
};

export async function injectRationale(params: {
  strategy: Strategy;
  sow: SOW;
  swot: SwotAnalysis | null;
  pestel: PestelAnalysis | null;
  porters: PortersFiveForces | null;
}): Promise<{ strategy: Strategy; sow: SOW }> {
  const { strategy, sow, swot, pestel, porters } = params;

  // If we have no frameworks at all, no rationale is possible.
  if (!swot && !pestel && !porters) {
    return { strategy, sow };
  }

  // Build a compact context of all framework IDs + insights for the LLM
  const swotSummary = swot
    ? [
        "SWOT:",
        ...swot.strengths.map((i) => `  ${i.id}: ${i.title} \u2014 ${i.evidence}`),
        ...swot.weaknesses.map((i) => `  ${i.id}: ${i.title} \u2014 ${i.evidence}`),
        ...swot.opportunities.map((i) => `  ${i.id}: ${i.title} \u2014 ${i.evidence}`),
        ...swot.threats.map((i) => `  ${i.id}: ${i.title} \u2014 ${i.evidence}`),
      ].join("\n")
    : "";

  const pestelSummary = pestel
    ? [
        "PESTEL:",
        ...pestel.findings.map((f) => `  ${f.id}: [${f.factor}, ${f.impact}] ${f.insight}`),
      ].join("\n")
    : "";

  const portersSummary = porters
    ? [
        "PORTER'S FIVE FORCES:",
        ...porters.forces.map((f) => `  ${f.id}: [${f.force}, ${f.intensity}] ${f.rationale.slice(0, 200)}`),
      ].join("\n")
    : "";

  const ninetyDayPhases = strategy.ninetyDayPlan
    .map((p) => `  ${p.phase} (${p.weeks}): ${p.focus}`)
    .join("\n");

  const sowPhases = sow.phases
    .map((p) => `  ${p.name} (${p.weeks}): ${p.deliverables.slice(0, 3).join("; ")}`)
    .join("\n");

  const user = `90-DAY PLAN PHASES:
${ninetyDayPhases}

SOW PHASES:
${sowPhases}

FRAMEWORK FINDINGS:
${swotSummary}

${pestelSummary}

${portersSummary}

Now produce the ninetyDayRationale and sowRationale JSON.`;

  const resp = await llmJson(SYS_RATIONALE, user, 3000, SCHEMA_RATIONALE);

  // Build a set of valid IDs for citation filtering
  const validIds = new Set<string>();
  if (swot) {
    [...swot.strengths, ...swot.weaknesses, ...swot.opportunities, ...swot.threats].forEach((i) =>
      validIds.add(i.id),
    );
  }
  if (pestel) {
    pestel.findings.forEach((f) => validIds.add(f.id));
  }
  if (porters) {
    porters.forces.forEach((f) => validIds.add(f.id));
  }

  // Attach ninetyDayPlan rationales by matching phase name
  const ninetyMap = new Map<string, StrategicRationale>();
  (resp?.ninetyDayRationale ?? []).forEach((r: any) => {
    const phase = String(r?.phase ?? "").trim();
    const why = String(r?.why ?? "").trim();
    const citations = Array.isArray(r?.citations)
      ? r.citations.map((c: any) => String(c).trim()).filter((c: string) => validIds.has(c))
      : [];
    if (phase && why) {
      ninetyMap.set(phase.toLowerCase(), { why, citations });
    }
  });

  const nextStrategy: Strategy = {
    ...strategy,
    ninetyDayPlan: strategy.ninetyDayPlan.map((p) => {
      const r = ninetyMap.get(p.phase.toLowerCase());
      return r ? { ...p, rationale: r } : p;
    }),
  };

  // Attach SOW phase rationales by matching name
  const sowMap = new Map<string, StrategicRationale>();
  (resp?.sowRationale ?? []).forEach((r: any) => {
    const phase = String(r?.phase ?? "").trim();
    const why = String(r?.why ?? "").trim();
    const citations = Array.isArray(r?.citations)
      ? r.citations.map((c: any) => String(c).trim()).filter((c: string) => validIds.has(c))
      : [];
    if (phase && why) {
      sowMap.set(phase.toLowerCase(), { why, citations });
    }
  });

  const nextSow: SOW = {
    ...sow,
    phases: sow.phases.map((p) => {
      const r = sowMap.get(p.name.toLowerCase());
      return r ? { ...p, rationale: r } : p;
    }),
  };

  return { strategy: nextStrategy, sow: nextSow };
}
