// Shared LLM helpers for the analysis and content pipelines.
// Uses Anthropic tool_use to force structured JSON output — this eliminates
// the whole class of "model produced invalid JSON" errors.

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
  throw new Error("Unbalanced JSON in model output");
}

export async function llmJson(system: string, user: string, maxTokens = 4096): Promise<any> {
  const tool: any = {
    name: "return_result",
    description:
      "Return the structured result described in the system prompt. Follow the schema exactly. Return ONLY this tool call — no other text.",
    input_schema: {
      type: "object",
      additionalProperties: true,
    },
  };

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    tools: [tool],
    tool_choice: { type: "tool", name: "return_result" } as any,
    messages: [{ role: "user", content: user }],
  });

  for (const block of resp.content as any[]) {
    if (block.type === "tool_use" && block.name === "return_result") {
      const inp = block.input;
      if (inp && typeof inp === "object" && !Array.isArray(inp)) {
        const keys = Object.keys(inp);
        if (keys.length === 1) {
          const solo = inp[keys[0]];
          if (Array.isArray(solo)) return solo;
        }
      }
      return inp;
    }
  }

  const text = (resp.content as any[])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  try {
    return extractJson(text);
  } catch (e: any) {
    const stopReason = (resp as any).stop_reason;
    const usage = (resp as any).usage;
    const tail = text.slice(-500);
    console.error(
      `[llmJson] extract failed. stop_reason=${stopReason} usage=${JSON.stringify(usage)} textLen=${text.length}\nTAIL:\n${tail}`,
    );
    throw new Error(`${e.message} (stop_reason=${stopReason}, textLen=${text.length})`);
  }
}
