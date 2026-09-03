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
import { calculateRoiProjections, FALLBACK_ASSUMPTIONS, ROI_INFERENCE_SYSTEM_PROMPT } from "./roi-calc";
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
      // Include SOW so the LLM can anchor avgDealSize on priceTiers.
      const analysisContext = JSON.stringify({
        clientName: analysis.clientName,
        clientUrl: analysis.clientUrl,
        extraction: analysis.extraction,
        strategy: analysis.strategy,
        sow: analysis.sow, // CRITICAL: priceTiers drive ACV anchoring.
        competitors: analysis.competitors,
      }).slice(0, 12000);

      const roiUser = `# Client Analysis\n${analysisContext}\n\n# Content Plan Summary\n${(payload.summary ?? "").slice(0, 800)}\n\nInfer realistic ROI assumptions for a 12-month content marketing engagement. Follow the priceTiers anchoring rule if a SOW is present.`;

      let assumptions: RoiAssumptions;
      try {
        assumptions = (await llmJson(
          ROI_INFERENCE_SYSTEM_PROMPT,
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

  // Manual-override recompute: skip the LLM entirely, take user-tuned
  // assumptions from the request body, run the deterministic calculator.
  // Body: { assumptions: Partial<RoiAssumptions> }
  // Missing fields fall back to the cached assumptions on the plan (or the
  // FALLBACK_ASSUMPTIONS if none exist). Rationale is auto-updated to note
  // manual override so the PDF/PPTX exports show it was user-tuned.
  app.post("/api/content-plans/:id/roi/recompute", async (req, res) => {
    const plan = await storage.getContentPlan(req.params.id);
    if (!plan) return res.status(404).json({ error: "Plan not found" });
    if (plan.status !== "ready" || !plan.planJson) {
      return res.status(400).json({ error: "Plan is not ready" });
    }

    let payload: ContentPlanPayload;
    try {
      payload = typeof plan.planJson === "string"
        ? (JSON.parse(plan.planJson) as ContentPlanPayload)
        : (plan.planJson as unknown as ContentPlanPayload);
    } catch {
      return res.status(500).json({ error: "Plan data is malformed" });
    }

    const overrides = (req.body?.assumptions ?? {}) as Partial<RoiAssumptions>;
    const baseline = payload.roiProjections?.assumptions ?? FALLBACK_ASSUMPTIONS;

    // Clamp helper — keep every field inside the schema's declared range so
    // a user can't accidentally break the calculator with wild values.
    const clamp = (n: unknown, min: number, max: number, fallback: number): number => {
      const num = typeof n === "number" && Number.isFinite(n) ? n : fallback;
      return Math.min(max, Math.max(min, num));
    };

    const merged: RoiAssumptions = {
      avgDealSize: clamp(overrides.avgDealSize, 500, 10_000_000, baseline.avgDealSize),
      dealType: overrides.dealType === "acv" || overrides.dealType === "one-time"
        ? overrides.dealType
        : baseline.dealType,
      grossMargin: clamp(overrides.grossMargin, 0.1, 0.95, baseline.grossMargin),
      salesCycleDays: clamp(overrides.salesCycleDays, 7, 365, baseline.salesCycleDays),
      visitorToLeadRate: clamp(overrides.visitorToLeadRate, 0.001, 0.1, baseline.visitorToLeadRate),
      leadToMqlRate: clamp(overrides.leadToMqlRate, 0.05, 0.9, baseline.leadToMqlRate),
      mqlToSqlRate: clamp(overrides.mqlToSqlRate, 0.05, 0.9, baseline.mqlToSqlRate),
      sqlToWonRate: clamp(overrides.sqlToWonRate, 0.05, 0.6, baseline.sqlToWonRate),
      monthlyVisitorsPerPost: clamp(overrides.monthlyVisitorsPerPost, 5, 500, baseline.monthlyVisitorsPerPost),
      monthsToRank: clamp(overrides.monthsToRank, 2, 9, baseline.monthsToRank),
      contentDecayFactor: clamp(overrides.contentDecayFactor, 0.7, 0.98, baseline.contentDecayFactor),
      programCost12Mo: clamp(overrides.programCost12Mo, 20_000, 500_000, baseline.programCost12Mo),
      paidCacBaseline: clamp(overrides.paidCacBaseline, 50, 5000, baseline.paidCacBaseline),
      rationale: {
        dealSize: `Manually tuned: $${Math.round(overrides.avgDealSize ?? baseline.avgDealSize).toLocaleString()} ${overrides.dealType ?? baseline.dealType}. Original: ${baseline.rationale.dealSize}`,
        conversionRates: `Manually tuned. Original: ${baseline.rationale.conversionRates}`,
        trafficRamp: `Manually tuned. Original: ${baseline.rationale.trafficRamp}`,
        programCost: `Manually tuned: $${Math.round(overrides.programCost12Mo ?? baseline.programCost12Mo).toLocaleString()}/12mo. Original: ${baseline.rationale.programCost}`,
      },
    };

    try {
      const projections = calculateRoiProjections(merged, payload);
      payload.roiProjections = projections;
      await storage.updateContentPlan(plan.id, { planJson: JSON.stringify(payload) });
      return res.json({ roi: projections, cached: false, tuned: true });
    } catch (err: any) {
      console.error("[roi/recompute] failed", err);
      return res.status(500).json({ error: err?.message ?? "ROI recompute failed" });
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
        swot: analysis.swot ? JSON.parse(analysis.swot) : null,
        pestel: analysis.pestel ? JSON.parse(analysis.pestel) : null,
        porters: analysis.porters ? JSON.parse(analysis.porters) : null,
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
        swot: analysis.swot ? JSON.parse(analysis.swot) : null,
        pestel: analysis.pestel ? JSON.parse(analysis.pestel) : null,
        porters: analysis.porters ? JSON.parse(analysis.porters) : null,
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
