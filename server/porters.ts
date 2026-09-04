// Porter's Five Forces generator — deep web research with citations.
// Opt-in per analysis. For each of 5 forces, does a Perplexity Sonar search
// with recency filter (2025-2026) and then asks Claude to determine intensity,
// rationale, and drivers with source URLs.

import { llmJson } from "./llm";
import { pplxAsk, isPerplexityConfigured } from "./perplexity-search";
import type {
  PortersFiveForces,
  PortersForce,
  PortersForceName,
  FrameworkSource,
  Competitor,
} from "@shared/schema";

const FORCE_ORDER: PortersForceName[] = [
  "rivalry",
  "newEntrants",
  "substitutes",
  "buyerPower",
  "supplierPower",
];

const FORCE_LABELS: Record<PortersForceName, string> = {
  rivalry: "Competitive Rivalry",
  newEntrants: "Threat of New Entrants",
  substitutes: "Threat of Substitutes",
  buyerPower: "Buyer Power",
  supplierPower: "Supplier Power",
};

function questionForForce(
  force: PortersForceName,
  industry: string,
  clientName: string,
  competitorNames: string[],
): string {
  const base = `Industry: ${industry}. Client: ${clientName}. Known competitors: ${competitorNames.join(", ")}.`;
  switch (force) {
    case "rivalry":
      return `${base} In 2025-2026, how intense is competitive rivalry in the ${industry} industry? Cover: number of competitors, growth rate, differentiation levels, switching costs, recent price wars, M&A activity, exit barriers. Cite recent industry reports, funding news, and market share data.`;
    case "newEntrants":
      return `${base} In 2025-2026, what is the threat of new entrants into the ${industry} industry? Cover: barriers to entry (capital, brand, regulation, IP), recent startups that have entered, AI-native new entrants, and any noteworthy category disruptors. Cite specific companies, funding rounds, and analyst commentary.`;
    case "substitutes":
      return `${base} In 2025-2026, what substitute solutions threaten the ${industry} industry? Cover: adjacent categories, DIY / in-house alternatives, AI-driven substitutes, and specific technologies replacing traditional offerings. Cite specific products/vendors and buyer behavior data.`;
    case "buyerPower":
      return `${base} In 2025-2026, how much bargaining power do buyers have in the ${industry} industry? Cover: buyer concentration, switching costs, procurement sophistication, transparency (e.g., G2/Gartner), price sensitivity, and any collective purchasing trends. Cite procurement surveys and buyer behavior studies.`;
    case "supplierPower":
      return `${base} In 2025-2026, how much bargaining power do suppliers have in the ${industry} industry? Cover: talent supply (labor markets, wage inflation), key technology vendors (cloud, AI infrastructure), data providers, and any supply chain / API concentration. Cite specific vendor pricing changes and labor market reports.`;
  }
}

const SYS_STRUCTURE = `You are a senior strategy analyst applying Porter's Five Forces. You will receive raw research about ONE force plus its source citations. Determine intensity, write a rationale, list drivers, and cite sources.

RULES:
- \`intensity\` must be "low", "medium", or "high" based on the evidence.
- \`rationale\` is 2-4 sentences citing specific facts from the research.
- \`drivers\` is 2-4 bullet points, each a concrete factor behind the intensity rating.
- Prefer sources from the provided citations list. Each finding should tie to at least 1 source.

Return ONLY valid JSON:
{
  "intensity": "low" | "medium" | "high",
  "rationale": "2-4 sentences citing specific facts",
  "drivers": ["driver 1", "driver 2", ...],
  "sourceIndexes": [0, 2]   // 0-indexed positions in the citations array
}`;

const SCHEMA_STRUCTURE = {
  type: "object",
  additionalProperties: true,
  required: ["intensity", "rationale", "drivers"],
  properties: {
    intensity: { type: "string" },
    rationale: { type: "string" },
    drivers: { type: "array", minItems: 1 },
    sourceIndexes: { type: "array" },
  },
};

async function generateForce(
  force: PortersForceName,
  industry: string,
  clientName: string,
  competitorNames: string[],
): Promise<PortersForce> {
  const question = questionForForce(force, industry, clientName, competitorNames);
  const research = await pplxAsk(question, {
    recency: "year",
    maxTokens: 1400,
  });

  if (!research || research.citations.length === 0) {
    return await claudeOnlyForce(force, industry, clientName, competitorNames);
  }

  const citationsPreview = research.citations
    .slice(0, 12)
    .map((c, i) => `[${i}] ${c.title} — ${c.url}${c.date ? ` (${c.date})` : ""}`)
    .join("\n");

  const structUser = `Research question: ${question}

Raw research answer:
${research.answer.slice(0, 8000)}

Available citations (0-indexed):
${citationsPreview}`;

  const structured = await llmJson(SYS_STRUCTURE, structUser, 1500, SCHEMA_STRUCTURE);

  const idxs: number[] = Array.isArray(structured?.sourceIndexes) ? structured.sourceIndexes : [];
  const sources: FrameworkSource[] = idxs
    .map((idx) => research.citations[idx])
    .filter(Boolean)
    .slice(0, 4)
    .map((c) => ({
      title: c.title,
      url: c.url,
      publisher: c.publisher,
      date: c.date,
    }));

  // Fallback: top 3 citations if Claude picked none
  if (sources.length === 0 && research.citations.length > 0) {
    research.citations.slice(0, 3).forEach((c) => {
      sources.push({
        title: c.title,
        url: c.url,
        publisher: c.publisher,
        date: c.date,
      });
    });
  }

  return {
    id: `P5F-${forceIdSlug(force)}`,
    force,
    intensity: validIntensity(structured?.intensity),
    rationale: String(structured?.rationale ?? "").trim(),
    drivers: (structured?.drivers ?? []).map((d: any) => String(d).trim()).filter((d: string) => d),
    sources,
  };
}

async function claudeOnlyForce(
  force: PortersForceName,
  industry: string,
  clientName: string,
  competitorNames: string[],
): Promise<PortersForce> {
  const question = questionForForce(force, industry, clientName, competitorNames);
  const sys = `You are a senior strategy analyst applying Porter's Five Forces. Answer with intensity, rationale, and 2-4 drivers. Return ONLY valid JSON:
{
  "intensity": "low"|"medium"|"high",
  "rationale": "2-4 sentences",
  "drivers": ["...", "..."]
}
Do NOT invent citations \u2014 leave sources empty.`;

  const structured = await llmJson(sys, question, 1200, SCHEMA_STRUCTURE);

  return {
    id: `P5F-${forceIdSlug(force)}`,
    force,
    intensity: validIntensity(structured?.intensity),
    rationale: String(structured?.rationale ?? "").trim(),
    drivers: (structured?.drivers ?? []).map((d: any) => String(d).trim()).filter((d: string) => d),
    sources: [],
  };
}

function forceIdSlug(f: PortersForceName): string {
  switch (f) {
    case "rivalry": return "Rivalry";
    case "newEntrants": return "NewEntrants";
    case "substitutes": return "Substitutes";
    case "buyerPower": return "BuyerPower";
    case "supplierPower": return "SupplierPower";
  }
}

function validIntensity(v: any): "low" | "medium" | "high" {
  const s = String(v ?? "").toLowerCase();
  if (s.includes("low")) return "low";
  if (s.includes("high")) return "high";
  return "medium";
}

export async function generatePorters(params: {
  clientName: string;
  industry: string;
  competitors: Competitor[];
}): Promise<PortersFiveForces> {
  const { clientName, industry, competitors } = params;
  const compNames = competitors.map((c) => c.name).slice(0, 6);

  console.log(`[porters] starting deep research for ${clientName} (${industry}). pplx=${isPerplexityConfigured()}`);

  // Fan-out: 5 forces in parallel — never let one force take down the whole framework.
  const settled = await Promise.allSettled(
    FORCE_ORDER.map((f) => generateForce(f, industry, clientName, compNames)),
  );
  const forces: PortersForce[] = [];
  for (let i = 0; i < FORCE_ORDER.length; i++) {
    const s = settled[i];
    const f = FORCE_ORDER[i];
    if (s.status === "fulfilled") {
      forces.push(s.value);
    } else {
      console.error(`[porters] force '${f}' failed:`, s.reason?.message ?? s.reason);
      // Second-chance: try claude-only (no web research) so this force still appears
      try {
        const fallback = await claudeOnlyForce(f, industry, clientName, compNames);
        forces.push(fallback);
        console.log(`[porters] force '${f}' recovered via claude-only fallback`);
      } catch (fallbackErr: any) {
        console.error(`[porters] force '${f}' claude-only fallback also failed:`, fallbackErr?.message ?? fallbackErr);
        // Last resort: skeleton entry so the shape stays valid and PDF still renders
        forces.push({
          id: `P5F-${forceIdSlug(f)}`,
          force: f,
          intensity: "medium",
          rationale: `Analysis unavailable — research pipeline failure. ${String(s.reason?.message ?? s.reason).slice(0, 200)}`,
          drivers: [],
          sources: [],
        });
      }
    }
  }

  // Overall structure + summary from Claude
  const summaryUser = `Client: ${clientName}
Industry: ${industry}

Porter's Five Forces results:
${forces.map((f) => `- ${FORCE_LABELS[f.force]}: ${f.intensity} \u2014 ${f.rationale}`).join("\n")}

Write:
1. \`overallStructure\`: 2-3 sentences on the industry's attractiveness given these forces.
2. \`summary\`: 1-2 sentences on the single most important force this client must play against.

Return ONLY valid JSON: { "overallStructure": "...", "summary": "..." }`;

  let summaryResp: any = null;
  try {
    summaryResp = await llmJson(
      "You are Kenneth Peavy, senior fractional CMO. Return ONLY valid JSON.",
      summaryUser,
      600,
      {
        type: "object",
        additionalProperties: true,
        required: ["overallStructure", "summary"],
        properties: {
          overallStructure: { type: "string" },
          summary: { type: "string" },
        },
      },
    );
  } catch (summaryErr: any) {
    console.error(`[porters] summary generation failed:`, summaryErr?.message ?? summaryErr);
  }

  const highForces = forces.filter((f) => f.intensity === "high").map((f) => FORCE_LABELS[f.force]);
  const fallbackSummary = highForces.length > 0
    ? `The most critical forces are ${highForces.join(", ")}. Focus strategic response on these.`
    : `Industry structure is balanced. No single force dominates.`;

  return {
    industry,
    forces,
    overallStructure: String(summaryResp?.overallStructure ?? "").trim() || `Analysis of ${industry} across all five Porter's forces.`,
    summary: String(summaryResp?.summary ?? "").trim() || fallbackSummary,
  };
}
