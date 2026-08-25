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
          return inp;
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
    return extractJson(text);
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

export const SCHEMA_STRATEGY = {
  type: "object",
  additionalProperties: true,
  required: ["positioning", "priorities", "plan"],
  properties: {
    positioning: { type: "string" },
    priorities: { type: "array" },
    plan: { type: "array" },
  },
};

export const SCHEMA_SOW = {
  type: "object",
  additionalProperties: true,
  required: ["title", "sections"],
  properties: {
    title: { type: "string" },
    sections: { type: "array" },
  },
};

export const SCHEMA_COMPETITORS = {
  type: "object",
  additionalProperties: true,
  required: ["competitors"],
  properties: {
    competitors: { type: "array" },
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

export const SCHEMA_BLOG_BATCH = {
  type: "object",
  additionalProperties: true,
  required: ["blogCalendar"],
  properties: {
    blogCalendar: { type: "array", minItems: 1 },
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
