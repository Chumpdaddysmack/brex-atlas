// Shared LLM helpers and JSON extraction used across both the analysis pipeline
// and the content-generation pipeline. Extracted so both files use the same
// bracket-aware JSON scanner.

import Anthropic from "@anthropic-ai/sdk";
import { jsonrepair } from "jsonrepair";

// The client picks up ANTHROPIC_API_KEY from the environment.
// - In the dev sandbox, api_credentials=["llm-api:website"] injects a proxy key + base URL
//   and the model alias "claude_sonnet_4_6" resolves inside the proxy.
// - In the published sandbox, we set a real Anthropic key via the publish `credentials`
//   arg and must use the real Anthropic model id.
//
// We detect "real key mode" by looking for the sk-ant- prefix and switch model ids
// accordingly, so the same build runs cleanly in dev and prod.
// Key resolution:
// 1. Published sandbox (custom-cred proxy): CUSTOM_CRED_API_ANTHROPIC_COM_TOKEN +
//    CUSTOM_CRED_API_ANTHROPIC_COM_URL are injected by publish_website. This is
//    the production path — the real Anthropic key is proxied, not embedded.
// 2. Direct env: ANTHROPIC_API_KEY set to a real sk-ant- key (local production test).
// 3. Dev sandbox: api_credentials=["llm-api:website"] injects a proxy key + base URL
//    and the model alias "claude_sonnet_4_6" resolves inside the proxy.
const customCredToken = process.env.CUSTOM_CRED_API_ANTHROPIC_COM_TOKEN ?? "";
const customCredUrl = process.env.CUSTOM_CRED_API_ANTHROPIC_COM_URL ?? "";
const directKey = process.env.ANTHROPIC_API_KEY ?? "";
const rawKey = customCredToken || directKey;
const REAL_ANTHROPIC = rawKey.startsWith("sk-ant-") || customCredToken.length > 0;

// When we detect a real Anthropic key, force the SDK to hit Anthropic's public
// API endpoint directly (or the custom-cred proxy URL if injected). In the dev
// sandbox the LLM proxy sets ANTHROPIC_BASE_URL to a Perplexity host, but the
// published sandbox must not inherit that.
const realBaseURL = customCredUrl || "https://api.anthropic.com";
export const client = REAL_ANTHROPIC
  ? new Anthropic({ apiKey: rawKey, baseURL: realBaseURL })
  : new Anthropic();
// Model selection:
// - REAL_ANTHROPIC (published sandbox with sk-ant- key): use claude-sonnet-5, Anthropic's
//   current default as of August 2026. 1M-token context, $3/$15 per Mtok.
// - Perplexity proxy (dev sandbox): use the proxy alias claude_sonnet_4_6.
export const MODEL = REAL_ANTHROPIC ? "claude-sonnet-5" : "claude_sonnet_4_6";

/**
 * Scan a model response for the outermost JSON value.
 * Handles fenced code blocks and mismatched brackets inside string literals.
 */
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
  throw new Error("Unbalanced JSON in model output");
}

export async function llmJson(system: string, user: string, maxTokens = 4096): Promise<any> {
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  });
  const text = resp.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n");
  try {
    return extractJson(text);
  } catch (e: any) {
    const stopReason = (resp as any).stop_reason;
    const usage = (resp as any).usage;
    // Dump the raw model output for diagnosis; keep last 500 chars visible in the thrown error.
    const tail = text.slice(-500);
    console.error(
      `[llmJson] extract failed. stop_reason=${stopReason} usage=${JSON.stringify(usage)} textLen=${text.length}\nTAIL:\n${tail}`,
    );
    throw new Error(`${e.message} (stop_reason=${stopReason}, textLen=${text.length})`);
  }
}
