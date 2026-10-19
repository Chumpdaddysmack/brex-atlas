import type {Express,Response} from "express";
import {randomBytes,createHash} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {z} from "zod";
import {widgetDb,hashIp} from "./widget-store";
import {publicCompanyUrl} from "./widget-snapshot-research";
import {researchGrowth,domain} from "./widget-v2-research";
import {growthAnswersSchema,growthAssessment} from "../shared/widget-growth";
import {leadCaptureSchema,privateLeadCapture} from "../shared/widget-lead-capture";
import {initialInternalAlert,internalAlertStatus} from "./widget-internal-alert";

// Kept false until provider, email and live routing checks pass.
export const WIDGET_V2_DEFAULT=false;
const requestSchema=z.object({website:z.string().max(300),answers:growthAnswersSchema,capture:leadCaptureSchema,
  resumeToken:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict();
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
export function researchFailureCode(error:unknown){
  const e=error as any;
  if(e?.name==="TimeoutError")return "RESEARCH_TIMEOUT";
  if(e?.name==="AbortError"||e?.name==="APIUserAbortError")return "RESEARCH_CANCELLED";
  if(e?.name==="ZodError")return "RESEARCH_FORMAT_INVALID";
  if([400,401,403,404,429,500,502,503,504].includes(e?.status))return `PROVIDER_HTTP_${e.status}`;
  return ["STORE_FAILED","RESEARCH_UNAVAILABLE","OFFICIAL_EVIDENCE_MISSING","ENTITY_UNCONFIRMED","UNSUPPORTED_CLAIM"].includes(e?.message)
    ?e.message:"RESEARCH_FAILED";
}
const lifetime=10*86400000,cache=new Map<string,{at:number;data:any}>(),activeTokens=new Set<string>();
let active=0;const hits=new Map<string,number[]>();
function rate(key:string,max:number,span:number){
  const now=Date.now();
  if(hits.size>5000)for(const [k,v] of hits)if(!v.some(t=>now-t<86400000))hits.delete(k);
  const times=(hits.get(key)||[]).filter(t=>now-t<span);
  if(times.length>=max)return false;times.push(now);hits.set(key,times);return true;
}
export function v2Snapshot(url:string,answers:unknown,research:any=null){
  const growth=growthAssessment(answers);
  return {kind:"company-growth-v2",companyName:research?.company_name||domain(url),companyUrl:url,
    researchedAt:research?.researched_at||null,growth,research,researchStatus:research?"ready":"pending",
    // Compat fields keep historical downstream tooling readable, never fabricated.
    introduction:research?.summary.map((b:any)=>({text:b.text,sources:b.evidence.map((e:any)=>research.sources.find((s:any)=>s.id===e.source_id)).filter(Boolean)}))||[],
    limitations:research?.limitations||[]};
}
export function registerWidgetV2Routes(app:Express,deps={research:researchGrowth,db:widgetDb}){
  app.post("/api/widget/v2/research",async(req,res)=>{
    res.set({"Cache-Control":"no-store","X-Robots-Tag":"noindex, nofollow","Referrer-Policy":"no-referrer"});
    const parsed=requestSchema.safeParse(req.body);
    if(!parsed.success)return res.status(400).json({detail:"Check your name, company email, revenue range and four answers."});
    const input=parsed.data,url=publicCompanyUrl(input.website);
    if(!url)return res.status(400).json({detail:"Enter a public company website."});
    if(active>=2)return res.status(429).json({detail:"Research is busy. Please try again shortly."});
    const ip=hashIp(req.ip||"unknown");
    if(!rate(`v2:${ip}`,5,86400000)||!rate("v2:global",40,3600000))
      return res.status(429).json({detail:"Research limit reached. Please try later or schedule a discussion."});
    const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(240000)]);
    let token="",expiresAt="",id="",ownsToken=false,db:ReturnType<typeof widgetDb>|null=null,snapshot:any=null,heartbeat:ReturnType<typeof setInterval>|null=null;
    let researchStage="Recording inquiry";
    const startedAt=Date.now();
    active++;
    const emit=(event:any)=>{if(!res.destroyed&&!res.writableEnded)res.write(JSON.stringify(event)+"\n");};
    res.on("close",()=>controller.abort());
    try{
      db=deps.db();
      if(input.resumeToken){
        const found=await db.from("widget_snapshots").select("id,expires_at,company_url,snapshot,lead_capture").eq("token_hash",hash(input.resumeToken)).maybeSingle();
        const row=found.data;
        if(found.error||!row||Date.parse(row.expires_at)<=Date.now()||row.company_url!==url
          ||!isDeepStrictEqual(row.snapshot?.growth?.answers,input.answers)
          ||!Object.entries(input.capture).every(([k,v])=>row.lead_capture?.[k]===v))
          return res.status(409).json({detail:"This saved request cannot be reused with different details. Edit your answers and submit a new request."});
        token=input.resumeToken;expiresAt=row.expires_at;id=row.id;snapshot=row.snapshot;
      }else{
        snapshot=v2Snapshot(url,input.answers);token=randomBytes(32).toString("hex");expiresAt=new Date(Date.now()+lifetime).toISOString();
        // Store inquiry BEFORE research so an abandoned research wait is not a lost lead.
        // Contact details stay in the existing private column, never public research.
        const saved=await db.from("widget_snapshots").insert({token_hash:hash(token),expires_at:expiresAt,company_url:url,ip_hash:ip,
          snapshot,lead_capture:{...privateLeadCapture(input.capture,url,domain(url)),
            ...(internalAlertStatus().enabled?{alert:initialInternalAlert()}:{})}}).select("id").single();
        if(saved.error||!saved.data?.id)throw Error("STORE_FAILED");
        id=saved.data.id;
      }
      if(activeTokens.has(hash(token)))return res.status(409).json({detail:"Research for this saved request is already running. Please wait before retrying."});
      activeTokens.add(hash(token));
      ownsToken=true;
      signal.throwIfAborted();
      res.status(200).set({"Content-Type":"application/x-ndjson; charset=utf-8","X-Accel-Buffering":"no"});res.flushHeaders();
      emit({type:"receipt",token,expiresAt,message:"Your inquiry is recorded."});
      heartbeat=setInterval(()=>emit({type:"heartbeat"}),10000);heartbeat.unref();
      let research=snapshot.researchStatus==="ready"?snapshot.research:null;
      const cached=cache.get(url);
      if(!research&&cached&&Date.now()-cached.at<900000){research={...cached.data,cached:true};emit({type:"progress",message:"Reusing recently checked public research…"});}
      if(!research){
        research=await deps.research(url,message=>{researchStage=message;emit({type:"progress",message});},undefined,signal);
        cache.set(url,{at:Date.now(),data:research});
        for(const [key,value] of cache)if(Date.now()-value.at>900000)cache.delete(key);
      }
      signal.throwIfAborted();snapshot=v2Snapshot(url,input.answers,research);
      const stored=await db.from("widget_snapshots").update({snapshot}).eq("id",id);
      if(stored.error)throw Error("STORE_FAILED");
      emit({type:"result",data:{...research,growth:snapshot.growth,token,expiresAt}});
      res.end();
    }catch(error){
      const diagnostic={code:researchFailureCode(error),stage:researchStage,
        elapsedSeconds:Math.round((Date.now()-startedAt)/1000),at:new Date().toISOString()};
      // Never store provider messages, prompts, contact details or credentials in diagnostics.
      console.warn("[widget-v2] research stopped",JSON.stringify({snapshotId:id||null,...diagnostic}));
      if(db&&id&&snapshot?.researchStatus!=="ready")
        await db.from("widget_snapshots").update({snapshot:{...snapshot,researchStatus:"unavailable",researchDiagnostic:diagnostic}}).eq("id",id).then(()=>{},()=>{});
      const message=id?"Your inquiry is recorded, but the company research could not finish. Your answers are kept. Retry company research or schedule a discussion."
        :"We could not record your inquiry. Please retry before starting research.";
      if(!res.headersSent&&!res.destroyed)res.status(503).json({detail:message});
      else if(!res.destroyed){emit({type:"error",message});res.end();}
    }finally{
      if(heartbeat)clearInterval(heartbeat);
      if(ownsToken)activeTokens.delete(hash(token));
      active--;
    }
  });
}
