import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createContentPlanDeck } from "./pptx-export";
import { executivePdfPayload } from "../scripts/fixtures/executive-pdf";
import { deckFilename, parseDeckScope } from "../shared/deck-export-options";
import JSZip from "jszip";
import { compatiblePptx } from "./pptx-package";

const originalFetch = globalThis.fetch;
before(() => { globalThis.fetch = (async () => new Response("", { status: 404 })) as typeof fetch; });
after(() => { globalThis.fetch = originalFetch; });
const args = { payload: executivePdfPayload, clientName: "Summary QA", clientUrl: "https://example.invalid",
  swot: { industry: "QA", summary: "FULL_REPORT_FRAMEWORK_MARKER", strengths: [], weaknesses: [], opportunities: [], threats: [] } };

test("deck scope defaults to summary while explicit full retains its original filename", () => {
  assert.equal(parseDeckScope(undefined), "summary");
  assert.equal(parseDeckScope("summary"), "summary");
  assert.equal(parseDeckScope("full"), "full");
  for (const invalid of ["", "CEO", ["full"], {}]) assert.throws(() => parseDeckScope(invalid));
  assert.equal(deckFilename("Test company", "summary"), "Test_company-executive-summary-deck.pptx");
  assert.equal(deckFilename("Test company", "full"), "Test_company-content-strategy-deck.pptx");
});

test("summary includes only summary sections, a week-one preview, and ends with next steps", async () => {
  const before = JSON.stringify(args);
  const d = await createContentPlanDeck({ ...args, scope: "summary" });
  const text = d.regions.map(r => r.text).join("\n").replace(/\s+/g, " ");
  for (const required of ["EXECUTIVE SUMMARY", "12-Month Growth Engagement", "At a Glance", "Strategic Thesis",
    "Pillar Mix", "Publishing Timeline", "Brex vs. Market", "Investment Benchmarks", "Week 1 Preview", "Next Steps"])
    assert.ok(text.includes(required), required);
  for (const post of executivePdfPayload.blogCalendar[0].posts) assert.ok(text.includes(post.title));
  assert.doesNotMatch(text, /QA week 2 post|FULL_REPORT_FRAMEWORK_MARKER|Brex vs. Market \| Services|Site Page Brief|Customer Insights/);
  const finalSlideText = d.regions.filter(r => r.slide === d.slides.length - 1).map(r => r.text).join(" ");
  assert.match(finalSlideText, /Next Steps/);
  assert.equal(JSON.stringify(args), before);
  assert.ok(d.footerSources.size >= 2);
  const overlaps = d.regions.flatMap((a, i) => d.regions.slice(i + 1).filter(b => a.slide === b.slide &&
    Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > .01 &&
    Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > .01));
  assert.equal(overlaps.length, 0);
});

test("the explicit full deck retains detailed sections and the legacy internal default", async () => {
  const full = await createContentPlanDeck({ ...args, scope: "full" });
  const legacy = await createContentPlanDeck(args);
  assert.deepEqual(full.regions, legacy.regions);
  assert.match(full.regions.map(r => r.text).join(" "), /FULL_REPORT_FRAMEWORK_MARKER/);
  assert.match(full.regions.map(r => r.text).join(" "), /Brex vs. Market \| Services/);
});

test("rich citation paragraphs are repaired without losing text or links", async () => {
  const z = new JSZip();
  z.file("[Content_Types].xml", '<Types></Types>');
  z.file("ppt/slides/slide1.xml", '<a:p><a:r><a:t xml:space="preserve">Source: </a:t></a:r><a:pPr/><a:r><a:rPr><a:hlinkClick r:id="rId1"/></a:rPr><a:t>Reference</a:t></a:r><a:pPr/></a:p>');
  const out = await JSZip.loadAsync(await compatiblePptx(await z.generateAsync({ type: "nodebuffer" })));
  const xml = await out.file("ppt/slides/slide1.xml")!.async("string");
  assert.ok(xml.startsWith("<a:p><a:pPr/>"));
  assert.equal((xml.match(/<a:pPr/g) || []).length, 1);
  assert.doesNotMatch(xml, /xml:space/);
  assert.match(xml, /Source: /);
  assert.match(xml, /a:hlinkClick r:id="rId1"/);
});
