import type { Express } from "express";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { storage } from "./storage";
import { intakeSchema } from "@shared/schema";
import { runPipeline } from "./pipeline";
import { runContentPlanGeneration } from "./content-pipeline";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
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
