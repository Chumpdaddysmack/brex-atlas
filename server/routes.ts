import type { Express } from "express";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { storage } from "./storage";
import { intakeSchema } from "@shared/schema";
import { runPipeline } from "./pipeline";
import { runContentPlanGeneration } from "./content-pipeline";
import { requireAuth } from "./auth";
import { streamContentPlanPdf, type PdfScope } from "./pdf-export";
import { buildContentPlanPptx } from "./pptx-export";
import { llmJson, SCHEMA_ROI_ASSUMPTIONS } from "./llm";
import { calculateRoiProjections, FALLBACK_ASSUMPTIONS } from "./roi-calc";
import type { RoiAssumptions } from "@shared/schema";
import type { ContentPlanPayload } from "@shared/schema";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // All /api routes below require an authenticated session.
  // Auth endpoints themselves (/api/login, /api/logout, /api/auth/status)
  // are registered in setupAuth() before this and stay unprotected.
  app.use("/api", requireAuth);

  // Create a new analysis and kick off the pipeline (fire-and-forget)
  app.post("/api/analyses", async (req, res) => {
    const parsed = intakeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const created = await storage.createAnalysis(parsed.data);
    // Kick off asynchronously — do not block response
    runPipeline(created.id).catch((err) => console.error("[pipeline] fatal", err));
    res.status(201).json(created);
  });

  // Poll status / full record
  app.get("/api/analyses/:id", async (req, res) => {
    const row = await storage.getAnalysis(req.params.id);
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  });

  // List all
  app.get("/api/analyses", async (_req, res) => {
    const rows = await storage.listAnalyses();
    res.json(rows);
  });

  // -------- Content plan endpoints --------

  // Kick off the 12-week content plan for an analysis. Fire-and-forget.
  app.post("/api/analyses/:id/content-plan", async (req, res) => {
    const analysis = await storage.getAnalysis(req.params.id);
    if (!analysis) return res.status(404).json({ error: "Analysis not found" });
    if (analysis.status !== "done") {
      return res.status(400).json({ error: "Analysis must be completed before generating a content plan" });
    }
    // If a plan already exists AND is still active, return it
    const existing = await storage.getContentPlanByAnalysis(analysis.id);
    if (existing && existing.status !== "error") {
      return res.status(200).json(existing);
    }
    const created = await storage.createContentPlan(analysis.id);
    runContentPlanGeneration(created.id).catch((err) => console.error("[content-plan] fatal", err));
    res.status(201).json(created);
  });

  // Poll plan status
  app.get("/api/content-plans/:id", async (req, res) => {
    const row = await storage.getContentPlan(req.params.id);
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  });

  // Get the plan (if any) attached to an analysis
  app.get("/api/analyses/:id/content-plan", async (req, res) => {
    const row = await storage.getContentPlanByAnalysis(req.params.id);
    if (!row) return res.status(404).json({ error: "No plan yet" });
    res.json(row);
  });

  // Export the plan as a branded PDF (streams the file back)
  // ?scope=full (default) | strategy | summary
  // Compute (or recompute) ROI projections for an existing plan.
  // Idempotent — pass ?force=1 to override cached projections.
  app.post("/api/content-plans/:id/roi", async (req, res) => {
    const plan = await storage.getContentPlan(req.params.id);
    if (!plan) return res.status(404).json({ error: "Plan not found" });
    if (plan.status !== "ready" || !plan.planJson) {
      return res.status(400).json({ error: "Plan is not ready" });
    }
    const analysis = await storage.getAnalysis(plan.analysisId);
    if (!analysis) return res.status(404).json({ error: "Analysis not found" });

    let payload: ContentPlanPayload;
    try {
      payload = typeof plan.planJson === "string"
        ? (JSON.parse(plan.planJson) as ContentPlanPayload)
        : (plan.planJson as unknown as ContentPlanPayload);
    } catch {
      return res.status(500).json({ error: "Plan data is malformed" });
    }

    const force = req.query.force === "1";
    if (!force && payload.roiProjections) {
      return res.json({ roi: payload.roiProjections, cached: true });
    }

    try {
      const roiSys = `You are a B2B revenue analyst inferring conservative, defensible ROI assumptions for a 12-week content marketing engagement. Be DELIBERATELY CONSERVATIVE — use the lower end of plausible ranges. This is used to project ROI to a skeptical CFO.

For each field:
- avgDealSize: One deal value in USD. Use ACV if subscription. Infer from industry, ICP company size, and pricing signals.
- dealType: "one-time" for services/implementation/hardware; "acv" for SaaS/subscriptions.
- grossMargin: 0.55–0.70 for services; 0.70–0.85 for SaaS; 0.30–0.45 for hardware/distribution.
- salesCycleDays: 30–60 SMB, 60–120 mid-market, 120–270 enterprise.
- visitorToLeadRate: 0.008–0.020.
- leadToMqlRate: 0.25–0.40. mqlToSqlRate: 0.30–0.45. sqlToWonRate: 0.15–0.25.
- monthlyVisitorsPerPost: 20–80 at maturity.
- monthsToRank: 3–5. contentDecayFactor: 0.85–0.92.
- programCost12Mo: 12-month Brex mid-market retainer + content ops, $75k–$120k typical.
- paidCacBaseline: B2B paid CPL, typically $200–$800.

Every rationale must reference the SPECIFIC client analysis, one tight sentence each.`;

      const analysisContext = JSON.stringify({
        clientName: analysis.clientName,
        clientUrl: analysis.clientUrl,
        strategy: analysis.strategy,
        extraction: analysis.extraction,
        competitors: analysis.competitors,
      }).slice(0, 8000);

      const roiUser = `# Client Analysis\n${analysisContext}\n\n# Content Plan Summary\n${(payload.summary ?? "").slice(0, 800)}\n\nInfer conservative ROI assumptions for a 12-week content marketing engagement.`;

      let assumptions: RoiAssumptions;
      try {
        assumptions = (await llmJson(
          roiSys,
          roiUser,
          2000,
          SCHEMA_ROI_ASSUMPTIONS,
        )) as RoiAssumptions;
      } catch (llmErr) {
        console.error("[roi-inference] LLM failed, using fallback", llmErr);
        assumptions = FALLBACK_ASSUMPTIONS;
      }

      const projections = calculateRoiProjections(assumptions, payload);
      payload.roiProjections = projections;

      await storage.updateContentPlan(plan.id, { planJson: JSON.stringify(payload) });
      return res.json({ roi: projections, cached: false });
    } catch (err: any) {
      console.error("[roi] failed", err);
      return res.status(500).json({ error: err?.message ?? "ROI calculation failed" });
    }
  });

  app.get("/api/content-plans/:id/pptx", async (req, res) => {
    const plan = await storage.getContentPlan(req.params.id);
    if (!plan) return res.status(404).json({ error: "Plan not found" });
    if (plan.status !== "ready" || !plan.planJson) {
      return res.status(400).json({ error: "Plan is not ready to export" });
    }
    const analysis = await storage.getAnalysis(plan.analysisId);
    if (!analysis) return res.status(404).json({ error: "Analysis not found" });

    let payload: ContentPlanPayload;
    try {
      payload = typeof plan.planJson === "string"
        ? (JSON.parse(plan.planJson) as ContentPlanPayload)
        : (plan.planJson as unknown as ContentPlanPayload);
    } catch {
      return res.status(500).json({ error: "Plan data is malformed" });
    }

    try {
      const buffer = await buildContentPlanPptx({
        payload,
        clientName: analysis.clientName,
        clientUrl: analysis.clientUrl,
      });

      const safeName = (analysis.clientName || "client").replace(/[^a-z0-9-_]/gi, "_");
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${safeName}-content-strategy-deck.pptx"`,
      );
      res.setHeader("Content-Length", String(buffer.length));
      res.end(buffer);
    } catch (err) {
      console.error("[pptx-export] failed", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "PPTX generation failed" });
      } else {
        res.end();
      }
    }
  });

  app.get("/api/content-plans/:id/pdf", async (req, res) => {
    const plan = await storage.getContentPlan(req.params.id);
    if (!plan) return res.status(404).json({ error: "Plan not found" });
    if (plan.status !== "ready" || !plan.planJson) {
      return res.status(400).json({ error: "Plan is not ready to export" });
    }
    const analysis = await storage.getAnalysis(plan.analysisId);
    if (!analysis) return res.status(404).json({ error: "Analysis not found" });

    const rawScope = typeof req.query.scope === "string" ? req.query.scope : "full";
    const scope: PdfScope =
      rawScope === "strategy" || rawScope === "summary" ? rawScope : "full";

    let payload: ContentPlanPayload;
    try {
      payload = typeof plan.planJson === "string"
        ? (JSON.parse(plan.planJson) as ContentPlanPayload)
        : (plan.planJson as unknown as ContentPlanPayload);
    } catch {
      return res.status(500).json({ error: "Plan data is malformed" });
    }

    try {
      streamContentPlanPdf({
        res,
        payload,
        clientName: analysis.clientName,
        clientUrl: analysis.clientUrl,
        scope,
      });
    } catch (err) {
      console.error("[pdf-export] failed", err);
      // If headers already sent (stream started), we can only end the response
      if (!res.headersSent) {
        res.status(500).json({ error: "PDF generation failed" });
      } else {
        res.end();
      }
    }
  });

  // -------- Content piece endpoints --------

  // List all pieces for a plan (optionally filtered by channel)
  app.get("/api/content-plans/:id/pieces", async (req, res) => {
    const channel = typeof req.query.channel === "string" ? req.query.channel : undefined;
    const rows = await storage.listContentPiecesByPlan(req.params.id, channel);
    res.json(rows);
  });

  // Get a single piece
  app.get("/api/content-pieces/:id", async (req, res) => {
    const row = await storage.getContentPiece(req.params.id);
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  });

  // Strategy-only review actions — approve or reject a planned entry
  app.post("/api/content-pieces/:id/approve", async (req, res) => {
    const notes = typeof req.body?.notes === "string" ? req.body.notes : null;
    const updated = await storage.updateContentPiece(req.params.id, { status: "approved", reviewNotes: notes });
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  });

  app.post("/api/content-pieces/:id/reject", async (req, res) => {
    const notes = typeof req.body?.notes === "string" ? req.body.notes : null;
    const updated = await storage.updateContentPiece(req.params.id, { status: "rejected", reviewNotes: notes });
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  });

  // Inline edit — title and review notes only (no drafts to edit in strategy mode)
  app.patch("/api/content-pieces/:id", async (req, res) => {
    const allowed: any = {};
    if (req.body?.reviewNotes !== undefined) allowed.reviewNotes = req.body.reviewNotes;
    if (req.body?.title !== undefined) allowed.title = req.body.title;
    const updated = await storage.updateContentPiece(req.params.id, allowed);
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  });

  return httpServer;
}
