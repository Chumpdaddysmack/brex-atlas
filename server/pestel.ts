// PESTEL generator — deep web research with citations.
// Opt-in per analysis. For each of 6 factors, does a Perplexity Sonar search
// with recency filter (2025-2026) and then asks Claude to structure the
// findings into 2-3 items with source URLs.

import { llmJson } from "./llm";
import { pplxAsk, isPerplexityConfigured, type PplxResult } from "./perplexity-search";
import type {
  PestelAnalysis,
  PestelFinding,
  PestelFactor,
  FrameworkSource,
} from "@shared/schema";

const FACTOR_LABELS: Record<PestelFactor, string> = {
  political: "Political & regulatory",
  economic: "Economic",
  social: "Social & demographic",
  technological: "Technological",
  environmental: "Environmental & sustainability",
  legal: "Legal & compliance",
};

const FACTOR_ORDER: PestelFactor[] = [
  "political",
  "economic",
  "social",
  "technological",
  "environmental",
  "legal",
];

function questionForFactor(factor: PestelFactor, industry: string, clientName: string): string {
  const base = `Industry context: ${industry}. Client: ${clientName}.`;
  switch (factor) {
    case "political":
      return `${base} What are the most important political and regulatory developments in 2025-2026 affecting the ${industry} industry? Include tariffs, trade policy, government spending priorities, industry-specific regulations, and executive orders. Cite specific bills, agencies, and dates.`;
    case "economic":
      return `${base} What are the key macroeconomic conditions in 2025-2026 affecting buyer behavior and budgets in the ${industry} sector? Include interest rates, inflation, capex trends, sector-specific GDP contribution, funding environment, IT spending forecasts.`;
    case "social":
      return `${base} What social and demographic shifts in 2025-2026 are changing how buyers in the ${industry} industry make decisions? Include remote work trends, workforce demographics, DE&I priorities, consumer trust in AI, and generational buying preferences.`;
    case "technological":
      return `${base} What are the most disruptive technology trends of 2025-2026 in the ${industry} industry? Include AI adoption, automation, cloud migration status, cybersecurity threats, and specific vendors/platforms gaining share.`;
    case "environmental":
      return `${base} What environmental and sustainability factors in 2025-2026 affect procurement, operations, or brand for companies in the ${industry} industry? Include ESG reporting requirements, sustainable supply chain, energy costs, and carbon disclosure mandates.`;
    case "legal":
      return `${base} What legal and compliance developments in 2025-2026 affect the ${industry} industry? Include data privacy laws (state-by-state US, GDPR, DSA), AI regulation (EU AI Act, state AI bills), employment law changes, and industry-specific compliance mandates.`;
  }
}

const SYS_STRUCTURE = `You are a senior strategy analyst. You will receive raw research answering a PESTEL question, plus the source citations that back it. Extract exactly 2-3 specific, industry-relevant findings and structure them as JSON.

RULES:
- Each finding MUST reference specific facts from the research (numbers, dates, agency names, bill numbers, product names).
- Each finding gets at least 1 source URL from the provided citations list. Prefer 2 sources per finding if available.
- Skip generic MBA-textbook observations. If the research is thin, return fewer findings — never invent facts.
- \`impact\` is from the CLIENT's perspective: does this help them (positive), hurt them (negative), or is it neutral pressure they must respond to?
- \`timeHorizon\`: "near" = <12 months, "mid" = 12-36 months, "long" = 3+ years.

Return ONLY valid JSON:
{
  "findings": [
    {
      "insight": "1-2 sentences, factual, specific",
      "impact": "positive" | "negative" | "neutral",
      "timeHorizon": "near" | "mid" | "long",
      "sourceIndexes": [0, 2]   // 0-indexed positions in the provided citations array
    },
    ...
  ]
}`;

const SCHEMA_STRUCTURE = {
  type: "object",
  additionalProperties: true,
  required: ["findings"],
  properties: {
    findings: { type: "array", minItems: 1, maxItems: 4 },
  },
};

// Synthesize a factor's findings from Perplexity research + Claude structuring
async function generateFactor(
  factor: PestelFactor,
  industry: string,
  clientName: string,
): Promise<PestelFinding[]> {
  const question = questionForFactor(factor, industry, clientName);
  const research = await pplxAsk(question, {
    recency: "year",
    maxTokens: 1400,
  });

  // If Perplexity is unavailable, ask Claude directly (still useful, no live citations)
  if (!research || research.citations.length === 0) {
    return await claudeOnlyFactor(factor, industry, clientName);
  }

  // Ask Claude to extract structured findings from the research answer
  const citationsPreview = research.citations
    .slice(0, 12)
    .map((c, i) => `[${i}] ${c.title} — ${c.url}${c.date ? ` (${c.date})` : ""}`)
    .join("\n");

  const structUser = `Research question: ${question}

Raw research answer:
${research.answer.slice(0, 8000)}

Available citations (0-indexed):
${citationsPreview}`;

  const structured = await llmJson(SYS_STRUCTURE, structUser, 2000, SCHEMA_STRUCTURE);

  const findings: PestelFinding[] = (structured?.findings ?? [])
    .slice(0, 4)
    .map((f: any, i: number) => {
      const idxs: number[] = Array.isArray(f?.sourceIndexes) ? f.sourceIndexes : [];
      const sources: FrameworkSource[] = idxs
        .map((idx) => research.citations[idx])
        .filter(Boolean)
        .slice(0, 3)
        .map((c) => ({
          title: c.title,
          url: c.url,
          publisher: c.publisher,
          date: c.date,
        }));

      // If Claude picked no valid indexes, use the top 2 citations as fallback
      if (sources.length === 0 && research.citations.length > 0) {
        research.citations.slice(0, 2).forEach((c) => {
          sources.push({
            title: c.title,
            url: c.url,
            publisher: c.publisher,
            date: c.date,
          });
        });
      }

      return {
        id: `PESTEL-${capitalize(factor)}-${i + 1}`,
        factor,
        insight: String(f?.insight ?? "").trim(),
        impact: validImpact(f?.impact),
        timeHorizon: validHorizon(f?.timeHorizon),
        sources,
      };
    })
    .filter((f: PestelFinding) => f.insight.length > 10);

  return findings;
}

// Fallback: Claude-only synthesis when Perplexity isn't available
async function claudeOnlyFactor(
  factor: PestelFactor,
  industry: string,
  clientName: string,
): Promise<PestelFinding[]> {
  const question = questionForFactor(factor, industry, clientName);
  const sys = `You are a senior strategy analyst. Answer the following PESTEL question with 2-3 specific, industry-relevant findings. Return ONLY valid JSON matching this schema:
{
  "findings": [
    { "insight": "1-2 sentences, factual", "impact": "positive"|"negative"|"neutral", "timeHorizon": "near"|"mid"|"long" }
  ]
}
Do NOT invent citations — leave sources empty for now.`;

  const structured = await llmJson(sys, question, 1500, SCHEMA_STRUCTURE);

  return (structured?.findings ?? []).slice(0, 3).map((f: any, i: number) => ({
    id: `PESTEL-${capitalize(factor)}-${i + 1}`,
    factor,
    insight: String(f?.insight ?? "").trim(),
    impact: validImpact(f?.impact),
    timeHorizon: validHorizon(f?.timeHorizon),
    sources: [],
  }));
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function validImpact(v: any): "positive" | "negative" | "neutral" {
  return v === "positive" || v === "negative" ? v : "neutral";
}

function validHorizon(v: any): "near" | "mid" | "long" {
  return v === "near" || v === "mid" || v === "long" ? v : "mid";
}

export async function generatePestel(params: {
  clientName: string;
  industry: string;
}): Promise<PestelAnalysis> {
  const { clientName, industry } = params;

  console.log(`[pestel] starting deep research for ${clientName} (${industry}). pplx=${isPerplexityConfigured()}`);

  // Fan-out: 6 factors in parallel. Each factor does 1 pplx call + 1 Claude call.
  const factorResults = await Promise.all(
    FACTOR_ORDER.map((f) => generateFactor(f, industry, clientName)),
  );

  const findings: PestelFinding[] = factorResults.flat();

  // Ask Claude for a 2-3 sentence summary of the whole PESTEL
  const summaryUser = `Client: ${clientName}
Industry: ${industry}

PESTEL findings (all factors):
${findings.map((f) => `- [${f.factor}] ${f.insight} (impact: ${f.impact})`).join("\n")}

Write a 2-3 sentence strategic summary: what is the single most important macro theme this client must respond to?`;

  const summaryResp = await llmJson(
    "You are Kenneth Peavy, senior fractional CMO. Return ONLY valid JSON: { \"summary\": \"...\" }",
    summaryUser,
    500,
    { type: "object", additionalProperties: true, required: ["summary"], properties: { summary: { type: "string" } } },
  );

  return {
    industry,
    findings,
    summary: String(summaryResp?.summary ?? "").trim(),
  };
}
