import test from "node:test";
import assert from "node:assert/strict";
import { buildDemoReport } from "./demo-report";
import type { Analysis, ContentPlan } from "@shared/schema";

const analysis = Object.freeze({
  id: "demo-fixture", clientName: "Demo Company", clientUrl: "https://example.com",
  status: "done", progress: 100, createdAt: 1,
  notes: "PRIVATE_NOTES", assumptions: '{"budget":"PRIVATE_BUDGET"}',
  extraction: JSON.stringify({ positioningStatement: "First complete positioning finding.", ctaAudit: "First CTA finding." }),
  competitors: JSON.stringify([{ name: "Example competitor", positioning: "First competitor finding." }, { name: "PRIVATE_COMPETITOR" }]),
  strategy: JSON.stringify({ icp: { summary: "Customer profile." }, positioningGaps: ["First gap.", "PRIVATE_SECOND_GAP"], quickWins: ["First move.", "PRIVATE_SECOND_MOVE"] }),
  sow: JSON.stringify({ engagementSummary: "Engagement overview.", priceTiers: ["PRIVATE_PRICE"] }),
  swot: JSON.stringify({ strengths: [{ title: "Strength", evidence: "First evidence." }, { title: "PRIVATE_SWOT" }] }),
  pestel: JSON.stringify({ findings: [{ factor: "Economic", insight: "First factor.", sources: [{ title: "Reference", url: "https://example.com/evidence" }, { url: "javascript:alert(1)" }] }] }),
  porters: null, customerInsights: null,
} as unknown as Analysis);
const plan = Object.freeze({
  planJson: JSON.stringify({
    summary: "Content thesis.",
    blogCalendar: [{ posts: [{ title: "Opening topic", angle: "First angle." }, { title: "PRIVATE_SECOND_POST" }] }],
    heroColdEmail: { subjectLineA: "First subject", body: "PRIVATE_EMAIL_BODY" },
    roiProjections: { assumptions: { rationale: { dealSize: "Working assumption, not verified." } }, outcomes: "PRIVATE_ROI" },
  }),
} as ContentPlan);

test("demo projection contains complete opening examples and leaves full data unchanged", () => {
  const before = JSON.stringify({ analysis, plan });
  const result = buildDemoReport(analysis, plan);
  assert.equal(result.mode, "demo");
  assert.equal(result.sections.length, 31);
  assert.equal(result.sections.find(s => s.id === "gap")?.items[0].text, "First gap.");
  assert.equal(result.sections.find(s => s.id === "blog")?.items[0].text, "First angle.");
  assert.equal(JSON.stringify({ analysis, plan }), before);
  assert.ok(analysis.strategy?.includes("PRIVATE_SECOND_GAP"));
});
test("demo payload excludes internal fields, remaining findings, full copy, and finances", () => {
  const result = buildDemoReport(analysis, plan);
  assert.ok(!JSON.stringify(result).includes("PRIVATE_"));
  assert.deepEqual(Object.keys(result).sort(), ["clientName", "clientUrl", "id", "mode", "sections", "status", "version"]);
});
test("selected citations are retained and unsafe URLs rejected", () => {
  assert.deepEqual(buildDemoReport(analysis, plan).sections.find(s => s.id === "pestel")?.items[0].sources,
    [{ title: "Reference", url: "https://example.com/evidence" }]);
});
test("missing and malformed report sections do not invent preview content", () => {
  const empty = { ...analysis, extraction: "{broken", competitors: "null", strategy: "[]", sow: null, swot: null, pestel: null };
  assert.ok(buildDemoReport(empty, null).sections.every(s => !s.items.length));
});
test("long findings are omitted rather than cut off without their caveats", () => {
  const long = { ...analysis, extraction: JSON.stringify({ positioningStatement: "a".repeat(2401) }) };
  assert.deepEqual(buildDemoReport(long, null).sections.find(s => s.id === "positioning")?.items, []);
});
