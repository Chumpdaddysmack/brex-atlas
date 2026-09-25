import type { SOW } from "./schema";
import { standardizePackages } from "./service-packages";

// Approved September 25, 2026. Retainer proposal policy only: not a change to
// diagnostic/project fees, signed agreements, billing cadence, or ROI formulas.
export const ENGAGEMENT = {
  title: "12-month growth engagement",
  term: "A 12-month growth engagement with an initial six-month commitment.",
  commitment: "The initial six-month commitment gives implementation, testing, and optimization time to work and results time to materialize.",
  onRampTitle: "90-day roadmap | On-ramp quarter",
  onRamp: "The first 90 days are the on-ramp quarter (months 1–3): establish the foundations, launch the initial work, and build the operating rhythm for the full 12-month engagement.",
  continuation: "Months 4–12 build on that foundation through ongoing execution, measurement, optimization, and quarterly planning.",
  caveat: "Results and timing vary; the six-month commitment is not a guarantee of a specific outcome or payback date.",
} as const;
export const ENGAGEMENT_TERMS: readonly string[] = [ENGAGEMENT.term, ENGAGEMENT.commitment, ENGAGEMENT.onRamp, ENGAGEMENT.caveat];
export const ENGAGEMENT_PROMPT = `${ENGAGEMENT_TERMS.join("\n")}\n${ENGAGEMENT.continuation}
The 90-day roadmap remains the detailed on-ramp, not the entire offer. Do not promise guaranteed results by month six.
Keep monthly pricing and monthly billing unchanged. Do not invent cancellation rights, auto-renewal, notice periods, or payment penalties.`;

// Refresh proposal wording in existing saved SOWs without changing their stored
// historical JSON. Deliberately target engagement terms, not delivery calendars.
export function currentOfferText(value: string): string {
  const duration = "(?:3|three)[ -]months?|90[ -]days?";
  return value
    .replace(new RegExp(`\\bminimum\\s+(?:${duration})\\s+(?:engagement|term|commitment)\\b`, "gi"), "initial six-month commitment")
    .replace(new RegExp(`\\b(?:${duration})\\s+(?:minimum\\s+|initial\\s+)?(?:commitment|minimum engagement)\\b`, "gi"), "initial six-month commitment")
    .replace(new RegExp(`\\bminimum\\s+(?:engagement|term|commitment)\\s+(?:of\\s+)?(?:${duration})\\b`, "gi"), "initial six-month commitment")
    .replace(new RegExp(`\\b(?:${duration})\\s+minimum\\s+(?:term|contract|retainer)\\b`, "gi"), "initial six-month commitment")
    .replace(new RegExp(`\\b(?:${duration})\\s+(engagement|program|programme|retainer|contract|term)\\b`, "gi"), "12-month $1")
    .replace(new RegExp(`\\b(engagement|program|programme|retainer|contract|term)\\s+(?:of|for|lasting)\\s+(?:${duration})\\b`, "gi"), "$1 for 12 months");
}

export function currentOfferSow(sow: SOW): SOW {
  // Clone recursively: never mutate the report object or any nested array.
  const visit = (v: unknown): any => typeof v === "string" ? currentOfferText(v)
    : Array.isArray(v) ? v.map(visit)
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, value]) => [k, visit(value)])) : v;
  const updated = visit(sow) as SOW;
  const retained = (Array.isArray(updated.termsNotes) ? updated.termsNotes : [])
    .filter(v => typeof v === "string" && !ENGAGEMENT_TERMS.includes(v) &&
      !/initial six-month commitment|(?:6|six)[ -]month\s+(?:minimum|commitment)|12[ -]month\s+(?:growth\s+)?engagement/i.test(v));
  updated.termsNotes = [...ENGAGEMENT_TERMS, ...retained];
  return standardizePackages(updated);
}
