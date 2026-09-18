// Customer Insights generator — 12-analysis buyer intelligence pack.
// Added Sep 2026. Extends and replaces the shallow strategy.icp fields when
// enabled. Uses real Perplexity Sonar search for voice-of-customer evidence
// when configured; falls back to labeled paraphrased quotes when the account
// has no reviewable footprint (or no API key).
//
// Four panels of sub-analyses:
//   A. Who they are       — persona, psychographics, sociotype
//   B. What hurts / hire  — pain points, JTBD, voice-of-customer
//   C. Will they buy      — Would-They-Buy, Mom Test, buying signals
//   D. How the deal closes — decision committee, objections, journey stages
//
// Pattern mirrors server/swot.ts + server/pestel.ts.

import { llmJson } from "./llm";
import { pplxAsk, isPerplexityConfigured } from "./perplexity-search";
import type {
  CustomerInsights,
  Extraction,
  Competitor,
  CIPersona,
  CIPainPoint,
  CIJTBD,
  CIVoiceOfCustomer,
  CIWouldTheyBuySignal,
  CIMomTestQuestion,
  CIBuyingSignal,
  CIDecisionCommitteeRole,
  CIObjection,
  CIJourneyStage,
  CIPsychographics,
  CISociotype,
  FrameworkSource,
} from "@shared/schema";

// ============================================================
// System prompt — one LLM call produces the full pack.
// Prompt is intentionally long: 12 sub-analyses with concrete rubrics keeps
// generation grounded and prevents drift into MBA-textbook filler.
// ============================================================

const SYS_CI = `You are Kenneth Peavy, Senior Fractional CMO at Brex Consulting, applying the Big Rock Method to buyer intelligence. You are producing a rigorous Customer Insights pack — the buyer intelligence layer that replaces the shallow ICP block in the strategy.

CRITICAL RULES:
- Every item MUST be grounded in specific evidence from the extraction, competitor set, or industry knowledge. No generic MBA-textbook items.
- Direct, analytical business language tied to measurable revenue outcomes. No fluff, no hedging.
- Personas must be named individuals with realistic titles and org context — not generic archetypes.
- JTBD statements MUST use the canonical form: situation, motivation, outcome — plus explicit functional / emotional / social jobs.
- Would-They-Buy signals are BEHAVIORS (what a prospect does), not opinions ("they say they like it" is not a signal).
- Mom Test questions must extract behavior. Each question includes its antipattern — the compliment-seeking version we are AVOIDING.
- Objections use these frames: price, risk, timing, fit, authority, status-quo. Reframes are the exact language a rep uses.
- Decision Committee roles include our play: champion, neutralize, educate, or bypass.
- Journey stages are exactly 5, in order: unaware, aware, considering, deciding, deciding-with-us.

Return ONLY valid JSON matching this exact schema — no prose, no markdown, no XML/tool-syntax tags:

{
  "industry": "inferred industry sector",
  "personas": [
    {
      "name": "First Last",
      "role": "Job title",
      "seniority": "ic | manager | director | vp | c-suite | owner",
      "orgSize": "e.g. 50-500 employees",
      "industry": "vertical",
      "authority": "decider | influencer | user | gatekeeper | champion",
      "isPrimary": true
    }
    // 1 primary; optional secondary
  ],
  "psychographics": {
    "personalityType": "one-word or short phrase (e.g. Methodical, Visionary, Skeptical Pragmatist)",
    "buyerType": "e.g. Brand Loyalist | Price Hunter | Reference Buyer",
    "buyerStage": "e.g. Early Adopter | Late Majority | Laggard",
    "userType": "e.g. Power User | Delegator | Reluctant User",
    "decisionStyle": "analytical | intuitive | consensus | directive",
    "riskTolerance": "low | medium | high",
    "informationDiet": ["source1", "source2", "source3"],
    "brandRelationship": "loyalist | switcher | evaluator | skeptic"
  },
  "sociotype": {
    "archetype": "MBTI-style label with descriptor (e.g. 'ENTJ — Strategic Implementer')",
    "iAm": "1-2 sentences",
    "iCrave": "1-2 sentences",
    "butAlso": "1-2 sentences",
    "iStruggleWith": "1-2 sentences",
    "iConsume": "1-2 sentences"
  },
  "painPoints": [
    {
      "rank": 1,
      "label": "short label (5-8 words)",
      "symptom": "what they experience day-to-day",
      "businessCost": "quantified or qualified impact on revenue/efficiency",
      "currentWorkaround": "what they do today to cope",
      "ourLeverage": "how the client's offer resolves this — Brex language when in Brex context"
    }
    // 3-5 items, ranked
  ],
  "jtbd": [
    {
      "situation": "When {trigger situation}",
      "motivation": "I want to {desired action}",
      "outcome": "so I can {desired outcome}",
      "functionalJob": "the practical task",
      "emotionalJob": "how they want to feel",
      "socialJob": "how they want to be perceived"
    }
    // 3-5 items
  ],
  "voiceOfCustomer": [
    // The generator will replace these placeholders with real or paraphrased quotes.
    // Leave this array EMPTY in your output — a separate step populates it.
  ],
  "wouldTheyBuySignals": [
    {
      "signal": "behavior a prospect exhibits in discovery",
      "whatItMeans": "the interpretation",
      "strength": "weak | moderate | strong"
    }
    // exactly 5 items
  ],
  "momTestQuestions": [
    {
      "question": "the actual question to ask",
      "whyItWorks": "why it extracts behavior, not flattery",
      "antipattern": "the compliment-seeking version to AVOID"
    }
    // exactly 5 items
  ],
  "buyingSignals": [
    {
      "trigger": "observable event",
      "category": "hiring | funding | tech-stack | leadership | content | competitor",
      "urgency": "cold | warming | hot | in-market",
      "action": "outreach play to run"
    }
    // 5-8 items
  ],
  "decisionCommittee": [
    {
      "role": "job title",
      "motivation": "what drives them",
      "blocker": "what stops them from saying yes",
      "ourPlay": "champion | neutralize | educate | bypass",
      "primaryObjection": "the objection they raise most often"
    }
    // 3-7 roles
  ],
  "objections": [
    {
      "objection": "verbatim customer language",
      "frame": "price | risk | timing | fit | authority | status-quo",
      "underlyingFear": "the real concern behind the objection",
      "reframe": "the exact language the rep uses to reframe",
      "proofAsset": "case study, calculator, benchmark, or reference to neutralize it"
    }
    // exactly 5 items
  ],
  "journeyStages": [
    {
      "stage": "unaware | aware | considering | deciding | deciding-with-us",
      "mindset": "what the buyer is thinking at this stage",
      "primaryQuestion": "the question in their head",
      "channel": "where they are",
      "contentAsset": "the deliverable that moves them to next stage",
      "cta": "the action we want them to take",
      "exitCriterion": "what proves they moved on"
    }
    // exactly 5 in order: unaware, aware, considering, deciding, deciding-with-us
  ],
  "summary": "2-3 sentence executive read — feeds strategy.icp.summary. REQUIRED. Never leave empty. Name the primary buyer, the top pain they are stuck on, and the trigger that opens the buying window."
}

SHAPE ENFORCEMENT:
- All arrays are JSON arrays of objects inline in the payload — NEVER numbered top-level keys like "item1", "persona1".
- NEVER emit XML-style tags like <parameter name="..."> or <item>...</item>.
- The voiceOfCustomer array MUST be empty in your output — a downstream step populates it.
- Return valid JSON only.`;

// Minimal JSON-schema-ish hint for llmJson. The generator does its own
// normalization, so this stays loose — we only enforce top-level shape.
const SCHEMA_CI = {
  type: "object",
  additionalProperties: true,
  required: [
    "industry",
    "personas",
    "psychographics",
    "sociotype",
    "painPoints",
    "jtbd",
    "voiceOfCustomer",
    "wouldTheyBuySignals",
    "momTestQuestions",
    "buyingSignals",
    "decisionCommittee",
    "objections",
    "journeyStages",
    "summary",
  ],
  properties: {
    industry: { type: "string" },
    personas: { type: "array", minItems: 1, maxItems: 2 },
    psychographics: { type: "object" },
    sociotype: { type: "object" },
    painPoints: { type: "array", minItems: 3, maxItems: 5 },
    jtbd: { type: "array", minItems: 3, maxItems: 5 },
    voiceOfCustomer: { type: "array" }, // empty on generation; VoC step fills it
    wouldTheyBuySignals: { type: "array", minItems: 5, maxItems: 5 },
    momTestQuestions: { type: "array", minItems: 5, maxItems: 5 },
    buyingSignals: { type: "array", minItems: 5, maxItems: 8 },
    decisionCommittee: { type: "array", minItems: 3, maxItems: 7 },
    objections: { type: "array", minItems: 5, maxItems: 5 },
    journeyStages: { type: "array", minItems: 5, maxItems: 5 },
    summary: { type: "string" },
  },
};

// ============================================================
// Normalizers — defensive against LLM shape drift.
// Every field gets a safe fallback so a partial payload still renders.
// ============================================================

const SENIORITY = ["ic", "manager", "director", "vp", "c-suite", "owner"] as const;
const AUTHORITY = ["decider", "influencer", "user", "gatekeeper", "champion"] as const;
const DECISION_STYLE = ["analytical", "intuitive", "consensus", "directive"] as const;
const RISK = ["low", "medium", "high"] as const;
const BRAND_REL = ["loyalist", "switcher", "evaluator", "skeptic"] as const;
const STRENGTH = ["weak", "moderate", "strong"] as const;
const CATEGORY = ["hiring", "funding", "tech-stack", "leadership", "content", "competitor"] as const;
const URGENCY = ["cold", "warming", "hot", "in-market"] as const;
const OUR_PLAY = ["champion", "neutralize", "educate", "bypass"] as const;
const FRAME = ["price", "risk", "timing", "fit", "authority", "status-quo"] as const;
const STAGES = ["unaware", "aware", "considering", "deciding", "deciding-with-us"] as const;

function enumOr<T extends string>(v: any, allowed: readonly T[], fallback: T): T {
  const s = String(v ?? "").trim().toLowerCase();
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}

function s(v: any, fallback = ""): string {
  return String(v ?? fallback).trim();
}

function normalizePersonas(arr: any[]): CIPersona[] {
  const items = Array.isArray(arr) ? arr.slice(0, 2) : [];
  const out: CIPersona[] = items.map((p: any, i: number) => ({
    name: s(p?.name, i === 0 ? "Primary Buyer" : "Secondary Buyer"),
    role: s(p?.role, "Decision-Maker"),
    seniority: enumOr(p?.seniority, SENIORITY, "director"),
    orgSize: s(p?.orgSize, "unspecified"),
    industry: s(p?.industry, "General B2B"),
    authority: enumOr(p?.authority, AUTHORITY, "decider"),
    isPrimary: i === 0 ? true : Boolean(p?.isPrimary),
  }));
  if (out.length === 0) {
    out.push({
      name: "Primary Buyer",
      role: "Decision-Maker",
      seniority: "director",
      orgSize: "unspecified",
      industry: "General B2B",
      authority: "decider",
      isPrimary: true,
    });
  }
  return out;
}

function normalizePsychographics(p: any): CIPsychographics {
  return {
    personalityType: s(p?.personalityType, "Methodical"),
    buyerType: s(p?.buyerType, "Reference Buyer"),
    buyerStage: s(p?.buyerStage, "Early Majority"),
    userType: s(p?.userType, "Power User"),
    decisionStyle: enumOr(p?.decisionStyle, DECISION_STYLE, "analytical"),
    riskTolerance: enumOr(p?.riskTolerance, RISK, "medium"),
    informationDiet: Array.isArray(p?.informationDiet)
      ? p.informationDiet.slice(0, 6).map(s)
      : [],
    brandRelationship: enumOr(p?.brandRelationship, BRAND_REL, "evaluator"),
  };
}

function normalizeSociotype(t: any): CISociotype {
  return {
    archetype: s(t?.archetype, "Strategic Implementer"),
    iAm: s(t?.iAm),
    iCrave: s(t?.iCrave),
    butAlso: s(t?.butAlso),
    iStruggleWith: s(t?.iStruggleWith),
    iConsume: s(t?.iConsume),
  };
}

function normalizePainPoints(arr: any[]): CIPainPoint[] {
  const items = Array.isArray(arr) ? arr.slice(0, 5) : [];
  return items
    .map((p: any, i: number) => ({
      rank: Number.isFinite(p?.rank) ? Math.min(5, Math.max(1, Math.round(p.rank))) : i + 1,
      label: s(p?.label, `Pain #${i + 1}`),
      symptom: s(p?.symptom),
      businessCost: s(p?.businessCost),
      currentWorkaround: s(p?.currentWorkaround),
      ourLeverage: s(p?.ourLeverage),
    }))
    .sort((a, b) => a.rank - b.rank);
}

function normalizeJTBD(arr: any[]): CIJTBD[] {
  const items = Array.isArray(arr) ? arr.slice(0, 5) : [];
  return items.map((j: any) => ({
    situation: s(j?.situation),
    motivation: s(j?.motivation),
    outcome: s(j?.outcome),
    functionalJob: s(j?.functionalJob),
    emotionalJob: s(j?.emotionalJob),
    socialJob: s(j?.socialJob),
  }));
}

function normalizeWouldTheyBuy(arr: any[]): CIWouldTheyBuySignal[] {
  const items = Array.isArray(arr) ? arr.slice(0, 5) : [];
  return items.map((x: any) => ({
    signal: s(x?.signal),
    whatItMeans: s(x?.whatItMeans),
    strength: enumOr(x?.strength, STRENGTH, "moderate"),
  }));
}

function normalizeMomTest(arr: any[]): CIMomTestQuestion[] {
  const items = Array.isArray(arr) ? arr.slice(0, 5) : [];
  return items.map((x: any) => ({
    question: s(x?.question),
    whyItWorks: s(x?.whyItWorks),
    antipattern: s(x?.antipattern),
  }));
}

function normalizeBuyingSignals(arr: any[]): CIBuyingSignal[] {
  const items = Array.isArray(arr) ? arr.slice(0, 8) : [];
  return items.map((x: any) => ({
    trigger: s(x?.trigger),
    category: enumOr(x?.category, CATEGORY, "content"),
    urgency: enumOr(x?.urgency, URGENCY, "warming"),
    action: s(x?.action),
  }));
}

function normalizeCommittee(arr: any[]): CIDecisionCommitteeRole[] {
  const items = Array.isArray(arr) ? arr.slice(0, 7) : [];
  return items.map((x: any) => ({
    role: s(x?.role),
    motivation: s(x?.motivation),
    blocker: s(x?.blocker),
    ourPlay: enumOr(x?.ourPlay, OUR_PLAY, "educate"),
    primaryObjection: s(x?.primaryObjection),
  }));
}

function normalizeObjections(arr: any[]): CIObjection[] {
  const items = Array.isArray(arr) ? arr.slice(0, 5) : [];
  return items.map((x: any) => ({
    objection: s(x?.objection),
    frame: enumOr(x?.frame, FRAME, "risk"),
    underlyingFear: s(x?.underlyingFear),
    reframe: s(x?.reframe),
    proofAsset: s(x?.proofAsset),
  }));
}

function normalizeJourney(arr: any[]): CIJourneyStage[] {
  // Coerce to exactly 5 stages in canonical order
  const byStage = new Map<string, any>();
  (Array.isArray(arr) ? arr : []).forEach((x: any) => {
    const st = enumOr(x?.stage, STAGES, "aware");
    if (!byStage.has(st)) byStage.set(st, x);
  });
  return STAGES.map((stage) => {
    const x = byStage.get(stage) ?? {};
    return {
      stage,
      mindset: s(x?.mindset),
      primaryQuestion: s(x?.primaryQuestion),
      channel: s(x?.channel),
      contentAsset: s(x?.contentAsset),
      cta: s(x?.cta),
      exitCriterion: s(x?.exitCriterion),
    };
  });
}

// ============================================================
// Voice-of-Customer step — real search first, paraphrased fallback.
// ============================================================

// Runs after the base pack is generated. Uses persona + pain-point language
// to search for real quotes on review sites, LinkedIn, forums, industry press.
// Falls back to LLM-paraphrased "representative language" when nothing returns.
async function generateVoiceOfCustomer(params: {
  clientName: string;
  industry: string;
  personas: CIPersona[];
  painPoints: CIPainPoint[];
  jtbd: CIJTBD[];
}): Promise<{ quotes: CIVoiceOfCustomer[]; sources: FrameworkSource[]; mode: "real" | "paraphrased" | "mixed" }> {
  const { clientName, industry, personas, painPoints, jtbd } = params;
  const primary = personas.find((p) => p.isPrimary) ?? personas[0];

  // Try real search first if Perplexity is configured
  if (isPerplexityConfigured() && primary) {
    try {
      const topPains = painPoints.slice(0, 3).map((p) => p.label).join(", ");
      const question = `Find 6-10 real, sourced quotes from buyers in the ${industry} sector — ideally ${primary.role}-level buyers at ${primary.orgSize} companies — describing their frustrations, needs, or purchase decisions around: ${topPains}. Prefer G2, Capterra, Reddit, LinkedIn posts, industry publications, or podcast transcripts from 2025-2026. For each quote, include the speaker's role/context and the source URL. Return quotes with themes.`;

      const result = await pplxAsk(question, {
        recency: "year",
        maxTokens: 2500,
      });

      if (result?.answer && result.citations.length > 0) {
        // LLM parse of the Perplexity answer into our schema
        const parsed = await llmJson(
          `You are converting a research answer (with citations) into a structured Voice-of-Customer array. The research answer contains real quotes with speaker context and sources. Group them by theme. Tag each quote to a pain point label or JTBD situation when possible.

Return ONLY a JSON object: { "quotes": [ { "quote": "...", "speaker": "role, org context", "source": "publication or platform", "sourceUrl": "https://...", "isParaphrased": false, "theme": "grouping label", "supportsPain": "pain-point label OR null", "supportsJTBD": "JTBD situation OR null" } ] }

Rules:
- Only include quotes explicitly present in the research answer. Do NOT invent quotes.
- If the answer has fewer than 6 usable quotes, return only what's real — the caller will backfill with paraphrased quotes.
- sourceUrl must be one of the provided citation URLs.
- isParaphrased is false for every quote from real research.`,
          `RESEARCH ANSWER:\n${result.answer}\n\nCITATIONS AVAILABLE:\n${JSON.stringify(result.citations, null, 2)}\n\nPAIN POINT LABELS: ${painPoints.map((p) => p.label).join(" | ")}\n\nJTBD SITUATIONS: ${jtbd.map((j) => j.situation).join(" | ")}`,
          2500,
          {
            type: "object",
            required: ["quotes"],
            properties: { quotes: { type: "array" } },
          },
        );

        const realQuotes: CIVoiceOfCustomer[] = (Array.isArray(parsed?.quotes) ? parsed.quotes : [])
          .slice(0, 10)
          .map((q: any) => ({
            quote: s(q?.quote),
            speaker: s(q?.speaker, "Industry buyer"),
            source: s(q?.source, "Research"),
            sourceUrl: s(q?.sourceUrl) || undefined,
            isParaphrased: false,
            theme: s(q?.theme, "General"),
            supportsPain: s(q?.supportsPain) || undefined,
            supportsJTBD: s(q?.supportsJTBD) || undefined,
          }))
          .filter((q: CIVoiceOfCustomer) => q.quote.length > 10);

        const sources: FrameworkSource[] = result.citations.map((c) => ({
          title: c.title,
          url: c.url,
          publisher: c.publisher,
          date: c.date,
        }));

        // If real search yielded enough, ship as "real"
        if (realQuotes.length >= 6) {
          return { quotes: realQuotes.slice(0, 10), sources, mode: "real" };
        }

        // Partial — backfill with paraphrased
        const need = Math.min(10, Math.max(6, realQuotes.length + 4)) - realQuotes.length;
        if (need > 0) {
          const paraphrased = await generateParaphrasedVoC({
            clientName,
            industry,
            personas,
            painPoints,
            jtbd,
            count: need,
          });
          return {
            quotes: [...realQuotes, ...paraphrased].slice(0, 10),
            sources,
            mode: "mixed",
          };
        }

        return { quotes: realQuotes, sources, mode: "real" };
      }
    } catch (err) {
      console.error("[ci.voc] real search failed, falling back to paraphrased:", err);
    }
  }

  // Full paraphrased fallback
  const paraphrased = await generateParaphrasedVoC({
    clientName,
    industry,
    personas,
    painPoints,
    jtbd,
    count: 8,
  });
  return { quotes: paraphrased, sources: [], mode: "paraphrased" };
}

async function generateParaphrasedVoC(params: {
  clientName: string;
  industry: string;
  personas: CIPersona[];
  painPoints: CIPainPoint[];
  jtbd: CIJTBD[];
  count: number;
}): Promise<CIVoiceOfCustomer[]> {
  const { industry, personas, painPoints, jtbd, count } = params;
  const primary = personas.find((p) => p.isPrimary) ?? personas[0];

  const raw = await llmJson(
    `You are producing REPRESENTATIVE LANGUAGE — paraphrased quotes that capture how buyers in this segment talk about the pain points and jobs-to-be-done listed below. These are NOT real quotes and MUST be labeled as such.

Return ONLY a JSON object: { "quotes": [ { "quote": "...", "speaker": "role, org context", "theme": "grouping label", "supportsPain": "pain-point label OR null", "supportsJTBD": "JTBD situation OR null" } ] }

Rules:
- Each quote should sound like something a real buyer would say in a review or discussion — specific, textured, sometimes frustrated.
- Speaker context should reference the persona role (${primary?.role ?? "buyer"}) and a plausible org size.
- Group quotes across 3-4 themes. Tag pain/JTBD when the quote clearly maps.
- Return exactly ${count} quotes.`,
    `INDUSTRY: ${industry}\nPRIMARY PERSONA: ${JSON.stringify(primary)}\n\nPAIN POINTS:\n${JSON.stringify(painPoints)}\n\nJTBD:\n${JSON.stringify(jtbd)}`,
    2500,
    {
      type: "object",
      required: ["quotes"],
      properties: { quotes: { type: "array" } },
    },
  );

  return (Array.isArray(raw?.quotes) ? raw.quotes : [])
    .slice(0, count)
    .map((q: any) => ({
      quote: s(q?.quote),
      speaker: s(q?.speaker, `${primary?.role ?? "Buyer"}, mid-market`),
      source: "Representative language",
      sourceUrl: undefined,
      isParaphrased: true,
      theme: s(q?.theme, "General"),
      supportsPain: s(q?.supportsPain) || undefined,
      supportsJTBD: s(q?.supportsJTBD) || undefined,
    }))
    .filter((q: CIVoiceOfCustomer) => q.quote.length > 10);
}

// ============================================================
// Main entry point
// ============================================================

export async function generateCustomerInsights(params: {
  clientName: string;
  industry: string | null;
  extraction: Extraction;
  competitors: Competitor[];
  notes?: string | null;
  brexContext?: boolean; // true when Atlas is being run for a Brex prospect
}): Promise<CustomerInsights> {
  const { clientName, industry, extraction, competitors, notes, brexContext } = params;

  const user = `Client: ${clientName}
Self-reported industry (may be blank): ${industry ?? ""}
Context: ${brexContext ? "This analysis is being run for a Brex prospect — ourLeverage and journeyStages CTAs should reference Brex offers (Growth Excavation Report, Fractional CMO retainer)." : "This analysis is being run for a client's own marketing plan — ourLeverage and CTAs should reference the client's own offers listed in the extraction."}
Notes: ${notes ?? ""}

EXTRACTION (from client's website):
${JSON.stringify(extraction).slice(0, 6000)}

COMPETITOR SET:
${JSON.stringify(competitors).slice(0, 4000)}`;

  const raw = await llmJson(SYS_CI, user, 7500, SCHEMA_CI);

  // Normalize the base pack
  const personas = normalizePersonas(raw?.personas);
  const painPoints = normalizePainPoints(raw?.painPoints);
  const jtbd = normalizeJTBD(raw?.jtbd);
  const industryOut = s(raw?.industry, industry ?? "General B2B");

  // Generate VoC as a separate step (real search + fallback)
  const voc = await generateVoiceOfCustomer({
    clientName,
    industry: industryOut,
    personas,
    painPoints,
    jtbd,
  }).catch((err) => {
    console.error("[ci.voc] fatal, shipping empty VoC:", err);
    return { quotes: [], sources: [], mode: "paraphrased" as const };
  });

  const insights: CustomerInsights = {
    industry: industryOut,
    personas,
    psychographics: normalizePsychographics(raw?.psychographics),
    sociotype: normalizeSociotype(raw?.sociotype),
    painPoints,
    jtbd,
    voiceOfCustomer: voc.quotes,
    wouldTheyBuySignals: normalizeWouldTheyBuy(raw?.wouldTheyBuySignals),
    momTestQuestions: normalizeMomTest(raw?.momTestQuestions),
    buyingSignals: normalizeBuyingSignals(raw?.buyingSignals),
    decisionCommittee: normalizeCommittee(raw?.decisionCommittee),
    objections: normalizeObjections(raw?.objections),
    journeyStages: normalizeJourney(raw?.journeyStages),
    summary: s(raw?.summary),
    vocSources: voc.sources,
    vocEvidenceMode: voc.mode,
  };

  // Guarantee a summary: LLMs sometimes drop this field silently even when
  // the schema requires it. If empty, synthesize a 2-3 sentence executive read
  // from the top persona + top pain + top JTBD + top buying signal so downstream
  // consumers (strategy.icp.summary via Option A merge, PDF cover, PPTX overview)
  // never render blank.
  if (!insights.summary || insights.summary.length < 20) {
    insights.summary = synthesizeSummary(insights);
  }

  return insights;
}

/**
 * Fallback executive read built from the pack's own top-ranked items when the
 * generator returns an empty summary. Two sentences: who + what they're stuck on,
 * then what triggers a buy.
 */
function synthesizeSummary(ci: CustomerInsights): string {
  const topPersona = ci.personas?.[0];
  const topPain = ci.painPoints?.[0];
  const topJTBD = ci.jtbd?.[0];
  const topSignal = ci.buyingSignals?.find((b) => b.urgency === "hot" || b.urgency === "in-market") ?? ci.buyingSignals?.[0];

  const who = topPersona
    ? `${topPersona.role || "The primary buyer"}${topPersona.orgSize ? ` at a ${topPersona.orgSize} ${topPersona.industry || ""}`.trim().replace(/\s+$/, "") + " firm" : ""}`
    : "The primary buyer";

  const painClause = topPain?.label
    ? ` is stuck on ${topPain.label.replace(/\.$/, "").toLowerCase()}`
    : " faces friction that keeps deals from closing";

  const jtbdClause = topJTBD?.motivation
    ? ` — they want to ${String(topJTBD.motivation).replace(/^i want to\s+/i, "").replace(/\.$/, "").toLowerCase()}`
    : "";

  const s1 = `${who}${painClause}${jtbdClause}.`;

  const s2 = topSignal?.trigger
    ? `The buying window opens when ${String(topSignal.trigger).replace(/\.$/, "").toLowerCase()} — that is where outreach and content should land.`
    : `Outreach that names their specific pain and shows a fast, low-risk first step consistently outperforms broad brand plays.`;

  return `${s1} ${s2}`;
}
