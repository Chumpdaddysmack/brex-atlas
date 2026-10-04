import {createSnapshotSubscriptionClient,type SnapshotReceipt} from "./snapshot-subscriptions";
import {SNAPSHOT_SUPPRESSION_PROPERTIES} from "./snapshot-workflow-guard";
import type {ReadOnlySnapshotInputs} from "./snapshot-dry-run-worker";
import type {DryRunEvidence} from "./snapshot-readiness";

const contactFields=["email","hs_marketable_status",...SNAPSHOT_SUPPRESSION_PROPERTIES,
  "atlas_snapshot_request_id","atlas_snapshot_id","atlas_snapshot_url","atlas_snapshot_requested_at",
  "atlas_snapshot_expires_at","atlas_snapshot_email_permission","atlas_snapshot_permission_version",
  "atlas_optional_marketing_choice","atlas_snapshot_delivery_state"];
export interface ReadOnlyEvidenceSources {
  // Authenticated, host-pinned GET transport. No method/body arguments exist.
  // Transport must return null only for a confirmed contact-not-found response.
  get(path:string,signal:AbortSignal):Promise<any>;
  readReviewedEmail(signal:AbortSignal):Promise<DryRunEvidence["email"]>;
  readVerifiedBilling(signal:AbortSignal):Promise<DryRunEvidence["billing"]>;
}
export function createSnapshotReadOnlyInputs(sources:ReadOnlyEvidenceSources,now=Date.now):ReadOnlySnapshotInputs {
  return {
    async readEvidence(receipt:SnapshotReceipt,signal:AbortSignal){
      signal.throwIfAborted();
      const subscriptions=createSnapshotSubscriptionClient(async(method,path)=>{
        if(method!=="GET")throw new Error("No-send evidence reader cannot mutate subscriptions");
        return sources.get(path,signal);
      },now);
      const preferences=await subscriptions.read(receipt.email);
      signal.throwIfAborted();
      const data=await sources.get(`/crm/v3/objects/contacts/${encodeURIComponent(receipt.email)}?idProperty=email&properties=${contactFields.join(",")}`,signal);
      if(data!==null&&(!data||data.archived!==false||!data.id||!data.properties||typeof data.properties!=="object"))
        throw new Error("Unconfirmed CRM response");
      const contactCheckedAt=now();
      const email=await sources.readReviewedEmail(signal);
      const billing=await sources.readVerifiedBilling(signal);
      signal.throwIfAborted();
      return {preferences,contact:data?.properties||null,contactCheckedAt,email,billing};
    },
  };
}
