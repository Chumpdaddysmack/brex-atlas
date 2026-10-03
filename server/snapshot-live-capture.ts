import { widgetDb } from "./widget-store";
import { loadSnapshotPilotReceipt } from "./snapshot-pilot";
import { createSnapshotDeliveryLedger } from "./snapshot-delivery-ledger";
import { SNAPSHOT_PILOT_EMAIL } from "./snapshot-subscriptions";

export const LIVE_TEST_APPROVAL = "kenny-one-email-2026-10-03T23:45:00Z";
export const LIVE_TEST_CUTOFF = "2026-10-03T23:45:00Z";

/**
 * Capture only. No HubSpot, subscription, marketing-status, workflow or send
 * capability is exposed here. The operator must separately verify eligibility.
 * Existing no-send receipts are never converted or released for sending.
 */
export async function captureSnapshotLiveTest(
  input:{requestId:string;snapshotUrl:string}, db:ReturnType<typeof widgetDb>,
) {
  const receipt=await loadSnapshotPilotReceipt(input.requestId,input.snapshotUrl,async id=>{
    const {data:request,error}=await db.from("widget_snapshot_requests").select("*").eq("id",id).single();
    if(error||!request||request.consent_evidence?.liveEmailTest!==LIVE_TEST_APPROVAL
      || request.consent_evidence?.noSendPilot
      || Date.parse(request.requested_at)<=Date.parse(LIVE_TEST_CUTOFF))
      throw new Error("Fresh live-test receipt required.");
    const {data:snapshot,error:snapshotError}=await db.from("widget_snapshots").select("*").eq("id",request.snapshot_id).single();
    if(snapshotError||!snapshot)throw new Error("Snapshot unavailable.");
    return {request,snapshot};
  });
  if(receipt.email!==SNAPSHOT_PILOT_EMAIL)throw new Error("Outside approved recipient.");
  // Do not open another candidate after a terminal outcome for this approval.
  // Concurrent candidates are also serialized by the database claim RPC.
  const {data:prior,error}=await db.from("widget_snapshot_delivery_attempts")
    .select("request_id,state").eq("email",SNAPSHOT_PILOT_EMAIL)
    .gte("created_at",LIVE_TEST_CUTOFF);
  if(error||!Array.isArray(prior))throw new Error("Delivery history unavailable.");
  if(prior.some(a=>a.request_id!==receipt.requestId))
    return {status:"review_required",sendingEnabled:false};
  const claim=await createSnapshotDeliveryLedger((name,args)=>db.rpc(name,args)).claim(receipt);
  return {status:claim.status==="claimed" || (claim.status==="duplicate"&&claim.state==="prepared")
    ?"request_held":"review_required",sendingEnabled:false};
}
