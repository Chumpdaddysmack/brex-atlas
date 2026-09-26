import Database from "better-sqlite3";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import type { AssessmentRecord } from "@shared/tier-assessment";
import type { ClientSnapshot, ShareSummary } from "@shared/client-report";

export type ShareRow = ShareSummary & { analysisId: string; tokenHash: string; codeHash: string | null; snapshot: ClientSnapshot };
export interface ClientReportStore {
  assessment(id: string): Promise<AssessmentRecord | null>;
  saveAssessment(id: string, record: AssessmentRecord): Promise<void>;
  create(row: ShareRow): Promise<void>;
  get(id: string): Promise<ShareRow | null>;
  byToken(hash: string): Promise<ShareRow | null>;
  list(analysisId: string): Promise<ShareSummary[]>;
  update(id: string, patch: { expiresAt?: number; revokedAt?: number }): Promise<void>;
}
export class SqliteClientReportStore implements ClientReportStore {
  constructor(private db: Database.Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS tier_assessments (analysis_id TEXT PRIMARY KEY, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS report_shares (id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL,
      code_hash TEXT, mode TEXT NOT NULL, snapshot TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER);
      CREATE INDEX IF NOT EXISTS report_shares_analysis_idx ON report_shares(analysis_id);`);
  }
  async assessment(id: string) { const row: any = this.db.prepare("SELECT record FROM tier_assessments WHERE analysis_id=?").get(id); return row ? JSON.parse(row.record) : null; }
  async saveAssessment(id: string, record: AssessmentRecord) { this.db.prepare("INSERT INTO tier_assessments VALUES (?,?) ON CONFLICT(analysis_id) DO UPDATE SET record=excluded.record").run(id, JSON.stringify(record)); }
  async create(r: ShareRow) { this.db.prepare("INSERT INTO report_shares VALUES (?,?,?,?,?,?,?,?,?)").run(r.id, r.analysisId, r.tokenHash, r.codeHash, r.mode, JSON.stringify(r.snapshot), r.createdAt, r.expiresAt, r.revokedAt); }
  async get(id: string) { return fromRow(this.db.prepare("SELECT * FROM report_shares WHERE id=?").get(id)); }
  async byToken(hash: string) { return fromRow(this.db.prepare("SELECT * FROM report_shares WHERE token_hash=?").get(hash)); }
  async list(id: string) { return (this.db.prepare("SELECT * FROM report_shares WHERE analysis_id=? ORDER BY created_at DESC").all(id)).map(r => summary(fromRow(r)!)); }
  async update(id: string, patch: { expiresAt?: number; revokedAt?: number }) {
    if (patch.revokedAt !== undefined) this.db.prepare("UPDATE report_shares SET revoked_at=? WHERE id=?").run(patch.revokedAt, id);
    if (patch.expiresAt !== undefined) this.db.prepare("UPDATE report_shares SET expires_at=? WHERE id=? AND revoked_at IS NULL").run(patch.expiresAt, id);
  }
}
function fromRow(row: any): ShareRow | null {
  return row ? { id: row.id, analysisId: row.analysis_id, tokenHash: row.token_hash, codeHash: row.code_hash,
    protected: !!row.code_hash, mode: row.mode, snapshot: typeof row.snapshot === "string" ? JSON.parse(row.snapshot) : row.snapshot,
    createdAt: Number(row.created_at), expiresAt: Number(row.expires_at), revokedAt: row.revoked_at == null ? null : Number(row.revoked_at) } : null;
}
export function summary(r: ShareRow): ShareSummary { return { id: r.id, mode: r.mode, createdAt: r.createdAt, expiresAt: r.expiresAt, revokedAt: r.revokedAt, protected: r.protected }; }
export class SupabaseClientReportStore implements ClientReportStore {
  constructor(private db: SupabaseClient) {}
  async assessment(id: string) { const { data, error } = await this.db.from("tier_assessments").select("record").eq("analysis_id", id).maybeSingle(); if (error) throw error; return data?.record ?? null; }
  async saveAssessment(id: string, record: AssessmentRecord) { const { error } = await this.db.from("tier_assessments").upsert({ analysis_id: id, record }); if (error) throw error; }
  async create(r: ShareRow) { const { error } = await this.db.from("report_shares").insert({ id:r.id, analysis_id:r.analysisId, token_hash:r.tokenHash, code_hash:r.codeHash, mode:r.mode, snapshot:r.snapshot, created_at:r.createdAt, expires_at:r.expiresAt, revoked_at:r.revokedAt }); if (error) throw error; }
  async get(id: string) { const { data, error } = await this.db.from("report_shares").select("*").eq("id", id).maybeSingle(); if (error) throw error; return fromRow(data); }
  async byToken(hash: string) { const { data, error } = await this.db.from("report_shares").select("*").eq("token_hash", hash).maybeSingle(); if (error) throw error; return fromRow(data); }
  async list(id: string) { const { data, error } = await this.db.from("report_shares").select("id,mode,created_at,expires_at,revoked_at,code_hash").eq("analysis_id", id).order("created_at", { ascending:false }); if (error) throw error; return (data ?? []).map(r => summary(fromRow(r)!)); }
  async update(id: string, p: { expiresAt?: number; revokedAt?: number }) {
    let q = this.db.from("report_shares").update({ ...(p.expiresAt !== undefined ? {expires_at:p.expiresAt} : {}), ...(p.revokedAt !== undefined ? {revoked_at:p.revokedAt} : {}) }).eq("id",id);
    if (p.expiresAt !== undefined) q = q.is("revoked_at", null);
    const { error } = await q; if (error) throw error;
  }
}
let singleton: ClientReportStore | undefined;
export function clientReportStore(): ClientReportStore {
  if (!singleton) {
    if (process.env.SUPABASE_URL) {
      if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Report sharing requires the Supabase service role.");
      singleton = new SupabaseClientReportStore(createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth:{ persistSession:false }, realtime:{transport:ws as any} }));
    } else singleton = new SqliteClientReportStore(new Database("data.db"));
  }
  return singleton;
}
