import type { CompanyFactKey, CompanyProfile } from "./schema";

export const COMPANY_FACT_LABELS: Record<CompanyFactKey, string> = {
  business: "Company background", founded: "Year founded", industry: "Industry",
  expertise: "Expertise", ownership: "Ownership", annualRevenue: "Annual revenue",
  employees: "Employee count", locations: "Locations and geography",
  marketingStrategy: "Current marketing strategy",
};
export const COMPANY_FACT_KEYS = Object.keys(COMPANY_FACT_LABELS) as CompanyFactKey[];

export function safeSourceUrl(value: unknown): string | null {
  try {
    const url = new URL(typeof value === "string" ? value : "");
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

// Allowlist persisted/model data before display, including demo projection.
export function readCompanyProfile(value: unknown): CompanyProfile | null {
  const p = value as Partial<CompanyProfile> | null;
  if (!p || p.version !== 1 || !Array.isArray(p.facts) ||
      typeof p.researchedAt !== "string" || !Number.isFinite(Date.parse(p.researchedAt))) return null;
  const facts = COMPANY_FACT_KEYS.flatMap(key => {
    const f = p.facts!.find(f => f && f.key === key);
    if (!f || typeof f.sentence !== "string" || !f.sentence.trim() || f.sentence.length > 650 ||
        !["reported", "estimate", "observed"].includes(f.status)) return [];
    const sources = (Array.isArray(f.sources) ? f.sources : []).flatMap(s => {
      const url = safeSourceUrl(s?.url);
      return url ? [{ url, title: typeof s.title === "string" ? s.title.slice(0, 200) : new URL(url).hostname,
        ...(typeof s.date === "string" ? { date: s.date.slice(0, 60) } : {}) }] : [];
    }).slice(0, 3);
    return sources.length ? [{ key, sentence: f.sentence.trim(), status: f.status, sources }] : [];
  });
  return { version: 1, researchedAt: p.researchedAt, facts };
}
