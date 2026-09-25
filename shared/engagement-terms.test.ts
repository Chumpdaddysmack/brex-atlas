import test from "node:test";
import assert from "node:assert/strict";
import { ENGAGEMENT, ENGAGEMENT_TERMS, currentOfferText, currentOfferSow } from "./engagement-terms";
import type { SOW } from "./schema";

test("legacy minimums become six-month commitments without confusing the annual horizon", () => {
  for (const term of ["3-month minimum engagement", "three month commitment", "3-month minimum term",
    "minimum engagement of 3 months", "Minimum 3-month engagement", "90-day commitment"]) {
    assert.equal(currentOfferText(term), "initial six-month commitment");
  }
  assert.equal(currentOfferText("A three-month engagement for Example."), "A 12-month engagement for Example.");
  assert.equal(currentOfferText("A program for 3 months."), "A program for 12 months.");
});
test("on-ramp timelines, project terms, pricing, and billing are not stretched to twelve months", () => {
  for (const text of ["90-day roadmap", "12-week publishing calendar", "3-month on-ramp quarter",
    "Weeks 1-4", "Monthly retainer, invoiced in advance", "$9,500/mo", "Five-day diagnostic",
    "3-month historical revenue", "30-day payment terms"]) {
    assert.equal(currentOfferText(text), text);
  }
});
test("existing SOWs get current terms without mutating saved findings or prices", () => {
  const sow: SOW = {
    engagementSummary: "A 3-month engagement with company-specific priorities.",
    phases: [{ name: "Foundation", weeks: "Weeks 1-4", deliverables: ["Positioning workshop"], outcomes: ["Clear message"] }],
    team: ["Strategist"], priceTiers: [{ name: "Advisor", monthly: "$3,500/mo", inclusions: ["Advisory"], bestFor: "Small team" }],
    termsNotes: ["3-month minimum engagement", "Monthly retainer, invoiced in advance"],
  };
  const before = JSON.stringify(sow);
  const updated = currentOfferSow(sow);
  assert.equal(JSON.stringify(sow), before);
  assert.deepEqual(updated.phases, sow.phases);
  assert.deepEqual(updated.priceTiers, sow.priceTiers);
  assert.equal(updated.engagementSummary, "A 12-month engagement with company-specific priorities.");
  assert.deepEqual(updated.termsNotes, [...ENGAGEMENT_TERMS, "Monthly retainer, invoiced in advance"]);
  assert.deepEqual(currentOfferSow(updated), updated);
});
test("terms explicitly explain quarter one and avoid a six-month results guarantee", () => {
  assert.match(ENGAGEMENT.onRamp, /months 1–3/);
  assert.match(ENGAGEMENT.continuation, /Months 4–12/);
  assert.match(ENGAGEMENT.caveat, /not a guarantee/);
});
