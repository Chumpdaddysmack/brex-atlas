import test from "node:test";
import assert from "node:assert/strict";
import { BREX_TIERS } from "./brex-pricing";
import { canonicalPriceTiers, standardizePackages, PRICING_VERSION, PACKAGE_PROMPT, parseCurrentSow, packageFor } from "./service-packages";
import type { SOW } from "./schema";

const legacy = (): SOW => ({
  engagementSummary: "A Growth package at $15,000/mo supports the buyer journey.",
  priceTiers: [
    { name: "Foundation", monthly: "$9,000/mo", inclusions: ["Invented scope"], bestFor: "Small" },
    { name: "Growth", monthly: "$15,000/mo", inclusions: ["Unlimited work"], bestFor: "Medium" },
    { name: "Scale", monthly: "$30,000/mo", inclusions: [], bestFor: "Large" },
  ],
  team: ["CMO"], termsNotes: ["Monthly billing"],
  phases: [{ name: "Foundation", weeks: "Weeks 1-4", deliverables: ["Positioning"], outcomes: ["Clarity"] }],
});
test("approved ranges are the only canonical package prices", () => {
  assert.deepEqual(BREX_TIERS.map(t => [t.name, t.monthly, t.monthlyMax]), [
    ["Advisor CMO", 3500, 5000], ["Strategist CMO", 6500, 8000], ["Full Fractional CMO", 9500, 15500],
  ]);
  assert.deepEqual(canonicalPriceTiers().map(t => t.monthly), ["$3,500–$5,000/mo", "$6,500–$8,000/mo", "$9,500–$15,500/mo"]);
});
test("old proposals use catalog scope and ranges, not arbitrary model fees, without mutating data", () => {
  const input = legacy(), before = JSON.stringify(input);
  const result = standardizePackages(input);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(result.priceTiers, canonicalPriceTiers());
  assert.equal(result.recommendedTier, null);
  assert.equal(result.engagementSummary, "A Strategist CMO package at $6,500–$8,000/mo supports the buyer journey.");
  assert.deepEqual(result.phases, input.phases);
  assert.deepEqual(standardizePackages(result), result);
});
test("model-written SOW recommendations are not presented as evidence-approved recommendations", () => {
  assert.equal(standardizePackages({ ...legacy(), pricingVersion: PRICING_VERSION, recommendedTier: "advisor" }).recommendedTier, null);
  assert.equal(standardizePackages({ ...legacy(), recommendedTier: "strategist" }).recommendedTier, null);
  assert.equal(standardizePackages({ ...legacy(), pricingVersion: PRICING_VERSION, recommendedTier: "invalid" as any }).recommendedTier, null);
});
test("defensive parsing handles missing and malformed legacy payloads", () => {
  for (const input of [null, "", "broken", "[]"]) assert.equal(parseCurrentSow(input), null);
  assert.deepEqual(parseCurrentSow(JSON.stringify(legacy()))?.priceTiers, canonicalPriceTiers());
  assert.equal(packageFor("full-fractional")?.name, "Full Fractional CMO");
});
test("generation instructions constrain pricing and require final scope approval", () => {
  for (const tier of canonicalPriceTiers()) { assert.ok(PACKAGE_PROMPT.includes(tier.name)); assert.ok(PACKAGE_PROMPT.includes(tier.monthly)); }
  assert.match(PACKAGE_PROMPT, /Never select a final fee/);
  assert.match(PACKAGE_PROMPT, /not automatically recommend the middle tier/);
});
