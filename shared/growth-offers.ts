// Approved pilot offer policy. Diagnostic scores are deliberately not inputs.
export const GROWTH_OFFERS = {
  foundations: { name: "Growth Excavation: Foundations", priceUsd: 495 },
  focus: { name: "Growth Excavation: Focus", priceUsd: 1495 },
  "full-report": { name: "Growth Excavation Report", priceUsd: 4995 },
} as const;

export type PaidGrowthOffer = keyof typeof GROWTH_OFFERS;
export type GrowthOffer = PaidGrowthOffer | "free-resources";
export type ImplementationReadiness = "owner" | "team-partner" | "not-ready";
export type GrowthNeed = "first-priority" | "one-problem" | "comprehensive";

export function recommendGrowthOffer(
  need: GrowthNeed,
  readiness: ImplementationReadiness,
): GrowthOffer {
  if (readiness === "not-ready") return "free-resources";
  return {
    "first-priority": "foundations",
    "one-problem": "focus",
    comprehensive: "full-report",
  }[need] as PaidGrowthOffer;
}

/** Date-only policy: the expiry date is inclusive; later upgrades never reset it. */
export function reportCreditExpiry(firstDeliveryDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(firstDeliveryDate)) throw new Error("A delivery date is required.");
  const date = new Date(`${firstDeliveryDate}T00:00:00Z`);
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== firstDeliveryDate) {
    throw new Error("Invalid delivery date.");
  }
  date.setUTCDate(date.getUTCDate() + 60);
  return date.toISOString().slice(0, 10);
}

/** A quote only, not a payment event. Values must come from verified billing records. */
export function quoteReportUpgrade(input: {
  currentOffer: PaidGrowthOffer;
  targetOffer: PaidGrowthOffer;
  netPaidUsd: number;
  firstDeliveryDate: string;
  asOfDate: string;
  sameScope: boolean;
}) {
  const current = GROWTH_OFFERS[input.currentOffer];
  const target = GROWTH_OFFERS[input.targetOffer];
  if (!current || !target || target.priceUsd <= current.priceUsd) throw new Error("Select a higher report tier.");
  if (!Number.isFinite(input.netPaidUsd) || input.netPaidUsd < 0) throw new Error("Invalid net paid amount.");
  const expiresAt = reportCreditExpiry(input.firstDeliveryDate);
  reportCreditExpiry(input.asOfDate); // Validate comparison date.
  const eligible = input.sameScope && input.asOfDate >= input.firstDeliveryDate && input.asOfDate <= expiresAt;
  const creditUsd = eligible ? Math.min(input.netPaidUsd, target.priceUsd) : 0;
  return { expiresAt, eligible, creditUsd, amountDueUsd: target.priceUsd - creditUsd };
}
