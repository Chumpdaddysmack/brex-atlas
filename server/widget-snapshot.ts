import type { Express, Request, Response } from "express";
import { randomBytes, createHash } from "node:crypto";
import { widgetDb, hashIp } from "./widget-store";
import { publicCompanyUrl, researchSnapshot, type ResearchSnapshot } from "./widget-snapshot-research";
import { parseWidgetConsent, WIDGET_MARKETING_CONSENT } from "@shared/widget-consent";
import { syncSnapshotToHubSpot } from "./hubspot";

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
export function registerSnapshotRoutes(app:Express,deps={research:researchSnapshot,db:widgetDb,sync:syncSnapshotToHubSpot}) {
  app.use("/api/widget/snapshot",noCache);
  app.get("/api/widget/snapshot/config",(_req,res)=>res.json({
    marketingConsent:WIDGET_MARKETING_CONSENT,lifetimeDays:10,
    emailDeliveryReady:process.env.SNAPSHOT_EMAIL_DELIVERY_READY==="true",
  }));
  app.post("/api/widget/snapshot",async(req,res)=>{
    const url=publicCompanyUrl(req.body?.url);
    const companyName=typeof req.body?.companyName==="string"?req.body.companyName.trim():"";
    if(!url||companyName.length<2||companyName.length>140||req.body?.companyConfirmed!==true)
      return res.status(400).json({error:"Enter the public company website and name, then confirm they refer to the same company."});
    const ip=hashIp(req.ip||"unknown");
    if(active>=2)return res.status(429).json({error:"Research is busy. Please try again shortly."});
    if(!rate(`research:${ip}`,5,24*3600*1000)||!rate("global-research",40,3600*1000))
      return res.status(429).json({error:"Research limit reached. Please try later or book a discussion."});
    active++;
    try {
      // Verify persistence configuration before spending on external research.
      const db=deps.db();
      const snapshot=await deps.research({url,companyName});
      const token=randomBytes(32).toString("hex"),expiresAt=new Date(Date.now()+lifetime).toISOString();
      const {error}=await db.from("widget_snapshots").insert({token_hash:hash(token),expires_at:expiresAt,
        company_url:url,ip_hash:ip,snapshot});
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
      res.status(503).json({code,...(validation?{validation}:{}),error:"We could not produce a sufficiently supported snapshot for that company. Check the name and website, or try again later. No guessed findings were substituted."});
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
    if(!rate(`lead:${hashIp(req.ip||"unknown")}`,15,3600*1000))return res.status(429).json({error:"Too many requests. Please try later."});
    let evidence;
    try{evidence=parseWidgetConsent(req.body);}catch(e){return res.status(400).json({error:(e as Error).message});}
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
      const snapshotUrl=`https://atlas.brexconsulting.com/widget.html#snapshot=${token}`;
      if(receipt.sync_status!=="synced"){
        const result=await deps.sync({email,company:(row.snapshot as ResearchSnapshot).companyName,url:row.company_url,
          snapshotId:row.id,snapshotUrl,requestedAt:receipt.requested_at});
        const {error:statusError}=await db.from("widget_snapshot_requests").update({
          sync_status:result.status==="synced"?"synced":"failed",contact_id:result.contactId,
        }).eq("id",receipt.id);
        if(result.status!=="synced"||statusError)throw new Error("CRM_SYNC_FAILED");
      }
      res.json({ok:true,snapshotUrl,expiresAt:row.expires_at,
        message:process.env.SNAPSHOT_EMAIL_DELIVERY_READY==="true"
          ?"Your email-copy request has been recorded. Email delivery is subject to eligibility; save this link so you can return to your snapshot."
          :"Your request has been recorded for follow-up. Automatic email delivery is not active yet. Save this link or download a text copy to keep your snapshot."});
    }catch{
      res.status(503).json({error:"We could not complete your email-copy request. Your snapshot remains available here; please retry. We have not changed your subscription preferences."});
    }finally{requestLocks.delete(key);}
  });
}
