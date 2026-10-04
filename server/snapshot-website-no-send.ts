import {createCipheriv,createDecipheriv,createHmac,randomBytes} from "node:crypto";
import {widgetDb} from "./widget-store";
import {loadSnapshotPilotReceipt} from "./snapshot-pilot";
import {snapshotReceiptDigest} from "./snapshot-delivery-ledger";
import {evaluateSnapshotReadiness,type ReadinessPlan} from "./snapshot-readiness";
import {createSnapshotReadOnlyInputs} from "./snapshot-readonly-inputs";
import {SNAPSHOT_PILOT_EMAIL,validateSnapshotReceipt,type SnapshotReceipt} from "./snapshot-subscriptions";
export const WEBSITE_NO_SEND_VERSION="kenny-website-no-send-v1";
type Db=ReturnType<typeof widgetDb>;
export function websiteNoSendReady(env:NodeJS.ProcessEnv=process.env,now=Date.now()){
  const cutoff=Date.parse(env.SNAPSHOT_WEBSITE_NO_SEND_AFTER||"");
  return env.SNAPSHOT_WEBSITE_NO_SEND_ENABLED==="true"&&/^[a-f0-9]{64}$/i.test(env.SNAPSHOT_QUEUE_ENCRYPTION_KEY||"")
    &&Number.isFinite(cutoff)&&cutoff<=now&&!!env.HUBSPOT_ACCESS_TOKEN;
}
function key(){const value=process.env.SNAPSHOT_QUEUE_ENCRYPTION_KEY||"";
  if(!/^[a-f0-9]{64}$/i.test(value))throw new Error("Queue key unavailable");return Buffer.from(value,"hex");}
export function encryptWebsiteReceipt(r:SnapshotReceipt,k:Buffer){
  const iv=randomBytes(12),c=createCipheriv("aes-256-gcm",k,iv);c.setAAD(Buffer.from(r.requestId));
  const encrypted=Buffer.concat([c.update(JSON.stringify(r),"utf8"),c.final()]);
  return [iv,c.getAuthTag(),encrypted].map(b=>b.toString("base64")).join(".");
}
export function decryptWebsiteReceipt(id:string,payload:string,digest:string,k:Buffer){
  const [iv,tag,data]=payload.split(".").map(s=>Buffer.from(s,"base64"));
  const d=createDecipheriv("aes-256-gcm",k,iv);d.setAAD(Buffer.from(id));d.setAuthTag(tag);
  const r=JSON.parse(Buffer.concat([d.update(data),d.final()]).toString("utf8")) as SnapshotReceipt;
  if(r.requestId!==id||snapshotReceiptDigest(r)!==digest)throw new Error("Queue receipt mismatch");
  return r;
}
async function rpc(db:Db,name:string,args:Record<string,unknown>={}){
  const {data,error}=await db.rpc(name,args);if(error||data==null)throw new Error("No-send queue unavailable");return data;
}
export async function captureWebsiteNoSend(input:{requestId:string;snapshotUrl:string},db:Db){
  if(!websiteNoSendReady())throw new Error("Website no-send test is not configured");
  const receipt=await loadSnapshotPilotReceipt(input.requestId,input.snapshotUrl,async id=>{
    const {data:request,error}=await db.from("widget_snapshot_requests").select("*").eq("id",id).single();
    if(error||request?.email!==SNAPSHOT_PILOT_EMAIL||request?.consent_evidence?.websiteNoSend!==WEBSITE_NO_SEND_VERSION
      ||request.consent_evidence.liveEmailTest||request.consent_evidence.noSendPilot
      ||Date.parse(request.requested_at)<=Date.parse(process.env.SNAPSHOT_WEBSITE_NO_SEND_AFTER!))
      throw new Error("Fresh website test receipt required");
    const {data:snapshot,error:bad}=await db.from("widget_snapshots").select("*").eq("id",request.snapshot_id).single();
    if(bad||!snapshot)throw new Error("Snapshot unavailable");return {request,snapshot};
  });
  const k=key();
  try{return await rpc(db,"enqueue_snapshot_no_send",{
    p_request_id:receipt.requestId,p_recipient_hash:createHmac("sha256",k).update(receipt.email).digest("hex"),
    p_digest:snapshotReceiptDigest(receipt),p_ciphertext:encryptWebsiteReceipt(receipt,k),
    p_cutoff:process.env.SNAPSHOT_WEBSITE_NO_SEND_AFTER,
  });}finally{k.fill(0);}
}
// The only HubSpot transport in this worker hardcodes GET and pins the host.
export async function websiteReadOnlyGet(path:string,signal:AbortSignal){
  if(!path.startsWith("/")||path.startsWith("//"))throw new Error("Invalid read path");
  const response=await fetch("https://api.hubapi.com"+path,{method:"GET",redirect:"error",signal,
    headers:{Authorization:`Bearer ${process.env.HUBSPOT_ACCESS_TOKEN||""}`,Accept:"application/json"}});
  if(response.status===404&&path.startsWith("/crm/v3/objects/contacts/"))return null;
  if(!response.ok)throw new Error("HubSpot read unavailable");
  return response.json();
}
export async function runWebsiteNoSendOnce(db:Db,get=websiteReadOnlyGet){
  if(!websiteNoSendReady())return {status:"disabled"};
  const claim=await rpc(db,"claim_snapshot_no_send");
  if(claim.status!=="claimed")return {status:claim.status};
  const j=claim.job,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30_000);
  const finish=(plan:ReadinessPlan)=>rpc(db,"finish_snapshot_no_send",{
    p_request_id:j.request_id,p_lease_token:j.lease_token,p_result:plan});
  const stop=(reason:string,status:ReadinessPlan["status"]="review"):ReadinessPlan=>({status,reason,actions:[],sendingEnabled:false});
  try{
    let receipt:SnapshotReceipt;
    const k=key();
    try{receipt=decryptWebsiteReceipt(j.request_id,j.encrypted_payload,j.receipt_digest,k);}
    catch{await finish(stop("stored_payload_unreadable"));return {status:"review"};}
    finally{k.fill(0);}
    try{validateSnapshotReceipt(receipt);}catch{await finish(stop("invalid_or_expired_receipt","blocked"));return {status:"blocked"};}
    if(receipt.email!==SNAPSHOT_PILOT_EMAIL){await finish(stop("outside_test_recipient","blocked"));return {status:"blocked"};}
    const reader=createSnapshotReadOnlyInputs({
      get,
      readReviewedEmail:async signal=>{
        const e=await get("/marketing/v3/emails/405101719239",signal);
        return {id:String(e?.id),subscriptionId:String(e?.subscriptionDetails?.subscriptionId),
          published:e?.isPublished===true&&e.state==="AUTOMATED"&&e.archived===false,
          resultsOnlyReviewed:e?.updatedAt==="2026-10-03T23:40:04.983Z"
            &&e.subject==="Your requested company snapshot is ready"&&e.from?.replyTo==="kenny@brexconsulting.com",
          checkedAt:Date.now()};
      },
      // A UI screenshot is NOT a fresh machine-readable billing reservation.
      // Hold at this gate, rather than pretending it was automatically verified.
      readVerifiedBilling:async()=>({cap:2000,capVerified:false,current:0,reserved:0,checkedAt:0}),
    });
    const evidence=await reader.readEvidence(receipt,controller.signal);
    const plan=evaluateSnapshotReadiness(receipt,evidence);
    return {status:await finish(plan)?plan.status:"lease_lost"};
  }catch{
    await rpc(db,"retry_snapshot_no_send",{p_request_id:j.request_id,p_lease_token:j.lease_token});
    return {status:"read_retry_or_review"};
  }finally{clearTimeout(timer);controller.abort();}
}
let running=false;
export function startWebsiteNoSendWorker(){
  if(process.env.SNAPSHOT_WEBSITE_NO_SEND_ENABLED!=="true")return;
  const tick=async()=>{
    if(running||!websiteNoSendReady())return;running=true;
    try{await runWebsiteNoSendOnce(widgetDb());}catch{console.error("[website-no-send] read or queue unavailable");}
    finally{running=false;}
  };
  const timer=setInterval(tick,10_000);timer.unref();void tick();
}
