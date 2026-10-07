// Isolated local QA server. No database, model calls, CRM, or outbound email.
import express from "express";
import path from "node:path";
import { streamContentPlanPdf } from "../server/pdf-export";
import { parsePdfPov } from "../shared/pdf-export-options";
import { executivePdfInput, executivePdfPayload } from "./fixtures/executive-pdf";

const app = express();
const analysis = { id: "qa-pov", status: "done", progress: 100, createdAt: Date.now(),
  ...executivePdfInput, extraction: JSON.stringify(executivePdfInput.extraction),
  strategy: JSON.stringify(executivePdfInput.strategy), porters: null };
const plan = { id: "qa-pov-plan", analysisId: analysis.id, status: "ready",
  planJson: JSON.stringify(executivePdfPayload) };
app.get("/api/auth/status", (_req, res) => res.json({ authenticated: true }));
app.get("/api/analyses", (_req, res) => res.json([analysis]));
app.get("/api/config-status", (_req, res) => res.json({}));
app.get("/api/analyses/qa-pov", (_req, res) => res.json(analysis));
app.get("/api/analyses/qa-pov/content-plan", (_req, res) => res.json(plan));
app.get("/api/content-plans/qa-pov-plan/pieces", (_req, res) => res.json([]));
app.get("/api/content-plans/qa-pov-plan/pdf", (req, res) => {
  let pov;
  try { pov = parsePdfPov(req.query.pov); }
  catch { return res.status(400).json({ error: "POV must be CEO, COO, CMO, or CFO" }); }
  const scope = req.query.scope === "summary" || req.query.scope === "strategy" ? req.query.scope : "full";
  streamContentPlanPdf({ res, payload: executivePdfPayload, clientName: analysis.clientName, scope, pov,
    executiveInput: executivePdfInput });
});
app.use("/api", (_req, res) => res.status(404).json({ error: "QA endpoint unavailable" }));
const root = path.resolve("dist/public");
app.use(express.static(root));
app.get("/{*path}", (_req, res) => res.sendFile(path.join(root, "index.html")));
const port = Number(process.env.PORT ?? 5120);
app.listen(port, "0.0.0.0", () => console.log(`Isolated POV export QA on ${port}`));
