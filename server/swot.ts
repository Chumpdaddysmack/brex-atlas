// SWOT generator — synthesizes from existing extraction + competitor set.
// Fast, cheap, no external web fetches. Always runs on every analysis.

import { llmJson } from "./llm";
import type { SwotAnalysis, Extraction, Competitor } from "@shared/schema";

const SYS_SWOT = `You are Kenneth Peavy, Senior Fractional CMO at Brex Consulting. Apply the Big Rock Method: identify the small number of factors that actually determine strategic priorities.

Given a client's site extraction and 4-competitor teardown, produce a rigorous SWOT analysis.

CRITICAL RULES:
- Every SWOT item MUST be grounded in specific evidence from the extraction or competitor data. No generic MBA-textbook items.
- Strengths and Weaknesses are INTERNAL — about the client's positioning, offerings, evidence, site, team.
- Opportunities and Threats are EXTERNAL — about the market, competitors, buyer behavior, technology.
- Use short, punchy titles (5-8 words) with concrete evidence sentences (1-2 sentences each).
- Each item gets a stable id: S1/S2/S3/S4 for strengths, W1/W2/W3/W4 for weaknesses, O1/O2/O3/O4 for opportunities, T1/T2/T3/T4 for threats.

Return ONLY valid JSON matching this exact schema — no prose, no markdown:
{
  "industry": "string — inferred industry sector (e.g. 'B2B ERP consulting', 'mid-market SaaS')",
  "strengths":     [{ "id": "S1", "title": "...", "evidence": "..." }, ... 3-5 items],
  "weaknesses":    [{ "id": "W1", "title": "...", "evidence": "..." }, ... 3-5 items],
  "opportunities": [{ "id": "O1", "title": "...", "evidence": "..." }, ... 3-5 items],
  "threats":       [{ "id": "T1", "title": "...", "evidence": "..." }, ... 3-5 items],
  "summary": "string — 2-3 sentence strategic read: what does this SWOT tell us to do?"
}`;

const SCHEMA_SWOT = {
  type: "object",
  additionalProperties: true,
  required: ["industry", "strengths", "weaknesses", "opportunities", "threats", "summary"],
  properties: {
    industry: { type: "string" },
    strengths: { type: "array", minItems: 3, maxItems: 5 },
    weaknesses: { type: "array", minItems: 3, maxItems: 5 },
    opportunities: { type: "array", minItems: 3, maxItems: 5 },
    threats: { type: "array", minItems: 3, maxItems: 5 },
    summary: { type: "string" },
  },
};

export async function generateSwot(params: {
  clientName: string;
  industry: string | null;
  extraction: Extraction;
  competitors: Competitor[];
  notes?: string | null;
}): Promise<SwotAnalysis> {
  const { clientName, industry, extraction, competitors, notes } = params;

  const user = `Client: ${clientName}
Self-reported industry (may be blank): ${industry ?? ""}
Notes: ${notes ?? ""}

EXTRACTION (from client's website):
${JSON.stringify(extraction).slice(0, 6000)}

COMPETITOR SET:
${JSON.stringify(competitors).slice(0, 6000)}`;

  const raw = await llmJson(SYS_SWOT, user, 3500, SCHEMA_SWOT);

  // Normalize + ensure ids are stable
  const normalize = (arr: any[], prefix: string): { id: string; title: string; evidence: string }[] =>
    (arr ?? []).slice(0, 5).map((item: any, i: number) => ({
      id: typeof item?.id === "string" && item.id.startsWith(prefix) ? item.id : `${prefix}${i + 1}`,
      title: String(item?.title ?? "").trim(),
      evidence: String(item?.evidence ?? "").trim(),
    }));

  const swot: SwotAnalysis = {
    industry: String(raw?.industry ?? industry ?? "General B2B").trim(),
    strengths: normalize(raw?.strengths, "S"),
    weaknesses: normalize(raw?.weaknesses, "W"),
    opportunities: normalize(raw?.opportunities, "O"),
    threats: normalize(raw?.threats, "T"),
    summary: String(raw?.summary ?? "").trim(),
  };

  return swot;
}
