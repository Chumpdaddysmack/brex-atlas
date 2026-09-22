// Local-only rendering of an existing plan; never regenerates analysis or writes to the database.
// Usage: npx tsx scripts/check-pdf-layout.ts <plan.json> <backup.json> <output-dir>
import fs from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { once } from "node:events";
import { streamContentPlanPdf } from "../server/pdf-export";

async function main() {
  const payload = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const { analysis_backup: analysis } = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
  const dir = process.argv[4];
  fs.mkdirSync(dir, { recursive: true });
  for (const scope of ["summary", "full"] as const) {
    const res = new PassThrough() as any;
    res.setHeader = () => {};
    const chunks: Buffer[] = [];
    res.on("data", (chunk: Buffer) => chunks.push(chunk));
    const ended = once(res, "end");
    streamContentPlanPdf({
      res, payload, scope,
      clientName: analysis.client_name, clientUrl: analysis.client_url,
      swot: analysis.swot, pestel: analysis.pestel, porters: analysis.porters,
      customerInsights: analysis.customer_insights,
    });
    await ended;
    const output = path.join(dir, `layout-${scope}.pdf`);
    fs.writeFileSync(output, Buffer.concat(chunks));
    console.log(`${scope}: ${output} (${Buffer.concat(chunks).length} bytes)`);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
