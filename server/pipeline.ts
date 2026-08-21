import { storage } from "./storage";
import { llmJson } from "./llm";

// ------------ Utilities ------------

async function fetchSite(url: string): Promise<{ url: string; html: string; textSummary: string; }> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
    // 15s soft timeout via AbortSignal
    signal: AbortSignal.timeout(15000),
  });
  const html = await res.text();
  const textSummary = htmlToText(html).slice(0, 18000);
  return { url, html, textSummary };
}

function htmlToText(html: string): string {
  // Strip script/style, tags, collapse whitespace. Cheap but works for LLM ingestion.
  const noScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ");
  // Keep meta descriptions as visible text
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
    // Stage 1: Extract client website
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
    );

    await storage.updateAnalysis(id, {
      progress: 35,
      currentStep: "Identifying competitors",
      status: "competitors",
      extraction: JSON.stringify(extraction),
    });

    // Stage 2: Competitor teardown (LLM synthesizes based on positioning; fast + no external APIs required for MVP)
    const competitors = await llmJson(
      SYS_COMPETITORS,
      `Client name: ${record.clientName}\nClient URL: ${record.clientUrl}\nClient extraction (JSON):\n${JSON.stringify(extraction).slice(0, 6000)}`,
      3500,
    );

    await storage.updateAnalysis(id, {
      progress: 60,
      currentStep: "Building strategy & recommendations",
      status: "strategy",
      competitors: JSON.stringify(competitors),
    });

    // Stage 3: Strategy
    const strategy = await llmJson(
      SYS_STRATEGY,
      `Client: ${record.clientName}\nGoals: ${record.goals ?? "(not specified)"}\nRevenue band: ${record.revenueBand ?? "(not specified)"}\nBudget band: ${record.budgetBand ?? "(not specified)"}\n\nEXTRACTION:\n${JSON.stringify(extraction).slice(0, 5000)}\n\nCOMPETITORS:\n${JSON.stringify(competitors).slice(0, 5000)}`,
      12000,
    );

    await storage.updateAnalysis(id, {
      progress: 85,
      currentStep: "Assembling scope of work",
      status: "sow",
      strategy: JSON.stringify(strategy),
    });

    // Stage 4: Scope of Work
    const sow = await llmJson(
      SYS_SOW,
      `Client: ${record.clientName}\nBudget band: ${record.budgetBand ?? "(not specified)"}\nRevenue band: ${record.revenueBand ?? "(not specified)"}\n\nSTRATEGY:\n${JSON.stringify(strategy).slice(0, 6000)}`,
      10000,
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
  "valueProps": ["string", ...],   // 3-6 stated value propositions found on-site
  "offerings": ["string", ...],    // products/services/packages the site presents
  "targetAudience": "string — who the site is written for, in ICP terms",
  "evidenceElements": ["string", ...],  // logos, testimonials, case studies, certifications, awards found on-site (or 'none visible' items)
  "ctaAudit": "string — 2-3 sentences on primary CTAs, friction, and clarity",
  "seoNotes": "string — observations on SEO fundamentals from what's visible (titles, structure, keywords)",
  "aeoReadinessScore": 0,   // integer 0-100 — how ready is this site to be cited by AI answer engines (Perplexity, ChatGPT, Google AI Overviews)? Consider: clear entity definitions, FAQ presence, schema hints, distinct claims, comparison content
  "aeoReadinessNotes": "string — 2-3 sentences justifying the score with concrete observations"
}`;

const SYS_COMPETITORS = `You are a senior competitive strategist. Given a client's positioning and offerings, identify the 4 most relevant competitors — real, named companies in the same category. Be specific with real company names. Do not invent generic placeholders.

Return ONLY valid JSON — an array of 4 objects:
[
  {
    "name": "Real company name",
    "url": "https://likely-official-domain.com",
    "positioning": "1-2 sentence positioning summary based on what you know of this company",
    "strengths": ["string", "string", "string"],
    "weaknesses": ["string", "string", "string"],
    "hookIdeas": ["string", "string"]   // paid-ad hook angles the client could use to steal share from this competitor
  }
]

Rules:
- Use real, well-known competitors. If the client is a small regional player, choose real category leaders and peers.
- URLs must be your best guess at the real official domain.
- Hooks should be specific and provocative, not generic ("Better software" is not a hook).`;

const SYS_STRATEGY = `You are Kenneth Peavy, Senior Fractional CMO at Brex Consulting. You apply the Big Rock Method: pick a small number of high-leverage moves and execute them relentlessly. Given a client's extraction and competitor set, produce a strategy.

Return ONLY valid JSON:
{
  "icp": {
    "summary": "string — 2-3 sentences describing the ideal customer profile",
    "firmographics": ["string", ...],
    "painPoints": ["string", ...],
    "buyingTriggers": ["string", ...]
  },
  "positioningGaps": ["string", ...],   // 3-5 sharp gaps between client's current site and where the market is going
  "messagingRecommendations": ["string", ...],   // 4-6 concrete messaging shifts, including proposed headlines
  "aeoRecommendations": ["string", ...],   // 4-6 concrete moves to become citable by AI answer engines
  "contentPillars": [
    { "name": "Pillar name", "description": "why this pillar", "sampleTitles": ["title 1", "title 2", "title 3"] }
    // 3 pillars total
  ],
  "channelMix": [
    { "channel": "LinkedIn Ads | Google Search | SEO/AEO Content | Webinars | Email | Organic Social | ABM | ...", "role": "why this channel for this ICP", "priority": "High | Medium | Low" }
    // 5-7 channels
  ],
  "quickWins": ["string", ...],   // 5 things that could be shipped in the next 30 days
  "ninetyDayPlan": [
    { "phase": "Foundation", "weeks": "Weeks 1-4", "focus": "string", "outcomes": ["string", ...] },
    { "phase": "Acceleration", "weeks": "Weeks 5-8", "focus": "string", "outcomes": ["string", ...] },
    { "phase": "Scale", "weeks": "Weeks 9-12", "focus": "string", "outcomes": ["string", ...] }
  ]
}`;

const SYS_SOW = `You are Kenneth Peavy at Brex Consulting building a professional Scope of Work. It must feel like a real fractional CMO engagement — modular, priced in tiers, with clear phase deliverables.

Return ONLY valid JSON:
{
  "engagementSummary": "string — 3-5 sentence executive summary of the engagement",
  "phases": [
    { "name": "string", "weeks": "e.g. Weeks 1-4", "deliverables": ["string", ...], "outcomes": ["string", ...] }
    // 3-4 phases
  ],
  "team": ["Senior Fractional CMO (Kenneth Peavy) — 10 hrs/wk", "..."],   // 3-5 team roles with hours
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
- Scale: $22,500 - $35,000/mo
Adjust based on the client's revenue band and stated budget. If budget is low, weight Foundation heavier. If budget is high or revenue is $20M+, weight Scale.`;
