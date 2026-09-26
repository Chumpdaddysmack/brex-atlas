import test from "node:test";
import assert from "node:assert/strict";
import { applyPackageCost, FALLBACK_ASSUMPTIONS, ROI_INFERENCE_SYSTEM_PROMPT } from "./roi-calc";
import { PRICING_VERSION } from "@shared/service-packages";

test("each preferred package uses an explicit midpoint scenario, never changes client deal economics", () => {
  for (const [preferredTier, cost] of [["advisor", 51000], ["strategist", 87000], ["fractional", 150000]] as const) {
    const input = { ...FALLBACK_ASSUMPTIONS, avgDealSize: 12345 };
    const before = JSON.stringify(input);
    const result = applyPackageCost(input, { assumptions: JSON.stringify({ preferredTier }) });
    assert.equal(result.programCost12Mo, cost);
    assert.equal(result.avgDealSize, 12345);
    assert.equal(JSON.stringify(input), before);
    assert.match(result.rationale.programCost, /not a final quote/);
    assert.equal(result.pricingVersion, PRICING_VERSION);
  }
});
test("model-written recommendations never select a financial scenario; explicit preferences still can", () => {
  const sow = { pricingVersion: PRICING_VERSION, recommendedTier: "advisor" };
  assert.equal(applyPackageCost(FALLBACK_ASSUMPTIONS, { sow }).programCost12Mo, 87000);
  assert.equal(applyPackageCost(FALLBACK_ASSUMPTIONS, { sow, assumptions: { preferredTier: "fractional" } }).programCost12Mo, 150000);
  const unknown = applyPackageCost(FALLBACK_ASSUMPTIONS, { sow: { recommendedTier: "advisor" } });
  assert.equal(unknown.programCost12Mo, 87000);
  assert.match(unknown.rationale.programCost, /not a recommendation/);
  assert.match(ROI_INFERENCE_SYSTEM_PROMPT, /NOT what the prospect charges/);
});
