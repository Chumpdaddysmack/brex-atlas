// Local render smoke test from a JSON file dumped from Supabase.
// Usage: cd brex-atlas && npx tsx scripts/render-pdf-from-json.ts <input.json> <output.pdf>
//
// Input JSON shape:
//   {
//     "clientName": "...",
//     "clientUrl": "...",
//     "payload": ContentPlanPayload,
//     "swot": SwotAnalysis | null,
//     "pestel": PestelAnalysis | null,
//     "porters": PortersFiveForces | null,
//     "customerInsights": CustomerInsights | null
//   }

import * as fs from "node:fs";
import { PassThrough } from "node:stream";
import type { Response } from "express";
import { streamContentPlanPdf } from "../server/pdf-export";

const inputPath = process.argv[2];
const outputPath = process.argv[3] ?? "/tmp/atlas-test.pdf";

if (!inputPath) {
  console.error("Usage: npx tsx scripts/render-pdf-from-json.ts <input.json> <output.pdf>");
  process.exit(1);
}

const bundle = JSON.parse(fs.readFileSync(inputPath, "utf8"));

const out = fs.createWriteStream(outputPath);
const passthrough = new PassThrough();
passthrough.pipe(out);

// Minimal Express Response shim: pdfkit pipes into `res` and calls setHeader.
// Do NOT override .end — PassThrough already implements it, and shimming it
// with a method that calls back into `.end` yields infinite recursion.
(passthrough as any).setHeader = (name: string, value: string) => {
  console.log(`  header: ${name}=${value}`);
  return passthrough;
};
const res: Response = passthrough as unknown as Response;

streamContentPlanPdf({
  res,
  payload: bundle.payload,
  clientName: bundle.clientName,
  clientUrl: bundle.clientUrl ?? null,
  scope: "full",
  swot: bundle.swot ?? null,
  pestel: bundle.pestel ?? null,
  porters: bundle.porters ?? null,
  customerInsights: bundle.customerInsights ?? null,
});

await new Promise<void>((resolve, reject) => {
  out.on("finish", () => resolve());
  out.on("error", reject);
});

const stat = fs.statSync(outputPath);
console.log(`\n[render] wrote ${outputPath} (${(stat.size / 1024).toFixed(1)} KB)`);
