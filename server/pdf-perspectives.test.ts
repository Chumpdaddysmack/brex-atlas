import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDF_EXECUTIVE_ROLES, parsePdfPov, pdfFilename } from "../shared/pdf-export-options";
import { buildExecutiveSummary, type ExecutiveRole } from "../shared/executive-summary";
import { streamContentPlanPdf } from "./pdf-export";
import { executivePdfInput, executivePdfPayload } from "../scripts/fixtures/executive-pdf";

async function render(pov?: ExecutiveRole, input = executivePdfInput, scope: "full" | "summary" | "strategy" = "full") {
  const res: any = new PassThrough();
  const headers: Record<string, string> = {};
  res.setHeader = (key: string, value: string) => { headers[key] = value; };
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = once(res, "end");
  const before = JSON.stringify({ input, executivePdfPayload });
  streamContentPlanPdf({ res, payload: executivePdfPayload, clientName: input.clientName, scope, pov, executiveInput: input });
  await finished;
  assert.equal(JSON.stringify({ input, executivePdfPayload }), before, "Export must not mutate saved findings");
  const dir = mkdtempSync(join(tmpdir(), "atlas-pov-"));
  try {
    const file = join(dir, "report.pdf");
    writeFileSync(file, Buffer.concat(chunks));
    const text = execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
    assert.doesNotMatch(text, /Report generation ended early/);
    const body = text.replace(/^Brex Consulting\s+·[^\n]+content plan\s+\d+\s*\/\s*\d+\s*$/gm, "");
    return { text, compact: body.replace(/\s+/g, " "), headers };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("POV validation is explicit and filenames preserve standard exports", () => {
  assert.equal(parsePdfPov(undefined), undefined);
  for (const role of PDF_EXECUTIVE_ROLES) assert.equal(parsePdfPov(role), role);
  for (const bad of ["", "CTO", "ceo", ["CEO"], null, {}]) assert.throws(() => parsePdfPov(bad));
  assert.equal(pdfFilename("A & B", "full"), "A___B-full-plan.pdf");
  assert.equal(pdfFilename("A & B", "summary", "CFO"), "A___B-executive-summary-cfo-perspective.pdf");
});

test("all four PDFs include the matching brief and all 120 calendar titles without changing input", async () => {
  for (const role of PDF_EXECUTIVE_ROLES) {
    const out = await render(role);
    const summary = buildExecutiveSummary(executivePdfInput, role);
    assert.ok(out.headers["Content-Disposition"].includes(`${role.toLowerCase()}-perspective.pdf`));
    assert.ok(out.compact.includes(`${role} Executive Perspective`));
    assert.ok(out.compact.includes(summary.opening));
    for (const section of summary.sections) {
      assert.ok(out.compact.includes(section.title));
      assert.ok(out.compact.includes(section.question));
      if (section.evidence) {
        assert.ok(out.compact.includes(section.evidence.text));
        for (const source of section.evidence.sources) assert.ok(out.text.includes(source.url));
      }
    }
    for (const week of executivePdfPayload.blogCalendar)
      for (const post of week.posts) assert.ok(out.compact.includes(post.title));
    assert.ok(out.compact.includes(executivePdfPayload.summary));
  }
});

test("standard scopes remain unpersonalized and keep their filenames", async () => {
  for (const scope of ["full", "strategy", "summary"] as const) {
    const out = await render(undefined, executivePdfInput, scope);
    assert.ok(out.headers["Content-Disposition"].includes(pdfFilename(executivePdfInput.clientName, scope)));
    assert.doesNotMatch(out.text, /Executive Perspective|QA ONLY: Revenue|QA ONLY: The company/);
  }
});

test("unknown financial evidence is disclosed rather than fabricated", async () => {
  const out = await render("CFO", { clientName: "Missing evidence QA" } as any);
  assert.match(out.compact, /Not established in this saved report/);
  assert.doesNotMatch(out.text, /8 million|30 employees|example.com\/revenue/);
});

test("long evidence flows across pages without losing its ending or the next section", async () => {
  const input = structuredClone(executivePdfInput);
  input.strategy.icp.summary = "Long source passage for pagination QA. ".repeat(100) + "EVIDENCE END MARKER.";
  const out = await render("CEO", input);
  assert.match(out.compact, /EVIDENCE END MARKER/);
  assert.match(out.compact, /What to prioritize/);
  assert.match(out.compact, /What to sponsor first/);
});
