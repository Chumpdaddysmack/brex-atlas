import { SNAPSHOT_EMAIL_PERMISSION } from "../shared/snapshot-delivery";
import { SNAPSHOT_PILOT_EMAIL, validateSnapshotReceipt, type SnapshotReceipt, type PreferenceRead } from "./snapshot-subscriptions";

export const SNAPSHOT_RESULTS_EMAIL_ID = "405101719239";
export const SNAPSHOT_SUPPRESSION_PROPERTIES = [
  "hs_email_optout", "hs_email_bad_address", "hs_email_hard_bounce_reason_enum", "hs_email_quarantined",
] as const;
function crmTimestamp(value:string|null|undefined):number{
  if(!value)return NaN;
  return /^\d+$/.test(value)?Number(value)
    :/^\d{4}-\d{2}-\d{2}T/.test(value)?Date.parse(value):NaN;
}

export interface WorkflowEvidence {
  pilotEnabled: boolean;
  approvedRequestsAfter: string;
  receipt: SnapshotReceipt;
  preferences: PreferenceRead;
  contact: Record<string, string | null>;
  contactCheckedAt: number;
  billingCapVerified: boolean;
  // Even an active native cap is not a reservation. A persisted serialized
  // contact/request claim and actual marketing-status readback are required.
  requestClaimVerified: boolean;
  email: {id: string; subscriptionId: string; published: boolean; resultsOnlyReviewed: boolean};
  ledgerState: "pending" | "ready" | "sent" | "delivered" | "blocked" | "failed";
}

/** Pure policy; does not enroll, set CRM properties, or mark an email sent. */
export function evaluateSnapshotWorkflow(e: WorkflowEvidence, now = Date.now()) {
  const stop = (reason: string) => ({allow: false, reason});
  if (!e.pilotEnabled) return stop("pilot_disabled");
  try { validateSnapshotReceipt(e.receipt, now); } catch { return stop("invalid_or_expired_receipt"); }
  const r = e.receipt, c = e.contact, p = e.preferences;
  if (r.email !== SNAPSHOT_PILOT_EMAIL) return stop("not_pilot_recipient");
  const cutoff = Date.parse(e.approvedRequestsAfter);
  if (!Number.isFinite(cutoff) || cutoff > now || Date.parse(r.requestedAt) <= cutoff) return stop("historical_request");
  if (["sent", "delivered"].includes(e.ledgerState)) return stop("already_processed");
  if (!["pending", "ready"].includes(e.ledgerState)) return stop("manual_review_required");
  if (!e.requestClaimVerified) return stop("request_not_exclusively_claimed");
  if (c.email?.toLowerCase() !== r.email || c.atlas_snapshot_request_id !== r.requestId
      || c.atlas_snapshot_id !== r.snapshotId || c.atlas_snapshot_url !== r.snapshotUrl
      || crmTimestamp(c.atlas_snapshot_expires_at) !== Date.parse(r.expiresAt)
      || c.atlas_snapshot_email_permission !== "true"
      || c.atlas_snapshot_permission_version !== SNAPSHOT_EMAIL_PERMISSION.version
      || c.atlas_optional_marketing_choice !== r.marketingChoice
      || crmTimestamp(c.atlas_snapshot_requested_at) !== Date.parse(r.requestedAt)) return stop("contact_request_mismatch");
  if (!["pending", "ready"].includes(c.atlas_snapshot_delivery_state || "")) return stop("contact_state_not_pending");
  if (!Number.isFinite(e.contactCheckedAt) || e.contactCheckedAt > now || now - e.contactCheckedAt > 60_000
      || !Number.isFinite(p.checkedAt) || p.checkedAt > now || now - p.checkedAt > 60_000
      || p.email !== r.email) return stop("stale_or_mismatched_read");
  if (p.globallyBlocked !== false || p.snapshot !== "SUBSCRIBED") return stop("not_explicitly_subscribed");
  // Requested fields must be present, even if their value is null/empty.
  if (SNAPSHOT_SUPPRESSION_PROPERTIES.some(k => !Object.hasOwn(c, k))) return stop("suppression_status_unknown");
  for (const key of ["hs_email_optout", "hs_email_bad_address", "hs_email_quarantined"]) {
    if (!["", "false", null].includes(c[key])) return stop("suppressed_or_unknown");
  }
  if (c.hs_email_hard_bounce_reason_enum) return stop("hard_bounce");
  if (!e.billingCapVerified) return stop("billing_cap_unverified");
  if (c.hs_marketable_status !== "true") return stop("not_marketing_contact_or_cap_blocked");
  if (e.email.id !== SNAPSHOT_RESULTS_EMAIL_ID
      || e.email.subscriptionId !== SNAPSHOT_EMAIL_PERMISSION.subscriptionTypeId
      || !e.email.published || !e.email.resultsOnlyReviewed) return stop("email_not_ready");
  return {allow: true, reason: "eligible_for_controlled_test"};
}
