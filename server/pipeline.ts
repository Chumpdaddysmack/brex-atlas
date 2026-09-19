import { storage } from "./storage";
import { llmJson, retryFillExtraction, SCHEMA_EXTRACT, SCHEMA_COMPETITORS, SCHEMA_STRATEGY, SCHEMA_SOW } from "./llm";
import { generateSwot } from "./swot";
import { generatePestel } from "./pestel";
import { generatePorters } from "./porters";
import { generateCustomerInsights } from "./customer-insights";
import { injectRationale } from "./rationale";
import type { SwotAnalysis, PestelAnalysis, PortersFiveForces, CustomerInsights, Strategy, SOW, Extraction, Competitor, Assumptions } from "@shared/schema";

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

// URL candidate expansion: try user-provided form first, then www./naked variants.
// Handles the common case where a user pastes example.com but only www.example.com
// resolves (or vice versa), and cheaply protects against protocol-less input.
function siteCandidates(raw: string): string[] {
  let base = (raw || "").trim();
  if (!base) return [];
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  const out = new Set<string>([base]);
  try {
    const u = new URL(base);
    const host = u.hostname;
    const swap = host.startsWith("www.") ? host.slice(4) : `www.${host}`;
    const alt = new URL(base);
    alt.hostname = swap;
    out.add(alt.toString());
    // Also try http:// as a last resort — some legacy sites redirect only on http
    if (u.protocol === "https:") {
      const httpAlt = new URL(base);
      httpAlt.protocol = "http:";
      out.add(httpAlt.toString());
    }
  } catch {
    // fall through — the single candidate will still be tried
  }
  return Array.from(out);
}

async function fetchSiteOnce(url: string, timeoutMs: number): Promise<{ url: string; html: string }> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const html = await res.text();
  return { url: res.url || url, html };
}

async function fetchSite(url: string): Promise<{ url: string; html: string; textSummary: string; }> {
  const candidates = siteCandidates(url);
  const errors: string[] = [];
  // Try each candidate up to 2 times with a small backoff and a 25s timeout.
  // International hops (e.g., US Railway → TW Apache) occasionally drop the
  // first SYN; one retry with a fresh connection almost always succeeds.
  for (const candidate of candidates) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { url: finalUrl, html } = await fetchSiteOnce(candidate, 25000);
        const textSummary = htmlToText(html).slice(0, 18000);
        return { url: finalUrl, html, textSummary };
      } catch (err: any) {
        const label = `${candidate} (attempt ${attempt + 1})`;
        const msg = err?.message || String(err);
        errors.push(`${label}: ${msg}`);
        console.warn(`[fetchSite] ${label} failed: ${msg}`);
        if (attempt === 0) await new Promise((r) => setTimeout(r, 1200));
      }
    }
  }
  throw new Error(`Website fetch failed for ${url}. Tried: ${errors.join(" | ")}`);
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

    // Retry-fill missing/empty valueProps + evidenceElements. The primary
    // SYS_EXTRACT call occasionally returns objects where these arrays are
    // absent (proxy fallback text-path truncation) or empty (model played it
    // safe). A targeted second pass with narrower prompting recovers real
    // content in the former case and returns explicit "None visible" strings
    // in the latter — either outcome is materially better than a blank
    // section in the pitch UI. Cheap (~$0.02/plan), non-fatal on failure.
    const vpMissing = !Array.isArray(extraction?.valueProps) || extraction.valueProps.length === 0;
    const evMissing = !Array.isArray(extraction?.evidenceElements) || extraction.evidenceElements.length === 0;
    if (vpMissing || evMissing) {
      console.warn(
        `[pipeline] extraction incomplete for ${record.clientName}: vpMissing=${vpMissing} evMissing=${evMissing}. Running retry-fill.`,
      );
      const refill = await retryFillExtraction({
        clientName: record.clientName,
        clientUrl: record.clientUrl,
        siteText: site.textSummary,
        needsValueProps: vpMissing,
        needsEvidence: evMissing,
      });
      if (refill?.valueProps && vpMissing) (extraction as any).valueProps = refill.valueProps;
      if (refill?.evidenceElements && evMissing) (extraction as any).evidenceElements = refill.evidenceElements;
    }

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

    // Stage 5: Strategic frameworks (SWOT always; PESTEL/Porter's/CI opt-in)
    // Each generator runs in its OWN try/catch so one failure never wipes
    // out siblings — this fixes the empty-Frameworks-tab bug that hit when
    // SWOT threw before PESTEL/Porter's/CI could start.
    let swotResult: SwotAnalysis | null = null;
    let pestelResult: PestelAnalysis | null = null;
    let portersResult: PortersFiveForces | null = null;
    let ciResult: CustomerInsights | null = null;
    const frameworkErrors: string[] = [];

    try {
      swotResult = await generateSwot({
        clientName: record.clientName,
        industry: record.industry,
        extraction: extraction as Extraction,
        competitors: competitors as Competitor[],
        notes: [record.notes, assumptionsBlock].filter(Boolean).join("\n\n"),
      });
    } catch (err: any) {
      console.error("[swot] failed:", err);
      frameworkErrors.push(`SWOT: ${String(err?.message ?? err).slice(0, 200)}`);
    }

    // Infer industry from SWOT (which infers from extraction) for PESTEL/Porter's;
    // fall back to record.industry or generic when SWOT failed.
    const industry = record.industry || swotResult?.industry || "General B2B";

    const wantsPestel = (record as any).includePestel === 1 || (record as any).includePestel === true;
    const wantsPorters = (record as any).includePorters === 1 || (record as any).includePorters === true;
    const wantsCI = (record as any).includeCustomerInsights === 1 || (record as any).includeCustomerInsights === true;

    // Run PESTEL + Porter's + Customer Insights in parallel if opted in.
    // Independent of SWOT so a SWOT outage never blocks these.
    const [pestelR, portersR, ciR] = await Promise.all([
      wantsPestel
        ? generatePestel({ clientName: record.clientName, industry }).catch((err) => {
            console.error("[pestel] failed:", err);
            frameworkErrors.push(`PESTEL: ${String(err?.message ?? err).slice(0, 200)}`);
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
            frameworkErrors.push(`Porter's: ${String(err?.message ?? err).slice(0, 200)}`);
            return null;
          })
        : Promise.resolve(null),
      wantsCI
        ? generateCustomerInsights({
            clientName: record.clientName,
            industry,
            extraction: extraction as Extraction,
            competitors: competitors as Competitor[],
            notes: record.notes,
            // Brex-specific offers surface when the analysis is being run FOR Brex.
            // Default false so client-facing runs cite the client's own offers.
            brexContext: false,
          }).catch((err) => {
            console.error("[customer-insights] failed:", err);
            frameworkErrors.push(`Customer Insights: ${String(err?.message ?? err).slice(0, 200)}`);
            return null;
          })
        : Promise.resolve(null),
    ]);
    pestelResult = pestelR;
    portersResult = portersR;
    ciResult = ciR;

    // If Customer Insights ran, tighten strategy.icp to a 2-3 line summary
    // (Option A upgrade — the deep pack becomes the authoritative buyer layer).
    if (ciResult) {
      const s = strategy as Strategy;
      if (s?.icp) {
        s.icp.summary = ciResult.summary || s.icp.summary;
        // Preserve firmographics from strategy; pain/triggers now live in CI
        // but keep 1-liner arrays for legacy PDF/PPTX sections that read them.
        s.icp.painPoints = ciResult.painPoints.slice(0, 5).map((p) => p.label);
        s.icp.buyingTriggers = ciResult.buyingSignals
          .filter((b) => b.urgency === "hot" || b.urgency === "in-market")
          .slice(0, 5)
          .map((b) => b.trigger);
      }
    }

    // Inject strategic rationale into the strategy + SOW.
    // Uses whatever frameworks succeeded; missing ones simply aren't referenced.
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

    // Determine terminal status. "Complete" only when every REQUESTED framework
    // succeeded. Partial state is called out so the UI can offer a Retry button.
    const missing: string[] = [];
    if (!swotResult) missing.push("SWOT");
    if (wantsPestel && !pestelResult) missing.push("PESTEL");
    if (wantsPorters && !portersResult) missing.push("Porter's");
    if (wantsCI && !ciResult) missing.push("Customer Insights");

    const finalStep =
      missing.length === 0
        ? "Complete"
        : `Complete (frameworks partial — retry: ${missing.join(", ")})`;

    await storage.updateAnalysis(id, {
      progress: 100,
      currentStep: finalStep,
      status: "done",
      strategy: JSON.stringify(withRationale.strategy),
      sow: JSON.stringify(withRationale.sow),
      swot: swotResult ? JSON.stringify(swotResult) : null,
      pestel: pestelResult ? JSON.stringify(pestelResult) : null,
      porters: portersResult ? JSON.stringify(portersResult) : null,
      customerInsights: ciResult ? JSON.stringify(ciResult) : null,
      // Surface framework errors so the UI can render "Retry frameworks"
      // with an accurate cause instead of the misleading "toggles were off" copy.
      errorMessage: frameworkErrors.length ? frameworkErrors.join(" | ") : null,
    } as any);
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

Return ONLY valid JSON matching this exact schema — no prose, no markdown, no XML/tool-syntax tags:
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
}

CRITICAL SHAPE RULES — the client renderer WILL silently collapse if you deviate:
- valueProps, offerings, and evidenceElements MUST be JSON arrays of strings inline in the object. Example: "evidenceElements": ["Trade show presence: IWF Atlanta 2026", "No customer logos visible", "No testimonials visible"].
- NEVER emit numbered top-level keys like "item1", "item2", "item3" as a substitute for array items. Do not use "itemN" keys anywhere in the output.
- NEVER emit XML-style tool syntax like <parameter name="item"> or <item>...</item>. Use pure JSON arrays only.
- valueProps must contain 3-6 items. offerings must contain 2+ items. evidenceElements must contain 3+ items (use "None visible" / "No X visible" strings when the site genuinely lacks that evidence — do not return an empty array).
- Only the exact keys listed in the schema are allowed. Do not add extra keys like "seoNotesAdditional", "item1", or others.`;

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
