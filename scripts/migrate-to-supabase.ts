// One-shot migrator: pulls every row from the local SQLite (./data.db) and
// upserts it into Supabase. Uses the SERVICE ROLE key so it bypasses RLS —
// with RLS enabled and no policies, an anon key would get 'permission denied'
// on every row.
//
// Usage:
//   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//     npx tsx scripts/migrate-to-supabase.ts
//
// Idempotent — safe to re-run. Uses `upsert(..., { onConflict: "id" })` so
// existing rows update in place; new rows insert.
//
// Assumes the schema in supabase/schema.sql has already been applied in the
// Supabase SQL editor.

import Database from "better-sqlite3";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error("[migrate] set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env");
  process.exit(1);
}

// Node 20 lacks a global WebSocket. Supabase's realtime client eagerly
// initializes one, so we hand it the `ws` package explicitly. We never
// call realtime, but the client still needs a valid transport.
const supa = createClient(url, key, {
  auth: { persistSession: false },
  realtime: { transport: ws as any },
});
const sqlite = new Database("data.db", { readonly: true });

// Every jsonb column stores its payload as a JSON string in SQLite.
// Convert strings -> parsed JSON objects on the way into Supabase.
function parseJsonOrNull(v: unknown): unknown {
  if (v == null) return null;
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

async function upsertAll(table: string, rows: any[]) {
  if (rows.length === 0) {
    console.log(`[migrate] ${table}: 0 rows, skipping`);
    return;
  }
  // Chunk into 500-row batches.
  for (let start = 0; start < rows.length; start += 500) {
    const chunk = rows.slice(start, start + 500);
    const { error } = await supa.from(table).upsert(chunk, { onConflict: "id" });
    if (error) throw new Error(`upsert ${table} [${start}..${start + chunk.length}): ${error.message}`);
  }
  console.log(`[migrate] ${table}: upserted ${rows.length} rows`);
}

async function main() {
  console.log(`[migrate] source=data.db  dest=${new URL(url!).host}`);

  // -------- analyses --------
  const analyses = sqlite.prepare("SELECT * FROM analyses").all() as any[];
  const analysesRows = analyses.map((r) => ({
    id: r.id,
    client_name: r.client_name,
    client_url: r.client_url,
    industry: r.industry,
    revenue_band: r.revenue_band,
    goals: r.goals,
    budget_band: r.budget_band,
    notes: r.notes,
    status: r.status,
    progress: r.progress,
    current_step: r.current_step,
    error_message: r.error_message,
    extraction: parseJsonOrNull(r.extraction),
    competitors: parseJsonOrNull(r.competitors),
    strategy: parseJsonOrNull(r.strategy),
    sow: parseJsonOrNull(r.sow),
    created_at: r.created_at,
  }));
  await upsertAll("analyses", analysesRows);

  // -------- content_plans --------
  const plans = sqlite.prepare("SELECT * FROM content_plans").all() as any[];
  const planRows = plans.map((r) => ({
    id: r.id,
    analysis_id: r.analysis_id,
    status: r.status,
    progress: r.progress,
    current_step: r.current_step,
    error_message: r.error_message,
    plan_json: parseJsonOrNull(r.plan_json),
    created_at: r.created_at,
  }));
  await upsertAll("content_plans", planRows);

  // -------- content_pieces --------
  const pieces = sqlite.prepare("SELECT * FROM content_pieces").all() as any[];
  const pieceRows = pieces.map((r) => ({
    id: r.id,
    plan_id: r.plan_id,
    analysis_id: r.analysis_id,
    channel: r.channel,
    title: r.title,
    week_number: r.week_number,
    scheduled_date: r.scheduled_date,
    pillar: r.pillar,
    target_query: r.target_query,
    brief_json: parseJsonOrNull(r.brief_json),
    draft_json: parseJsonOrNull(r.draft_json),
    status: r.status,
    review_notes: r.review_notes,
    error_message: r.error_message,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
  await upsertAll("content_pieces", pieceRows);

  console.log("[migrate] done");
}

main().catch((e) => {
  console.error("[migrate] FAILED:", e);
  process.exit(1);
});
