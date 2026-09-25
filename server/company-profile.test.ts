import test from "node:test";
import assert from "node:assert/strict";
import { generateCompanyProfile, normalizeCompanyResearch, researchAndSaveCompanyProfile } from "./company-profile";
import { readCompanyProfile } from "@shared/company-profile";
import { buildDemoReport } from "./demo-report";
import type { Analysis } from "@shared/schema";

const citations = [{ title: "Company history", url: "https://example.com/about" }, { title: "Revenue estimate", url: "https://example.org/estimate", date: "2025" }];
const raw = { facts: [
  { key: "business", sentence: "Example makes industrial components.", status: "reported", sourceIndexes: [0] },
  { key: "annualRevenue", sentence: "Annual revenue was estimated at US$10 million for 2025.", status: "estimate", sourceIndexes: [1] },
  { key: "ownership", sentence: "Unsupported ownership claim.", status: "reported", sourceIndexes: [99] },
] };
const profile = normalizeCompanyResearch(raw, citations);
const analysis = { id: "intro-test", status: "done", clientName: "Example", clientUrl: "https://example.com",
  extraction: JSON.stringify({ positioningStatement: "Existing positioning.", valueProps: ["Unchanged"] }),
  strategy: "UNCHANGED_STRATEGY", sow: "UNCHANGED_SOW", assumptions: "PRIVATE_INPUTS" } as Analysis;

test("keeps supported facts and estimate labels, drops unsupported source indexes", () => {
  assert.deepEqual(profile.facts.map(f => f.key), ["business", "annualRevenue"]);
  assert.equal(profile.facts[1].status, "estimate");
  assert.equal(profile.facts[1].sources[0].date, "2025");
});
test("ignores malformed shapes, unknown fields, unsafe links, and unbounded prose", () => {
  assert.equal(readCompanyProfile(null), null);
  assert.equal(readCompanyProfile({ version: 1, facts: [], researchedAt: "bad" }), null);
  const result = normalizeCompanyResearch({ facts: [
    null, { key: "notes", sentence: "PRIVATE", status: "reported", sourceIndexes: [0] },
    { key: "employees", sentence: "100 staff.", status: "reported", sourceIndexes: [-1, 0.5, "0", 9] },
    { key: "founded", sentence: "Since 1970.", status: "reported", sourceIndexes: [2] },
    { key: "business", sentence: "a".repeat(651), status: "reported", sourceIndexes: [0] },
  ] }, [...citations, { title: "Unsafe", url: "javascript:alert(1)" }]);
  assert.deepEqual(result.facts, []);
});
test("company research requests history without year-only filter and uses supplied sources", async () => {
  let options: any;
  const result = await generateCompanyProfile(analysis, {
    research: async (_question, opts) => { options = opts; return { answer: "Cited findings.", citations }; },
    structure: async () => raw,
  });
  assert.equal(options.recency, null);
  assert.equal(result.facts.length, 2);
});
test("unavailable or source-free research never falls back to fabricated model knowledge", async () => {
  for (const response of [null, { answer: "Unsourced answer", citations: [] }]) {
    await assert.rejects(generateCompanyProfile(analysis, {
      research: async () => response, structure: async () => { throw new Error("Should not run"); },
    }), /research is unavailable/);
  }
});
test("unsupported structured response fails instead of replacing a good introduction", async () => {
  await assert.rejects(generateCompanyProfile(analysis, {
    research: async () => ({ answer: "Cited findings", citations }), structure: async () => ({ facts: [] }),
  }), /No source-supported/);
});
test("refresh updates only extraction.companyProfile and preserves all other findings", async () => {
  let saved: Partial<Analysis> | undefined;
  const result = await researchAndSaveCompanyProfile(analysis.id, {
    getAnalysis: async () => analysis,
    updateAnalysis: async (_id, patch) => { saved = patch; return { ...analysis, ...patch }; },
  }, async () => profile);
  assert.deepEqual(result, profile);
  assert.deepEqual(Object.keys(saved!), ["extraction"]);
  assert.deepEqual(JSON.parse(saved!.extraction!), { ...JSON.parse(analysis.extraction!), companyProfile: profile });
});
test("failed research and concurrent report changes preserve saved data", async () => {
  let writes = 0, reads = 0;
  const store = { getAnalysis: async () => analysis, updateAnalysis: async () => { writes++; return analysis; } };
  await assert.rejects(researchAndSaveCompanyProfile(analysis.id, store, async () => { throw new Error("Unavailable"); }));
  await assert.rejects(researchAndSaveCompanyProfile(analysis.id, {
    ...store, getAnalysis: async () => ++reads === 1 ? analysis : { ...analysis, extraction: "{}" },
  }, async () => profile), /report changed/);
  assert.equal(writes, 0);
});
test("unknown, running, or malformed analyses are rejected before paid research", async () => {
  for (const row of [undefined, { ...analysis, status: "strategy" }, { ...analysis, extraction: "broken" }]) {
    await assert.rejects(researchAndSaveCompanyProfile(analysis.id, {
      getAnalysis: async () => row, updateAnalysis: async () => { throw new Error("Must not write"); },
    }, async () => { assert.fail("Must not research"); }));
  }
});
test("duplicate clicks are rejected and the research lock is released", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const store = { getAnalysis: async () => analysis, updateAnalysis: async () => analysis };
  const first = researchAndSaveCompanyProfile(analysis.id, store, async () => { await gate; return profile; });
  await assert.rejects(researchAndSaveCompanyProfile(analysis.id, store), /already running/);
  release(); await first;
  await researchAndSaveCompanyProfile(analysis.id, store, async () => profile);
});
test("demo includes only allowlisted public company facts and leaves original untouched", () => {
  const row = { ...analysis, extraction: JSON.stringify({
    companyProfile: { ...profile, internalNotes: "PRIVATE_SECRET" }, positioningStatement: "Original.",
  }) };
  const before = JSON.stringify(row);
  const demo = buildDemoReport(row, null);
  assert.deepEqual(demo.companyProfile, profile);
  assert.ok(!JSON.stringify(demo).includes("PRIVATE_"));
  assert.equal(JSON.stringify(row), before);
  assert.equal(buildDemoReport(analysis, null).companyProfile, undefined);
});
