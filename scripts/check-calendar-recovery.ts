// Local-only recovery verification. Does not write to any database.
// Usage: npx tsx scripts/check-calendar-recovery.ts <connector-output> <output-dir>
import fs from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { once } from "node:events";
import assert from "node:assert/strict";
import { normalizeBlogCalendar } from "../server/blog-calendar";
import { calculateRoiProjections } from "../server/roi-calc";
import { streamContentPlanPdf } from "../server/pdf-export";
import { buildContentPlanPptx } from "../server/pptx-export";

async function main() {
  const wrapper = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const result = wrapper.result.result as string;
  const [backup] = JSON.parse(result.slice(result.indexOf("[{"), result.lastIndexOf("}]") + 2));
  const dir = process.argv[3];
  fs.mkdirSync(dir, { recursive: true });
  const backupPath = path.join(dir, "original-plan-and-pieces.json");
  if (!fs.existsSync(backupPath)) fs.writeFileSync(backupPath, JSON.stringify(backup));
  const payload = structuredClone(backup.plan_backup.plan_json);
  const old = payload.blogCalendar as unknown[];
  assert.equal(old.length, 36984);
  const text = old.filter(v => typeof v === "string").join("");
  const orphan = '"angleSummary "  ,';
  assert.equal(text.split(orphan).length, 2, "Expected exactly one known missing optional sentence");
  const marker = "Not supplied in original generation; editorial review required.";
  const repairedText = text.replace(orphan, `"angleSummary": ${JSON.stringify(marker)},`);
  const recovered = normalizeBlogCalendar(repairedText, {
    expectedWeeks: [4, 5, 6], postsPerWeek: 10, requireCompleteBrief: true,
  });
  payload.blogCalendar = normalizeBlogCalendar([
    ...old.filter(v => typeof v === "object" && v !== null), ...recovered,
  ], { expectedWeeks: Array.from({ length: 12 }, (_, i) => i + 1), postsPerWeek: 10 });
  assert.equal(payload.blogCalendar.reduce((sum: number, w: any) => sum + w.posts.length, 0), 120);
  // Ensure no intact week or other research field changed.
  for (const week of old.filter(v => typeof v === "object" && v !== null) as any[]) {
    assert.deepEqual(payload.blogCalendar.find((w: any) => w.weekNumber === week.weekNumber), week);
  }
  if (payload.roiProjections?.assumptions) {
    payload.roiProjections = calculateRoiProjections(payload.roiProjections.assumptions, payload);
  }
  const originalOther = structuredClone(backup.plan_backup.plan_json);
  const recoveredOther = structuredClone(payload);
  delete originalOther.blogCalendar; delete recoveredOther.blogCalendar;
  delete originalOther.roiProjections; delete recoveredOther.roiProjections;
  assert.deepEqual(recoveredOther, originalOther);
  fs.writeFileSync(path.join(dir, "recovered-plan.json"), JSON.stringify(payload));
  fs.writeFileSync(path.join(dir, "recomputed-roi.json"), JSON.stringify(payload.roiProjections));
  const analysis = backup.analysis_backup;
  const input = {
    payload, clientName: analysis.client_name, clientUrl: analysis.client_url,
    swot: analysis.swot, pestel: analysis.pestel, porters: analysis.porters,
    customerInsights: analysis.customer_insights,
  };
  const res = new PassThrough() as any;
  res.setHeader = () => {};
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(chunk));
  const ended = once(res, "end");
  streamContentPlanPdf({ ...input, res, scope: "full" });
  await ended;
  fs.writeFileSync(path.join(dir, "recovery-check.pdf"), Buffer.concat(chunks));
  const pptx = await buildContentPlanPptx(input);
  fs.writeFileSync(path.join(dir, "recovery-check.pptx"), pptx);
  console.log(JSON.stringify({
    client: analysis.client_name, weeks: payload.blogCalendar.length, posts: 120,
    missingBriefSentence: recovered.flatMap(w => w.posts)
      .filter(p => p.editorialBrief?.angleSummary === marker).map(p => p.title),
    pdfBytes: Buffer.concat(chunks).length, pptxBytes: pptx.length,
    intactWeeksPreserved: true, otherResearchPreserved: true,
  }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
