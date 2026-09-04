// Dual-mode storage.
//
// - Dev sandbox: better-sqlite3 file at ./data.db (fast, ephemeral).
// - Published sandbox: Supabase Postgres via @supabase/supabase-js when
//   SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in env.
//
// Both paths implement the same IStorage interface so routes/pipelines don't
// need to know which backend is active.

import { analyses, contentPlans, contentPieces } from "@shared/schema";
import type {
  Analysis,
  InsertAnalysis,
  ContentPlan,
  ContentPiece,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc, and, asc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";

// --------------------------------------------------------------------------
// Shared interface
// --------------------------------------------------------------------------
export interface IStorage {
  createAnalysis(input: InsertAnalysis): Promise<Analysis>;
  getAnalysis(id: string): Promise<Analysis | undefined>;
  listAnalyses(): Promise<Analysis[]>;
  updateAnalysis(id: string, patch: Partial<Analysis>): Promise<Analysis | undefined>;

  createContentPlan(analysisId: string): Promise<ContentPlan>;
  getContentPlan(id: string): Promise<ContentPlan | undefined>;
  getContentPlanByAnalysis(analysisId: string): Promise<ContentPlan | undefined>;
  updateContentPlan(id: string, patch: Partial<ContentPlan>): Promise<ContentPlan | undefined>;

  createContentPiece(input: Omit<ContentPiece, "id" | "createdAt" | "updatedAt">): Promise<ContentPiece>;
  createContentPiecesBulk(inputs: Omit<ContentPiece, "id" | "createdAt" | "updatedAt">[]): Promise<void>;
  getContentPiece(id: string): Promise<ContentPiece | undefined>;
  listContentPiecesByPlan(planId: string, channel?: string): Promise<ContentPiece[]>;
  updateContentPiece(id: string, patch: Partial<ContentPiece>): Promise<ContentPiece | undefined>;
}

// --------------------------------------------------------------------------
// SQLite implementation (dev)
// --------------------------------------------------------------------------
const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS analyses (
    id TEXT PRIMARY KEY,
    client_name TEXT NOT NULL,
    client_url TEXT NOT NULL,
    industry TEXT,
    revenue_band TEXT,
    goals TEXT,
    budget_band TEXT,
    notes TEXT,
    include_pestel INTEGER DEFAULT 0,
    include_porters INTEGER DEFAULT 0,
    assumptions TEXT,
    status TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    current_step TEXT,
    error_message TEXT,
    extraction TEXT,
    competitors TEXT,
    strategy TEXT,
    sow TEXT,
    swot TEXT,
    pestel TEXT,
    porters TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS content_plans (
    id TEXT PRIMARY KEY,
    analysis_id TEXT NOT NULL,
    status TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    current_step TEXT,
    error_message TEXT,
    plan_json TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_content_plans_analysis ON content_plans(analysis_id);
  CREATE TABLE IF NOT EXISTS content_pieces (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL,
    analysis_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    title TEXT NOT NULL,
    week_number INTEGER,
    scheduled_date TEXT,
    pillar TEXT,
    target_query TEXT,
    brief_json TEXT,
    draft_json TEXT,
    status TEXT NOT NULL,
    review_notes TEXT,
    error_message TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_content_pieces_plan ON content_pieces(plan_id);
  CREATE INDEX IF NOT EXISTS idx_content_pieces_analysis ON content_pieces(analysis_id);
  CREATE INDEX IF NOT EXISTS idx_content_pieces_channel ON content_pieces(channel);
`);

// Idempotent SQLite alters for pre-existing dev DBs (Sep 2026 migration).
for (const sql of [
  "ALTER TABLE analyses ADD COLUMN include_pestel INTEGER DEFAULT 0",
  "ALTER TABLE analyses ADD COLUMN include_porters INTEGER DEFAULT 0",
  "ALTER TABLE analyses ADD COLUMN swot TEXT",
  "ALTER TABLE analyses ADD COLUMN pestel TEXT",
  "ALTER TABLE analyses ADD COLUMN porters TEXT",
  "ALTER TABLE analyses ADD COLUMN assumptions TEXT",
]) {
  try { sqlite.exec(sql); } catch { /* column already exists */ }
}

export const db = drizzle(sqlite);

// ------- Helpers for Assumptions JSON marshaling ---------------------------
// SQLite stores as TEXT; Postgres stores as jsonb. Both call sites need
// consistent normalization: intake can send an object OR a string OR null.
function assumptionsToString(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch { return null; }
}
function parseAssumptionsForRow(v: unknown): any {
  if (v == null) return null;
  if (typeof v === "string") {
    try { return JSON.parse(v); } catch { return null; }
  }
  return v;
}

export class SqliteStorage implements IStorage {
  async createAnalysis(input: InsertAnalysis): Promise<Analysis> {
    const id = randomUUID();
    const now = Date.now();
    const row = {
      id,
      clientName: input.clientName,
      clientUrl: input.clientUrl,
      industry: input.industry ?? null,
      revenueBand: input.revenueBand ?? null,
      goals: input.goals ?? null,
      budgetBand: input.budgetBand ?? null,
      notes: input.notes ?? null,
      includePestel: input.includePestel ? 1 : 0,
      includePorters: input.includePorters ? 1 : 0,
      assumptions: assumptionsToString((input as any).assumptions),
      status: "queued",
      progress: 0,
      currentStep: "Queued",
      errorMessage: null,
      extraction: null,
      competitors: null,
      strategy: null,
      sow: null,
      swot: null,
      pestel: null,
      porters: null,
      createdAt: now,
    } as any;
    return db.insert(analyses).values(row).returning().get();
  }

  async getAnalysis(id: string): Promise<Analysis | undefined> {
    return db.select().from(analyses).where(eq(analyses.id, id)).get();
  }

  async listAnalyses(): Promise<Analysis[]> {
    return db.select().from(analyses).orderBy(desc(analyses.createdAt)).all();
  }

  async updateAnalysis(id: string, patch: Partial<Analysis>): Promise<Analysis | undefined> {
    if (Object.keys(patch).length === 0) return this.getAnalysis(id);
    return db.update(analyses).set(patch as any).where(eq(analyses.id, id)).returning().get();
  }

  async createContentPlan(analysisId: string): Promise<ContentPlan> {
    const id = randomUUID();
    const now = Date.now();
    const row = {
      id,
      analysisId,
      status: "queued",
      progress: 0,
      currentStep: "Queued",
      errorMessage: null,
      planJson: null,
      createdAt: now,
    } as any;
    return db.insert(contentPlans).values(row).returning().get();
  }

  async getContentPlan(id: string): Promise<ContentPlan | undefined> {
    return db.select().from(contentPlans).where(eq(contentPlans.id, id)).get();
  }

  async getContentPlanByAnalysis(analysisId: string): Promise<ContentPlan | undefined> {
    return db
      .select()
      .from(contentPlans)
      .where(eq(contentPlans.analysisId, analysisId))
      .orderBy(desc(contentPlans.createdAt))
      .get();
  }

  async updateContentPlan(id: string, patch: Partial<ContentPlan>): Promise<ContentPlan | undefined> {
    if (Object.keys(patch).length === 0) return this.getContentPlan(id);
    return db.update(contentPlans).set(patch as any).where(eq(contentPlans.id, id)).returning().get();
  }

  async createContentPiece(input: Omit<ContentPiece, "id" | "createdAt" | "updatedAt">): Promise<ContentPiece> {
    const id = randomUUID();
    const now = Date.now();
    const row = { id, ...input, createdAt: now, updatedAt: now } as any;
    return db.insert(contentPieces).values(row).returning().get();
  }

  async createContentPiecesBulk(inputs: Omit<ContentPiece, "id" | "createdAt" | "updatedAt">[]): Promise<void> {
    if (inputs.length === 0) return;
    const now = Date.now();
    const rows = inputs.map((i) => ({ id: randomUUID(), ...i, createdAt: now, updatedAt: now })) as any[];
    db.insert(contentPieces).values(rows).run();
  }

  async getContentPiece(id: string): Promise<ContentPiece | undefined> {
    return db.select().from(contentPieces).where(eq(contentPieces.id, id)).get();
  }

  async listContentPiecesByPlan(planId: string, channel?: string): Promise<ContentPiece[]> {
    const where = channel
      ? and(eq(contentPieces.planId, planId), eq(contentPieces.channel, channel))
      : eq(contentPieces.planId, planId);
    return db.select().from(contentPieces).where(where).orderBy(asc(contentPieces.weekNumber), asc(contentPieces.createdAt)).all();
  }

  async updateContentPiece(id: string, patch: Partial<ContentPiece>): Promise<ContentPiece | undefined> {
    const withTs = { ...patch, updatedAt: Date.now() };
    return db.update(contentPieces).set(withTs as any).where(eq(contentPieces.id, id)).returning().get();
  }
}

// --------------------------------------------------------------------------
// Supabase implementation (published)
// --------------------------------------------------------------------------
// Snake-case row shapes matching the Postgres schema in supabase/schema.sql.
type AnalysisRow = {
  id: string;
  client_name: string;
  client_url: string;
  industry: string | null;
  revenue_band: string | null;
  goals: string | null;
  budget_band: string | null;
  notes: string | null;
  include_pestel: boolean | number | null;
  include_porters: boolean | number | null;
  assumptions: any; // jsonb in postgres, TEXT in sqlite
  status: string;
  progress: number;
  current_step: string | null;
  error_message: string | null;
  extraction: any;
  competitors: any;
  strategy: any;
  sow: any;
  swot: any;
  pestel: any;
  porters: any;
  created_at: number;
};

type PlanRow = {
  id: string;
  analysis_id: string;
  status: string;
  progress: number;
  current_step: string | null;
  error_message: string | null;
  plan_json: any;
  created_at: number;
};

type PieceRow = {
  id: string;
  plan_id: string;
  analysis_id: string;
  channel: string;
  title: string;
  week_number: number | null;
  scheduled_date: string | null;
  pillar: string | null;
  target_query: string | null;
  brief_json: any;
  draft_json: any;
  status: string;
  review_notes: string | null;
  error_message: string | null;
  created_at: number;
  updated_at: number;
};

// Camel <-> snake mapping. The app-side types (Analysis, ContentPlan, ContentPiece)
// come from Drizzle SQLite tables and use camelCase; Postgres uses snake_case.
// Also: SQLite stores JSON payloads as strings; Postgres stores them as jsonb objects.
// So on read we STRINGIFY jsonb -> string, on write we JSON.parse string -> jsonb.
function analysisFromRow(r: AnalysisRow): Analysis {
  return {
    id: r.id,
    clientName: r.client_name,
    clientUrl: r.client_url,
    industry: r.industry,
    revenueBand: r.revenue_band,
    goals: r.goals,
    budgetBand: r.budget_band,
    notes: r.notes,
    includePestel: r.include_pestel ? 1 : 0,
    includePorters: r.include_porters ? 1 : 0,
    assumptions: r.assumptions == null ? null : (typeof r.assumptions === "string" ? r.assumptions : JSON.stringify(r.assumptions)),
    status: r.status,
    progress: r.progress,
    currentStep: r.current_step,
    errorMessage: r.error_message,
    extraction: r.extraction == null ? null : (typeof r.extraction === "string" ? r.extraction : JSON.stringify(r.extraction)),
    competitors: r.competitors == null ? null : (typeof r.competitors === "string" ? r.competitors : JSON.stringify(r.competitors)),
    strategy: r.strategy == null ? null : (typeof r.strategy === "string" ? r.strategy : JSON.stringify(r.strategy)),
    sow: r.sow == null ? null : (typeof r.sow === "string" ? r.sow : JSON.stringify(r.sow)),
    swot: r.swot == null ? null : (typeof r.swot === "string" ? r.swot : JSON.stringify(r.swot)),
    pestel: r.pestel == null ? null : (typeof r.pestel === "string" ? r.pestel : JSON.stringify(r.pestel)),
    porters: r.porters == null ? null : (typeof r.porters === "string" ? r.porters : JSON.stringify(r.porters)),
    createdAt: r.created_at,
  } as Analysis;
}

function analysisToRow(patch: Partial<Analysis>): Partial<AnalysisRow> {
  const out: Partial<AnalysisRow> = {};
  if (patch.id !== undefined) out.id = patch.id;
  if (patch.clientName !== undefined) out.client_name = patch.clientName;
  if (patch.clientUrl !== undefined) out.client_url = patch.clientUrl;
  if (patch.industry !== undefined) out.industry = patch.industry;
  if (patch.revenueBand !== undefined) out.revenue_band = patch.revenueBand;
  if (patch.goals !== undefined) out.goals = patch.goals;
  if (patch.budgetBand !== undefined) out.budget_band = patch.budgetBand;
  if (patch.notes !== undefined) out.notes = patch.notes;
  if ((patch as any).includePestel !== undefined) out.include_pestel = !!(patch as any).includePestel;
  if ((patch as any).includePorters !== undefined) out.include_porters = !!(patch as any).includePorters;
  if ((patch as any).assumptions !== undefined) {
    const a = (patch as any).assumptions;
    out.assumptions = a == null ? null : (typeof a === "string" ? JSON.parse(a) : a);
  }
  if (patch.status !== undefined) out.status = patch.status;
  if (patch.progress !== undefined) out.progress = patch.progress;
  if (patch.currentStep !== undefined) out.current_step = patch.currentStep;
  if (patch.errorMessage !== undefined) out.error_message = patch.errorMessage;
  if (patch.extraction !== undefined) out.extraction = patch.extraction == null ? null : JSON.parse(patch.extraction);
  if (patch.competitors !== undefined) out.competitors = patch.competitors == null ? null : JSON.parse(patch.competitors);
  if (patch.strategy !== undefined) out.strategy = patch.strategy == null ? null : JSON.parse(patch.strategy);
  if (patch.sow !== undefined) out.sow = patch.sow == null ? null : JSON.parse(patch.sow);
  if ((patch as any).swot !== undefined) out.swot = (patch as any).swot == null ? null : JSON.parse((patch as any).swot);
  if ((patch as any).pestel !== undefined) out.pestel = (patch as any).pestel == null ? null : JSON.parse((patch as any).pestel);
  if ((patch as any).porters !== undefined) out.porters = (patch as any).porters == null ? null : JSON.parse((patch as any).porters);
  if (patch.createdAt !== undefined) out.created_at = patch.createdAt;
  return out;
}

function planFromRow(r: PlanRow): ContentPlan {
  return {
    id: r.id,
    analysisId: r.analysis_id,
    status: r.status,
    progress: r.progress,
    currentStep: r.current_step,
    errorMessage: r.error_message,
    planJson: r.plan_json == null ? null : (typeof r.plan_json === "string" ? r.plan_json : JSON.stringify(r.plan_json)),
    createdAt: r.created_at,
  } as ContentPlan;
}

function planToRow(patch: Partial<ContentPlan>): Partial<PlanRow> {
  const out: Partial<PlanRow> = {};
  if (patch.id !== undefined) out.id = patch.id;
  if (patch.analysisId !== undefined) out.analysis_id = patch.analysisId;
  if (patch.status !== undefined) out.status = patch.status;
  if (patch.progress !== undefined) out.progress = patch.progress;
  if (patch.currentStep !== undefined) out.current_step = patch.currentStep;
  if (patch.errorMessage !== undefined) out.error_message = patch.errorMessage;
  if (patch.planJson !== undefined) out.plan_json = patch.planJson == null ? null : JSON.parse(patch.planJson);
  if (patch.createdAt !== undefined) out.created_at = patch.createdAt;
  return out;
}

function pieceFromRow(r: PieceRow): ContentPiece {
  return {
    id: r.id,
    planId: r.plan_id,
    analysisId: r.analysis_id,
    channel: r.channel,
    title: r.title,
    weekNumber: r.week_number,
    scheduledDate: r.scheduled_date,
    pillar: r.pillar,
    targetQuery: r.target_query,
    briefJson: r.brief_json == null ? null : (typeof r.brief_json === "string" ? r.brief_json : JSON.stringify(r.brief_json)),
    draftJson: r.draft_json == null ? null : (typeof r.draft_json === "string" ? r.draft_json : JSON.stringify(r.draft_json)),
    status: r.status,
    reviewNotes: r.review_notes,
    errorMessage: r.error_message,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  } as ContentPiece;
}

function pieceToRow(patch: Partial<ContentPiece>): Partial<PieceRow> {
  const out: Partial<PieceRow> = {};
  if (patch.id !== undefined) out.id = patch.id;
  if (patch.planId !== undefined) out.plan_id = patch.planId;
  if (patch.analysisId !== undefined) out.analysis_id = patch.analysisId;
  if (patch.channel !== undefined) out.channel = patch.channel;
  if (patch.title !== undefined) out.title = patch.title;
  if (patch.weekNumber !== undefined) out.week_number = patch.weekNumber;
  if (patch.scheduledDate !== undefined) out.scheduled_date = patch.scheduledDate;
  if (patch.pillar !== undefined) out.pillar = patch.pillar;
  if (patch.targetQuery !== undefined) out.target_query = patch.targetQuery;
  if (patch.briefJson !== undefined) out.brief_json = patch.briefJson == null ? null : JSON.parse(patch.briefJson);
  if (patch.draftJson !== undefined) out.draft_json = patch.draftJson == null ? null : JSON.parse(patch.draftJson);
  if (patch.status !== undefined) out.status = patch.status;
  if (patch.reviewNotes !== undefined) out.review_notes = patch.reviewNotes;
  if (patch.errorMessage !== undefined) out.error_message = patch.errorMessage;
  if (patch.createdAt !== undefined) out.created_at = patch.createdAt;
  if (patch.updatedAt !== undefined) out.updated_at = patch.updatedAt;
  return out;
}

export class SupabaseStorage implements IStorage {
  constructor(private supa: SupabaseClient) {}

  async createAnalysis(input: InsertAnalysis): Promise<Analysis> {
    const row: AnalysisRow = {
      id: randomUUID(),
      client_name: input.clientName,
      client_url: input.clientUrl,
      industry: input.industry ?? null,
      revenue_band: input.revenueBand ?? null,
      goals: input.goals ?? null,
      budget_band: input.budgetBand ?? null,
      notes: input.notes ?? null,
      include_pestel: !!input.includePestel,
      include_porters: !!input.includePorters,
      assumptions: parseAssumptionsForRow((input as any).assumptions),
      status: "queued",
      progress: 0,
      current_step: "Queued",
      error_message: null,
      extraction: null,
      competitors: null,
      strategy: null,
      sow: null,
      swot: null,
      pestel: null,
      porters: null,
      created_at: Date.now(),
    };
    const { data, error } = await this.supa.from("analyses").insert(row).select().single();
    if (error) throw new Error(`Supabase createAnalysis: ${error.message}`);
    return analysisFromRow(data as AnalysisRow);
  }

  async getAnalysis(id: string): Promise<Analysis | undefined> {
    const { data, error } = await this.supa.from("analyses").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`Supabase getAnalysis: ${error.message}`);
    return data ? analysisFromRow(data as AnalysisRow) : undefined;
  }

  async listAnalyses(): Promise<Analysis[]> {
    const { data, error } = await this.supa.from("analyses").select("*").order("created_at", { ascending: false });
    if (error) throw new Error(`Supabase listAnalyses: ${error.message}`);
    return (data as AnalysisRow[]).map(analysisFromRow);
  }

  async updateAnalysis(id: string, patch: Partial<Analysis>): Promise<Analysis | undefined> {
    if (Object.keys(patch).length === 0) return this.getAnalysis(id);
    const { data, error } = await this.supa.from("analyses").update(analysisToRow(patch)).eq("id", id).select().maybeSingle();
    if (error) throw new Error(`Supabase updateAnalysis: ${error.message}`);
    return data ? analysisFromRow(data as AnalysisRow) : undefined;
  }

  async createContentPlan(analysisId: string): Promise<ContentPlan> {
    const row: PlanRow = {
      id: randomUUID(),
      analysis_id: analysisId,
      status: "queued",
      progress: 0,
      current_step: "Queued",
      error_message: null,
      plan_json: null,
      created_at: Date.now(),
    };
    const { data, error } = await this.supa.from("content_plans").insert(row).select().single();
    if (error) throw new Error(`Supabase createContentPlan: ${error.message}`);
    return planFromRow(data as PlanRow);
  }

  async getContentPlan(id: string): Promise<ContentPlan | undefined> {
    const { data, error } = await this.supa.from("content_plans").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`Supabase getContentPlan: ${error.message}`);
    return data ? planFromRow(data as PlanRow) : undefined;
  }

  async getContentPlanByAnalysis(analysisId: string): Promise<ContentPlan | undefined> {
    const { data, error } = await this.supa
      .from("content_plans")
      .select("*")
      .eq("analysis_id", analysisId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`Supabase getContentPlanByAnalysis: ${error.message}`);
    return data ? planFromRow(data as PlanRow) : undefined;
  }

  async updateContentPlan(id: string, patch: Partial<ContentPlan>): Promise<ContentPlan | undefined> {
    if (Object.keys(patch).length === 0) return this.getContentPlan(id);
    const { data, error } = await this.supa.from("content_plans").update(planToRow(patch)).eq("id", id).select().maybeSingle();
    if (error) throw new Error(`Supabase updateContentPlan: ${error.message}`);
    return data ? planFromRow(data as PlanRow) : undefined;
  }

  async createContentPiece(input: Omit<ContentPiece, "id" | "createdAt" | "updatedAt">): Promise<ContentPiece> {
    const now = Date.now();
    const row: PieceRow = {
      id: randomUUID(),
      plan_id: input.planId,
      analysis_id: input.analysisId,
      channel: input.channel,
      title: input.title,
      week_number: input.weekNumber ?? null,
      scheduled_date: input.scheduledDate ?? null,
      pillar: input.pillar ?? null,
      target_query: input.targetQuery ?? null,
      brief_json: input.briefJson == null ? null : JSON.parse(input.briefJson),
      draft_json: input.draftJson == null ? null : JSON.parse(input.draftJson),
      status: input.status,
      review_notes: input.reviewNotes ?? null,
      error_message: input.errorMessage ?? null,
      created_at: now,
      updated_at: now,
    };
    const { data, error } = await this.supa.from("content_pieces").insert(row).select().single();
    if (error) throw new Error(`Supabase createContentPiece: ${error.message}`);
    return pieceFromRow(data as PieceRow);
  }

  async createContentPiecesBulk(inputs: Omit<ContentPiece, "id" | "createdAt" | "updatedAt">[]): Promise<void> {
    if (inputs.length === 0) return;
    const now = Date.now();
    const rows: PieceRow[] = inputs.map((i) => ({
      id: randomUUID(),
      plan_id: i.planId,
      analysis_id: i.analysisId,
      channel: i.channel,
      title: i.title,
      week_number: i.weekNumber ?? null,
      scheduled_date: i.scheduledDate ?? null,
      pillar: i.pillar ?? null,
      target_query: i.targetQuery ?? null,
      brief_json: i.briefJson == null ? null : JSON.parse(i.briefJson),
      draft_json: i.draftJson == null ? null : JSON.parse(i.draftJson),
      status: i.status,
      review_notes: i.reviewNotes ?? null,
      error_message: i.errorMessage ?? null,
      created_at: now,
      updated_at: now,
    }));
    // Chunk inserts of 500 to keep payload sizes reasonable.
    for (let start = 0; start < rows.length; start += 500) {
      const chunk = rows.slice(start, start + 500);
      const { error } = await this.supa.from("content_pieces").insert(chunk);
      if (error) throw new Error(`Supabase createContentPiecesBulk: ${error.message}`);
    }
  }

  async getContentPiece(id: string): Promise<ContentPiece | undefined> {
    const { data, error } = await this.supa.from("content_pieces").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`Supabase getContentPiece: ${error.message}`);
    return data ? pieceFromRow(data as PieceRow) : undefined;
  }

  async listContentPiecesByPlan(planId: string, channel?: string): Promise<ContentPiece[]> {
    let q = this.supa.from("content_pieces").select("*").eq("plan_id", planId);
    if (channel) q = q.eq("channel", channel);
    const { data, error } = await q
      .order("week_number", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(`Supabase listContentPiecesByPlan: ${error.message}`);
    return (data as PieceRow[]).map(pieceFromRow);
  }

  async updateContentPiece(id: string, patch: Partial<ContentPiece>): Promise<ContentPiece | undefined> {
    const withTs: Partial<ContentPiece> = { ...patch, updatedAt: Date.now() };
    const { data, error } = await this.supa
      .from("content_pieces")
      .update(pieceToRow(withTs))
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) throw new Error(`Supabase updateContentPiece: ${error.message}`);
    return data ? pieceFromRow(data as PieceRow) : undefined;
  }
}

// --------------------------------------------------------------------------
// Selector — SUPABASE_URL + service-role key present → Supabase, else SQLite.
//
// SECURITY: this backend runs on Railway (private, server-only) and MUST use
// the service role key so it bypasses RLS. The anon key would be blocked by
// the RLS-enabled-with-no-policies posture set up in the 2026-08-25 migration
// (`enable_rls_lockdown`). Do NOT ship the service role key to the browser.
//
// SUPABASE_SERVICE_ROLE_KEY is the canonical env var. We still accept the
// legacy SUPABASE_ANON_KEY name as a fallback so old Railway configs don't
// crash mid-deploy — but log a loud warning if that's the only thing set,
// because the app will 'permission denied' on every table read.
// --------------------------------------------------------------------------
function selectStorage(): IStorage {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const legacyKey = process.env.SUPABASE_ANON_KEY;
  const key = serviceKey ?? legacyKey;
  if (url && key && url.startsWith("http")) {
    if (!serviceKey && legacyKey) {
      // eslint-disable-next-line no-console
      console.warn(
        "[storage] WARNING: falling back to SUPABASE_ANON_KEY. RLS is enabled with no policies, so every query will fail with 'permission denied'. Set SUPABASE_SERVICE_ROLE_KEY in Railway.",
      );
    }
    // eslint-disable-next-line no-console
    console.log(
      `[storage] using Supabase backend (${new URL(url).host}) [${serviceKey ? "service_role" : "anon-fallback"}]`,
    );
    // Node 20 lacks a global WebSocket; provide the `ws` package explicitly
    // so the eagerly-initialized realtime client doesn't crash on startup.
    const supa = createClient(url, key, {
      auth: { persistSession: false },
      realtime: { transport: ws as any },
    });
    return new SupabaseStorage(supa);
  }
  // eslint-disable-next-line no-console
  console.log("[storage] using SQLite backend (data.db)");
  return new SqliteStorage();
}

export const storage: IStorage = selectStorage();
// Back-compat: some callers may import DatabaseStorage — keep alias.
export const DatabaseStorage = SqliteStorage;
