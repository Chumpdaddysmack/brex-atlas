import fs from "node:fs";
import { PassThrough } from "node:stream";
import assert from "node:assert/strict";
import { createContentPlanDeck } from "../server/pptx-export";
import { compatiblePptx } from "../server/pptx-package";
import { streamContentPlanPdf } from "../server/pdf-export";
import { ENGAGEMENT } from "../shared/engagement-terms";

async function main() {
  const inputPath = process.argv[2];
  const output = process.argv[3];
  if (!inputPath || !output) throw new Error("Usage: qa-engagement-exports.ts input.json output-directory");
  fs.mkdirSync(output, { recursive: true });
  const args = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const before = JSON.stringify(args);
  const d = await createContentPlanDeck(args);
  const overlaps = d.regions.flatMap((a, i) => d.regions.slice(i + 1).filter(b =>
    a.slide === b.slide && Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > .01 &&
    Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > .01));
  assert.equal(overlaps.length, 0);
  assert.equal(JSON.stringify(args), before);
  assert.ok(d.regions.some(r => r.text.replace(/\s+/g, " ") === ENGAGEMENT.term));
  fs.writeFileSync(`${output}/engagement-check.pptx`, await compatiblePptx(await d.pptx.write({ outputType: "nodebuffer" }) as Buffer));
  const res: any = new PassThrough();
  res.setHeader = () => {};
  const chunks: Buffer[] = [];
  const ready = new Promise<void>((resolve, reject) => {
    res.on("data", (chunk: Buffer) => chunks.push(chunk));
    res.on("end", () => { fs.writeFileSync(`${output}/engagement-summary.pdf`, Buffer.concat(chunks)); resolve(); });
    res.on("error", reject);
  });
  streamContentPlanPdf({ ...args, res, scope: "summary" });
  await ready;
  assert.equal(JSON.stringify(args), before);
  console.log(JSON.stringify({ slides: d.slides.length, overlaps: overlaps.length,
    newSections: d.regions.filter(r => r.slide <= 3 && r.y === .43).map(r => ({ slide: r.slide + 1, title: r.text })) }));
}
main().catch(err => { console.error(err); process.exitCode = 1; });
