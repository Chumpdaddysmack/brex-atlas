// server/hubspot.ts
// HubSpot CRM writer for Atlas widget leads.
// - Upserts contact by email with Atlas properties + score
// - Creates deal for qualified fit tiers, associates to contact
// - Uses fetch directly (no SDK) — HubSpot's REST API is straightforward
//   and this keeps the container lean + upgrade-safe.
//
// Auth: Private App access token from env var HUBSPOT_ACCESS_TOKEN.
// On Railway, set this to your pat-na2-... token.

import type { GrowthOffer, ImplementationReadiness } from "@shared/growth-offers";

const HUBSPOT_API = "https://api.hubapi.com";
const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;

// Owner id for Kenny Peavy (fetched during v2 planning)
const KENNY_OWNER_ID = "78405166";
const DEFAULT_PIPELINE_ID = "default";

// Fit tier → deal stage in the default pipeline (Brex Deals Pipeline)
const TIER_TO_STAGE: Record<string, string> = {
  "advisor": "appointmentscheduled",
  "strategist": "appointmentscheduled",
  "full-fractional": "qualifiedtobuy",
};

// Fit tier → placeholder deal amount ($)
const TIER_TO_AMOUNT: Record<string, number> = {
  "advisor": 2500,
  "strategist": 5000,
  "full-fractional": 10000,
};

// Fit tier → hs_lead_status value on contact
const TIER_TO_LEAD_STATUS: Record<string, string> = {
  "full-fractional": "Deal Qualified",
  "strategist": "Marketing Qualified Lead",
  "advisor": "NEW",
  "not-a-fit": "Unqualified - Not Good Fit",
};

// Raw Atlas score (0-100) → brex_icp_score enum bucket
function bucketBrexIcpScore(score: number): string {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  if (s <= 10) return "1-10%";
  if (s <= 20) return "11-20%";
  if (s <= 30) return "21-30%";
  if (s <= 40) return "31-40%";
  if (s <= 50) return "41-50%";
  if (s <= 60) return "51-60%";
  if (s <= 70) return "61-70%";
  if (s <= 80) return "71-80%";
  if (s <= 90) return "81-90%";
  return "91-99%"; // no 100% option in the enum
}

// Raw Atlas score → brex_icp enum band
function bandBrexIcp(score: number): string {
  if (score < 50) return "Under 50%";
  if (score < 75) return "Between 51-75%";
  return "Above 75%";
}

// Tier → is qualified (create deal?)
function isQualifiedTier(tier: string): boolean {
  return tier === "advisor" || tier === "strategist" || tier === "full-fractional";
}

// Minimal fetch wrapper with auth + JSON handling
async function hs<T = any>(
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown,
): Promise<T> {
  if (!HUBSPOT_TOKEN) {
    throw new Error("HUBSPOT_ACCESS_TOKEN not set. Cannot call HubSpot.");
  }
  const res = await fetch(`${HUBSPOT_API}${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${HUBSPOT_TOKEN}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `HubSpot ${method} ${path} → ${res.status}: ${text.slice(0, 500)}`,
    );
  }
  return text ? JSON.parse(text) : ({} as T);
}

// ---------- Widget-facing types ----------

export interface AtlasWidgetSyncInput {
  // Diagnostic
  diagnosticId: string;
  overallScore: number;
  fitTier: "advisor" | "strategist" | "full-fractional" | "not-a-fit";
  verdict: "critical" | "developing" | "solid" | "top-quartile";
  positioningScore?: number;
  offerScore?: number;
  buyerScore?: number;
  growthScore?: number;
  // Input
  url: string;
  industry: string;
  revenueBand: string;
  primaryGoal: string;
  // Lead
  email: string;
  company?: string;
  runAt: Date;
  recommendedOffer?: GrowthOffer;
  implementationReadiness?: ImplementationReadiness;
}

export interface AtlasWidgetSyncResult {
  contactId: string | null;
  dealId: string | null;
  status: "synced" | "failed" | "skipped";
  error?: string;
}

// ---------- Contact upsert ----------

function buildContactProperties(input: AtlasWidgetSyncInput) {
  const overallInt = Math.round(input.overallScore);
  const props: Record<string, string | number> = {
    email: input.email,
    // Existing Brex properties — overwrite per spec
    brex_icp_score: bucketBrexIcpScore(overallInt),
    brex_icp: bandBrexIcp(overallInt),
    industry: input.industry,
    hs_lead_status: TIER_TO_LEAD_STATUS[input.fitTier] || "NEW",
    // Atlas custom properties
    atlas_fit_score: overallInt,
    atlas_fit_tier: input.fitTier,
    atlas_verdict: input.verdict,
    atlas_diagnostic_url: input.url,
    atlas_diagnostic_id: input.diagnosticId,
    atlas_run_at: input.runAt.toISOString(),
  };
  if (input.positioningScore !== undefined) {
    props.atlas_positioning_score = Math.round(input.positioningScore);
  }
  if (input.offerScore !== undefined) {
    props.atlas_offer_score = Math.round(input.offerScore);
  }
  if (input.buyerScore !== undefined) {
    props.atlas_buyer_score = Math.round(input.buyerScore);
  }
  if (input.growthScore !== undefined) {
    props.atlas_growth_score = Math.round(input.growthScore);
  }
  if (input.company) {
    props.company = input.company;
  }
  // Prospect preferences must never overwrite purchased tier, cash paid, or credit dates.
  if (input.recommendedOffer) props.atlas_recommended_offer = input.recommendedOffer;
  if (input.implementationReadiness) props.atlas_implementation_readiness = input.implementationReadiness;
  return props;
}

async function findContactByEmail(email: string): Promise<string | null> {
  try {
    const r = await hs<any>("POST", "/crm/v3/objects/contacts/search", {
      filterGroups: [{
        filters: [{ propertyName: "email", operator: "EQ", value: email }],
      }],
      properties: ["email"],
      limit: 1,
    });
    return r?.results?.[0]?.id ?? null;
  } catch (err) {
    console.error("[hubspot] findContactByEmail failed:", err);
    return null;
  }
}

async function upsertContact(input: AtlasWidgetSyncInput): Promise<string> {
  const props = buildContactProperties(input);
  const existingId = await findContactByEmail(input.email);
  if (existingId) {
    await hs("PATCH", `/crm/v3/objects/contacts/${existingId}`, { properties: props });
    return existingId;
  }
  // Set lead_source_tag + original_lead_source only on create
  const createProps = {
    ...props,
    lead_source_tag: "Atlas Excavator Widget",
    original_lead_source: "Website",
    lifecyclestage: input.fitTier === "not-a-fit" ? "subscriber" : "lead",
  };
  const created = await hs<any>("POST", "/crm/v3/objects/contacts", { properties: createProps });
  return created.id;
}

// ---------- Deal creation ----------

async function createDeal(
  input: AtlasWidgetSyncInput,
  contactId: string,
): Promise<string | null> {
  if (!isQualifiedTier(input.fitTier)) return null;

  const companyOrDomain =
    input.company ||
    (input.url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0]);
  const tierLabels: Record<string, string> = {
    "advisor": "Advisor Fit",
    "strategist": "Strategist Fit",
    "full-fractional": "Full Fractional CMO Fit",
  };
  const tierLabel = tierLabels[input.fitTier] || "Fit";
  const closeDate = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  closeDate.setUTCHours(0, 0, 0, 0);

  const description = [
    `Atlas widget diagnostic (${input.diagnosticId})`,
    `Score: ${Math.round(input.overallScore)}/100 (${input.verdict})`,
    input.positioningScore !== undefined
      ? `Sub-scores: Positioning ${Math.round(input.positioningScore)} · Offer ${Math.round(input.offerScore ?? 0)} · Buyer ${Math.round(input.buyerScore ?? 0)} · Growth ${Math.round(input.growthScore ?? 0)}`
      : "",
    `Industry: ${input.industry}`,
    `Revenue: ${input.revenueBand}`,
    `Primary goal: ${input.primaryGoal}`,
    `URL diagnosed: ${input.url}`,
  ].filter(Boolean).join("\n");

  const dealProps = {
    dealname: `Atlas Lead — ${companyOrDomain} — ${tierLabel}`,
    pipeline: DEFAULT_PIPELINE_ID,
    dealstage: TIER_TO_STAGE[input.fitTier],
    amount: TIER_TO_AMOUNT[input.fitTier],
    dealtype: "newbusiness",
    hubspot_owner_id: KENNY_OWNER_ID,
    closedate: closeDate.toISOString(),
    description,
  };

  // Create deal with primary contact association in one call (v4 associations)
  const deal = await hs<any>("POST", "/crm/v3/objects/deals", {
    properties: dealProps,
    associations: [{
      to: { id: contactId },
      types: [{
        associationCategory: "HUBSPOT_DEFINED",
        associationTypeId: 3, // deal → contact primary
      }],
    }],
  });
  return deal.id;
}

// ---------- Public API ----------

export async function syncAtlasLeadToHubSpot(
  input: AtlasWidgetSyncInput,
): Promise<AtlasWidgetSyncResult> {
  if (!HUBSPOT_TOKEN) {
    return {
      contactId: null,
      dealId: null,
      status: "skipped",
      error: "HUBSPOT_ACCESS_TOKEN not set",
    };
  }
  try {
    const contactId = await upsertContact(input);
    let dealId: string | null = null;
    try {
      dealId = await createDeal(input, contactId);
    } catch (dealErr: any) {
      // Contact worked; deal failed — return partial success
      console.error("[hubspot] createDeal failed:", dealErr?.message ?? dealErr);
      return {
        contactId,
        dealId: null,
        status: "failed",
        error: `Contact synced but deal creation failed: ${dealErr?.message ?? dealErr}`,
      };
    }
    return { contactId, dealId, status: "synced" };
  } catch (err: any) {
    console.error("[hubspot] sync failed:", err?.message ?? err);
    return {
      contactId: null,
      dealId: null,
      status: "failed",
      error: err?.message ?? String(err),
    };
  }
}

// Deep-link helpers for the hot-lead email
export function hubspotContactUrl(contactId: string): string {
  return `https://app-na2.hubspot.com/contacts/242249577/contact/${contactId}`;
}
export function hubspotDealUrl(dealId: string): string {
  return `https://app-na2.hubspot.com/contacts/242249577/deal/${dealId}`;
}
