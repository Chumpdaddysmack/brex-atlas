import { createHash } from "node:crypto";
import { type DeliveryLedger } from "./snapshot-delivery-ledger";
import { prepareSnapshotSubscription, SNAPSHOT_PILOT_EMAIL, validateSnapshotReceipt,
  type SnapshotReceipt, type SubscriptionClient } from "./snapshot-subscriptions";
import { evaluateSnapshotWorkflow, type WorkflowEvidence } from "./snapshot-workflow-guard";

/** Resolve evidence from storage and bind the supplied private link to its hash. */
export async function loadSnapshotPilotReceipt(
  requestId:string,snapshotUrl:string,
  read:(requestId:string)=>Promise<{request:any;snapshot:any}>,
  now=Date.now(),
):Promise<SnapshotReceipt>{
  const {request:r,snapshot:s}=await read(requestId);
  const url=new URL(snapshotUrl),token=new URLSearchParams(url.hash.slice(1)).get("snapshot");
  if(!r || !s || r.id!==requestId || r.snapshot_id!==s.id || !token
      || createHash("sha256").update(token).digest("hex")!==s.token_hash)
    throw new Error("Snapshot does not match stored request.");
  const receipt:SnapshotReceipt={
    requestId:r.id,email:r.email,snapshotId:s.id,snapshotUrl,
    requestedAt:new Date(r.requested_at).toISOString(),expiresAt:new Date(s.expires_at).toISOString(),
    permission:r.consent_evidence?.snapshotDelivery,marketingChoice:r.consent_evidence?.decision,
  };
  validateSnapshotReceipt(receipt,now);
  return receipt;
}

/**
 * NO SEND/ENROLL/PUBLISH/SUBSCRIBE-WRITE PORT EXISTS in this runner.
 * It exercises a durable claim and current eligibility, then completes dry_run.
 * All callers must load the immutable receipt from storage, not request JSON.
 */
export async function runSnapshotPilotDryRun(
  receipt: SnapshotReceipt,
  options: {enabled: boolean; approvedRequestsAfter: string; now?: () => number},
  deps: {
    ledger: DeliveryLedger;
    subscriptions: Pick<SubscriptionClient,"read">;
    readEvidence(receipt: SnapshotReceipt): Promise<Omit<WorkflowEvidence,
      "pilotEnabled" | "approvedRequestsAfter" | "receipt" | "requestClaimVerified">>;
  },
) {
  const now=options.now||Date.now;
  if (!options.enabled) return {status:"disabled",sendingEnabled:false};
  try {validateSnapshotReceipt(receipt,now());} catch {return {status:"invalid_receipt",sendingEnabled:false};}
  const cutoff=Date.parse(options.approvedRequestsAfter);
  if (receipt.email!==SNAPSHOT_PILOT_EMAIL || !Number.isFinite(cutoff) || cutoff>now()
    || Date.parse(receipt.requestedAt)<=cutoff) return {status:"outside_pilot",sendingEnabled:false};
  let claim;
  try {claim=await deps.ledger.claim(receipt);}
  catch {return {status:"ledger_unavailable",sendingEnabled:false};}
  if(claim.status!=="claimed" || !claim.attemptId) return {status:claim.status,sendingEnabled:false};
  try {
    const subscription=await prepareSnapshotSubscription(receipt,{
      read:email=>deps.subscriptions.read(email),
      subscribe:async()=>{throw new Error("Writes are prohibited in dry-run");},
    },{mode:"dry-run",now});
    const evidence=await deps.readEvidence(receipt);
    const gate=subscription.state!=="subscription_verified"
      ? {allow:false,reason:subscription.reason}
      : evaluateSnapshotWorkflow({...evidence,receipt,pilotEnabled:true,
        approvedRequestsAfter:options.approvedRequestsAfter,requestClaimVerified:true},now());
    const completed=await deps.ledger.transition(receipt.requestId,claim.attemptId,"prepared","dry_run",
      gate.allow?"dry_run_eligible":gate.reason);
    if(!completed) return {status:"claim_state_changed",sendingEnabled:false};
    return {status:"dry_run_completed",sendingEnabled:false,subscription,gate};
  } catch {
    // Still pre-send: no send port exists, so releasing as blocked is safe.
    try {
      const released=await deps.ledger.transition(receipt.requestId,claim.attemptId,"prepared","blocked","dry_run_read_failed");
      return {status:released?"dry_run_blocked":"claim_state_changed",sendingEnabled:false};
    } catch {return {status:"claim_held_for_review",sendingEnabled:false};}
  }
}
