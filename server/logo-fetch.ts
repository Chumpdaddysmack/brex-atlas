// =============================================================
// Logo auto-fetch — pulls a prospect logo from their website
// Strategy: try apple-touch-icon → og:image → favicon
// Returns a base64 data URL suitable for pptxgenjs image insertion.
// =============================================================

import { URL } from "node:url";

const FETCH_TIMEOUT_MS = 6000;
const MAX_BYTES = 2_000_000; // 2 MB cap so we don't OOM the server

export interface FetchedLogo {
  dataUrl: string;
  mimeType: string;
  sizeBytes: number;
  source: "apple-touch-icon" | "og-image" | "favicon" | "fallback";
}

async function fetchWithTimeout(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; BrexAtlas/1.0; +https://atlas.brexconsulting.com)",
      },
    });
    return res.ok ? res : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function toDataUrl(res: Response): Promise<FetchedLogo | null> {
  const ctype = res.headers.get("content-type") ?? "image/png";
  if (!ctype.startsWith("image/")) return null;

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0 || buf.length > MAX_BYTES) return null;

  const base64 = buf.toString("base64");
  return {
    dataUrl: `data:${ctype};base64,${base64}`,
    mimeType: ctype,
    sizeBytes: buf.length,
    source: "favicon",
  };
}

function extractMetaImage(html: string, siteUrl: URL): string | null {
  // Look for og:image, twitter:image, apple-touch-icon
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<link[^>]+rel=["']apple-touch-icon[^"']*["'][^>]+href=["']([^"']+)["']/i,
    /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']apple-touch-icon[^"']*["']/i,
    /<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      try {
        return new URL(match[1], siteUrl).toString();
      } catch {
        continue;
      }
    }
  }
  return null;
}

/**
 * Best-effort fetch of a prospect's logo from their website.
 * Returns null on any failure — caller should render a text fallback.
 */
export async function fetchProspectLogo(rawUrl: string): Promise<FetchedLogo | null> {
  if (!rawUrl) return null;

  let siteUrl: URL;
  try {
    // Normalize — accept "concentrus.com" or "https://concentrus.com"
    const normalized = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    siteUrl = new URL(normalized);
  } catch {
    return null;
  }

  // 1. Try Clearbit-style shortcut for well-known domains
  //    (fast, high-quality, but not all domains covered)
  const clearbit = await fetchWithTimeout(
    `https://logo.clearbit.com/${siteUrl.hostname}?size=400`,
    4000,
  );
  if (clearbit) {
    const result = await toDataUrl(clearbit);
    if (result) {
      return { ...result, source: "og-image" };
    }
  }

  // 2. Fetch homepage HTML and parse for og:image / apple-touch-icon
  const homepage = await fetchWithTimeout(siteUrl.toString());
  if (homepage) {
    try {
      const html = await homepage.text();
      const imgUrl = extractMetaImage(html, siteUrl);
      if (imgUrl) {
        const imgRes = await fetchWithTimeout(imgUrl);
        if (imgRes) {
          const result = await toDataUrl(imgRes);
          if (result) {
            return { ...result, source: "og-image" };
          }
        }
      }
    } catch {
      // fall through to favicon
    }
  }

  // 3. Fall back to /favicon.ico
  const favicon = await fetchWithTimeout(`${siteUrl.origin}/favicon.ico`);
  if (favicon) {
    const result = await toDataUrl(favicon);
    if (result) {
      return { ...result, source: "favicon" };
    }
  }

  return null;
}
