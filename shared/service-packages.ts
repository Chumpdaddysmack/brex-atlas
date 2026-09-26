import { BREX_TIERS, computeSavings, type BrexTier } from "./brex-pricing";
import type { SOW } from "./schema";

export const PRICING_VERSION = "brex-cmo-ranges-2026-09-25";
export const PACKAGE_SCOPE_NOTE = "Monthly ranges depend on agreed scope, delivery volume, and complexity. Listed inclusions describe the baseline service mix, not unlimited execution. Final fees and deliverables require approval; additional work, media spend, software, and third-party costs are scoped separately. The full roadmap is not included in every package.";
export type PackageKey = BrexTier["key"];

export function packageFor(key: unknown): BrexTier | undefined {
  return BREX_TIERS.find(t => t.key === (key === "full-fractional" ? "fractional" : key));
}
export function packageMonthlyLabel(t: BrexTier): string {
  return `${packageRange(t)}/mo`;
}
export function packageRange(t: BrexTier): string {
  return `$${t.monthly.toLocaleString("en-US")}–$${t.monthlyMax.toLocaleString("en-US")}`;
}
export function packageSavingsRange(t: BrexTier, midpoint: number): string {
  return `${computeSavings(t.monthly, midpoint).label} to ${computeSavings(t.monthlyMax, midpoint).label}`;
}
export function canonicalPriceTiers(): SOW["priceTiers"] {
  return BREX_TIERS.map(t => ({
    name: t.name, monthly: packageMonthlyLabel(t), inclusions: [...t.includes], bestFor: t.bestFor,
  }));
}
export const PACKAGE_PROMPT = `BREX SERVICE CATALOG (approved ranges, not market benchmarks):
${JSON.stringify(canonicalPriceTiers())}
Use exactly these three package names, monthly ranges, and baseline inclusions. Do not invent, narrow, or discount these ranges. Never select a final fee without an approved scope.
Set recommendedTier to null. The separate evidence assessment and human approval determine service fit; do not automatically recommend the middle tier or infer fit from revenue, headcount, or a CMO title. A preferred tier is a preference, not verified suitability. If the budget cannot cover the requested remit, flag it for human review instead of lowering the price.
${PACKAGE_SCOPE_NOTE}
Tailor strategic priorities and quarterly planning to the client. Volume and final deliverables require scope approval. Do not promise the complete plan at the Advisor fee. Never call these packages Foundation, Growth, or Scale; those words may still describe roadmap phases.
Do not restate package prices in the summary, team, phase deliverables, or terms: priceTiers is the authoritative commercial table. Recommendations are subject to Kenneth's review.`;

/** Current proposal view only; leaves the saved SOW and signed agreements untouched. */
export function standardizePackages(sow: SOW): SOW {
  const isLegacy = sow.pricingVersion !== PRICING_VERSION;
  const oldTiers = Array.isArray(sow.priceTiers) ? sow.priceTiers : [];
  const clean = (value: unknown): any => {
    if (typeof value === "string") {
      let text = value;
      for (let i = 0; i < oldTiers.length && i < BREX_TIERS.length; i++) {
        const old = oldTiers[i];
        const mapped = /foundation/i.test(old?.name) ? BREX_TIERS[0]
          : /^growth\b/i.test(old?.name) ? BREX_TIERS[1]
          : /^scale\b/i.test(old?.name) ? BREX_TIERS[2]
          : BREX_TIERS.find(t => t.name === old?.name);
        if (!mapped) continue;
        // Replace explicit package phrases, never a standalone roadmap phase name.
        const name = old.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        text = text.replace(new RegExp(`\\b${name}\\s+(tier|package|plan|retainer)\\b`, "gi"), `${mapped.name} $1`);
        if (old.monthly && old.monthly !== packageMonthlyLabel(mapped)) {
          text = text.split(old.monthly).join(packageMonthlyLabel(mapped));
        }
      }
      return text;
    }
    if (Array.isArray(value)) return value.map(clean);
    return value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clean(v)])) : value;
  };
  const updated = clean(sow) as SOW;
  updated.priceTiers = canonicalPriceTiers();
  // Do not reinterpret an old model recommendation as a recommendation for a
  // materially different catalog package.
  // Recommendations now live in the evidence assessment, not model-written SOW
  // JSON. Keep legacy and newly generated guesses out of all proposal views.
  updated.recommendedTier = null;
  updated.pricingVersion = PRICING_VERSION;
  updated.termsNotes = [...(Array.isArray(updated.termsNotes) ? updated.termsNotes : [])
    .filter(t => t !== PACKAGE_SCOPE_NOTE), PACKAGE_SCOPE_NOTE];
  return updated;
}

export function parseCurrentSow(raw: unknown): SOW | null {
  try {
    const sow = typeof raw === "string" ? JSON.parse(raw) : raw;
    return sow && typeof sow === "object" && !Array.isArray(sow) ? standardizePackages(sow) : null;
  } catch { return null; }
}
