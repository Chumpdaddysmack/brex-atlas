// Isolated PDF layout QA: synthetic data, no research/database/CRM calls.
import { mkdirSync, writeFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { once } from "node:events";
import { join } from "node:path";
import { streamContentPlanPdf } from "../server/pdf-export";
import { PDF_EXECUTIVE_ROLES } from "../shared/pdf-export-options";
import { executivePdfInput, executivePdfPayload } from "./fixtures/executive-pdf";

const dir = process.argv[2];
if (!dir) throw new Error("Usage: npx tsx scripts/qa-pdf-pricing.ts <output-directory>");
mkdirSync(dir, { recursive: true });
for (const pov of [...PDF_EXECUTIVE_ROLES, undefined]) {
  for (const scope of pov ? ["full"] as const : ["full", "strategy", "summary"] as const) {
    const res: any = new PassThrough();
    res.setHeader = () => {};
    const chunks: Buffer[] = [];
    res.on("data", (b: Buffer) => chunks.push(b));
    const ended = once(res, "end");
    streamContentPlanPdf({ res, payload: executivePdfPayload, clientName: executivePdfInput.clientName,
      scope, pov, executiveInput: executivePdfInput });
    await ended;
    const file = join(dir, `${pov ?? "standard"}-${scope}.pdf`);
    writeFileSync(file, Buffer.concat(chunks));
    console.log(file);
  }
}
