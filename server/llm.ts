// Shared LLM helpers for the analysis and content pipelines.
// Uses Anthropic tool_use with SCHEMAS that specify required fields. This
// forces Claude to actually return the expected data — a permissive schema
// let Claude satisfy the tool call by returning {}.

import Anthropic from "@anthropic-ai/sdk";
import { jsonrepair } from "jsonrepair";

const customCredToken = process.env.CUSTOM_CRED_API_ANTHROPIC_COM_TOKEN ?? "";
const customCredUrl = process.env.CUSTOM_CRED_API_ANTHROPIC_COM_URL ?? "";
const directKey = process.env.ANTHROPIC_API_KEY ?? "";
const rawKey = customCredToken || directKey;
const REAL_ANTHROPIC = rawKey.startsWith("sk-ant-") || customCredToken.length > 0;

const realBaseURL = customCredUrl || "https://api.anthropic.com";
export const client = REAL_ANTHROPIC
  ? new Anthropic({ apiKey: rawKey, baseURL: realBaseURL })
  : new Anthropic();

export const MODEL = REAL_ANTHROPIC ? "claude-sonnet-5" : "claude_sonnet_4_6";

// Fields the app treats as string arrays. If the LLM leaks something else
// into these (XML tool-syntax, a stringified list, a single string, etc.),
// coerce to [] rather than let downstream .map() calls crash the client.
const ARRAY_STRING_FIELDS = new Set([
  "offerings", "valueProps", "evidenceElements", "quickWins",
  "positioningGaps", "messagingRecommendations", "aeoRecommendations",
  "sampleTitles", "outcomes", "tags", "deliverables", "strengths",
  "weaknesses", "hookIdeas",
]);

// Strip leaked Anthropic tool-syntax XML from a string value.
// The proxy fallback occasionally leaks fragments like
//   `Some text</positioningStatement> <parameter name="valueProps"> <parameter name="item">More text`
// into what should be a clean string. Cut at the first stray XML/tool tag
// and trim, so the visible content is just the leading real prose.
function stripToolLeakage(s: string): string {
  if (!s || typeof s !== "string") return s;
  // Cut at the first HTML-encoded or raw XML/tool tag we recognize
  // NB: also catch the string-field close-tags the model occasionally leaks
  // into what should be plain prose (description, targetAudience, ctaAudit,
  // seoNotes, aeoReadinessNotes, title). Spotmill exposed this in prod:
  // description ended with "…traditional production vendor.</description"
  const cutMatch = s.match(/(&lt;|<)\s*\/?(parameter|positioning|valueProps|offerings|evidenceElements|strengths|weaknesses|opportunities|threats|item|quickWins|invoke|function|tool_use|antml:|description|targetAudience|ctaAudit|seoNotes|aeoReadinessNotes|title|hookIdeas)/i);
  const cut = cutMatch ? s.slice(0, cutMatch.index).trim() : s;
  // Also collapse stray trailing punctuation left by the cut
  return cut.replace(/[\s,;<>"]+$/, "").trim();
}

// Reclaim orphan `item1, item2, ...` keys that Claude occasionally leaks at the
// top level of the extraction object when it emits `<parameter name="item">`
// XML-tool-syntax fragments alongside empty arrays. Rebind them into whichever
// of the known array fields is currently empty (evidenceElements first, then
// valueProps, then offerings), so the UI "What the site says today" section
// actually renders instead of collapsing silently.
function reclaimOrphanItemKeys(obj: any): any {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;
  const orphanKeys = Object.keys(obj).filter((k) => /^item\d+$/i.test(k));
  if (orphanKeys.length === 0) return obj;

  // Preserve numeric order so item1 comes before item10.
  orphanKeys.sort((a, b) => {
    const na = parseInt(a.replace(/^item/i, ""), 10);
    const nb = parseInt(b.replace(/^item/i, ""), 10);
    return na - nb;
  });
  const orphanValues = orphanKeys
    .map((k) => obj[k])
    .filter((v) => typeof v === "string" && v.trim().length > 0);

  if (orphanValues.length === 0) {
    // Nothing worth reclaiming — still drop the keys so the shape is clean.
    const cleaned: any = {};
    for (const [k, v] of Object.entries(obj)) {
      if (!orphanKeys.includes(k)) cleaned[k] = v;
    }
    return cleaned;
  }

  // Pick a target array field. Extraction has 3 array fields; the leak
  // pattern in practice has been evidenceElements. If evidenceElements is
  // present and empty, prefer that. Otherwise fall back to valueProps,
  // then offerings. If none are known-empty targets, do nothing.
  const targets = ["evidenceElements", "valueProps", "offerings"] as const;
  let target: string | null = null;
  for (const t of targets) {
    const v = (obj as any)[t];
    if (Array.isArray(v) && v.length === 0) {
      target = t;
      break;
    }
    if (v === undefined) {
      target = t;
      break;
    }
  }

  const cleaned: any = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!orphanKeys.includes(k)) cleaned[k] = v;
  }
  if (target) {
    console.warn(
      `[llm] reclaimed ${orphanValues.length} orphan itemN key(s) into '${target}'. keys=${orphanKeys.join(",")}`,
    );
    cleaned[target] = orphanValues;
  } else {
    console.warn(
      `[llm] dropped ${orphanKeys.length} orphan itemN key(s) — no empty target field to reclaim into. keys=${orphanKeys.join(",")}`,
    );
  }
  return cleaned;
}

export function sanitizeLlmJson(node: any): any {
  if (typeof node === "string") {
    const cleaned = stripToolLeakage(node);
    if (cleaned !== node) {
      console.warn(`[llm] stripped tool-leak from string. before=${node.slice(0, 80)}... after=${cleaned.slice(0, 80)}`);
    }
    return cleaned;
  }
  if (Array.isArray(node)) return node.map(sanitizeLlmJson);
  if (node && typeof node === "object") {
    const withReclaimed = reclaimOrphanItemKeys(node);
    const out: any = {};
    for (const [k, v] of Object.entries(withReclaimed)) {
      if (ARRAY_STRING_FIELDS.has(k) && !Array.isArray(v)) {
        console.warn(`[llm] coercing malformed '${k}' from ${typeof v} to []. value=${JSON.stringify(v).slice(0, 120)}`);
        // If it's a string that looks like a delimited list, try to salvage.
        if (typeof v === "string" && !v.includes("<") && !v.includes("&lt;")) {
          const parts = v.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
          out[k] = parts.length > 0 ? parts : [];
        } else {
          out[k] = [];
        }
      } else {
        out[k] = sanitizeLlmJson(v);
      }
    }
    return out;
  }
  return node;
}

export function extractJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const src = fenced ? fenced[1] : text;
  let startIdx = -1;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "{" || c === "[") {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) throw new Error("No JSON found in model output");
  const openChar = src[startIdx];
  const closeChar = openChar === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = startIdx; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === openChar) depth++;
    else if (c === closeChar) {
      depth--;
      if (depth === 0) {
        const slice = src.slice(startIdx, i + 1);
        try {
          return JSON.parse(slice);
        } catch (parseErr) {
          return JSON.parse(jsonrepair(slice));
        }
      }
    }
  }
  try {
    return JSON.parse(jsonrepair(src.slice(startIdx)));
  } catch {
    throw new Error("Unbalanced JSON in model output");
  }
}

/**
 * Force Claude to return structured JSON via tool_use.
 *
 * If `schema` is provided, we use it as the tool's input_schema — Claude will
 * refuse to call the tool unless required fields are present.
 *
 * If `schema` is omitted, we fall back to a text response + jsonrepair.
 */
export async function llmJson(
  system: string,
  user: string,
  maxTokens = 4096,
  schema?: any,
): Promise<any> {
  if (schema) {
    // tool_use path with real schema — Claude MUST fill required fields
    const tool: any = {
      name: "return_result",
      description:
        "Return the structured result described in the system prompt. Follow the schema exactly.",
      input_schema: schema,
    };

    // tool_choice: {type: "any"} instead of {type: "tool", name: ...} — the
    // strict-name form has triggered a 400 "assistant message prefill" from
    // the Perplexity Anthropic proxy on newer Claude models. "any" still
    // forces a tool call, and there's only one tool defined, so behavior is
    // effectively identical without the proxy's prefill injection.
    try {
      const resp = await client.messages.create({
        model: MODEL,
        max_tokens: maxTokens,
        system,
        tools: [tool],
        tool_choice: { type: "any" } as any,
        messages: [{ role: "user", content: user }],
      });

      const stopReason = (resp as any).stop_reason;
      const usage = (resp as any).usage;

      for (const block of resp.content as any[]) {
        if (block.type === "tool_use" && block.name === "return_result") {
          const inp = block.input;
          const shape =
            inp && typeof inp === "object"
              ? Array.isArray(inp)
                ? `array[${inp.length}]`
                : `object{${Object.keys(inp).join(",")}}`
              : typeof inp;
          console.log(
            `[llmJson] tool_use hit. shape=${shape} stop=${stopReason} usage=${JSON.stringify(usage)}`,
          );
          return sanitizeLlmJson(inp);
        }
      }

      console.error(
        `[llmJson] NO tool_use block. stop=${stopReason} content=${(resp.content as any[]).map((b: any) => b.type).join(",")}`,
      );
      // Fall through to text path below.
    } catch (err: any) {
      const msg = String(err?.message || err);
      const isPrefillReject = /prefill|assistant message prefill|must end with a user message/i.test(msg);
      if (!isPrefillReject) throw err;
      console.error(
        `[llmJson] tool_use rejected by proxy (prefill). Falling back to text path. err=${msg.slice(0, 200)}`,
      );
      // Fall through to text path below.
    }
  }

  // Text path with jsonrepair — used when no schema is provided OR as fallback
  // when the proxy rejects tool_use with a prefill error.
  const schemaHint = schema
    ? `\n\nThe JSON must match this JSON Schema (top-level keys are required):\n${JSON.stringify(schema)}`
    : "";
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: `${system}\n\nRespond with ONLY a JSON object or array. No preface, no code fences, no commentary.${schemaHint}`,
    messages: [{ role: "user", content: user }],
  });

  const text = (resp.content as any[])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const stopReason = (resp as any).stop_reason;
  const usage = (resp as any).usage;
  console.log(`[llmJson] text path. stop=${stopReason} textLen=${text.length} usage=${JSON.stringify(usage)}`);

  try {
    return sanitizeLlmJson(extractJson(text));
  } catch (e: any) {
    const tail = text.slice(-500);
    console.error(
      `[llmJson] extract failed. stop=${stopReason} textLen=${text.length}\nTAIL:\n${tail}`,
    );
    throw new Error(`${e.message} (stop_reason=${stopReason}, textLen=${text.length})`);
  }
}

// Common schemas — permissive on nested details, strict on the top-level shape.
// This ensures Claude can't return {} and satisfy the tool call.

// Strategy shape consumed by the analysis page ("The recommended play"),
// PDF, and PPTX. Nested object shape (icp, contentPillars items, channelMix
// items, ninetyDayPlan items) is enforced via the SYSTEM prompt — nested
// `required` arrays trigger the Anthropic proxy 400 (see SCHEMA_SHELL note).
export const SCHEMA_STRATEGY = {
  type: "object",
  additionalProperties: true,
  required: [
    "icp",
    "positioningGaps",
    "messagingRecommendations",
    "aeoRecommendations",
    "contentPillars",
    "channelMix",
    "quickWins",
    "ninetyDayPlan",
  ],
  properties: {
    icp: { type: "object", additionalProperties: true },
    positioningGaps: { type: "array", items: { type: "string" } },
    messagingRecommendations: { type: "array", items: { type: "string" } },
    aeoRecommendations: { type: "array", items: { type: "string" } },
    contentPillars: { type: "array", minItems: 1 },
    channelMix: { type: "array", minItems: 1 },
    quickWins: { type: "array", items: { type: "string" } },
    ninetyDayPlan: { type: "array", minItems: 1 },
  },
};

// SOW shape consumed by "Priced engagement — ready to send" section, PDF,
// and PPTX. Nested object shape (phases items, priceTiers items) enforced
// via the SYSTEM prompt.
export const SCHEMA_SOW = {
  type: "object",
  additionalProperties: true,
  required: [
    "engagementSummary",
    "phases",
    "team",
    "priceTiers",
    "termsNotes",
  ],
  properties: {
    engagementSummary: { type: "string" },
    phases: { type: "array", minItems: 1 },
    team: { type: "array", items: { type: "string" } },
    priceTiers: { type: "array", minItems: 1 },
    termsNotes: { type: "array", items: { type: "string" } },
  },
};

// Competitor list rendered in the analysis page's competitor teardown
// section, the PDF, and the PPTX. Each item has {name, url, positioning,
// strengths[], weaknesses[], hookIdeas[]}. Item shape enforced via the
// SYSTEM prompt (nested requireds trip the Anthropic proxy 400).
export const SCHEMA_COMPETITORS = {
  type: "object",
  additionalProperties: true,
  required: ["competitors"],
  properties: {
    competitors: { type: "array", minItems: 3 },
  },
};

// Rich extraction shape consumed by the analysis page, PDF, and PPTX.
// The UI reads: positioningStatement, valueProps, offerings, targetAudience,
// evidenceElements, ctaAudit, aeoReadinessScore, aeoReadinessNotes.
// If any of these are missing the "What the site says today" section collapses
// silently, so the schema enforces them at the tool-use layer (Anthropic).
export const SCHEMA_EXTRACT = {
  type: "object",
  additionalProperties: true,
  required: [
    "title",
    "description",
    "positioningStatement",
    "valueProps",
    "offerings",
    "targetAudience",
    "evidenceElements",
    "ctaAudit",
    "seoNotes",
    "aeoReadinessScore",
    "aeoReadinessNotes",
  ],
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    positioningStatement: { type: "string" },
    valueProps: { type: "array", items: { type: "string" } },
    offerings: { type: "array", items: { type: "string" } },
    targetAudience: { type: "string" },
    evidenceElements: { type: "array", items: { type: "string" } },
    ctaAudit: { type: "string" },
    seoNotes: { type: "string" },
    aeoReadinessScore: { type: "number", minimum: 0, maximum: 100 },
    aeoReadinessNotes: { type: "string" },
  },
};

// NOTE: Keep this schema FLAT at the top level. Nested `required` arrays on
// object properties have caused the Perplexity Anthropic proxy to reject the
// request with a 400 "assistant message prefill" error. Enforce nested shape
// via the SYSTEM PROMPT, not via nested tool schema requireds.
export const SCHEMA_SHELL = {
  type: "object",
  additionalProperties: true,
  required: [
    "summary",
    "contentPillars",
    "socialCadence",
    "adBrief",
    "landingPages",
    "heroMetaAd",
    "heroLinkedInAd",
    "heroColdEmail",
  ],
  properties: {
    summary: { type: "string" },
    contentPillars: { type: "array", minItems: 1 },
    socialCadence: { type: "array" },
    adBrief: { type: "array" },
    landingPages: { type: "array" },
    heroMetaAd: { type: "object", additionalProperties: true },
    heroLinkedInAd: { type: "object", additionalProperties: true },
    heroColdEmail: { type: "object", additionalProperties: true },
  },
};

// Blog calendar batch returned by the 12-week generator. Each item is a
// week: {weekNumber, weekOf, posts[{title, pillar, targetQuery, angle,
// keywords[], scheduledDate, editorialBrief}]}. Validate at runtime as well:
// model tool schemas alone do not guarantee the returned runtime shape.
export const SCHEMA_BLOG_BATCH = {
  type: "object",
  additionalProperties: true,
  required: ["blogCalendar"],
  properties: {
    blogCalendar: {
      type: "array", minItems: 3, maxItems: 3,
      items: {
        type: "object",
        required: ["weekNumber", "weekOf", "posts"],
        properties: {
          weekNumber: { type: "integer", minimum: 1, maximum: 12 },
          weekOf: { type: "string" },
          posts: {
            type: "array", minItems: 10, maxItems: 10,
            items: {
              type: "object",
              required: ["title", "pillar", "targetQuery", "angle", "keywords", "scheduledDate", "editorialBrief"],
              properties: {
                title: { type: "string" }, pillar: { type: "string" },
                targetQuery: { type: "string" }, angle: { type: "string" },
                keywords: { type: "array", items: { type: "string" } },
                scheduledDate: { type: "string" },
                editorialBrief: {
                  type: "object",
                  required: ["readerQuestion", "angleSummary", "primaryKeyword", "aeoQuery"],
                  properties: {
                    readerQuestion: { type: "string" }, angleSummary: { type: "string" },
                    primaryKeyword: { type: "string" }, aeoQuery: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

export const SCHEMA_ROI_ASSUMPTIONS = {
  type: "object",
  additionalProperties: false,
  required: [
    "avgDealSize",
    "dealType",
    "grossMargin",
    "salesCycleDays",
    "visitorToLeadRate",
    "leadToMqlRate",
    "mqlToSqlRate",
    "sqlToWonRate",
    "monthlyVisitorsPerPost",
    "monthsToRank",
    "contentDecayFactor",
    "programCost12Mo",
    "paidCacBaseline",
    "rationale",
  ],
  properties: {
    avgDealSize: { type: "number", minimum: 500, maximum: 10000000 },
    dealType: { type: "string", enum: ["one-time", "acv"] },
    grossMargin: { type: "number", minimum: 0.1, maximum: 0.95 },
    salesCycleDays: { type: "number", minimum: 7, maximum: 365 },
    visitorToLeadRate: { type: "number", minimum: 0.001, maximum: 0.1 },
    leadToMqlRate: { type: "number", minimum: 0.05, maximum: 0.9 },
    mqlToSqlRate: { type: "number", minimum: 0.05, maximum: 0.9 },
    sqlToWonRate: { type: "number", minimum: 0.05, maximum: 0.6 },
    monthlyVisitorsPerPost: { type: "number", minimum: 5, maximum: 500 },
    monthsToRank: { type: "number", minimum: 2, maximum: 9 },
    contentDecayFactor: { type: "number", minimum: 0.7, maximum: 0.98 },
    programCost12Mo: { type: "number", minimum: 20000, maximum: 500000 },
    paidCacBaseline: { type: "number", minimum: 50, maximum: 5000 },
    rationale: {
      type: "object",
      additionalProperties: false,
      required: ["dealSize", "conversionRates", "trafficRamp", "programCost"],
      properties: {
        dealSize: { type: "string" },
        conversionRates: { type: "string" },
        trafficRamp: { type: "string" },
        programCost: { type: "string" },
      },
    },
  },
};

// -----------------------------------------------------------------------------
// Retry-fill for extraction: when the initial SYS_EXTRACT call comes back
// with valueProps / evidenceElements missing or empty, re-ask the LLM for
// JUST those fields with a much narrower prompt. The narrower ask gets past
// two failure modes we saw in prod:
//   1. The proxy fallback text-path leaks XML close-tags (Spotmill: description
//      ended with "</description"), truncating the JSON before the array
//      fields were emitted.
//   2. The model conservatively returned partial output rather than fill in
//      arrays where it "wasn't sure" — a targeted retry with explicit
//      permission to say "None visible" resolves this cleanly.
//
// If the site genuinely lacks these elements, the retry returns
// ["None visible on site"] style entries, which is materially more useful for
// the pitch call than a blank section (empty = ambiguous = looks broken).
// -----------------------------------------------------------------------------

const RETRY_FILL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["valueProps", "evidenceElements"],
  properties: {
    valueProps: { type: "array", items: { type: "string" }, minItems: 3 },
    evidenceElements: { type: "array", items: { type: "string" }, minItems: 3 },
  },
};

const SYS_RETRY_FILL = `You previously analyzed a client website for Brex Consulting and returned an incomplete extraction. Look at the site text again and return ONLY two fields as pure JSON:

{
  "valueProps": ["string", ...],       // 3-6 value propositions the site claims (benefit-oriented statements to the customer)
  "evidenceElements": ["string", ...]  // 3-8 evidence elements: named client logos, testimonials, case studies, awards, certifications, press mentions, trade-show presence, stats
}

RULES:
- Return EXACTLY this JSON shape. No prose. No markdown. No XML.
- If the site genuinely does not present value props in canonical form (e.g. it uses metaphorical language, or is mostly imagery), infer 3-6 value props from what a customer would take away from the visible content.
- If the site has no visible evidence elements, return descriptive "None visible" entries like "No customer logos shown on-site", "No case studies visible", "No testimonials present" — do NOT return an empty array. A confident negative finding is more useful than silence.
- Do not include \`item1\`, \`item2\`, etc. keys. Use pure JSON arrays only.`;

export async function retryFillExtraction(params: {
  clientName: string;
  clientUrl: string;
  siteText: string;
  needsValueProps: boolean;
  needsEvidence: boolean;
}): Promise<{ valueProps?: string[]; evidenceElements?: string[] } | null> {
  const { clientName, clientUrl, siteText, needsValueProps, needsEvidence } = params;
  if (!needsValueProps && !needsEvidence) return null;
  try {
    const result = await llmJson(
      SYS_RETRY_FILL,
      `Client name: ${clientName}\nClient URL: ${clientUrl}\n\n=== WEBSITE TEXT ===\n${siteText.slice(0, 12000)}`,
      1500,
      RETRY_FILL_SCHEMA,
    );
    const out: { valueProps?: string[]; evidenceElements?: string[] } = {};
    if (needsValueProps && Array.isArray(result?.valueProps) && result.valueProps.length > 0) {
      out.valueProps = result.valueProps.filter((s: any) => typeof s === "string" && s.trim().length > 0);
    }
    if (needsEvidence && Array.isArray(result?.evidenceElements) && result.evidenceElements.length > 0) {
      out.evidenceElements = result.evidenceElements.filter((s: any) => typeof s === "string" && s.trim().length > 0);
    }
    console.log(
      `[retryFill] refilled ${clientName}: vp=${out.valueProps?.length ?? 0} ev=${out.evidenceElements?.length ?? 0}`,
    );
    return out;
  } catch (err: any) {
    console.error(`[retryFill] failed for ${clientName}:`, err?.message ?? err);
    return null;
  }
}
