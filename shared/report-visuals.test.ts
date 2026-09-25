import test from "node:test";
import assert from "node:assert/strict";
import { buildReportVisuals } from "./report-visuals";

const input = {
  clientName: "Example company",
  extraction: { targetAudience: "Operations leaders", positioningStatement: "Clear reporting.",
    evidenceElements: ["First proof", "WITHHELD_SECOND_PROOF"], notes: "PRIVATE_NOTE" },
  strategy: { icp: { painPoints: ["First pain", "WITHHELD_SECOND_PAIN"] },
    positioningGaps: ["WITHHELD_POSITIONING_GAP"],
    ninetyDayPlan: [
      { phase: "Discover", weeks: "WITHHELD_WEEKS", focus: "Find the constraint.", outcomes: ["WITHHELD_OUTCOME"] },
      { phase: "WITHHELD_LATER_PHASE", weeks: "5–8", focus: "Second focus.", outcomes: [] },
    ] },
  competitors: [
    { name: "First rival", positioning: "First rival promise.", strengths: ["WITHHELD_STRENGTH"], weaknesses: ["WITHHELD_WEAKNESS"] },
    { name: "WITHHELD_SECOND_RIVAL", positioning: "Second rival promise." },
  ],
  swot: {
    strengths: [{title:"First strength", evidence:"Grounding."},{title:"WITHHELD_SECOND_STRENGTH", evidence:"Second grounding."}],
    weaknesses: [], opportunities: [], threats: [],
  },
  customerInsights: {
    journeyStages: [
      { stage:"aware", primaryQuestion:"What should change?", mindset:"Exploring.", channel:"WITHHELD_CHANNEL", contentAsset:"WITHHELD_ASSET", cta:"WITHHELD_CTA", exitCriterion:"WITHHELD_EXIT" },
      { stage:"deciding", primaryQuestion:"WITHHELD_LATER_QUESTION", mindset:"Comparing." },
    ],
    notes: "PRIVATE_BUYER_NOTE",
  },
};

test("demo visuals expose only explicitly selected examples, never later data", () => {
  const v = buildReportVisuals(input, true);
  assert.equal(v.preview, true);
  assert.equal(v.competitors.length, 2);
  assert.equal(v.journey.length, 1);
  assert.equal(v.roadmap.length, 1);
  assert.equal(v.swot[0].findings.length, 1);
  assert.ok(!JSON.stringify(v).includes("WITHHELD"));
  assert.ok(!JSON.stringify(v).includes("PRIVATE"));
});
test("full visuals retain all findings without modifying the source", () => {
  const before = JSON.stringify(input);
  const v = buildReportVisuals(input);
  assert.equal(v.competitors.length, 3);
  assert.equal(v.journey.length, 2);
  assert.equal(v.roadmap[0].outcomes[0], "WITHHELD_OUTCOME");
  assert.equal(v.swot[0].findings.length, 2);
  assert.equal(v.positioning[3].values.length, 2);
  assert.equal(JSON.stringify(input), before);
});
test("missing and malformed fields stay empty, not fabricated scores or stages", () => {
  const v = buildReportVisuals({ extraction: 3, strategy: {ninetyDayPlan: "bad"}, swot: [], competitors: null, customerInsights: {journeyStages:[null,7]} });
  assert.equal(v.journey.length, 0);
  assert.equal(v.roadmap.length, 0);
  assert.ok(v.swot.every(q=>q.findings.length===0));
  assert.ok(v.positioning.every(p=>p.values.length===0));
  assert.ok(!JSON.stringify(v).includes("score"));
});
test("partial and long preview findings fail closed without clipping caveats", () => {
  const v = buildReportVisuals({
    extraction: {positioningStatement: "x".repeat(2401)},
    swot: {strengths:[{title:"Headline without support", evidence:"x".repeat(2401)}]},
    customerInsights: {journeyStages:[{stage:"aware",primaryQuestion:"x".repeat(2401)}]},
  }, true);
  assert.deepEqual(v.positioning[2].values, []);
  assert.deepEqual(v.swot[0].findings, []);
  assert.deepEqual(v.journey, []);
});
test("serialized stored data retains week labels and handles legacy encoded arrays", () => {
  const v = buildReportVisuals({
    ...input, strategy: JSON.stringify(input.strategy), competitors: JSON.stringify(input.competitors),
    extraction: {evidenceElements: JSON.stringify(["First proof", "Second proof"])},
  });
  assert.equal(v.roadmap[1].weeks, "5–8");
  assert.equal(v.competitors.length, 3);
  assert.deepEqual(v.positioning[3].values, ["First proof", "Second proof"]);
});
