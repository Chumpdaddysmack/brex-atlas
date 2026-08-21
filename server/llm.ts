// Shared LLM helpers for the analysis and content pipelines.
// Uses Anthropic's "assistant message prefill" pattern to force JSON output:
// we start the assistant's reply with `{` so Claude has to continue with a JSON
// object. Combined with jsonrepair, this handles all the malformed-JSON edge
// cases we've hit (trailing commas, smart quotes, comment lines) without
// requiring a per-call schema.

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

export async function llmJson(system: string, user: string, maxTokens = 4096): Promise<any> {
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [
      { role: "user", content: user },
      { role: "assistant", content: "{" },
    ],
  });

  const rawText = (resp.content as any[])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  const text = "{" + rawText;

  const stopReason = (resp as any).stop_reason;
  const usage = (resp as any).usage;
  console.log(
    `[llmJson] stop=${stopReason} textLen=${text.length} usage=${JSON.stringify(usage)}`,
  );

  try {
    return extractJson(text);
  } catch (e: any) {
    const tail = text.slice(-500);
    console.error(
      `[llmJson] extract failed. stop_reason=${stopReason} usage=${JSON.stringify(usage)} textLen=${text.length}\nTAIL:\n${tail}`,
    );
    throw new Error(`${e.message} (stop_reason=${stopReason}, textLen=${text.length})`);
  }
}
