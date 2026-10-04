import {snapshotPermissionProperties, SNAPSHOT_EMAIL_PERMISSION} from "../shared/snapshot-delivery";
import {validateSnapshotReceipt, type SnapshotReceipt, type PreferenceRead} from "./snapshot-subscriptions";
import {SNAPSHOT_RESULTS_EMAIL_ID, SNAPSHOT_SUPPRESSION_PROPERTIES} from "./snapshot-workflow-guard";

export type PreparationAction = "sync_request_fields" | "subscribe_snapshot_only" | "mark_marketing_contact";
export interface DryRunEvidence {
  preferences: PreferenceRead;
  contact: Record<string,string|null> | null;
  contactCheckedAt: number;
  email: {id:string;subscriptionId:string;published:boolean;resultsOnlyReviewed:boolean;checkedAt:number};
  billing: {cap:number;capVerified:boolean;current:number;reserved:number;checkedAt:number};
}
export interface ReadinessPlan {
  status:"eligible_no_send"|"needs_preparation"|"blocked"|"review";
  reason:string;
  actions:PreparationAction[];
  sendingEnabled:false;
}
const fresh=(time:number,now:number)=>Number.isFinite(time)&&time<=now&&now-time<=60_000;
const instant=(s:string|null|undefined)=>s&&/^\d+$/.test(s)?Number(s):Date.parse(s||"");
const result=(status:ReadinessPlan["status"],reason:string,actions:PreparationAction[]=[]):ReadinessPlan=>
  ({status,reason,actions,sendingEnabled:false});

/** Read-only public-recipient policy. Never authorizes a real send or mutation. */
export function evaluateSnapshotReadiness(r:SnapshotReceipt,e:DryRunEvidence,now=Date.now()):ReadinessPlan {
  try {validateSnapshotReceipt(r,now);} catch {return result("blocked","invalid_or_expired_receipt");}
  const p=e.preferences,c=e.contact;
  if(!fresh(e.contactCheckedAt,now)||!fresh(p.checkedAt,now)||p.email!==r.email
    ||!["SUBSCRIBED","UNSUBSCRIBED","NOT_SPECIFIED"].includes(p.snapshot)
    ||typeof p.globallyBlocked!=="boolean")return result("review","preference_or_contact_read_unknown");
  if(p.globallyBlocked||p.snapshot==="UNSUBSCRIBED")return result("blocked","existing_opt_out");
  if(c){
    if(c.email?.trim().toLowerCase()!==r.email)return result("review","contact_recipient_mismatch");
    if(SNAPSHOT_SUPPRESSION_PROPERTIES.some(k=>!Object.hasOwn(c,k)))
      return result("review","suppression_status_unknown");
    for(const key of ["hs_email_optout","hs_email_bad_address","hs_email_quarantined"]){
      if(c[key]==="true")return result("blocked","suppressed_contact");
      if(![null,"","false"].includes(c[key]))return result("review","suppression_status_unknown");
    }
    if(c.hs_email_hard_bounce_reason_enum)return result("blocked","hard_bounce");
    if(!["true","false"].includes(c.hs_marketable_status||""))return result("review","marketing_status_unknown");
    if(c.atlas_snapshot_request_id===r.requestId&&["sent","delivered","failed","blocked"].includes(c.atlas_snapshot_delivery_state||""))
      return result("blocked","request_already_terminal");
    if(c.atlas_snapshot_request_id&&c.atlas_snapshot_request_id!==r.requestId
      &&["pending","ready","dispatching","uncertain","sent"].includes(c.atlas_snapshot_delivery_state||""))
      return result("review","other_request_active");
    if(c.atlas_snapshot_request_id===r.requestId&&["dispatching","uncertain"].includes(c.atlas_snapshot_delivery_state||""))
      return result("review","send_outcome_unknown");
    if(c.atlas_snapshot_delivery_state&&!["pending","ready","delivered","failed","blocked","sent","dispatching","uncertain"].includes(c.atlas_snapshot_delivery_state))
      return result("review","contact_delivery_state_unknown");
    if(c.atlas_snapshot_request_id&&!c.atlas_snapshot_delivery_state)
      return result("review","contact_delivery_state_unknown");
  }
  const m=e.email;
  if(!fresh(m.checkedAt,now)||m.id!==SNAPSHOT_RESULTS_EMAIL_ID
    ||m.subscriptionId!==SNAPSHOT_EMAIL_PERMISSION.subscriptionTypeId||m.published!==true||m.resultsOnlyReviewed!==true)
    return result("review","email_not_verified");
  const b=e.billing;
  if(!fresh(b.checkedAt,now)||b.capVerified!==true||b.cap!==2000
    ||![b.current,b.reserved].every(n=>Number.isSafeInteger(n)&&n>=0))
    return result("review","billing_guard_unknown");
  const needsMarketing=!c||c.hs_marketable_status!=="true";
  if(needsMarketing&&b.current+b.reserved>=b.cap)return result("blocked","marketing_cap_reached");
  const actions:PreparationAction[]=[];
  const fields={...snapshotPermissionProperties(r,now),atlas_snapshot_id:r.snapshotId,
    atlas_snapshot_url:r.snapshotUrl,atlas_snapshot_requested_at:r.requestedAt};
  const matches=c&&Object.entries(fields).every(([k,v])=>
    k==="atlas_snapshot_expires_at"||k==="atlas_snapshot_requested_at"
      ? instant(c[k])===instant(v)
      : k==="atlas_snapshot_delivery_state"?["pending","ready"].includes(c[k]||""):c[k]===v);
  if(c?.atlas_snapshot_request_id===r.requestId&&!matches)
    return result("review","current_request_fields_mismatch");
  if(!matches)actions.push("sync_request_fields");
  if(p.snapshot==="NOT_SPECIFIED")actions.push("subscribe_snapshot_only");
  if(needsMarketing)actions.push("mark_marketing_contact");
  return actions.length?result("needs_preparation","changes_required_not_applied",actions)
    :result("eligible_no_send","read_checks_passed_no_send_authorized");
}
