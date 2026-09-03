// Lightweight Perplexity Sonar client for cited web research.
//
// Used by PESTEL + Porter's Five Forces generators (Sep 2026). Falls back to
// null when PERPLEXITY_API_KEY isn't set, in which case the generators use
// Claude's built-in knowledge only (still useful, just without live citations).
//
// Docs: https://docs.perplexity.ai/api-reference/chat-completions
//
// We use the `sonar-pro` model with `return_citations: true` — cheap enough
// (~$0.005 per call) for the deep-research paths.

const PPLX_KEY = process.env.PERPLEXITY_API_KEY ?? "";
const PPLX_URL = "https://api.perplexity.ai/chat/completions";

export type PplxCitation = {
  title: string;
  url: string;
  publisher?: string;
  date?: string;
};

export type PplxResult = {
  answer: string;
  citations: PplxCitation[];
};

export function isPerplexityConfigured(): boolean {
  return PPLX_KEY.length > 0;
}

/**
 * Ask Perplexity Sonar a research question and get back an answer with
 * inline citations. Recency-filtered to 2025-2026 unless overridden.
 *
 * Falls back to null (not throwing) when no API key is set, so callers can
 * gracefully degrade to Claude-only synthesis.
 */
export async function pplxAsk(
  question: string,
  options?: {
    recency?: "month" | "week" | "day" | "year";
    maxTokens?: number;
    systemPrompt?: string;
  },
): Promise<PplxResult | null> {
  if (!PPLX_KEY) {
    console.log("[pplx] PERPLEXITY_API_KEY not set — skipping web search");
    return null;
  }

  const body = {
    model: "sonar-pro",
    messages: [
      {
        role: "system",
        content:
          options?.systemPrompt ??
          "You are a senior research analyst. Answer with concrete, source-cited facts. Prefer sources from 2025 or 2026. Cite industry publications, government reports, McKinsey/Deloitte/Gartner/Forrester, trade press. Avoid academic papers and Wikipedia.",
      },
      { role: "user", content: question },
    ],
    max_tokens: options?.maxTokens ?? 1200,
    temperature: 0.2,
    return_citations: true,
    search_recency_filter: options?.recency ?? "year",
  };

  try {
    const res = await fetch(PPLX_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PPLX_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[pplx] ${res.status} ${res.statusText}: ${errText.slice(0, 300)}`);
      return null;
    }

    const data: any = await res.json();
    const answer: string =
      data?.choices?.[0]?.message?.content ??
      data?.choices?.[0]?.delta?.content ??
      "";

    // Perplexity returns citations as an array of URL strings OR objects.
    // Normalize into PplxCitation with best-effort title inference.
    const rawCites: any[] = data?.citations ?? data?.choices?.[0]?.citations ?? [];
    const citations: PplxCitation[] = rawCites
      .map((c: any): PplxCitation | null => {
        if (typeof c === "string") {
          return { title: prettyDomain(c), url: c };
        }
        if (c && typeof c === "object") {
          const url = c.url ?? c.link ?? "";
          if (!url) return null;
          return {
            title: c.title ?? c.name ?? prettyDomain(url),
            url,
            publisher: c.publisher ?? c.source ?? prettyDomain(url),
            date: c.date ?? c.published ?? c.published_date,
          };
        }
        return null;
      })
      .filter((c): c is PplxCitation => c !== null);

    return { answer, citations };
  } catch (err: any) {
    console.error(`[pplx] request failed: ${String(err?.message ?? err).slice(0, 300)}`);
    return null;
  }
}

function prettyDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
