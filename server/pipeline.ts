import { storage } from "./storage";
import { llmJson, SCHEMA_EXTRACT, SCHEMA_COMPETITORS, SCHEMA_STRATEGY, SCHEMA_SOW } from "./llm";
import { generateSwot } from "./swot";
import { generatePestel } from "./pestel";
import { generatePorters } from "./porters";
import { injectRationale } from "./rationale";
import type { SwotAnalysis, PestelAnalysis, PortersFiveForces, Strategy, SOW, Extraction, Competitor, Assumptions } from "@shared/schema";

// Format the assumptions blob into a bracketed prompt block. Empty/null yields "".
// Called from every LLM stage so the model grounds outputs in prospect reality.
function formatAssumptions(raw: unknown): string {
  if (!raw) return "";
  let a: Partial<Assumptions>;
  try {
    a = typeof raw === "string" ? JSON.parse(raw) : (raw as Partial<Assumptions>);
  } catch {
    return "";
  }
  if (!a || typeof a !== "object") return "";
  const rows: string[] = [];
  const fmtUsd = (n: number) => n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `$${(n / 1_000).toFixed(0)}K` : `$${n}`;
  if (a.currentAnnualRevenue) rows.push(`- Current annual revenue: ${fmtUsd(a.currentAnnualRevenue)}`);
  if (a.currentMarketingBudget) rows.push(`- Current annual marketing budget: ${fmtUsd(a.currentMarketingBudget)}`);
  if (a.grossMarginPct != null) rows.push(`- Gross margin: ${a.grossMarginPct}%`);
  if (a.revenueGrowthTargetPct != null) rows.push(`- Revenue growth target (next 12 mo): ${a.revenueGrowthTargetPct}%`);
  if (a.topCompetitors) rows.push(`- Top competitors named by client: ${a.topCompetitors}`);
  if (a.preferredTier && a.preferredTier !== "unknown") rows.push(`- Client's preferred engagement tier: ${a.preferredTier} (Advisor=17% / Strategist=24% / Fractional=32% bundle discount)`);
  if (rows.length === 0) return "";
  return `\n\n=== CLIENT-PROVIDED ASSUMPTIONS (ground your ROI math, growth targets, and tier recommendations in these) ===\n${rows.join("\n")}\n`;
}

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
    const assumptionsBlock = formatAssumptions((record as any).assumptions);
    const extraction = await llmJson(
      SYS_EXTRACT,
      `Client name: ${record.clientName}\nClient URL: ${record.clientUrl}\nIndustry (self-reported, may be blank): ${record.industry ?? ""}\nStated goals: ${record.goals ?? ""}${assumptionsBlock}\n\n=== WEBSITE TEXT ===\n${site.textSummary}`,
      3500,
      SCHEMA_EXTRACT,
    );

    await storage.updateAnalysis(id, {
      progress: 35,
      currentStep: "Identifying competitors",
      status: "competitors",
      extraction: JSON.stringify(extraction),
    });

    // Stage 2: Competitor teardown (LLM synthesizes based on positioning; fast + no external APIs required for MVP)
    const competitorsResp = await llmJson(
      SYS_COMPETITORS,
      `Client name: ${record.clientName}\nClient URL: ${record.clientUrl}\nClient extraction (JSON):\n${JSON.stringify(extraction).slice(0, 6000)}`,
      3500,
      SCHEMA_COMPETITORS,
    );
    // competitorsResp is {competitors: [...]}, but downstream code and storage
    // expect an array. Unwrap.
    const competitors = Array.isArray(competitorsResp?.competitors)
      ? competitorsResp.competitors
      : competitorsResp;

    await storage.updateAnalysis(id, {
      progress: 60,
      currentStep: "Building strategy & recommendations",
      status: "strategy",
      competitors: JSON.stringify(competitors),
    });

    // Stage 3: Strategy — assumptions grounding is CRITICAL here for ROI math
    const strategy = await llmJson(
      SYS_STRATEGY,
      `Client: ${record.clientName}\nGoals: ${record.goals ?? "(not specified)"}\nRevenue band: ${record.revenueBand ?? "(not specified)"}\nBudget band: ${record.budgetBand ?? "(not specified)"}${assumptionsBlock}\n\nEXTRACTION:\n${JSON.stringify(extraction).slice(0, 5000)}\n\nCOMPETITORS:\n${JSON.stringify(competitors).slice(0, 5000)}`,
      12000,
      SCHEMA_STRATEGY,
    );

    await storage.updateAnalysis(id, {
      progress: 85,
      currentStep: "Assembling scope of work",
      status: "sow",
      strategy: JSON.stringify(strategy),
    });

    // Stage 4: Scope of Work — tier preference from assumptions steers tier recommendation
    const sow = await llmJson(
      SYS_SOW,
      `Client: ${record.clientName}\nBudget band: ${record.budgetBand ?? "(not specified)"}\nRevenue band: ${record.revenueBand ?? "(not specified)"}${assumptionsBlock}\n\nSTRATEGY:\n${JSON.stringify(strategy).slice(0, 6000)}`,
      10000,
      SCHEMA_SOW,
    );

    await storage.updateAnalysis(id, {
      progress: 90,
      currentStep: "Running strategic frameworks",
      status: "frameworks",
      sow: JSON.stringify(sow),
    });

    // Stage 5: Strategic frameworks (SWOT always; PESTEL/Porter's opt-in)
    let swotResult: SwotAnalysis | null = null;
    let pestelResult: PestelAnalysis | null = null;
    let portersResult: PortersFiveForces | null = null;

    try {
      // SWOT always runs — fast and free
      swotResult = await generateSwot({
        clientName: record.clientName,
        industry: record.industry,
        extraction: extraction as Extraction,
        competitors: competitors as Competitor[],
        notes: [record.notes, assumptionsBlock].filter(Boolean).join("\n\n"),
      });

      // Infer industry from SWOT (which infers from extraction) for PESTEL/Porter's
      const industry = record.industry || swotResult.industry || "General B2B";

      const wantsPestel = (record as any).includePestel === 1 || (record as any).includePestel === true;
      const wantsPorters = (record as any).includePorters === 1 || (record as any).includePorters === true;

      // Run PESTEL + Porter's in parallel if opted in
      const [pestelR, portersR] = await Promise.all([
        wantsPestel
          ? generatePestel({ clientName: record.clientName, industry }).catch((err) => {
              console.error("[pestel] failed:", err);
              return null;
            })
          : Promise.resolve(null),
        wantsPorters
          ? generatePorters({
              clientName: record.clientName,
              industry,
              competitors: competitors as Competitor[],
            }).catch((err) => {
              console.error("[porters] failed:", err);
              return null;
            })
          : Promise.resolve(null),
      ]);
      pestelResult = pestelR;
      portersResult = portersR;

      // Inject strategic rationale into the strategy + SOW
      const withRationale = await injectRationale({
        strategy: strategy as Strategy,
        sow: sow as SOW,
        swot: swotResult,
        pestel: pestelResult,
        porters: portersResult,
      }).catch((err) => {
        console.error("[rationale] failed:", err);
        return { strategy: strategy as Strategy, sow: sow as SOW };
      });

      await storage.updateAnalysis(id, {
        progress: 100,
        currentStep: "Complete",
        status: "done",
        strategy: JSON.stringify(withRationale.strategy),
        sow: JSON.stringify(withRationale.sow),
        swot: JSON.stringify(swotResult),
        pestel: pestelResult ? JSON.stringify(pestelResult) : null,
        porters: portersResult ? JSON.stringify(portersResult) : null,
      } as any);
    } catch (frameworksErr: any) {
      // Framework failure is non-fatal — the core analysis is still complete
      console.error("[frameworks] non-fatal error:", frameworksErr);
      await storage.updateAnalysis(id, {
        progress: 100,
        currentStep: "Complete (frameworks partial)",
        status: "done",
        swot: swotResult ? JSON.stringify(swotResult) : null,
        pestel: pestelResult ? JSON.stringify(pestelResult) : null,
        porters: portersResult ? JSON.stringify(portersResult) : null,
      } as any);
    }
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
