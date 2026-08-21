import { storage } from "./storage";
import { llmJson, SCHEMA_EXTRACT, SCHEMA_COMPETITORS, SCHEMA_STRATEGY, SCHEMA_SOW } from "./llm";

// ------------ Utilities ------------

async function fetchSite(url: string): Promise<{ url: string; html: string; textSummary: string; }> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(15000),
  });
  const html = await res.text();
  const textSummary = htmlToText(html).slice(0, 18000);
  return { url, html, textSummary };
}

function htmlToText(html: string): string {
  const noScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ");
  const withMeta = noScripts.replace(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/gi,
    " META_DESCRIPTION: $1 ",
  );
  const text = withMeta.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text;
}

// ------------ Pipeline stages ------------

export async function runPipeline(id: string) {
  const record = await storage.getAnalysis(id);
  if (!record) return;

  try {
    await storage.updateAnalysis(id, {
      status: "extracting",
      progress: 10,
      currentStep: "Analyzing client website",
    });

    const site = await fetchSite(record.clientUrl);
    const extraction = await llmJson(
      SYS_EXTRACT,
      `Client name: ${record.clientName}\nClient URL: ${record.clientUrl}\nIndustry (self-reported, may be blank): ${record.industry ?? ""}\nStated goals: ${record.goals ?? ""}\n\n=== WEBSITE TEXT ===\n${site.textSummary}`,
      3500,
      SCHEMA_EXTRACT,
    );

    await storage.updateAnalysis(id, {
      progress: 35,
      currentStep: "Identifying competitors",
      status: "competitors",
      extraction: JSON.stringify(extraction),
    });

    const competitorsResp = await llmJson(
      SYS_COMPETITORS,
      `Client name: ${record.clientName}\nClient URL: ${record.clientUrl}\nClient extraction (JSON):\n${JSON.stringify(extraction).slice(0, 6000)}`,
      3500,
      SCHEMA_COMPETITORS,
    );
    const competitors = Array.isArray(competitorsResp?.competitors)
      ? competitorsResp.competitors
      : competitorsResp;

    await storage.updateAnalysis(id, {
      progress: 60,
      currentStep: "Building strategy & recommendations",
      status: "strategy",
      competitors: JSON.stringify(competitors),
    });

    const strategy = await llmJson(
      SYS_STRATEGY,
      `Client: ${record.clientName}\nGoals: ${record.goals ?? "(not specified)"}\nRevenue band: ${record.revenueBand ?? "(not specified)"}\nBudget band: ${record.budgetBand ?? "(not specified)"}\n\nEXTRACTION:\n${JSON.stringify(extraction).slice(0, 5000)}\n\nCOMPETITORS:\n${JSON.stringify(competitors).slice(0, 5000)}`,
      12000,
      SCHEMA_STRATEGY,
    );

    await storage.updateAnalysis(id, {
      progress: 85,
      currentStep: "Assembling scope of work",
      status: "sow",
      strategy: JSON.stringify(strategy),
    });

    const sow = await llmJson(
      SYS_SOW,
      `Client: ${record.clientName}\nBudget band: ${record.budgetBand ?? "(not specified)"}\nRevenue band: ${record.revenueBand ?? "(not specified)"}\n\nSTRATEGY:\n${JSON.stringify(strategy).slice(0, 6000)}`,
      10000,
      SCHEMA_SOW,
    );

    await storage.updateAnalysis(id, {
      progress: 100,
      currentStep: "Complete",
      status: "done",
      sow: JSON.stringify(sow),
    });
  } catch (err: any) {
    console.error("[pipeline] error", err);
    await storage.updateAnalysis(id, {
      status: "error",
      errorMessage: String(err?.message ?? err),
    });
  }
}

// ------------ Prompts ------------

const SYS_EXTRACT = `You are a senior fractional CMO analyst for Brex Consulting (Big Rock Method). You will receive raw text extracted from a client's website. Produce a rigorous positioning analysis.

Return ONLY valid JSON matching this exact schema — no prose, no markdown:
{
  "title": "string — the site's primary H1 or brand hero line",
  "description": "string — 1-2 sentence summary of what the company does",
  "positioningStatement": "string — the company's current implied positioning (be honest — 'unclear' is a valid answer)",
  "valueProps": ["string", ...],
  "offerings": ["string", ...],
  "targetAudience": "string — who the site is written for, in ICP terms",
  "evidenceElements": ["string", ...],
  "ctaAudit": "string — 2-3 sentences on primary CTAs, friction, and clarity",
  "seoNotes": "string — observations on SEO fundamentals from what's visible",
  "aeoReadinessScore": 0,
  "aeoReadinessNotes": "string — 2-3 sentences justifying the score"
}`;

const SYS_COMPETITORS = `You are a senior competitive strategist. Given a client's positioning and offerings, identify the 4 most relevant competitors — real, named companies in the same category. Be specific with real company names. Do not invent generic placeholders.

Return ONLY valid JSON — an object with a "competitors" array of 4 objects:
{
  "competitors": [
    {
      "name": "Real company name",
      "url": "https://likely-official-domain.com",
      "positioning": "1-2 sentence positioning summary",
      "strengths": ["string", "string", "string"],
      "weaknesses": ["string", "string", "string"],
      "hookIdeas": ["string", "string"]
    }
  ]
}

Rules:
- Use real, well-known competitors. If the client is a small regional player, choose real category leaders and peers.
- URLs must be your best guess at the real official domain.
- Hooks should be specific and provocative, not generic.`;

const SYS_STRATEGY = `You are Kenneth Peavy, Senior Fractional CMO at Brex Consulting. You apply the Big Rock Method: pick a small number of high-leverage moves and execute them relentlessly. Given a client's extraction and competitor set, produce a strategy.

Return ONLY valid JSON with these top-level fields — positioning, priorities, plan — plus the details below:
{
  "positioning": "string — the recommended positioning statement",
  "priorities": ["string", ...],
  "plan": ["string", ...],
  "icp": {
    "summary": "string",
    "firmographics": ["string", ...],
    "painPoints": ["string", ...],
    "buyingTriggers": ["string", ...]
  },
  "positioningGaps": ["string", ...],
  "messagingRecommendations": ["string", ...],
  "aeoRecommendations": ["string", ...],
  "contentPillars": [
    { "name": "Pillar name", "description": "why this pillar", "sampleTitles": ["title 1", "title 2", "title 3"] }
  ],
  "channelMix": [
    { "channel": "string", "role": "string", "priority": "High | Medium | Low" }
  ],
  "quickWins": ["string", ...],
  "ninetyDayPlan": [
    { "phase": "Foundation", "weeks": "Weeks 1-4", "focus": "string", "outcomes": ["string", ...] },
    { "phase": "Acceleration", "weeks": "Weeks 5-8", "focus": "string", "outcomes": ["string", ...] },
    { "phase": "Scale", "weeks": "Weeks 9-12", "focus": "string", "outcomes": ["string", ...] }
  ]
}`;

const SYS_SOW = `You are Kenneth Peavy at Brex Consulting building a professional Scope of Work. It must feel like a real fractional CMO engagement — modular, priced in tiers, with clear phase deliverables.

Return ONLY valid JSON with a title and sections plus full engagement details:
{
  "title": "string — the SoW title, e.g. 'Fractional CMO Engagement — [Client]'",
  "sections": ["string", ...],
  "engagementSummary": "string — 3-5 sentence executive summary",
  "phases": [
    { "name": "string", "weeks": "e.g. Weeks 1-4", "deliverables": ["string", ...], "outcomes": ["string", ...] }
  ],
  "team": ["Senior Fractional CMO (Kenneth Peavy) — 10 hrs/wk", "..."],
  "priceTiers": [
    { "name": "Foundation", "monthly": "$X,XXX/mo", "inclusions": ["string", ...], "bestFor": "string" },
    { "name": "Growth", "monthly": "$X,XXX/mo", "inclusions": ["string", ...], "bestFor": "string" },
    { "name": "Scale", "monthly": "$X,XXX/mo", "inclusions": ["string", ...], "bestFor": "string" }
  ],
  "termsNotes": ["3-month minimum engagement", "Monthly retainer, invoiced in advance", "..."]
}

Pricing guidance for a US mid-market fractional CMO engagement:
- Foundation: $6,500 - $9,500/mo
- Growth: $12,500 - $18,500/mo
- Scale: $22,500 - $35,000/mo`;
