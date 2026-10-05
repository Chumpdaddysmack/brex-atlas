import type { Express, Request, Response } from "express";
import { randomBytes, createHash } from "node:crypto";
import { widgetDb, hashIp } from "./widget-store";
import { publicCompanyUrl, researchSnapshot, type ResearchSnapshot } from "./widget-snapshot-research";
import { parseWidgetConsent, WIDGET_MARKETING_CONSENT } from "@shared/widget-consent";
import { syncSnapshotToHubSpot, captureSnapshotNoSend } from "./hubspot";
import { SNAPSHOT_PILOT_EMAIL } from "./snapshot-subscriptions";
import { SNAPSHOT_EMAIL_PERMISSION, parseSnapshotEmailPermission } from "@shared/snapshot-delivery";
import { captureSnapshotLiveTest, LIVE_TEST_APPROVAL } from "./snapshot-live-capture";
import {captureWebsiteNoSend,WEBSITE_NO_SEND_VERSION,websiteNoSendReady,startWebsiteNoSendWorker} from "./snapshot-website-no-send";
import {PUBLIC_SNAPSHOT_COHORT,sendPublicSnapshot,publicSnapshotConfigured,startPublicSnapshotReconciler,verifyPublicSnapshotSetup,snapshotPublicApi} from "./snapshot-public-delivery";
import { assessWidget, widgetAssessmentInputSchema, WIDGET_HEALTH_CONFIG } from "../shared/widget-health";
import { leadCaptureSchema, privateLeadCapture, LEAD_CAPTURE_NOTICE, WIDGET_REVENUE_RANGES, PERSONAL_EMAIL_DOMAINS } from "../shared/widget-lead-capture";
import {initialInternalAlert,internalAlertStatus,startInternalAlertWorker} from "./widget-internal-alert";

const lifetime=10*24*60*60*1000;
const hash=(token:string)=>createHash("sha256").update(token).digest("hex");
const hits=new Map<string,number[]>();
let active=0;
const requestLocks=new Set<string>();
function rate(key:string,limit:number,window:number) {
  const now=Date.now();
  if(hits.size>5000)for(const [k,v] of hits)if(!v.some(t=>now-t<24*3600*1000))hits.delete(k);
  const history=(hits.get(key)||[]).filter(t=>now-t<window);
  if(history.length>=limit)return false;
  history.push(now);hits.set(key,history);return true;
}
function noCache(_req:Request,res:Response,next:()=>void) {
  res.set({"Cache-Control":"no-store","X-Robots-Tag":"noindex, nofollow","Referrer-Policy":"no-referrer"});next();
}
function validToken(t:unknown):t is string {return typeof t==="string"&&/^[a-f0-9]{64}$/.test(t);}
export function isSnapshotExpired(expiresAt:string,now=Date.now()){return !Number.isFinite(Date.parse(expiresAt))||Date.parse(expiresAt)<=now;}
export function registerSnapshotRoutes(app:Express,deps:{
  research:typeof researchSnapshot;db:typeof widgetDb;sync:typeof syncSnapshotToHubSpot;
  pilot?:typeof captureSnapshotNoSend;
  liveCapture?:typeof captureSnapshotLiveTest;
  websiteCapture?:typeof captureWebsiteNoSend;
  publicDelivery?:typeof sendPublicSnapshot;
}={research:researchSnapshot,db:widgetDb,sync:syncSnapshotToHubSpot}) {
  // Default off. Local preparation only; production activation requires the
  // new email, subscription gates, billing cap and workflow to be approved.
  const publicDelivery=process.env.SNAPSHOT_PUBLIC_DELIVERY_ENABLED==="true";
  // Activate only after the additive private-column migration is approved and
  // applied. Never place contact details inside the bearer-link snapshot JSON.
  const requiredLeadCapture=process.env.SNAPSHOT_REQUIRED_LEAD_CAPTURE_ENABLED==="true";
  const websiteNoSend=!publicDelivery&&process.env.SNAPSHOT_WEBSITE_NO_SEND_ENABLED==="true";
  const liveTestCapture=!publicDelivery&&!websiteNoSend&&process.env.SNAPSHOT_LIVE_TEST_CAPTURE_ENABLED==="true";
  const noSendPilot=!publicDelivery&&!websiteNoSend&&!liveTestCapture&&process.env.SNAPSHOT_NO_SEND_PILOT_ENABLED==="true";
  const permissionTrackingEnabled=publicDelivery||websiteNoSend||liveTestCapture||noSendPilot||process.env.SNAPSHOT_PERMISSION_TRACKING_ENABLED==="true";
  if(websiteNoSend&&!deps.websiteCapture)startWebsiteNoSendWorker();
  if(publicDelivery&&!deps.publicDelivery)startPublicSnapshotReconciler();
  const internalAlertEnabled=requiredLeadCapture&&process.env.SNAPSHOT_INTERNAL_ALERT_ENABLED==="true";
  if(internalAlertEnabled&&deps.db===widgetDb)startInternalAlertWorker();
  app.use("/api/widget/snapshot",noCache);
  let publicSetupCheckedAt=0,publicSetupReady=false;
  app.get("/api/widget/snapshot/config",async(_req,res)=>{
    if(publicDelivery&&Date.now()-publicSetupCheckedAt>60_000){
      try{
        if(!deps.publicDelivery)await verifyPublicSnapshotSetup(snapshotPublicApi);
        publicSetupReady=!!deps.publicDelivery||publicSnapshotConfigured();
      }catch{publicSetupReady=false;}
      publicSetupCheckedAt=Date.now();
    }
    res.json({
    marketingConsent:WIDGET_MARKETING_CONSENT,lifetimeDays:10,healthRubric:WIDGET_HEALTH_CONFIG,internalAlerts:internalAlertStatus(),
    ...(requiredLeadCapture?{leadCapture:{required:true,notice:LEAD_CAPTURE_NOTICE,revenueRanges:WIDGET_REVENUE_RANGES,personalEmailDomains:PERSONAL_EMAIL_DOMAINS}}:{}),
    noSendPilot,liveTestCapture,websiteNoSend,publicDelivery,
    ...(websiteNoSend?{websiteTestConfigured:websiteNoSendReady()}:{}),
    emailDeliveryReady:publicDelivery?publicSetupReady:!permissionTrackingEnabled&&process.env.SNAPSHOT_EMAIL_DELIVERY_READY==="true",
    ...(permissionTrackingEnabled?{snapshotEmailConsent:SNAPSHOT_EMAIL_PERMISSION}:{}),
  });});
  app.post("/api/widget/snapshot",async(req,res)=>{
    const url=publicCompanyUrl(req.body?.url);
    const companyName=typeof req.body?.companyName==="string"?req.body.companyName.trim():"";
    if(!url||companyName.length<2||companyName.length>140||req.body?.companyConfirmed!==true)
      return res.status(400).json({error:"Enter the public company website and name, then confirm they refer to the same company."});
    const captureInput=requiredLeadCapture?leadCaptureSchema.safeParse(req.body?.capture):null;
    if(captureInput&&!captureInput.success)
      return res.status(400).json({code:"CAPTURE_INVALID",error:"Enter your first and last name, company email, and annual revenue range. Use a company email rather than a common personal-email address. If the form was already open, refresh it."});
    if(!requiredLeadCapture&&req.body?.capture!==undefined)
      return res.status(409).json({error:"The required-contact form is not active. Refresh before submitting."});
    const assessmentInput = req.body?.assessment === undefined ? null : widgetAssessmentInputSchema.safeParse(req.body.assessment);
    if (assessmentInput && !assessmentInput.success)
      return res.status(400).json({error:"Check the assessment answers. Scores must be calculated from valid form choices, not supplied directly."});
    const ip=hashIp(req.ip||"unknown");
    if(active>=2)return res.status(429).json({error:"Research is busy. Please try again shortly."});
    if(!rate(`research:${ip}`,5,24*3600*1000)||!rate("global-research",40,3600*1000))
      return res.status(429).json({error:"Research limit reached. Please try later or book a discussion."});
    active++;
    try {
      // Verify persistence configuration before spending on external research.
      const db=deps.db();
      const researched=await deps.research({url,companyName});
      // Immutable per-snapshot answer receipt. Never accept client-provided
      // totals/tier or let web/LLM output populate self-reported answers.
      const {assessment:_discardUntrustedAssessment,...researchOnly} = researched;
      const snapshot = { ...researchOnly,
        ...(assessmentInput?.success ? {assessment: assessWidget({
          ...assessmentInput.data,
          context:{...assessmentInput.data.context,...(captureInput?.success?{revenueBand:captureInput.data.revenueBand}:{})},
        })} : {}) };
      const token=randomBytes(32).toString("hex"),expiresAt=new Date(Date.now()+lifetime).toISOString();
      const {error}=await db.from("widget_snapshots").insert({token_hash:hash(token),expires_at:expiresAt,
        company_url:url,ip_hash:ip,snapshot,
        ...(captureInput?.success?{lead_capture:{...privateLeadCapture(captureInput.data,url,companyName),
          ...(internalAlertEnabled?{alert:initialInternalAlert()}:{})}}:{})});
      if(error)throw new Error("STORE_FAILED");
      res.json({snapshot,token,expiresAt});
    }catch(error){
      console.error("[snapshot] research failed",error instanceof Error?error.message:"unknown");
      const message=error instanceof Error?error.message:"";
      const safeCodes=["RESEARCH_UNAVAILABLE","ENTITY_UNCONFIRMED","UNSUPPORTED_CLAIM",
        "OFFICIAL_EVIDENCE_MISSING","EVIDENCE_AUDIT_FAILED","RESEARCH_FORMAT_FAILED",
        "EVIDENCE_AUDIT_UNAVAILABLE","SNAPSHOT_FORMAT_INVALID","STORE_FAILED"];
      const providerStatus=(error as {status?:number})?.status;
      const code=safeCodes.includes(message)?message
        :(error as Error)?.name==="ZodError"?"SNAPSHOT_FORMAT_INVALID"
        :[400,401,403,404,429,500,502,503,529].includes(providerStatus||0)?`RESEARCH_PROVIDER_${providerStatus}`
        :"SNAPSHOT_UNAVAILABLE";
      const validation=code==="SNAPSHOT_FORMAT_INVALID"
        ?((error as any).issues||[]).slice(0,6).map((i:any)=>({field:i.path?.join("."),rule:i.code}))
        :undefined;
      const technical=code==="SNAPSHOT_FORMAT_INVALID"||code==="RESEARCH_FORMAT_FAILED";
      res.status(503).json({code,...(validation?{validation}:{}),error:technical
        ?"The research service returned an incomplete response, so we could not display your snapshot. Please try again shortly. This error does not mean your company details are incorrect. No guessed findings were substituted."
        :"We could not produce a sufficiently supported snapshot for that company. Check the name and website, or try again later. No guessed findings were substituted."});
    }finally{active--;}
  });
  async function load(token:string) {
    const {data,error}=await deps.db().from("widget_snapshots").select("id,snapshot,expires_at,company_url").eq("token_hash",hash(token)).maybeSingle();
    if(error)throw new Error("STORE_UNAVAILABLE");
    return data&&!isSnapshotExpired(data.expires_at)?data:null;
  }
  // Fragment tokens are posted so access keys never appear in server URL logs.
  app.post("/api/widget/snapshot/view",async(req,res)=>{
    if(!validToken(req.body?.token))return res.status(404).json({error:"Snapshot unavailable or expired."});
    if(!rate(`view:${hashIp(req.ip||"unknown")}`,90,60000))return res.status(429).json({error:"Please try again shortly."});
    try{
      const row=await load(req.body.token);
      if(!row)return res.status(410).json({error:"This snapshot is unavailable or its 10-day access period has ended. Run a fresh snapshot or schedule a discussion."});
      res.json({snapshot:row.snapshot,expiresAt:row.expires_at});
    }catch{res.status(503).json({error:"Snapshot storage is temporarily unavailable. Please retry."});}
  });
  app.post("/api/widget/snapshot/lead",async(req,res)=>{
    const token=req.body?.token,email=typeof req.body?.email==="string"?req.body.email.trim().toLowerCase():"";
    if(!validToken(token)||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))
      return res.status(400).json({error:"Enter a valid work email and run a snapshot first."});
    if((websiteNoSend||noSendPilot||liveTestCapture)&&email!==SNAPSHOT_PILOT_EMAIL)
      return res.status(403).json({error:"This test is limited to the approved test recipient. You can still view or save your snapshot."});
    if(websiteNoSend&&!websiteNoSendReady())
      return res.status(503).json({sendingEnabled:false,error:"The website no-send test is not configured yet. Your snapshot remains available; no email or contact change was requested."});
    if(publicDelivery&&!deps.publicDelivery&&!publicSnapshotConfigured())
      return res.status(503).json({error:"Email delivery is temporarily unavailable. Please save your snapshot link."});
    if(!rate(`lead:${hashIp(req.ip||"unknown")}`,15,3600*1000))return res.status(429).json({error:"Too many requests. Please try later."});
    let evidence;
    try{
      evidence={
        ...parseWidgetConsent(req.body),
        ...(permissionTrackingEnabled?{snapshotDelivery:parseSnapshotEmailPermission(req.body)}:{}),
        ...(noSendPilot?{noSendPilot:true}:{}),
        ...(liveTestCapture?{liveEmailTest:LIVE_TEST_APPROVAL}:{}),
        ...(websiteNoSend?{websiteNoSend:WEBSITE_NO_SEND_VERSION}:{}),
        ...(publicDelivery?{publicDelivery:PUBLIC_SNAPSHOT_COHORT}:{}),
      };
    }catch(e){return res.status(400).json({error:(e as Error).message});}
    const key=`${hash(token)}:${email}`;
    if(requestLocks.has(key))return res.status(409).json({error:"Your request is already being processed."});
    requestLocks.add(key);
    try {
      const row=await load(token);
      if(!row)return res.status(410).json({error:"Snapshot expired. Please run a fresh snapshot."});
      const db=deps.db();
      // Durable permission receipt before any CRM side effect. Retries never
      // overwrite an earlier choice or repeat a successful CRM write.
      const {error}=await db.from("widget_snapshot_requests").upsert({
        snapshot_id:row.id,email,consent_evidence:evidence,
      },{onConflict:"snapshot_id,email",ignoreDuplicates:true});
      if(error)throw new Error("CONSENT_STORE_FAILED");
      const {data:receipt,error:receiptError}=await db.from("widget_snapshot_requests").select("*").eq("snapshot_id",row.id).eq("email",email).single();
      if(receiptError||!receipt)throw new Error("CONSENT_READ_FAILED");
      // Do not retrofit a new choice onto an old immutable receipt. A cached
      // or previously completed request must never manufacture permission.
      if(permissionTrackingEnabled&&!receipt.consent_evidence?.snapshotDelivery)
        return res.status(409).json({error:"This earlier request has no snapshot email permission recorded. Run a fresh snapshot and request a new copy."});
      if(!!receipt.consent_evidence?.noSendPilot!==noSendPilot)
        return res.status(409).json({error:"Test receipts and live email requests cannot be reused across modes. Run a fresh snapshot."});
      if((receipt.consent_evidence?.liveEmailTest||null)!==(liveTestCapture?LIVE_TEST_APPROVAL:null))
        return res.status(409).json({error:"This earlier request cannot be used for the live email test. Run a fresh snapshot."});
      if((receipt.consent_evidence?.websiteNoSend||null)!==(websiteNoSend?WEBSITE_NO_SEND_VERSION:null))
        return res.status(409).json({error:"An earlier request cannot be reused for this website test. Run a fresh snapshot."});
      if((receipt.consent_evidence?.publicDelivery||null)!==(publicDelivery?PUBLIC_SNAPSHOT_COHORT:null))
        return res.status(409).json({error:"Run a fresh snapshot to request an email. Earlier test requests are not sent automatically."});
      const snapshotUrl=`https://atlas.brexconsulting.com/widget.html#snapshot=${token}`;
      if(publicDelivery){
        const result=await (deps.publicDelivery||sendPublicSnapshot)({requestId:receipt.id,snapshotUrl},db);
        return res.json({ok:true,publicDelivery:true,sendingEnabled:true,deliveryStatus:result.status,
          snapshotUrl,expiresAt:row.expires_at,message:result.status==="queued"
            ?"Your snapshot email has been queued. Delivery is subject to your email preferences and eligibility. Save the link below while it arrives."
            :result.status==="already_recorded"
            ?"This email request is already recorded. We have not sent a duplicate. Save your snapshot link below."
            :"Your snapshot is ready here, but email delivery needs review. Existing email preferences, contact limits, or an unresolved earlier request may prevent sending. Save the link below and contact Kenny for help."});
      }
      if(websiteNoSend){
        const result=await (deps.websiteCapture||captureWebsiteNoSend)({requestId:receipt.id,snapshotUrl},db);
        if(!["queued","duplicate"].includes(result.status))
          return res.status(409).json({sendingEnabled:false,error:"A website test is already active or needs review. Do not resubmit; ask Kenny to review its status."});
        return res.json({ok:true,sendingEnabled:false,websiteNoSend:true,snapshotUrl,expiresAt:row.expires_at,
          message:"Your website test is recorded for read-only checks. No email will be sent, and no HubSpot contact or subscription will be changed. Kenny will review the test result. This test request cannot be used to send a later email."});
      }
      if(liveTestCapture){
        const result=await (deps.liveCapture||captureSnapshotLiveTest)({requestId:receipt.id,snapshotUrl},db);
        if(result.status!=="request_held")
          return res.status(409).json({sendingEnabled:false,error:"An email test is already recorded or needs review. Do not resubmit; ask for the test status."});
        return res.json({ok:true,sendingEnabled:false,snapshotUrl,expiresAt:row.expires_at,
          message:"Your fresh email-test request and permission are recorded. No email has been sent by this submission. The single test email is held for final eligibility checks. Copy the snapshot link below and return it to Kenny's test conversation."});
      }
      if(noSendPilot){
        const result=await (deps.pilot||captureSnapshotNoSend)({requestId:receipt.id,snapshotUrl},db);
        if(result.status!=="dry_run_completed")
          return res.status(409).json({sendingEnabled:false,error:"This test is already recorded or needs review. No email send was requested. Do not resubmit; ask for the test status."});
        return res.json({ok:true,sendingEnabled:false,snapshotUrl,expiresAt:row.expires_at,
          message:"No-send test complete. Your contact and permission choices were recorded. No email or alert was requested, no subscription was changed, and this test receipt cannot later be used to send."});
      }
      if(receipt.sync_status!=="synced"){
        const result=await deps.sync({email,company:(row.snapshot as ResearchSnapshot).companyName,url:row.company_url,
          snapshotId:row.id,snapshotUrl,requestedAt:receipt.requested_at,
          ...(permissionTrackingEnabled?{permissionTracking:{
            requestId:receipt.id,expiresAt:row.expires_at,
            permission:receipt.consent_evidence.snapshotDelivery,
            marketingChoice:receipt.consent_evidence.decision,
          }}:{}),
        });
        const {error:statusError}=await db.from("widget_snapshot_requests").update({
          sync_status:result.status==="synced"?"synced":"failed",contact_id:result.contactId,
        }).eq("id",receipt.id);
        if(result.status!=="synced"||statusError)throw new Error("CRM_SYNC_FAILED");
      }
      res.json({ok:true,snapshotUrl,expiresAt:row.expires_at,
        message:permissionTrackingEnabled
          ?"Your snapshot email request and permission have been recorded. This confirmation does not mean an email has been sent. Save this link or a text copy while delivery setup is completed."
          :process.env.SNAPSHOT_EMAIL_DELIVERY_READY==="true"
          ?"Your email-copy request has been recorded. Email delivery is subject to eligibility; save this link so you can return to your snapshot."
          :"Your request has been recorded for follow-up. Automatic email delivery is not active yet. Save this link or download a text copy to keep your snapshot."});
    }catch{
      res.status(503).json({error:publicDelivery
        ?"We could not confirm email delivery. Please save your snapshot link and contact Kenny before submitting again."
        :websiteNoSend
        ?"We could not confirm the website test. No email or HubSpot change was requested. Keep your snapshot link and ask for the test status before resubmitting."
        :liveTestCapture
        ?"We could not confirm the email-test request. No email was sent by this submission. Your snapshot remains available; ask for the test status before submitting again."
        :"We could not complete your email-copy request. Your snapshot remains available here; please retry. We have not changed your subscription preferences."});
    }finally{requestLocks.delete(key);}
  });
}
