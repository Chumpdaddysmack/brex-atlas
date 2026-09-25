import PptxGenJS from "pptxgenjs";
import PDFDocument from "pdfkit";

export const C = { navy: "2A4365", blue: "00A6FB", text: "0F1824", muted: "607382", light: "EDF2F7", border: "DDE8EE", white: "FFFFFF" };
export const BOX = { left: .6, width: 8.8, top: 1.5, bottom: 4.95, footer: 5.12 };
// Use a full-size widescreen canvas. Coordinates remain in a compact design
// grid, while fonts stay at their actual, readable point sizes.
export const UNIT = 4 / 3;
export const scaled = <T extends { x: number; y: number; w: number; h: number }>(o: T): T =>
  ({ ...o, x: o.x * UNIT, y: o.y * UNIT, w: o.w * UNIT, h: o.h * UNIT });
export type Block = { label?: string; text: string; url?: string };
export type TextRegion = { slide: number; text: string; x: number; y: number; w: number; h: number; size: number };
const metric = new PDFDocument({ autoFirstPage: false });

export function clean(value: unknown): string {
  return String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
}

/** Arial-compatible metrics, with 12% wrap headroom for PowerPoint/LibreOffice. */
export function lines(value: unknown, width: number, size: number, bold = false): string[] {
  metric.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size);
  const max = width * UNIT * 72 / 1.12;
  const output: string[] = [];
  for (const paragraph of clean(value).split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && metric.widthOfString(`${line} ${word}`) > max) {
        output.push(line); line = "";
      }
      // URLs and long unbroken identifiers must not extend off-slide.
      let remainder = word;
      while (metric.widthOfString(remainder) > max) {
        let count = 1;
        while (count < remainder.length && metric.widthOfString(remainder.slice(0, count + 1)) <= max) count++;
        const prefix = remainder.slice(0, count);
        const boundary = Math.max(prefix.lastIndexOf("/"), prefix.lastIndexOf("-"), prefix.lastIndexOf("_"), prefix.lastIndexOf("?"), prefix.lastIndexOf("&")) + 1;
        if (boundary >= count * .4) count = boundary;
        if (line) { output.push(line); line = ""; }
        output.push(remainder.slice(0, count));
        remainder = remainder.slice(count);
      }
      line = line ? `${line} ${remainder}` : remainder;
    }
    output.push(line);
  }
  return output.length ? output : [""];
}

export const lineHeight = (size: number) => size * 1.3 / 72 / UNIT;
export const textHeight = (text: unknown, w: number, size: number, bold = false) =>
  lines(text, w, size, bold).length * lineHeight(size) + .06;

/** Shared layout owner. Every slide has a protected header/body/footer region.
 * Text is explicitly wrapped and paginated, never clipped or shrunk to fit.
 */
export class DeckLayout {
  readonly pptx = new PptxGenJS();
  readonly slides: PptxGenJS.Slide[] = [];
  readonly regions: TextRegion[] = [];
  constructor(readonly client: string) {
    this.pptx.layout = "LAYOUT_WIDE";
    this.pptx.author = "Brex Consulting";
    this.pptx.company = "Brex Consulting";
    this.pptx.title = `${client} | Content strategy briefing`;
    this.pptx.subject = "Brex Atlas executive briefing";
    this.pptx.theme = { headFontFace: "Arial", bodyFontFace: "Arial" };
  }
  text(slide: PptxGenJS.Slide, value: unknown, x: number, y: number, w: number, size = 15, bold = false, color = C.text, url?: string): number {
    const text = lines(value, w, size, bold).join("\n");
    const h = text.split("\n").length * lineHeight(size) + .06;
    if (x < .49 || x + w > 9.51 || y < .35 || y + h > 5.4) throw new Error(`PPTX text outside safe bounds: ${text.slice(0, 60)}`);
    slide.addText(text, {
      ...scaled({ x, y, w, h }), margin: 0, fontFace: "Arial", fontSize: size, bold, color,
      valign: "top", breakLine: false, lineSpacingMultiple: 1.15,
      paraSpaceAfter: 0, paraSpaceBefore: 0, fit: "none",
      ...(url && /^https?:\/\//i.test(url) ? { hyperlink: { url } } : {}),
    });
    this.regions.push({ slide: this.slides.indexOf(slide), text, x, y, w, h, size });
    return h;
  }
  slide(title: string, subtitle?: string): PptxGenJS.Slide {
    const slide = this.pptx.addSlide();
    this.slides.push(slide);
    slide.background = { color: C.white };
    // Section titles are controlled, short labels; long client content belongs in body.
    this.text(slide, title, .6, .43, 8.8, 32, true, C.navy);
    if (subtitle) this.text(slide, subtitle, .6, 1.04, 8.8, 11, false, C.muted);
    return slide;
  }
  section(title: string, blocks: Block[], subtitle?: string): void {
    const useful = blocks.filter(b => clean(b.text));
    if (!useful.length) return;
    let page = 0, y = BOX.top, slide: PptxGenJS.Slide;
    const next = () => { slide = this.slide(page++ ? `${title} | continued` : title, subtitle); y = BOX.top; };
    next();
    for (let blockIndex = 0; blockIndex < useful.length; blockIndex++) {
      const block = useful[blockIndex];
      // Short field labels use a proper two-column row, not two stacked boxes.
      // This keeps personas, sources and page metadata compact without tiny type.
      if (block.label && block.label.length <= 34 && clean(block.text).length <= 360) {
        const height = Math.max(textHeight(block.label, 2.2, 15, true), textHeight(block.text, 6.2, 15));
        if (height < 2.1) {
          if (y + height > BOX.bottom) next();
          this.text(slide!, block.label, .6, y, 2.2, 15, true, C.navy);
          this.text(slide!, block.text, 3.2, y, 6.2, 15, false, C.text, block.url);
          y += height + (block.label === "Source" ? .12 : .23);
          continue;
        }
      }
      let pending = lines(block.text, BOX.width, 15);
      let continuation = false;
      // Prefer keeping a complete finding and its citations on one slide.
      // Oversized findings still paginate rather than shrinking or clipping.
      const labelH = block.label ? textHeight(block.label, BOX.width, 16, true) + .1 : 0;
      const fullHeight = labelH + textHeight(block.text, BOX.width, 15);
      let sourceHeight = 0;
      for (let j = blockIndex + 1; j < useful.length && useful[j].label === "Source"; j++) {
        sourceHeight += Math.max(textHeight("Source", 2.2, 15, true), textHeight(useful[j].text, 6.2, 15)) + .12;
      }
      const groupHeight = fullHeight + (sourceHeight ? sourceHeight + .27 : 0);
      const keepHeight = groupHeight <= BOX.bottom - BOX.top ? groupHeight : fullHeight;
      if (keepHeight <= BOX.bottom - BOX.top && y + keepHeight > BOX.bottom) next();
      while (pending.length) {
        const label = block.label ? `${block.label}${continuation ? " (continued)" : ""}` : "";
        // Long labels are content too. Flow them as body instead of losing them.
        if (label && !continuation && textHeight(label, BOX.width, 16, true) > 1.3) {
          pending = [...lines(label, BOX.width, 15), ...pending];
        }
        const heading = label && textHeight(label, BOX.width, 16, true) <= 1.3 ? label : "";
        const lh = heading ? textHeight(heading, BOX.width, 16, true) + .1 : 0;
        const minimum = lh + Math.min(2, pending.length) * lineHeight(15) + .06;
        if (y + minimum > BOX.bottom) next();
        if (heading) { y += this.text(slide!, heading, .6, y, 8.8, 16, true, C.navy) + .1; }
        const capacity = Math.max(1, Math.floor((BOX.bottom - y - .06) / lineHeight(15)));
        const chunk = pending.splice(0, capacity).join("\n");
        y += this.text(slide!, chunk, .6, y, 8.8, 15, false, block.url ? C.navy : C.text, block.url) + .27;
        if (pending.length) { continuation = true; next(); }
      }
    }
  }
  table(title: string, headers: string[], widths: number[], rows: string[][], subtitle?: string): void {
    const font = 14;
    let slide: PptxGenJS.Slide, y = BOX.top, page = 0;
    const draw = (values: string[], head = false) => {
      const h = Math.max(...values.map((t, i) => textHeight(t, widths[i] - .24, font, head))) + .2;
      let x = .6;
      values.forEach((value, i) => {
        slide.addShape("rect", { ...scaled({ x, y, w: widths[i], h }), fill: { color: head ? C.navy : C.light }, line: { color: C.white, width: 1 } });
        this.text(slide, value, x + .12, y + .1, widths[i] - .24, font, head, head ? C.white : C.text);
        x += widths[i];
      });
      y += h;
    };
    const next = () => { slide = this.slide(page++ ? `${title} | continued` : title, subtitle); y = BOX.top; draw(headers, true); };
    next();
    const maxRowLines = Math.floor((BOX.bottom - BOX.top - .75 - .26) / lineHeight(font));
    for (const row of rows) {
      const pending = row.map((cell, i) => lines(cell, widths[i] - .24, font));
      while (pending.some(a => a.length)) {
        const cells = pending.map(a => a.splice(0, maxRowLines).join("\n"));
        const h = Math.max(...cells.map((t, i) => textHeight(t, widths[i] - .24, font))) + .2;
        if (y + h > BOX.bottom) next();
        draw(cells);
      }
    }
  }
  bars(title: string, rows: { label: string; value: number; detail?: string }[], subtitle?: string): void {
    if (!rows.length) return;
    const maximum = Math.max(1, ...rows.map(r => r.value));
    let slide = this.slide(title, subtitle), y = BOX.top;
    for (const row of rows) {
      const h = Math.max(.48, textHeight(row.label, 3.1, 15, true));
      if (y + h > BOX.bottom) { slide = this.slide(`${title} | continued`, subtitle); y = BOX.top; }
      this.text(slide, row.label, .6, y, 3.1, 15, true, C.navy);
      slide.addShape("rect", { ...scaled({ x: 4, y: y + .05, w: 3.8, h: .22 }), fill: { color: C.light }, line: { color: C.light } });
      if (row.value > 0) slide.addShape("rect", {
        ...scaled({ x: 4, y: y + .05, w: 3.8 * row.value / maximum, h: .22 }),
        fill: { color: C.blue }, line: { color: C.blue },
      });
      this.text(slide, row.detail || String(row.value), 8.15, y, 1.25, 13, true, C.navy);
      y += h + .27;
    }
  }
  finish(): void {
    this.slides.forEach((s, i) => {
      if (i === 0) return;
      this.text(s, "BREX CONSULTING  /  ATLAS", .6, BOX.footer, 6, 9, true, C.muted);
      this.text(s, `${i + 1} / ${this.slides.length}`, 8.4, BOX.footer, 1, 9, false, C.muted);
    });
  }
}
