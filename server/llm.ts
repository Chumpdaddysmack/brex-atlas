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

export async function llmJson(
  system: string,
  user: string,
  maxTokens = 4096,
  schema?: any,
): Promise<any> {
  if (schema) {
    const tool: any = {
      name: "return_result",
      description:
        "Return the structured result described in the system prompt. Follow the schema exactly.",
      input_schema: schema,
    };

    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      tools: [tool],
      tool_choice: { type: "tool", name: "return_result" } as any,
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
    throw new Error(`Model did not call return_result tool (stop_reason=${stopReason})`);
  }

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: `${system}\n\nRespond with ONLY a JSON object or array. No preface, no code fences, no commentary.`,
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

export const SCHEMA_EXTRACT = {
  type: "object",
  additionalProperties: true,
  required: ["businessName", "services", "positioning"],
  properties: {
    businessName: { type: "string" },
    services: { type: "array" },
    positioning: { type: "string" },
  },
};

export const SCHEMA_SHELL = {
  type: "object",
  additionalProperties: true,
  required: ["summary", "contentPillars", "socialCadence", "adBrief", "landingPages"],
  properties: {
    summary: { type: "string" },
    contentPillars: { type: "array", minItems: 1 },
    socialCadence: { type: "array" },
    adBrief: { type: "array" },
    landingPages: { type: "array" },
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
