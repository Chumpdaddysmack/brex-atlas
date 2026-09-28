// server/widget-store.ts
// Durable persistence for Atlas widget diagnostics + email-captured leads.
// Replaces the in-memory Map so widget runs survive Railway container restarts
// and lead captures are correlatable across days.
//
// Uses the existing Supabase project (dlidmsxiycnjdivzpzax).

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import ws from "ws";
import type { WidgetConsentEvidence } from "@shared/widget-consent";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let client: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set. Widget persistence disabled.",
    );
  }
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      // Match the main storage client: Node 20 has no native WebSocket.
      realtime: { transport: ws as any },
    });
  }
  return client;
}

// Hash IP so we can rate-limit / correlate without storing raw IPs (light PII posture)
export function hashIp(ip: string): string {
  return createHash("sha256").update(`brex-atlas-widget:${ip}`).digest("hex").slice(0, 32);
}

// ---------- Types ----------

export interface StoredDiagnostic {
  id: string;
  createdAt: string;
  url: string;
  industry: string;
  revenueBand: string;
  primaryGoal: string;
  overallScore: number;
  fitTier: "advisor" | "strategist" | "full-fractional" | "not-a-fit";
  verdict: "critical" | "developing" | "solid" | "top-quartile";
  positioningScore?: number;
  offerScore?: number;
  buyerScore?: number;
  growthScore?: number;
  headline?: string;
  rawOutput: any;
}

export interface InsertDiagnosticParams {
  ip: string;
  url: string;
  industry: string;
  revenueBand: string;
  primaryGoal: string;
  overallScore: number;
  fitTier: string;
  verdict: string;
  positioningScore?: number;
  offerScore?: number;
  buyerScore?: number;
  growthScore?: number;
  headline?: string;
  rawOutput: unknown;
}

export interface InsertLeadParams {
  diagnosticId: string;
  email: string;
  name?: string;
  company?: string;
  hubspotContactId?: string | null;
  hubspotDealId?: string | null;
  hubspotSyncStatus?: "pending" | "synced" | "failed" | "skipped";
  hubspotSyncError?: string | null;
  hotLeadAlertSent?: boolean;
}

// ---------- Diagnostics ----------

export async function insertDiagnostic(p: InsertDiagnosticParams): Promise<string> {
  const { data, error } = await db()
    .from("widget_diagnostics")
    .insert({
      ip_hash: hashIp(p.ip),
      url: p.url,
      industry: p.industry,
      revenue_band: p.revenueBand,
      primary_goal: p.primaryGoal,
      overall_score: Math.round(p.overallScore),
      fit_tier: p.fitTier,
      verdict: p.verdict,
      positioning_score: p.positioningScore !== undefined ? Math.round(p.positioningScore) : null,
      offer_score: p.offerScore !== undefined ? Math.round(p.offerScore) : null,
      buyer_score: p.buyerScore !== undefined ? Math.round(p.buyerScore) : null,
      growth_score: p.growthScore !== undefined ? Math.round(p.growthScore) : null,
      headline: p.headline ?? null,
      raw_output: p.rawOutput,
    })
    .select("id")
    .single();
  if (error) throw new Error(`insertDiagnostic failed: ${error.message}`);
  return data.id;
}

export async function getDiagnostic(id: string): Promise<StoredDiagnostic | null> {
  const { data, error } = await db()
    .from("widget_diagnostics")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return null;
  if (!data) return null;
  return {
    id: data.id,
    createdAt: data.created_at,
    url: data.url,
    industry: data.industry,
    revenueBand: data.revenue_band,
    primaryGoal: data.primary_goal,
    overallScore: data.overall_score,
    fitTier: data.fit_tier,
    verdict: data.verdict,
    positioningScore: data.positioning_score ?? undefined,
    offerScore: data.offer_score ?? undefined,
    buyerScore: data.buyer_score ?? undefined,
    growthScore: data.growth_score ?? undefined,
    headline: data.headline ?? undefined,
    rawOutput: data.raw_output,
  };
}

export async function markLeadCaptured(
  diagnosticId: string,
  email: string,
): Promise<void> {
  const { error } = await db()
    .from("widget_diagnostics")
    .update({ lead_captured_at: new Date().toISOString(), lead_email: email })
    .eq("id", diagnosticId);
  if (error) console.error("[widget-store] markLeadCaptured failed:", error);
}

// ---------- Leads ----------

export async function insertWidgetConsent(
  diagnosticId: string, email: string, evidence: WidgetConsentEvidence,
): Promise<{ id: string; recordedAt: string }> {
  const row = {
    diagnostic_id: diagnosticId, email, decision: evidence.decision,
    policy_version: evidence.policyVersion, consent_text: evidence.consentText,
    subscription_type_id: evidence.subscriptionTypeId, source: evidence.source,
  };
  // Retries preserve the original server timestamp and never overwrite history.
  const { error } = await db().from("widget_consent_events").upsert(row, {
    onConflict: "diagnostic_id,email,policy_version,decision", ignoreDuplicates: true,
  });
  if (error) throw new Error(`Consent evidence could not be saved: ${error.message}`);
  const { data, error: readError } = await db().from("widget_consent_events")
    .select("id,created_at").match({
      diagnostic_id: diagnosticId, email, policy_version: evidence.policyVersion, decision: evidence.decision,
    }).single();
  if (readError || !data) throw new Error("Consent receipt could not be verified.");
  return { id: data.id, recordedAt: data.created_at };
}

export async function insertLead(p: InsertLeadParams): Promise<string> {
  const { data, error } = await db()
    .from("widget_leads")
    .insert({
      diagnostic_id: p.diagnosticId,
      email: p.email,
      name: p.name ?? null,
      company: p.company ?? null,
      hubspot_contact_id: p.hubspotContactId ?? null,
      hubspot_deal_id: p.hubspotDealId ?? null,
      hubspot_sync_status: p.hubspotSyncStatus ?? "pending",
      hubspot_sync_error: p.hubspotSyncError ?? null,
      hubspot_synced_at: p.hubspotSyncStatus === "synced" ? new Date().toISOString() : null,
      hot_lead_alert_sent_at: p.hotLeadAlertSent ? new Date().toISOString() : null,
    })
    .select("id")
    .single();
  if (error) throw new Error(`insertLead failed: ${error.message}`);
  return data.id;
}

export async function updateLeadSync(
  leadId: string,
  patch: {
    hubspotContactId?: string | null;
    hubspotDealId?: string | null;
    hubspotSyncStatus?: "pending" | "synced" | "failed" | "skipped";
    hubspotSyncError?: string | null;
    hotLeadAlertSent?: boolean;
  },
): Promise<void> {
  const upd: any = {};
  if (patch.hubspotContactId !== undefined) upd.hubspot_contact_id = patch.hubspotContactId;
  if (patch.hubspotDealId !== undefined) upd.hubspot_deal_id = patch.hubspotDealId;
  if (patch.hubspotSyncStatus !== undefined) {
    upd.hubspot_sync_status = patch.hubspotSyncStatus;
    if (patch.hubspotSyncStatus === "synced") upd.hubspot_synced_at = new Date().toISOString();
  }
  if (patch.hubspotSyncError !== undefined) upd.hubspot_sync_error = patch.hubspotSyncError;
  if (patch.hotLeadAlertSent !== undefined && patch.hotLeadAlertSent) {
    upd.hot_lead_alert_sent_at = new Date().toISOString();
  }
  const { error } = await db().from("widget_leads").update(upd).eq("id", leadId);
  if (error) console.error("[widget-store] updateLeadSync failed:", error);
}

// Feature flag: is persistence configured?
export function isPersistenceConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}
