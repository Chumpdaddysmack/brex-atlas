// Synthetic fixtures only. No real prospect data, credentials or network calls.
import {createHash,randomUUID} from "node:crypto";
import {parseSnapshotEmailPermission,SNAPSHOT_EMAIL_PERMISSION,snapshotPermissionProperties} from "../shared/snapshot-delivery";
import type {SnapshotReceipt} from "./snapshot-subscriptions";
import type {DryRunEvidence} from "./snapshot-readiness";
export function dryRunFixture(now=Date.now()){
  const token="a".repeat(64);
  const receipt:SnapshotReceipt={
    requestId:randomUUID(),snapshotId:randomUUID(),email:`fixture-${randomUUID()}@example.invalid`,
    requestedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+86_400_000).toISOString(),
    snapshotUrl:`https://atlas.brexconsulting.com/widget.html#snapshot=${token}`,
    permission:parseSnapshotEmailPermission({snapshotEmailConsent:true,snapshotEmailConsentVersion:SNAPSHOT_EMAIL_PERMISSION.version}),
    marketingChoice:"not_selected",
  };
  const evidence:DryRunEvidence={
    preferences:{email:receipt.email,snapshot:"SUBSCRIBED",globallyBlocked:false,checkedAt:now},
    contact:{email:receipt.email,...snapshotPermissionProperties(receipt,now),atlas_snapshot_id:receipt.snapshotId,
      atlas_snapshot_url:receipt.snapshotUrl,atlas_snapshot_requested_at:receipt.requestedAt,hs_marketable_status:"true",
      hs_email_optout:null,hs_email_bad_address:null,hs_email_quarantined:null,hs_email_hard_bounce_reason_enum:null},
    contactCheckedAt:now,email:{id:"405101719239",subscriptionId:"3750294688",published:true,resultsOnlyReviewed:true,checkedAt:now},
    billing:{cap:2000,capVerified:true,current:1000,reserved:0,checkedAt:now},
  };
  const stored={
    request:{id:receipt.requestId,email:receipt.email,snapshot_id:receipt.snapshotId,requested_at:receipt.requestedAt,
      consent_evidence:{snapshotDelivery:receipt.permission,decision:receipt.marketingChoice}},
    snapshot:{id:receipt.snapshotId,expires_at:receipt.expiresAt,token_hash:createHash("sha256").update(token).digest("hex")},
  };
  return {receipt,evidence,stored};
}
