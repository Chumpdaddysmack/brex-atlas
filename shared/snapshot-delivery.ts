import type { ConsentDecision } from "./widget-consent";

// Separate from the optional promotional subscription and versioned independently.
export const SNAPSHOT_EMAIL_PERMISSION = Object.freeze({
  version: "atlas-snapshot-delivery-v1-2026-10-03",
  text: "Email me the Company & Positioning Snapshot I requested. This permission covers this snapshot and essential access help only, not promotional emails.",
  subscriptionTypeId: "3750294688",
  subscriptionName: "Atlas SnapShot Delivery",
  source: "atlas-widget",
});

export interface SnapshotEmailPermissionEvidence {
  decision: "accepted";
  policyVersion: string;
  consentText: string;
  subscriptionTypeId: string;
  source: string;
}

export interface SnapshotPermissionTracking {
  requestId: string;
  expiresAt: string;
  permission: SnapshotEmailPermissionEvidence;
  marketingChoice: ConsentDecision;
}

export function parseSnapshotEmailPermission(body: Record<string, unknown>): SnapshotEmailPermissionEvidence {
  if (body.snapshotEmailConsent !== true) {
    throw new Error("Please select the snapshot email permission to request a copy. You can view or save your snapshot without email.");
  }
  if (body.snapshotEmailConsentVersion !== SNAPSHOT_EMAIL_PERMISSION.version) {
    throw new Error("The snapshot email permission wording has changed. Please refresh the widget and choose again.");
  }
  return {
    decision: "accepted",
    policyVersion: SNAPSHOT_EMAIL_PERMISSION.version,
    consentText: SNAPSHOT_EMAIL_PERMISSION.text,
    subscriptionTypeId: SNAPSHOT_EMAIL_PERMISSION.subscriptionTypeId,
    source: SNAPSHOT_EMAIL_PERMISSION.source,
  };
}

// This stage records evidence only. It must NOT opt in contacts, mark them
// marketable, enroll workflows, or claim that an email has been sent.
export function snapshotPermissionProperties(
  tracking: SnapshotPermissionTracking,
  now = Date.now(),
): Record<string, string> {
  const { permission } = tracking;
  const expiry = Date.parse(tracking.expiresAt);
  if (!tracking.requestId || !Number.isFinite(expiry) || expiry <= now
    || permission.decision !== "accepted"
    || permission.policyVersion !== SNAPSHOT_EMAIL_PERMISSION.version
    || permission.consentText !== SNAPSHOT_EMAIL_PERMISSION.text
    || permission.subscriptionTypeId !== SNAPSHOT_EMAIL_PERMISSION.subscriptionTypeId
    || permission.source !== SNAPSHOT_EMAIL_PERMISSION.source
    || !["accepted", "not_selected", "not_presented"].includes(tracking.marketingChoice)) {
    throw new Error("Invalid or expired snapshot permission receipt.");
  }
  return {
    atlas_snapshot_email_permission: "true",
    atlas_snapshot_permission_version: permission.policyVersion,
    atlas_snapshot_request_id: tracking.requestId,
    atlas_snapshot_expires_at: String(expiry),
    atlas_optional_marketing_choice: tracking.marketingChoice,
    atlas_snapshot_delivery_state: "pending",
  };
}
