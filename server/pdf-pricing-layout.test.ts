import test from "node:test";
import assert from "node:assert/strict";
import PDFDocument from "pdfkit";
import { renderBrexPricingMatrix } from "./pdf-export";
import { BREX_LINE_ITEMS } from "../shared/brex-pricing";

test("service pricing rows, repeated headers and note remain inside their measured bounds", () => {
  for (const start of [72, 250, 560, 680]) {
    const doc = new PDFDocument({ size: "LETTER", margins: { top: 72, bottom: 72, left: 72, right: 72 }, bufferPages: true });
    doc.resume();
    doc.y = start;
    const cells: { text: string; x: number; y: number; w: number; h: number; page: unknown }[] = [];
    const original = doc.text.bind(doc);
    let inServices = false;
    let note: typeof cells[number] | undefined;
    (doc as any).text = (value: string, x: any, y: any, options: any) => {
      const text = String(value);
      if (text === "Service") inServices = true;
      if (inServices && typeof x === "number" && typeof y === "number") {
        const cell = { text, x, y, w: options.width,
          h: doc.heightOfString(text, { ...options }), page: doc.page };
        if (text.startsWith("Blended hourly rate:")) {
          note = cell;
          inServices = false;
        } else cells.push(cell);
      }
      return (original as any)(value, x, y, options);
    };
    renderBrexPricingMatrix(doc);
    assert.ok(note, "Full-width note must render");
    assert.equal(note.x, 72);
    assert.equal(note.w, 468);
    assert.ok(note.y + note.h < 720);
    assert.equal(doc.x, 72, "Subsequent prose must not inherit last column");
    for (const item of BREX_LINE_ITEMS) {
      const i = cells.findIndex(c => c.text === item.service);
      assert.ok(i >= 0, item.service);
      assert.equal(cells[i + 1].text, item.brexUnit);
      assert.ok(cells[i + 1].y >= cells[i].y + cells[i].h + 2, "Unit must follow wrapped name");
    }
    for (const cell of cells) {
      assert.ok(cell.y >= 72 && cell.y + cell.h <= 720, `${cell.text} crosses page margin`);
      assert.ok(cell.x >= 72 && cell.x + cell.w <= 540.01);
      const samePage = cells.filter(c => c.page === cell.page);
      assert.equal(samePage[0].text, "Service", "Each continuation page must repeat its header");
    }
    const collisions = cells.flatMap((a, i) => cells.slice(i + 1).filter(b =>
      a.page === b.page &&
      Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > .1 &&
      Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > .1,
    ).map(b => `${a.text} / ${b.text}`));
    assert.deepEqual(collisions, []);
    assert.ok(cells.filter(c => c.text === "Service").length >= 2, "Exercise page continuation");
    doc.end();
  }
});
