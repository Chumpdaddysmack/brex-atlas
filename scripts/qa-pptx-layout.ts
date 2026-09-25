import fs from "node:fs";
import { createContentPlanDeck } from "../server/pptx-export";
import { compatiblePptx } from "../server/pptx-package";
// Local-only fixture runner: never calls a model, writes a CRM record or emails.
async function main() {
  const [payloadPath, backupPath, outputPath] = process.argv.slice(2);
  const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
  const a = JSON.parse(fs.readFileSync(backupPath, "utf8")).analysis_backup;
  const parse = (v: unknown) => typeof v === "string" ? JSON.parse(v) : v;
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = (async () => new Response("", { status: 404 })) as typeof fetch;
  try {
    const d = await createContentPlanDeck({
      payload, clientName: a.client_name, clientUrl: a.client_url,
      generatedAt: new Date("2026-09-24T12:00:00Z"),
      swot: parse(a.swot), pestel: parse(a.pestel), porters: parse(a.porters), customerInsights: parse(a.customer_insights),
    });
    const collisions = d.regions.flatMap((a, i) => d.regions.slice(i + 1).filter(b =>
      a.slide === b.slide && Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > .01 &&
      Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > .01,
    ).map(b => ({ slide: a.slide + 1, a: a.text.slice(0, 65), b: b.text.slice(0, 65) })));
    if (collisions.length) throw new Error(JSON.stringify(collisions, null, 2));
    fs.writeFileSync(outputPath, await compatiblePptx(await d.pptx.write({ outputType: "nodebuffer" }) as Buffer));
    fs.writeFileSync(outputPath + ".geometry.json", JSON.stringify(d.regions));
    console.log(JSON.stringify({ slides: d.slides.length, textRegions: d.regions.length, collisions: collisions.length, outputPath }));
  } finally { globalThis.fetch = fetchBefore; }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
