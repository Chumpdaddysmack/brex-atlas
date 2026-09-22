import test from "node:test";
import assert from "node:assert/strict";
import PDFDocument from "pdfkit";
import { drawGanttTimeline, measureGanttTimeline } from "./pdf-charts";

const pillars = [
  "Digital Sustainment & Digital Thread Leadership",
  "Trusted Partner, Not Just a Prime",
  "Global Readiness & Compliance",
  "Beyond Staffing: Integrated Platform Engineering",
].map(name => ({ name, description: "" }));

function document() {
  const doc = new PDFDocument({ size: "LETTER", margin: 72, bufferPages: true });
  doc.resume();
  return doc;
}

test("timeline reserves the full wrapped label height and does not move the cursor while measuring", () => {
  const doc = document();
  const y = doc.y;
  const layout = measureGanttTimeline(doc, pillars, 468);
  assert.equal(doc.y, y);
  for (const row of layout.rows) {
    assert.ok(row.height >= row.textHeight + 12);
    assert.ok(row.height > 18, "old fixed-height rows caused bleedover");
  }
  const end = drawGanttTimeline(doc, [], pillars, 72, 100, 468);
  assert.equal(end, 100 + layout.height);
  assert.equal(doc.bufferedPageRange().count, 1);
  doc.end();
});

test("timeline grows for longer labels rather than truncating them", () => {
  const doc = document();
  const short = measureGanttTimeline(doc, [{ name: "Short", description: "" }], 468);
  const long = measureGanttTimeline(doc, [{
    name: "Integrated Platform Engineering and Global Regulatory Readiness for Aerospace Manufacturing Teams",
    description: "",
  }], 468);
  assert.ok(long.height > short.height);
  doc.end();
});

test("timeline keeps rows within page margins and repeats the week header on continuation pages", () => {
  const doc = document();
  const headers: number[] = [];
  const labels: number[] = [];
  const original = doc.text.bind(doc);
  doc.text = ((text: string, ...args: any[]) => {
    if (text === "PILLAR") headers.push(args[1]);
    if (pillars.some(p => p.name === text)) {
      const [x, y, options] = args;
      const height = doc.heightOfString(text, options);
      assert.ok(y >= 72 && y + height <= 720, `label outside content area: ${text}`);
      labels.push(y);
    }
    return (original as any)(text, ...args);
  }) as typeof doc.text;
  const end = drawGanttTimeline(doc, [], pillars, 72, 665, 468);
  assert.equal(labels.length, pillars.length);
  assert.equal(headers.length, 2);
  assert.equal(doc.bufferedPageRange().count, 2);
  assert.ok(end <= 720);
  doc.end();
});
