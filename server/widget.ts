// Public Atlas Widget backend — powers the embeddable diagnostic on
// brexconsulting.com. This is DELIBERATELY separated from the main /api routes
// because it must run WITHOUT authentication and must NEVER expose real
// research or paid-tier data. Everything returned is inferred, not researched.
//
// Endpoints (all mounted before the requireAuth middleware):
//   POST /api/widget/diagnose  → run the 90-second inferred diagnostic
//   POST /api/widget/lead       → capture email + score for HubSpot handoff
//   GET  /api/widget/config     → non-secret UI config (chip options, copy)
//
// Rate limiting: IP-based, 5 diagnostics per rolling 24 hours. Enforced in
// memory here (fine for single-container Railway) — move to Supabase if we
// scale horizontally.

import type { Express, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { client as anthropic, MODEL } from "./llm";
import {
  insertDiagnostic,
  getDiagnostic,
  insertLead,
  updateLeadSync,
  markLeadCaptured,
  isPersistenceConfigured,
} from "./widget-store";
import { syncAtlasLeadToHubSpot } from "./hubspot";

// ---------- Public config (chip options + strategic copy) ----------

const WIDGET_INDUSTRIES = [
  "Professional services",
  "B2B SaaS",
  "Manufacturing",
  "ERP / enterprise software",
  "Healthcare",
  "Financial services",
  "Consumer / e-commerce",
  "Nonprofit",
  "Other B2B",
];

const WIDGET_REVENUE_BANDS = [
  "Under $1M",
  "$1M–$5M",
  "$5M–$25M",
  "$25M–$100M",
  "$100M+",
];

const WIDGET_GOALS = [
  "Fill top-of-funnel with qualified leads",
  "Shorten a stalled sales cycle",
  "Reposition and clarify messaging",
  "Launch a new offer or category",
  "Accelerate revenue in the next 90 days",
];

// ---------- Rate limiter (per IP, 5/day rolling) ----------

const WIDGET_LIMIT = 5;
const WIDGET_WINDOW_MS = 24 * 60 * 60 * 1000;
const widgetHits = new Map<string, number[]>();

function checkWidgetRate(ip: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const hits = (widgetHits.get(ip) || []).filter((t) => now - t < WIDGET_WINDOW_MS);
  if (hits.length >= WIDGET_LIMIT) {
    widgetHits.set(ip, hits);
    return { allowed: false, remaining: 0 };
  }
  hits.push(now);
  widgetHits.set(ip, hits);
  return { allowed: true, remaining: WIDGET_LIMIT - hits.length };
}

// ---------- In-memory diagnostic cache (for lead-capture correlation) ----------
// Keys: diagnosticId → { input, output, createdAt, ip, lead? }
// TTL: 6 hours. This is intentionally ephemeral — we don't want to store
// prospects' widget runs long-term until they hand over an email.

interface WidgetDiagnostic {
  id: string;
  createdAt: number;
  ip: string;
  input: WidgetInput;
  output: WidgetOutput;
  lead?: { email: string; company?: string; capturedAt: number };
}

const diagnostics = new Map<string, WidgetDiagnostic>();
const DIAG_TTL_MS = 6 * 60 * 60 * 1000;

function pruneDiagnostics() {
  const now = Date.now();
  const toDelete: string[] = [];
  diagnostics.forEach((d, id) => {
    if (now - d.createdAt > DIAG_TTL_MS) toDelete.push(id);
  });
  toDelete.forEach((id) => diagnostics.delete(id));
}

// ---------- Type shapes ----------

interface WidgetInput {
  url: string;
  industry: string;
  revenueBand: string;
  goal: string;
}

interface SubScore {
  key: "positioning" | "offer" | "buyer" | "growth";
  label: string;
  score: number; // 0-100
  finding: string; // one punchy, specific inferred insight
}

interface WidgetOutput {
  overallScore: number; // 0-100 Big Rock Fit Score
  verdict: "critical" | "developing" | "solid" | "top-quartile";
  headline: string; // 1-line strategic read
  subScores: SubScore[];
  // Blurred/teaser sections — titles only, evidence intentionally missing.
  swotTitles: {
    strengths: string[];
    weaknesses: string[];
    opportunities: string[];
    threats: string[];
  };
  benchmark: { industryAverage: number; topQuartile: number };
  // Routing signal (invisible to prospect; hydrates HubSpot lead record)
  fitTier: "advisor" | "strategist" | "full-fractional" | "not-a-fit";
}

// ---------- Inferred diagnostic prompt ----------

const WIDGET_SYSTEM_PROMPT = `You are Kenneth Peavy, Senior Fractional CMO at Brex Consulting, running the Big Rock Method™ diagnostic.

This is a WIDGET on brexconsulting.com — a 90-second inferred diagnostic that prospects run BEFORE buying the $4,995 Growth Excavation Report™.

CRITICAL RULES:
- You are inferring from category patterns, NOT researching the actual website. Do not claim to have visited the URL.
- Every finding must be specific, punchy, and feel eerily accurate — the "how did it know that?" moment is what sells the paid report.
- Findings should be grounded in what is TYPICAL for a company in this industry + revenue band + goal, not generic MBA advice.
- Sub-scores are honest — reveal real weaknesses. Prospects will not book a call if the score is 90/100.
- Big Rock Method framing: growth problems are ALIGNMENT problems. Score reflects alignment between positioning, offer, buyer, and growth motion.
- SWOT titles ONLY — short 5-8 word phrases. No evidence sentences (those are paid-tier).

SCORING GUIDANCE:
- Overall score distribution should center around 45-65 for typical prospects. Rare to score above 75.
- verdict: <40 critical, 40-59 developing, 60-74 solid, 75+ top-quartile
- fitTier logic:
  * Under $1M revenue → 'not-a-fit' (below Brex ICP) UNLESS score is 75+ and goal is "Launch a new offer or category"
  * $1M–$5M → 'advisor' (score < 55) or 'strategist' (score ≥ 55)
  * $5M–$25M → 'strategist' (score < 60) or 'full-fractional' (score ≥ 60)
  * $25M+ → 'full-fractional'
- Industry benchmark: fabricate plausible values. Industry avg typically 55-65. Top quartile typically 75-82.

CONSISTENCY RULES (do not violate):
- The AVERAGE of the four subScores must be within ±3 of overallScore. Do the math before you return.
- The headline must NOT quote any number. Describe the situation qualitatively so the prospect never sees a written score that contradicts the score in the gauge.
- topQuartile must be strictly greater than industryAverage.
- verdict must match overallScore: <40 critical, 40-59 developing, 60-74 solid, 75+ top-quartile.

Return ONLY valid JSON matching this exact schema — no prose, no markdown:
{
  "overallScore": 52,
  "verdict": "developing",
  "headline": "One-sentence strategic read tying score to the specific industry+goal.",
  "subScores": [
    { "key": "positioning", "label": "Positioning Clarity", "score": 48, "finding": "One specific inferred insight about typical positioning gap in this industry — 12-25 words." },
    { "key": "offer", "label": "Offer Structure", "score": 55, "finding": "..." },
    { "key": "buyer", "label": "Buyer Alignment", "score": 42, "finding": "..." },
    { "key": "growth", "label": "Growth Signal", "score": 60, "finding": "..." }
  ],
  "swotTitles": {
    "strengths":     ["title only 1", "title only 2", "title only 3"],
    "weaknesses":    ["title only 1", "title only 2", "title only 3"],
    "opportunities": ["title only 1", "title only 2", "title only 3"],
    "threats":       ["title only 1", "title only 2", "title only 3"]
  },
  "benchmark": { "industryAverage": 58, "topQuartile": 76 },
  "fitTier": "strategist"
}`;

const WIDGET_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["overallScore", "verdict", "headline", "subScores", "swotTitles", "benchmark", "fitTier"],
  properties: {
    overallScore: { type: "integer", minimum: 0, maximum: 100 },
    verdict: { type: "string", enum: ["critical", "developing", "solid", "top-quartile"] },
    headline: { type: "string" },
    subScores: {
      type: "array",
      minItems: 4,
      maxItems: 4,
      items: {
        type: "object",
        required: ["key", "label", "score", "finding"],
        properties: {
          key: { type: "string", enum: ["positioning", "offer", "buyer", "growth"] },
          label: { type: "string" },
          score: { type: "integer", minimum: 0, maximum: 100 },
          finding: { type: "string" },
        },
      },
    },
    swotTitles: {
      type: "object",
      required: ["strengths", "weaknesses", "opportunities", "threats"],
      properties: {
        strengths:     { type: "array", items: { type: "string" }, minItems: 3, maxItems: 3 },
        weaknesses:    { type: "array", items: { type: "string" }, minItems: 3, maxItems: 3 },
        opportunities: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 3 },
        threats:       { type: "array", items: { type: "string" }, minItems: 3, maxItems: 3 },
      },
    },
    benchmark: {
      type: "object",
      required: ["industryAverage", "topQuartile"],
      properties: {
        industryAverage: { type: "integer", minimum: 0, maximum: 100 },
        topQuartile: { type: "integer", minimum: 0, maximum: 100 },
      },
    },
    fitTier: { type: "string", enum: ["advisor", "strategist", "full-fractional", "not-a-fit"] },
  },
} as const;

async function runInferredDiagnostic(input: WidgetInput): Promise<WidgetOutput> {
  const userPrompt = `Run the Big Rock Method™ widget diagnostic for this prospect:

URL: ${input.url}
Industry: ${input.industry}
Revenue band: ${input.revenueBand}
Primary goal: ${input.goal}

Produce the inferred diagnostic JSON now.`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: WIDGET_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
    tools: [
      {
        name: "return_diagnostic",
        description: "Return the inferred Big Rock Fit Score diagnostic",
        input_schema: WIDGET_SCHEMA as any,
      },
    ],
    tool_choice: { type: "tool", name: "return_diagnostic" },
  });

  const toolUse = response.content.find((c: any) => c.type === "tool_use") as any;
  if (!toolUse || !toolUse.input) {
    throw new Error("Diagnostic LLM returned no tool_use block");
  }
  return normalizeWidgetOutput(toolUse.input as WidgetOutput);
}

// Server-side consistency guarantees. The prompt already asks for these but a
// stray model output must never reach the browser — a prospect seeing a
// contradictory score kills trust in the paid Growth Excavation Report before
// we ever get on a call. Every value is coerced into a coherent state here.
function normalizeWidgetOutput(o: WidgetOutput): WidgetOutput {
  // Clamp overallScore + sub-scores to 0..100
  const clamp = (n: any) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
  o.overallScore = clamp(o.overallScore);

  // Coerce subScores to the canonical array shape. Claude sometimes returns it
  // as an object keyed by sub-score name (e.g. { positioning: {...}, offer: {...} }),
  // which crashes .forEach downstream. Accept both shapes and rebuild the array
  // in the required order.
  o.subScores = coerceSubScores((o as any).subScores);

  o.subScores = o.subScores.map((s) => ({ ...s, score: clamp(s.score) }));

  // Force sub-score average within ±3 of overallScore by nudging the closest
  // sub-score. This preserves the LLM's relative weakness signal while
  // guaranteeing the surfaced numbers can't publicly disagree.
  const avg = () => o.subScores.reduce((a, s) => a + s.score, 0) / o.subScores.length;
  let attempts = 0;
  while (Math.abs(avg() - o.overallScore) > 3 && attempts < 16) {
    const diff = o.overallScore - avg();
    // Nudge the sub-score furthest from the target overall in the wrong direction
    const sorted = [...o.subScores].sort((a, b) =>
      Math.abs(b.score - o.overallScore) - Math.abs(a.score - o.overallScore),
    );
    const target = o.subScores.find((s) => s.key === sorted[0].key)!;
    target.score = clamp(target.score + Math.sign(diff) * Math.max(1, Math.round(Math.abs(diff))));
    attempts++;
  }

  // Verdict must match overallScore band
  const s = o.overallScore;
  o.verdict = s < 40 ? "critical" : s < 60 ? "developing" : s < 75 ? "solid" : "top-quartile";

  // Benchmark sanity: clamp, and force topQuartile > industryAverage
  o.benchmark.industryAverage = clamp(o.benchmark.industryAverage) || 58;
  o.benchmark.topQuartile = clamp(o.benchmark.topQuartile) || 78;
  if (o.benchmark.topQuartile <= o.benchmark.industryAverage) {
    o.benchmark.topQuartile = Math.min(100, o.benchmark.industryAverage + 15);
  }

  // Strip any digits from the headline so the score gauge is the only score
  // the prospect sees. If stripping empties the headline, fall back to a
  // safe qualitative line.
  const scrubbed = String(o.headline || "")
    .replace(/\b\d+(\.\d+)?%?\b/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  o.headline = scrubbed.length >= 20
    ? scrubbed
    : "Alignment gaps between positioning, offer, buyer, and growth motion are the biggest lever here.";

  // Coerce swotTitles buckets to string arrays (Claude occasionally returns
  // objects like { title1: '...', title2: '...' } instead of arrays).
  o.swotTitles = {
    strengths: coerceStringArray((o as any).swotTitles?.strengths, 3),
    weaknesses: coerceStringArray((o as any).swotTitles?.weaknesses, 3),
    opportunities: coerceStringArray((o as any).swotTitles?.opportunities, 3),
    threats: coerceStringArray((o as any).swotTitles?.threats, 3),
  };

  return o;
}

const SUBSCORE_ORDER: Array<SubScore["key"]> = ["positioning", "offer", "buyer", "growth"];
const SUBSCORE_LABELS: Record<SubScore["key"], string> = {
  positioning: "Positioning Clarity",
  offer: "Offer Structure",
  buyer: "Buyer Alignment",
  growth: "Growth Signal",
};

function coerceSubScores(raw: any): SubScore[] {
  // Already an array — keep as-is, but fill any missing canonical entries.
  const src: Record<string, any> = {};
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (item && typeof item === "object") {
        const key = normalizeSubScoreKey(item.key);
        if (key) src[key] = item;
      }
    }
  } else if (raw && typeof raw === "object") {
    // Object shape: keys may be canonical (positioning/offer/buyer/growth) or
    // camelCase (positioningClarity, offerStructure, buyerAlignment, growthSignal).
    for (const [k, v] of Object.entries(raw)) {
      const key = normalizeSubScoreKey(k);
      if (key && v && typeof v === "object") src[key] = v;
    }
  }

  return SUBSCORE_ORDER.map((key) => {
    const item = src[key] || {};
    return {
      key,
      label: typeof item.label === "string" && item.label.trim() ? item.label : SUBSCORE_LABELS[key],
      score: Number.isFinite(Number(item.score)) ? Number(item.score) : 55,
      finding: typeof item.finding === "string" && item.finding.trim()
        ? item.finding
        : "Typical alignment gap seen at this stage — the paid report cites the specific evidence.",
    };
  });
}

function normalizeSubScoreKey(k: any): SubScore["key"] | null {
  if (typeof k !== "string") return null;
  const key = k.toLowerCase();
  if (key.startsWith("position")) return "positioning";
  if (key.startsWith("offer")) return "offer";
  if (key.startsWith("buyer")) return "buyer";
  if (key.startsWith("growth")) return "growth";
  return null;
}

function coerceStringArray(raw: any, minLen: number): string[] {
  let arr: string[] = [];
  if (Array.isArray(raw)) {
    arr = raw.filter((v) => typeof v === "string" && v.trim()).map((v) => String(v).trim());
  } else if (raw && typeof raw === "object") {
    arr = Object.values(raw)
      .filter((v) => typeof v === "string" && (v as string).trim())
      .map((v) => String(v).trim());
  }
  // Pad with safe fillers if the LLM under-delivered
  while (arr.length < minLen) arr.push("Additional finding available in the paid report");
  return arr.slice(0, Math.max(minLen, arr.length));
}

// ---------- URL validation (shallow — we don't fetch) ----------

function normalizeUrl(raw: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");
  if (!trimmed || trimmed.length > 200) return null;
  // Must look like a hostname with at least one dot
  if (!/^[a-z0-9][a-z0-9.\-/_?=&%:]*\.[a-z]{2,}(\/.*)?$/i.test(trimmed)) return null;
  return "https://" + trimmed;
}

// ---------- Public route registration ----------
// MUST be called BEFORE app.use("/api", requireAuth) — these routes are public.

export function registerWidgetRoutes(app: Express) {
  // Serve non-secret config so the widget frontend doesn't hardcode option lists
  app.get("/api/widget/config", (_req: Request, res: Response) => {
    res.json({
      industries: WIDGET_INDUSTRIES,
      revenueBands: WIDGET_REVENUE_BANDS,
      goals: WIDGET_GOALS,
    });
  });

  // Run the diagnostic
  app.post("/api/widget/diagnose", async (req: Request, res: Response) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const rate = checkWidgetRate(ip);
    if (!rate.allowed) {
      return res.status(429).json({
        error: "Daily limit reached. You can run 5 diagnostics per day — try again tomorrow or book a Growth Excavation Call.",
      });
    }

    const body = req.body ?? {};
    const url = normalizeUrl(body.url);
    if (!url) return res.status(400).json({ error: "Please enter a valid website URL." });
    if (!WIDGET_INDUSTRIES.includes(body.industry)) {
      return res.status(400).json({ error: "Please select an industry." });
    }
    if (!WIDGET_REVENUE_BANDS.includes(body.revenueBand)) {
      return res.status(400).json({ error: "Please select a revenue band." });
    }
    if (!WIDGET_GOALS.includes(body.goal)) {
      return res.status(400).json({ error: "Please select a primary goal." });
    }

    const input: WidgetInput = {
      url,
      industry: body.industry,
      revenueBand: body.revenueBand,
      goal: body.goal,
    };

    try {
      const output = await runInferredDiagnostic(input);
      pruneDiagnostics();

      // Persist to Supabase when configured (source of truth).
      // Fall back to in-memory Map when Supabase isn't wired (dev / rollback safety).
      let id: string;
      if (isPersistenceConfigured()) {
        try {
          const subMap = new Map(output.subScores.map((s) => [s.key, s.score]));
          id = await insertDiagnostic({
            ip,
            url: input.url,
            industry: input.industry,
            revenueBand: input.revenueBand,
            primaryGoal: input.goal,
            overallScore: output.overallScore,
            fitTier: output.fitTier,
            verdict: output.verdict,
            positioningScore: subMap.get("positioning"),
            offerScore: subMap.get("offer"),
            buyerScore: subMap.get("buyer"),
            growthScore: subMap.get("growth"),
            headline: output.headline,
            rawOutput: output,
          });
        } catch (persistErr: any) {
          console.error("[widget/diagnose] persistence failed, falling back to memory:", persistErr?.message ?? persistErr);
          id = randomUUID();
          diagnostics.set(id, { id, createdAt: Date.now(), ip, input, output });
        }
      } else {
        id = randomUUID();
        diagnostics.set(id, { id, createdAt: Date.now(), ip, input, output });
      }

      res.json({
        diagnosticId: id,
        remaining: rate.remaining,
        ...output,
      });
    } catch (err: any) {
      console.error("[widget/diagnose] failed:", err);
      res.status(500).json({
        error: "Diagnostic engine hiccupped. Please try again in a moment.",
      });
    }
  });

  // Lead capture — trades email for the "unlock evidence" experience.
  // Persists into memory only (post-v1 = write to Supabase + HubSpot).
  app.post("/api/widget/lead", async (req: Request, res: Response) => {
    const body = req.body ?? {};
    const diagnosticId = String(body.diagnosticId || "");
    const email = String(body.email || "").trim().toLowerCase();
    const company = body.company ? String(body.company).trim() : undefined;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return res.status(400).json({ error: "Please enter a valid work email." });
    }

    // Load diagnostic — Supabase first (source of truth), then memory fallback
    let diagOutput: WidgetOutput | null = null;
    let diagInput: { url: string; industry: string; revenueBand: string; goal: string } | null = null;
    let diagCreatedAt = new Date();

    if (isPersistenceConfigured()) {
      const stored = await getDiagnostic(diagnosticId);
      if (stored) {
        diagOutput = stored.rawOutput as WidgetOutput;
        diagInput = {
          url: stored.url,
          industry: stored.industry,
          revenueBand: stored.revenueBand,
          goal: stored.primaryGoal,
        };
        diagCreatedAt = new Date(stored.createdAt);
      }
    }
    if (!diagOutput) {
      const mem = diagnostics.get(diagnosticId);
      if (mem) {
        diagOutput = mem.output;
        diagInput = mem.input;
        diagCreatedAt = new Date(mem.createdAt);
      }
    }
    if (!diagOutput || !diagInput) {
      return res.status(404).json({ error: "Diagnostic session expired. Please run it again." });
    }

    console.log(
      `[widget/lead] captured — email=${email} company=${company ?? "-"} ` +
        `score=${diagOutput.overallScore} tier=${diagOutput.fitTier} ` +
        `industry=${diagInput.industry} revenue=${diagInput.revenueBand}`,
    );

    // Respond to the browser FAST — HubSpot + email happen after the response
    res.json({
      ok: true,
      unlocked: {
        strengthUnlock: {
          title: diagOutput.swotTitles.strengths[0],
          evidence: `Sample evidence sentence anchored in ${diagInput.industry} category patterns — the paid Growth Excavation Report cites your actual homepage, competitor pages, and 2026 buyer research for every SWOT item.`,
        },
        weaknessUnlock: {
          title: diagOutput.swotTitles.weaknesses[0],
          evidence: `Sample evidence sentence — the paid report shows exactly where this shows up on your site, which competitors exploit it, and the 30-day fix.`,
        },
      },
    });

    // ---------- Fire-and-forget: HubSpot + Supabase lead row + hot-lead email ----------
    // Wrapped in setImmediate so a slow HubSpot/Resend never blocks the browser.
    setImmediate(() => {
      void handleLeadSideEffects({
        diagnosticId,
        email,
        company,
        diagInput,
        diagOutput,
        diagCreatedAt,
      }).catch((err) => {
        console.error("[widget/lead] side-effects failed:", err);
      });
    });
  });
}

// ---------- Side-effect pipeline: Supabase lead row + HubSpot sync + hot-lead alert ----------

interface LeadSideEffectInput {
  diagnosticId: string;
  email: string;
  company?: string;
  diagInput: { url: string; industry: string; revenueBand: string; goal: string };
  diagOutput: WidgetOutput;
  diagCreatedAt: Date;
}

async function handleLeadSideEffects(p: LeadSideEffectInput): Promise<void> {
  const subMap = new Map(p.diagOutput.subScores.map((s) => [s.key, s.score]));

  // 1. Mark diagnostic as lead-captured (best-effort)
  if (isPersistenceConfigured()) {
    await markLeadCaptured(p.diagnosticId, p.email);
  }

  // 2. Insert lead row (Supabase) — pending sync
  let leadId: string | null = null;
  if (isPersistenceConfigured()) {
    try {
      leadId = await insertLead({
        diagnosticId: p.diagnosticId,
        email: p.email,
        company: p.company,
        hubspotSyncStatus: "pending",
      });
    } catch (err) {
      console.error("[widget/lead] insertLead failed:", err);
    }
  }

  // 3. HubSpot sync
  const syncResult = await syncAtlasLeadToHubSpot({
    diagnosticId: p.diagnosticId,
    overallScore: p.diagOutput.overallScore,
    fitTier: p.diagOutput.fitTier,
    verdict: p.diagOutput.verdict,
    positioningScore: subMap.get("positioning"),
    offerScore: subMap.get("offer"),
    buyerScore: subMap.get("buyer"),
    growthScore: subMap.get("growth"),
    url: p.diagInput.url,
    industry: p.diagInput.industry,
    revenueBand: p.diagInput.revenueBand,
    primaryGoal: p.diagInput.goal,
    email: p.email,
    company: p.company,
    runAt: p.diagCreatedAt,
  });

  // 4. Update lead row with sync result
  if (leadId) {
    await updateLeadSync(leadId, {
      hubspotContactId: syncResult.contactId,
      hubspotDealId: syncResult.dealId,
      hubspotSyncStatus: syncResult.status,
      hubspotSyncError: syncResult.error ?? null,
    });
  }

  // 5. Hot-lead notification: handled by a HubSpot workflow.
  //    When contact atlas_fit_tier is strategist or full-fractional AND
  //    atlas_fit_score >= 65, HubSpot fires an in-app notification to Kenny.
  //    See project docs for workflow setup steps.
}
