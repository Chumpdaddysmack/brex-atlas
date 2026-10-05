import {createHash} from "node:crypto";
import {widgetDb} from "./widget-store";
import {loadSnapshotPilotReceipt} from "./snapshot-pilot";
import {createSnapshotDeliveryLedger, snapshotReceiptDigest} from "./snapshot-delivery-ledger";
import {createSnapshotSubscriptionClient, validateSnapshotReceipt, type SnapshotReceipt} from "./snapshot-subscriptions";
import {snapshotPermissionProperties, SNAPSHOT_EMAIL_PERMISSION} from "../shared/snapshot-delivery";
import {widgetAttributionProperties} from "../shared/widget-attribution";
import {SNAPSHOT_SUPPRESSION_PROPERTIES} from "./snapshot-workflow-guard";
import {hubspotSnapshotMessageId,planBoundSnapshotEvents} from "./snapshot-provider-events";
import {buildSnapshotAssessmentRecap} from "./snapshot-assessment-recap";
import {isDeepStrictEqual} from "node:util";

export const PUBLIC_SNAPSHOT_COHORT="public-results-2026-10-04";
export const PUBLIC_SNAPSHOT_AFTER="2026-10-04T01:47:00Z";
export const PUBLIC_WORKFLOWS=[
  {id:"5051848423",hash:"b19a32ccb6f210bf12c77daf7649100b380f73eea41f65146ee79bd1bea99783"},
  {id:"5051859668",hash:"9c85db302c448cbbc0f42b50231e669f0ddbccf20a50c136de28361db90f5016"},
];
const legacy=["5015673537","5014906568","5051336409","5051781861"];
export const COMBINED_SNAPSHOT_EMAIL="406150193876";
export const COMBINED_EMAIL_UPDATED_AT="2026-10-05T21:38:00.127Z";
const originalSenderAction={actionId:"1",actionTypeVersion:0,actionTypeId:"0-4",
  fields:{content_id:"405101719239"},type:"SINGLE_CONNECTION"};
// Keep action 1 intact for any enrollment already in progress at cutover.
export const COMBINED_SENDER_ACTIONS=[
  originalSenderAction,
  {actionId:"2",type:"LIST_BRANCH",listBranches:[{
    filterBranch:{filterBranches:[],filters:[{property:"atlas_snapshot_assessment_recap",
      operation:{operator:"IS_KNOWN",includeObjectsWithNoValueSet:false,operationType:"ALL_PROPERTY"},filterType:"PROPERTY"}],
      filterBranchType:"AND",filterBranchOperator:"AND"},
    branchName:"Assessment score and snapshot",connection:{edgeType:"STANDARD",nextActionId:"3"}}],
    defaultBranchName:"Legacy research-only snapshot",defaultBranch:{edgeType:"STANDARD",nextActionId:"1"}},
  {actionId:"3",actionTypeVersion:0,actionTypeId:"0-4",
    fields:{content_id:COMBINED_SNAPSHOT_EMAIL},type:"SINGLE_CONNECTION"},
];
export function isCombinedSnapshotFlow(f:any){
  return f?.startActionId==="2"&&isDeepStrictEqual(f.actions,COMBINED_SENDER_ACTIONS)
    &&publicWorkflowHash({...f,actions:[originalSenderAction],startActionId:"1"})===PUBLIC_WORKFLOWS[1].hash;
}
type Api=(method:"GET"|"POST"|"PATCH",path:string,body?:unknown)=>Promise<any>;
const props=["email","company","website","original_lead_source","atlas_snapshot_id","atlas_snapshot_url",
  "atlas_snapshot_requested_at","atlas_snapshot_request_id","atlas_snapshot_expires_at",
  "atlas_snapshot_email_permission","atlas_snapshot_permission_version","atlas_optional_marketing_choice",
  "atlas_snapshot_delivery_state","atlas_snapshot_assessment_recap","hs_marketable_status",...SNAPSHOT_SUPPRESSION_PROPERTIES];
export function publicSnapshotConfigured(){return !!process.env.HUBSPOT_ACCESS_TOKEN;}
export const snapshotPublicApi:Api=async(method,path,body)=>{
  if(!path.startsWith("/")||path.startsWith("//")||!publicSnapshotConfigured())throw Error("Public delivery unavailable");
  const r=await fetch("https://api.hubapi.com"+path,{method,redirect:"error",
    signal:AbortSignal.timeout(15000),
    headers:{Authorization:`Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,"Content-Type":"application/json"},
    ...(body?{body:JSON.stringify(body)}:{})});
  if(r.status===404&&method==="GET"&&path.startsWith("/crm/v3/objects/contacts/"))return null;
  if(!r.ok)throw Error("HubSpot request unconfirmed");
  if(r.status===204)return null;
  return r.json();
};
export function publicWorkflowHash(f:any){
  return createHash("sha256").update(JSON.stringify({actions:f.actions,enrollmentCriteria:f.enrollmentCriteria,
    startActionId:f.startActionId,suppressionListIds:f.suppressionListIds,timeWindows:f.timeWindows,
    blockedDates:f.blockedDates})).digest("hex");
}
export async function verifyPublicSnapshotSetup(api:Api){
  let combined=false;
  for(const w of PUBLIC_WORKFLOWS){
    const f=await api("GET","/automation/v4/flows/"+w.id);
    const combinedSender=w.id===PUBLIC_WORKFLOWS[1].id&&isCombinedSnapshotFlow(f);
    if(f?.isEnabled!==true||(publicWorkflowHash(f)!==w.hash&&!combinedSender))throw Error("Public workflow requires review");
    if(combinedSender)combined=true;
  }
  for(const id of legacy)if((await api("GET","/automation/v4/flows/"+id))?.isEnabled!==false)
    throw Error("Legacy sender isolation changed");
  const e=await api("GET","/marketing/v3/emails/405101719239");
  if(e?.isPublished!==true||e.state!=="AUTOMATED"||e.type!=="AUTOMATED_EMAIL"||e.archived
    ||e.subscriptionDetails?.subscriptionId!=="3750294688"
    ||e.subject!=="Your requested company snapshot is ready"
    ||e.updatedAt!=="2026-10-03T23:40:04.983Z"
    ||e.from?.replyTo?.toLowerCase()!=="kenny@brexconsulting.com")
    throw Error("Results email requires review");
  if(combined){
    const e=await api("GET","/marketing/v3/emails/"+COMBINED_SNAPSHOT_EMAIL);
    if(e?.isPublished!==true||e.state!=="AUTOMATED"||e.type!=="AUTOMATED_EMAIL"||e.archived
      ||e.subscriptionDetails?.subscriptionId!=="3750294688"
      ||e.subject!=="Your Brex Atlas free assessment and company snapshot are ready"
      ||e.updatedAt!==COMBINED_EMAIL_UPDATED_AT
      ||e.from?.replyTo?.toLowerCase()!=="kenny@brexconsulting.com")
      throw Error("Combined assessment email requires review");
  }
  return combined?"combined":"link-only";
}
export function assertPublicReceiptRow(r:any,now=Date.now()){
  if(!r||r.consent_evidence?.publicDelivery!==PUBLIC_SNAPSHOT_COHORT
    ||r.consent_evidence?.liveEmailTest||r.consent_evidence?.noSendPilot||r.consent_evidence?.websiteNoSend
    ||!Number.isFinite(Date.parse(r.requested_at))||Date.parse(r.requested_at)<=Date.parse(PUBLIC_SNAPSHOT_AFTER)
    ||Date.parse(r.requested_at)>now)throw Error("Fresh public request required");
}
function clear(p:Record<string,string|null>,email:string){
  if(p?.email?.toLowerCase()!==email||SNAPSHOT_SUPPRESSION_PROPERTIES.some(k=>!Object.hasOwn(p,k)))
    throw Error("Contact eligibility unknown");
  for(const k of ["hs_email_optout","hs_email_bad_address","hs_email_quarantined"])
    if(![null,"","false"].includes(p[k]))throw Error("Contact suppressed");
  if(p.hs_email_hard_bounce_reason_enum)throw Error("Contact bounced");
}
const millis=(s:any)=>/^\d+$/.test(String(s))?Number(s):Date.parse(s);
export function matchesPublicProjection(p:any,r:SnapshotReceipt){
  return p?.email?.toLowerCase()===r.email&&p.atlas_snapshot_request_id===r.requestId
    &&p.atlas_snapshot_id===r.snapshotId&&p.atlas_snapshot_url===r.snapshotUrl
    &&millis(p.atlas_snapshot_requested_at)===Date.parse(r.requestedAt)
    &&millis(p.atlas_snapshot_expires_at)===Date.parse(r.expiresAt)
    &&p.atlas_snapshot_email_permission==="true"
    &&p.atlas_snapshot_permission_version===r.permission.policyVersion
    &&p.atlas_optional_marketing_choice===r.marketingChoice;
}
async function readStored(db:any,id:string,url:string){
  return loadSnapshotPilotReceipt(id,url,async requestId=>{
    const r=await db.from("widget_snapshot_requests").select("*").eq("id",requestId).single();
    if(r.error)throw Error("Receipt unavailable");
    assertPublicReceiptRow(r.data);
    const s=await db.from("widget_snapshots").select("*").eq("id",r.data.snapshot_id).single();
    if(s.error)throw Error("Snapshot unavailable");
    return {request:r.data,snapshot:s.data};
  });
}
export function publicSubscriptionReader(api:Api,email:string){
  return createSnapshotSubscriptionClient(async(m,path,body)=>{
    const data=await api(m,path,body);
    // HubSpot's observed v4 response for a brand-new subscriber is COMPLETE
    // plus one explicit OBJECT_NOT_FOUND and no rows. This is not opt-in.
    // The receipt supplies consent; v3's narrow subscribe still refuses an
    // existing unsubscribe. Global/brand status is read separately, unchanged.
    if(m==="GET"&&path===`/communication-preferences/v4/statuses/${encodeURIComponent(email)}?channel=EMAIL`
      &&data?.status==="COMPLETE"&&Array.isArray(data.results)&&data.results.length===0
      &&data.numErrors===1&&data.errors?.length===1&&data.errors[0].category==="OBJECT_NOT_FOUND"
      &&data.errors[0].context?.subscriberIdString?.length===1
      &&data.errors[0].context.subscriberIdString[0]===email&&!data.paging?.next)
      return {status:"COMPLETE",results:[{subscriptionId:3750294688,channel:"EMAIL",businessUnitId:0,
        subscriberIdString:email,status:"NOT_SPECIFIED"}]};
    return data;
  });
}
async function preferencesClear(api:Api,r:SnapshotReceipt,allowSubscribe:boolean){
  const client=publicSubscriptionReader(api,r.email);
  let p=await client.read(r.email);
  if(p.globallyBlocked||p.snapshot==="UNSUBSCRIBED")throw Error("Snapshot permission blocked");
  if(p.snapshot==="NOT_SPECIFIED"&&allowSubscribe){
    // Newest user authorization opens this narrowly to fresh public receipts.
    // No global resubscribe or promotional subscription endpoint is exposed.
    validateSnapshotReceipt(r);
    p=await client.read(r.email);
    if(p.globallyBlocked||p.snapshot==="UNSUBSCRIBED")throw Error("Snapshot permission blocked");
    if(p.snapshot==="NOT_SPECIFIED")await api("POST","/communication-preferences/v3/subscribe",{
      emailAddress:r.email,subscriptionId:SNAPSHOT_EMAIL_PERMISSION.subscriptionTypeId,
      legalBasis:"CONSENT_WITH_NOTICE",
      legalBasisExplanation:`${r.permission.consentText} Source: atlas-widget; request: ${r.requestId}; requested: ${r.requestedAt}; permission version: ${r.permission.policyVersion}.`,
    });
    p=await client.read(r.email);
  }
  if(p.globallyBlocked||p.snapshot!=="SUBSCRIBED")throw Error("Snapshot subscription unconfirmed");
}

/** One durable claim and one trigger write. No retries of ambiguous mutations. */
export async function sendPublicSnapshot(input:{requestId:string;snapshotUrl:string},
  db:any=widgetDb(),api:Api=snapshotPublicApi){
  const receipt=await readStored(db,input.requestId,input.snapshotUrl);
  const ledger=createSnapshotDeliveryLedger((n,a)=>db.rpc(n,a));
  const claim=await ledger.claim(receipt);
  if(claim.status!=="claimed"||!claim.attemptId)
    return {status:claim.status==="duplicate"?"already_recorded":"held",state:claim.state,sendingEnabled:true};
  let armed=false;
  try{
    const mode=await verifyPublicSnapshotSetup(api);
    // Check existing preferences before creating/updating a CRM record.
    const initial=await publicSubscriptionReader(api,receipt.email).read(receipt.email);
    if(initial.globallyBlocked||initial.snapshot==="UNSUBSCRIBED")throw Error("Existing opt-out");
    let c=await api("GET",`/crm/v3/objects/contacts/${encodeURIComponent(receipt.email)}?idProperty=email&properties=${props.join(",")}`);
    if(c)clear(c.properties,receipt.email);
    const snapshot=await db.from("widget_snapshots").select("id,created_at,snapshot,company_url").eq("id",receipt.snapshotId).single();
    if(snapshot.error)throw Error("Snapshot unavailable");
    const recap=mode==="combined"?buildSnapshotAssessmentRecap(snapshot.data,receipt):"";
    const old=c?.properties||{};
    const properties={email:receipt.email,...widgetAttributionProperties(old.original_lead_source),
      ...(!old.company?{company:snapshot.data.snapshot.companyName}:{}),
      ...(!old.website?{website:snapshot.data.company_url}:{}),
      ...snapshotPermissionProperties(receipt),atlas_snapshot_url:receipt.snapshotUrl,
      atlas_snapshot_id:receipt.snapshotId,atlas_snapshot_requested_at:receipt.requestedAt,
      atlas_snapshot_assessment_recap:recap};
    const saved=await api(c?"PATCH":"POST",`/crm/v3/objects/contacts${c?"/"+encodeURIComponent(c.id):""}`,{properties});
    const id=String(c?.id||saved?.id||"");
    if(!/^\d+$/.test(id))throw Error("Contact creation unconfirmed");
    const stored=await db.from("widget_snapshot_requests").update({contact_id:id,sync_status:"synced"}).eq("id",receipt.requestId);
    if(stored.error)throw Error("Contact binding unconfirmed");
    await preferencesClear(api,receipt,true);
    c=await api("GET",`/crm/v3/objects/contacts/${id}?properties=${props.join(",")}`);
    clear(c?.properties,receipt.email);
    if(!matchesPublicProjection(c.properties,receipt)||c.properties.atlas_snapshot_delivery_state!=="pending"
      ||(c.properties.atlas_snapshot_assessment_recap||"")!==recap)
      throw Error("Contact request mismatch");
    validateSnapshotReceipt(receipt);
    await preferencesClear(api,receipt,false);
    if(!await ledger.transition(receipt.requestId,claim.attemptId,"prepared","dispatching",PUBLIC_SNAPSHOT_COHORT))
      throw Error("Claim changed");
    armed=true;
    // Public status workflow respects the native saved maximum. The separate
    // sender enrolls only after HubSpot itself reads hs_marketable_status=true.
    // No REST marketing-status override and no billing-tier change.
    await api("PATCH",`/crm/v3/objects/contacts/${id}`,{properties:{atlas_snapshot_delivery_state:"ready"}});
    return {status:"queued",sendingEnabled:true};
  }catch{
    await ledger.transition(receipt.requestId,claim.attemptId,armed?"dispatching":"prepared",
      armed?"uncertain":"blocked",armed?PUBLIC_SNAPSHOT_COHORT+":unconfirmed":PUBLIC_SNAPSHOT_COHORT+":preflight_blocked").catch(()=>false);
    return {status:armed?"held":"blocked",sendingEnabled:true};
  }
}

/** A CLICK with the exact private snapshot token binds a message, but is NOT
 * delivery proof. Only its authenticated SENT/DELIVERED lineage changes state.
 * Unopened, ambiguous, bounced-without-binding and timed-out sends remain held.
 */
export function snapshotClickBinding(events:any[],email:string,url:string){
  const expected=new URL(url),matches=new Map<string,{id:string;created:number}>();
  for(const e of events){
    if(e.type!=="CLICK"||e.recipient!==email||e.portalId!==242249577||!e.sentBy?.id)continue;
    try{
      const u=new URL(e.url);
      if(u.origin===expected.origin&&u.pathname===expected.pathname&&u.hash===expected.hash)
        matches.set(`${e.sentBy.created}:${e.sentBy.id}`,e.sentBy);
    }catch{/* Not a usable link event. */}
  }
  return matches.size===1?[...matches.values()][0]:null;
}
async function completeEvents(api:Api,email:string,campaignId:number,since:number){
  const events:any[]=[];let offset:string|undefined;const seen=new Set<string>();
  for(let i=0;i<20;i++){
    const q=new URLSearchParams({recipient:email,campaignId:String(campaignId),startTimestamp:String(since),limit:"100"});
    if(offset)q.set("offset",offset);
    const p=await api("GET","/email/public/v1/events?"+q);
    if(!Array.isArray(p?.events)||typeof p.hasMore!=="boolean")throw Error("Incomplete events");
    events.push(...p.events);
    if(p.hasMore===false)return events;
    if(!p.offset||seen.has(String(p.offset)))throw Error("Invalid event pagination");
    offset=String(p.offset);seen.add(offset);
  }
  throw Error("Event pagination limit");
}
export async function reconcilePublicSnapshot(db:any=widgetDb(),api:Api=snapshotPublicApi){
  const rows=await db.from("widget_snapshot_delivery_attempts").select("*")
    .in("state",["dispatching","uncertain","sent"]).gte("created_at",PUBLIC_SNAPSHOT_AFTER).limit(50);
  if(rows.error)throw Error("Ledger unavailable");
  if(!rows.data.length)return;
  await verifyPublicSnapshotSetup(api);
  const map=await api("GET","/automation/v4/flows/email-campaigns?flowId="+PUBLIC_WORKFLOWS[1].id);
  // Observed mapping is an array (validated in tests against provider fixture).
  const mappings=Array.isArray(map)?map:map?.results;
  if(!Array.isArray(mappings))throw Error("Campaign mapping unavailable");
  const ids=new Set<number>();
  for(const m of mappings)if(String(m.flowId)===PUBLIC_WORKFLOWS[1].id
    &&["405101719239",COMBINED_SNAPSHOT_EMAIL].includes(String(m.emailContentId)))ids.add(Number(m.emailCampaignId));
  if(!ids.size||ids.size>10||![...ids].every(id=>Number.isSafeInteger(id)&&id>0))throw Error("Ambiguous campaign mapping");
  for(const a of rows.data){
    try{
      const request=await db.from("widget_snapshot_requests").select("*").eq("id",a.request_id).single();
      if(request.error||!request.data.contact_id)continue;
      assertPublicReceiptRow(request.data);
      const c=await api("GET",`/crm/v3/objects/contacts/${request.data.contact_id}?properties=${props.join(",")}`);
      const receipt=await readStored(db,a.request_id,c?.properties?.atlas_snapshot_url);
      if(snapshotReceiptDigest(receipt)!==a.receipt_digest||!matchesPublicProjection(c.properties,receipt))continue;
      const candidates:{campaignId:number;events:any[];parent:any}[]=[];
      for(const campaignId of ids){
        const events=await completeEvents(api,a.email,campaignId,Date.parse(a.created_at));
        if(events.some(e=>e.portalId!==242249577||e.emailCampaignId!==campaignId||e.recipient!==a.email))
          throw Error("Unexpected event identity");
        // More than one parent in any mapped campaign is ambiguous as well.
        const matching=events.filter(e=>snapshotClickBinding([e],a.email,receipt.snapshotUrl));
        const parent=snapshotClickBinding(events,a.email,receipt.snapshotUrl);
        if(matching.length&&!parent)throw Error("Ambiguous snapshot messages");
        if(parent)candidates.push({campaignId,events,parent});
      }
      if(candidates.length!==1)continue;
      const {campaignId,events,parent}=candidates[0];
      const providerMessageId=hubspotSnapshotMessageId(242249577,campaignId,parent);
      if(a.provider_message_id&&a.provider_message_id!==providerMessageId)continue;
      const lineage=events.filter(e=>(e.type==="SENT"?e:e.sentBy)?.id===parent.id
        &&(e.type==="SENT"?e:e.sentBy)?.created===parent.created);
      const plan=planBoundSnapshotEvents({requestId:a.request_id,attemptId:a.attempt_id,
        receiptDigest:a.receipt_digest,providerMessageId,portalId:242249577,campaignId,email:a.email,sentEvent:parent},
        {events:lineage,hasMore:false});
      if(plan.status!=="verified")continue;
      const bound=await db.rpc("bind_snapshot_delivery_message",{p_request_id:a.request_id,
        p_attempt_id:a.attempt_id,p_provider_message_id:providerMessageId});
      if(bound.error||bound.data!==true)continue;
      // The per-request ledger is authoritative. Never write the contact's
      // mutable state from an asynchronous observer: another instance could
      // have completed this request and started a newer request meanwhile.
      // New submissions set pending then ready, providing a fresh trigger.
      for(const e of plan.events){
        const r=await db.rpc("record_snapshot_delivery_event",{p_event_id:e.eventId,
          p_provider_message_id:e.providerMessageId,p_event_type:e.eventType,p_occurred_at:e.occurredAt});
        if(r.error)break;
      }
    }catch{/* Fail closed: never resend or release on uncertainty. */}
  }
}
let started=false,busy=false;
export function startPublicSnapshotReconciler(){
  if(started||process.env.SNAPSHOT_PUBLIC_DELIVERY_ENABLED!=="true")return;
  started=true;
  const t=setInterval(async()=>{
    if(busy)return;busy=true;
    try{await reconcilePublicSnapshot();}catch{console.warn("[snapshot] public delivery review pending");}
    finally{busy=false;}
  },60000);t.unref();
}
