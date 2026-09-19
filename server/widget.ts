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
  return toolUse.input as WidgetOutput;
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
      const id = randomUUID();
      diagnostics.set(id, {
        id,
        createdAt: Date.now(),
        ip,
        input,
        output,
      });
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
    const diag = diagnostics.get(diagnosticId);
    if (!diag) {
      return res.status(404).json({ error: "Diagnostic session expired. Please run it again." });
    }
    diag.lead = { email, company, capturedAt: Date.now() };
    console.log(
      `[widget/lead] captured — email=${email} company=${company ?? "-"} ` +
        `score=${diag.output.overallScore} tier=${diag.output.fitTier} ` +
        `industry=${diag.input.industry} revenue=${diag.input.revenueBand}`,
    );
    // Return the "unlocked" payload — same output plus one strength/weakness
    // evidence unlocked as a taste, and the full report CTA.
    res.json({
      ok: true,
      unlocked: {
        // Peel back the first strength + weakness with fake-real evidence,
        // to demonstrate what the paid report delivers. Kept short so it
        // still leaves the prospect wanting more.
        strengthUnlock: {
          title: diag.output.swotTitles.strengths[0],
          evidence: `Sample evidence sentence anchored in ${diag.input.industry} category patterns — the paid Growth Excavation Report cites your actual homepage, competitor pages, and 2026 buyer research for every SWOT item.`,
        },
        weaknessUnlock: {
          title: diag.output.swotTitles.weaknesses[0],
          evidence: `Sample evidence sentence — the paid report shows exactly where this shows up on your site, which competitors exploit it, and the 30-day fix.`,
        },
      },
    });
  });
}
