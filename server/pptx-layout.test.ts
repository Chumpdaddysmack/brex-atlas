import { test } from "node:test";
import assert from "node:assert/strict";
import { BOX, DeckLayout, lines, textHeight } from "./pptx-layout";
import { compatiblePptx } from "./pptx-package";
import JSZip from "jszip";
import { createContentPlanDeck } from "./pptx-export";
import type { ContentPlanPayload } from "@shared/schema";
import { ENGAGEMENT } from "@shared/engagement-terms";

function check(d: DeckLayout) {
  for (const [i, a] of d.regions.entries()) {
    assert.ok(a.x >= .5 && a.x + a.w <= 9.5 + 1e-6);
    assert.ok(a.y >= .35 && a.y + a.h <= 5.4);
    for (const b of d.regions.slice(i + 1)) {
      if (a.slide !== b.slide) continue;
      const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      assert.ok(overlapX <= .01 || overlapY <= .01, `${a.text} overlaps ${b.text}`);
    }
  }
}
test("long narrative continues without truncation, overlap, or tiny fonts", () => {
  const d = new DeckLayout("Test");
  const text = Array.from({ length: 220 }, (_, i) => `UniqueFinding${i}`).join(" ");
  d.section("Dense report", [{ label: "Evidence", text }]);
  assert.ok(d.slides.length > 1);
  check(d);
  const combined = d.regions.map(r => r.text).join(" ");
  for (let i = 0; i < 220; i++) assert.ok(combined.includes(`UniqueFinding${i}`));
  assert.ok(d.regions.every(r => r.size >= 15));
});
test("long unbroken identifiers wrap and explicit paragraphs survive", () => {
  const wrapped = lines(`First paragraph\n${"W".repeat(450)}\nLast paragraph`, 3, 15);
  assert.equal(wrapped.join("").replaceAll(" ", ""), `Firstparagraph${"W".repeat(450)}Lastparagraph`);
  assert.ok(wrapped.length > 4);
});
test("website paths prefer semantic breaks and preserve every character", () => {
  const path = "/solutions/international-defense-allied-nations";
  const wrapped = lines(path, 2.3, 15);
  assert.equal(wrapped.join(""), path);
  assert.ok(wrapped.slice(0, -1).every(line => /[-/]$/.test(line)));
});
test("a whole finding moves to the next slide rather than breaking mid-sentence", () => {
  const d = new DeckLayout("Test");
  const evidence = "This finding is deliberately long and must remain complete. ".repeat(12);
  d.section("Evidence", [{ label: "Opening", text: "Short context ".repeat(65) }, { label: "Complete finding", text: evidence }]);
  const matches = d.regions.filter(r => r.text.startsWith("This finding"));
  assert.equal(matches.length, 1);
  assert.equal(matches[0].text.replace(/\s+/g, " ").trim(), evidence.trim());
  check(d);
});
test("very long headings paginate instead of repeatedly prepending forever", () => {
  const d = new DeckLayout("Test");
  d.section("Long labels", [{ label: "Long heading ".repeat(150), text: "Complete evidence ".repeat(160) }]);
  assert.ok(d.slides.length < 30);
  check(d);
});
test("tables repeat headers and retain oversized cells across slides", () => {
  const d = new DeckLayout("Test");
  d.table("Directory", ["Page", "Path"], [4.4, 4.4], Array.from({ length: 25 }, (_, i) => [
    `Page ${i}: ${"Detailed label ".repeat(i === 4 ? 100 : 5)}`, `/services/${"long-path-".repeat(9)}${i}`,
  ]));
  check(d);
  assert.ok(d.slides.length > 3);
  assert.equal(d.regions.filter(r => r.text === "Page").length, d.slides.length);
  assert.ok(d.regions.every(r => r.size >= 14));
});
test("compact field rows keep labels and values in separate columns", () => {
  const d = new DeckLayout("Test");
  d.section("Buyer Journey", Array.from({ length: 12 }, (_, i) => ({ label: `Field ${i}`, text: "A detailed buyer insight ".repeat(6) })));
  d.finish();
  check(d);
  assert.ok(d.regions.filter(r => r.y >= BOX.footer).every(r => r.y + r.h <= 5.4));
});
test("empty sections do not create empty slides and metrics account for paragraphs", () => {
  const d = new DeckLayout("Test");
  d.section("Empty", []);
  assert.equal(d.slides.length, 0);
  assert.ok(textHeight("One\nTwo", 8.8, 15) > textHeight("One", 8.8, 15));
});
test("chart rows paginate long names and zero values without overlapping", () => {
  const d = new DeckLayout("Test");
  d.bars("Pillar Mix", Array.from({ length: 22 }, (_, i) => ({
    label: `Pillar ${i}: ${"Long strategic topic ".repeat(4)}`, value: i, detail: `${i} posts\n${i}%`,
  })));
  check(d);
  assert.ok(d.slides.length > 1);
});
test("every exported package omits invalid directories and phantom masters", async () => {
  const d = new DeckLayout("Test");
  d.section("Package test", [{ text: "Evidence ".repeat(600) }]);
  const buffer = await compatiblePptx(await d.pptx.write({ outputType: "nodebuffer" }) as Buffer);
  const zip = await JSZip.loadAsync(buffer);
  assert.ok(Object.values(zip.files).every(f => !f.dir));
  const types = await zip.file("[Content_Types].xml")!.async("string");
  for (const m of Array.from(types.matchAll(/PartName="\/(ppt\/slideMasters\/[^"]+)"/g))) assert.ok(zip.file(m[1]));
  assert.equal(Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length, d.slides.length);
});
test("the complete exporter handles absent optional sections without changing report data", async () => {
  const payload = {
    summary: "A focused test strategy.",
    contentPillars: Array.from({ length: 7 }, (_, i) => ({ name: `Pillar ${i + 1}`, description: "Complete pillar description." })),
    blogCalendar: [],
  } as unknown as ContentPlanPayload;
  const before = JSON.stringify(payload);
  const prior = globalThis.fetch;
  globalThis.fetch = (async () => new Response("", { status: 404 })) as typeof fetch;
  try {
    const d = await createContentPlanDeck({ payload, clientName: "Quality assurance test", clientUrl: "https://example.invalid" });
    check(d);
    assert.equal(JSON.stringify(payload), before);
    for (let i = 1; i <= 7; i++) assert.ok(d.regions.some(r => r.text === `Content Pillar ${i}`));
    assert.ok(!d.regions.some(r => r.text === "Customer Insights"));
    const text = d.regions.map(r => r.text).join(" ").replace(/\s+/g, " ");
    for (const required of [ENGAGEMENT.term, ENGAGEMENT.onRamp, ENGAGEMENT.caveat]) {
      assert.ok(text.includes(required), `Missing engagement framing: ${required}`);
    }
  } finally { globalThis.fetch = prior; }
});
