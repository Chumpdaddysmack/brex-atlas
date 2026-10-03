import { createHash } from "node:crypto";
import { validateSnapshotReceipt, type SnapshotReceipt } from "./snapshot-subscriptions";

export type Claim = {status: string; attemptId?: string; state?: string};
export interface DeliveryLedger {
  claim(receipt: SnapshotReceipt): Promise<Claim>;
  transition(requestId: string, attemptId: string, from: string, to: string, reason: string): Promise<boolean>;
}
// Explicit stable fields, not arbitrary object key order. No bearer link is
// written into the ledger: only its bound digest.
export function snapshotReceiptDigest(r: SnapshotReceipt) {
  return createHash("sha256").update(JSON.stringify([
    r.requestId,r.email,r.snapshotId,r.snapshotUrl,r.requestedAt,r.expiresAt,
    r.permission.decision,r.permission.policyVersion,r.permission.consentText,
    r.permission.subscriptionTypeId,r.permission.source,r.marketingChoice,
  ])).digest("hex");
}
type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{data: any; error: unknown}>;
export function createSnapshotDeliveryLedger(rpc: Rpc, now = Date.now): DeliveryLedger {
  async function call(name: string, args: Record<string, unknown>) {
    const result = await rpc(name,args);
    if (result.error || result.data == null) throw new Error("Delivery ledger unavailable");
    return result.data;
  }
  return {
    async claim(receipt) {
      validateSnapshotReceipt(receipt,now());
      const result=await call("claim_snapshot_delivery",{
        p_request_id:receipt.requestId,p_receipt_digest:snapshotReceiptDigest(receipt),
      });
      if (typeof result.status !== "string" || (result.status==="claimed" && !result.attemptId))
        throw new Error("Invalid delivery claim response");
      return result;
    },
    async transition(requestId,attemptId,from,to,reason) {
      return (await call("transition_snapshot_delivery",{
        p_request_id:requestId,p_attempt_id:attemptId,p_from:from,p_to:to,p_reason:reason,
      })) === true;
    },
  };
}
