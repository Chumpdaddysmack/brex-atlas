export type WidgetFitTier = "advisor" | "strategist" | "full-fractional" | "not-a-fit";

export const WIDGET_SMALL_BUSINESS_FIT = Object.freeze({
  version: "under-1m-advisor-40-v1",
  revenueBand: "Under $1M",
  minimumScore: 40,
  qualifyingTier: "advisor" as const,
});

// Apply only to new diagnostics, after score normalization. Existing stored
// diagnostics and higher-revenue routing are intentionally left unchanged.
export function applySmallBusinessFit(
  revenueBand: string, normalizedScore: number, modelTier: WidgetFitTier,
): WidgetFitTier {
  if (revenueBand !== WIDGET_SMALL_BUSINESS_FIT.revenueBand) return modelTier;
  return Number.isFinite(normalizedScore) && normalizedScore >= WIDGET_SMALL_BUSINESS_FIT.minimumScore
    ? WIDGET_SMALL_BUSINESS_FIT.qualifyingTier : "not-a-fit";
}
