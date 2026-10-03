import { snapshotPermissionProperties } from "../shared/snapshot-delivery";
import { createSnapshotDeliveryLedger } from "./snapshot-delivery-ledger";
import { loadSnapshotPilotReceipt } from "./snapshot-pilot";
import { SNAPSHOT_PILOT_EMAIL, type SnapshotReceipt } from "./snapshot-subscriptions";

type Transport = (method: "GET" | "POST", path: string, body?: unknown) => Promise<any>;
// Reviewed 2026-10-03. Any workflow edit, addition or removal requires re-review.
const reviewedEnabled = new Map([
  ["4634293988", "3"], ["4634514155", "4"], ["4634532561", "9"],
  ["4634749687", "2"], ["4946745055", "6"], ["4955775714", "5"],
  ["4957609704", "3"], ["5014906568", "4"], ["5015673537", "22"],
]);
const shellId = "5050995440";

export async function verifyNoSendWorkflows(api: Transport) {
  const list = await api("GET", "/automation/v4/flows");
  if (!Array.isArray(list.results) || list.paging?.next)
    throw new Error("Complete workflow review required");
  const enabled = list.results.filter((w: any) => w.isEnabled === true);
  if (enabled.length !== reviewedEnabled.size ||
      enabled.some((w: any) => reviewedEnabled.get(String(w.id)) !== String(w.revisionId)))
    throw new Error("Workflow configuration changed; no-send pilot stopped");
  const shell = await api("GET", `/automation/v4/flows/${shellId}`);
  if (String(shell.id) !== shellId || shell.isEnabled !== false ||
      !Array.isArray(shell.actions) || shell.actions.length !== 0)
    throw new Error("No-send workflow is not safely disabled");
}

/** Deliberately excludes every legacy snapshot/score trigger, subscription,
 * marketing-status and lifecycle property. Never PATCH an existing contact. */
export function noSendContactProperties(receipt: SnapshotReceipt) {
  if (receipt.email !== SNAPSHOT_PILOT_EMAIL) throw new Error("Outside pilot");
  return {
    email: receipt.email,
    ...snapshotPermissionProperties(receipt),
    atlas_snapshot_delivery_state: "blocked",
  };
}

export async function captureNoSendContact(receipt: SnapshotReceipt, api: Transport) {
  const properties = noSendContactProperties(receipt);
  await verifyNoSendWorkflows(api);
  const found = await api("POST", "/crm/v3/objects/contacts/search", {
    filterGroups: [{filters: [{propertyName: "email", operator: "EQ", value: receipt.email}]}],
    properties: ["email"], limit: 2,
  });
  // Creating a fresh test contact only. Existing history may enroll it in
  // unrelated automations; do not update or silently overwrite that history.
  if (found.total !== 0 || !Array.isArray(found.results) || found.results.length !== 0)
    throw new Error("Existing or unverified contact; manual review required");
  const saved = await api("POST", "/crm/v3/objects/contacts", {properties});
  if (!saved?.id) throw new Error("Contact creation unconfirmed");
  const legacy = ["atlas_snapshot_id", "atlas_snapshot_url", "atlas_snapshot_requested_at",
    "atlas_diagnostic_id", "atlas_fit_tier", "atlas_fit_score"];
  const fields = [...Object.keys(properties), ...legacy, "hs_analytics_source"];
  const readback = await api("GET",
    `/crm/v3/objects/contacts/${encodeURIComponent(saved.id)}?properties=${fields.join(",")}`);
  const p = readback.properties;
  if (!p || fields.some(k => !Object.hasOwn(p, k)) ||
      Object.entries(properties).some(([k, v]) => k === "atlas_snapshot_expires_at"
        ? (Number(p[k]) !== Number(v) && Date.parse(p[k]) !== Number(v))
        : p[k] !== v) || legacy.some(k => !!p[k]) || p.hs_analytics_source === "ORGANIC_SEARCH")
    throw new Error("Contact readback requires review; no retry performed");
  return String(saved.id);
}

/** Bound to a server-stored, user-submitted checkbox receipt, never chat
 * approval or an invented opt-in. No email or subscription-write capability. */
export async function runNoSendCapture(input: {
  requestId: string; snapshotUrl: string;
}, deps: {db: any; api: Transport}) {
  const {db, api} = deps;
  const receipt = await loadSnapshotPilotReceipt(input.requestId, input.snapshotUrl, async id => {
    const request = await db.from("widget_snapshot_requests").select("*").eq("id", id).single();
    if (request.error || request.data?.consent_evidence?.noSendPilot !== true)
      throw new Error("Not a stored no-send receipt");
    const snapshot = await db.from("widget_snapshots").select("*")
      .eq("id", request.data.snapshot_id).single();
    if (snapshot.error) throw new Error("Snapshot unavailable");
    return {request: request.data, snapshot: snapshot.data};
  });
  if (receipt.email !== SNAPSHOT_PILOT_EMAIL) throw new Error("Outside pilot");
  const ledger = createSnapshotDeliveryLedger((name, args) => db.rpc(name, args));
  const claim = await ledger.claim(receipt);
  if (claim.status !== "claimed" || !claim.attemptId) {
    // Do not create again after a timeout, retry, or terminal dry-run receipt.
    return {status: "already_claimed", sendingEnabled: false, contactId: null};
  }
  try {
    const contactId = await captureNoSendContact(receipt, api);
    const stored = await db.from("widget_snapshot_requests")
      .update({contact_id: contactId, sync_status: "synced"}).eq("id", receipt.requestId);
    if (stored.error) throw new Error("Contact receipt readback required");
    if (!await ledger.transition(receipt.requestId, claim.attemptId, "prepared", "dry_run",
      "capture_only_legacy_fields_withheld")) throw new Error("Ledger completion unconfirmed");
    return {status: "dry_run_completed", sendingEnabled: false, contactId};
  } catch {
    // Retain the claim, even after a timeout that might have created a contact.
    await ledger.transition(receipt.requestId, claim.attemptId, "prepared", "blocked",
      "capture_only_manual_review").catch(() => false);
    return {status: "manual_review_required", sendingEnabled: false, contactId: null};
  }
}
