import {widgetDb} from "./widget-store";
import {snapshotPublicApi,publicWorkflowHash} from "./snapshot-public-delivery";
import {assessWidget,HEALTH_VERSION,TIER_QUESTIONS} from "../shared/widget-health";
import {leadCaptureSchema} from "../shared/widget-lead-capture";
import {widgetAttributionProperties} from "../shared/widget-attribution";

export const ALERT_VERSION="atlas-internal-assessment-v1-2026-10-05";
export const ALERT_WORKFLOW={id:"5064375995",hash:"dcaf8f9e8cb6217eaa0e0d3dcab73b470ae84f98fb565eaf8607a6bb344e3c8e"};
type State="pending"|"processing"|"waiting"|"settling"|"queued"|"needs-review";
export type Alert={version:string;state:State;updatedAt:string;contactId?:string;reason?:string};
export type AlertRow={id:string;created_at:string;company_url:string;snapshot:any;lead_capture:any};
type Api=typeof snapshotPublicApi;
export interface AlertStore {
  candidates():Promise<AlertRow[]>;
  firstForEmail(email:string):Promise<string|undefined>;
  move(row:AlertRow,state:State,extra?:Partial<Alert>):Promise<boolean>;
}
export function initialInternalAlert():Alert{
  return {version:ALERT_VERSION,state:"pending",updatedAt:new Date().toISOString()};
}
export function assessmentAlertProperties(row:AlertRow,originalSource?:string){
  const c=row.lead_capture;
  const input=leadCaptureSchema.parse({firstName:c.firstName,lastName:c.lastName,email:c.email,
    revenueBand:c.revenueBand,noticeVersion:c.noticeVersion});
  if(c.alert?.version!==ALERT_VERSION||!row.id||!Number.isFinite(Date.parse(row.created_at)))
    throw Error("Invalid alert receipt");
  const original=row.snapshot.assessment;
  if(original&&original.version!==HEALTH_VERSION)throw Error("Rubric requires review");
  // Recalculate from the immutable, self-reported answer receipt. Never use
  // research or an LLM to fill unknown answers, and never reuse old fit fields.
  const a=assessWidget(original?.answers??{});
  const h=a.health;
  const lines=[
    `Marketing health: ${h.score===null?"Incomplete":`${h.score}/100`} (${h.answered}/8 answers).`,
    ...h.subScores.map(s=>`${s.label}: ${s.score===null?"Incomplete":`${s.score}/100`}.`),
    ...TIER_QUESTIONS.map(q=>`${q.label} ${q.options.find(o=>o[0]===a.answers.fit[q.key])?.[1]??"Not sure"}.`),
    `Growth outcome: ${a.answers.fit.growthGoal?"Provided":"Not provided"}; timeframe: ${a.answers.fit.timeframe?"Provided":"Not provided"}.`,
    `Potential tier: ${a.fit.label}${a.fit.price?` (${a.fit.price})`:""}. ${a.fit.reason}`,
    ...a.fit.concerns,...a.fit.missing.map(m=>`Needs confirmation: ${m}`),
    `Rubric: ${HEALTH_VERSION}. Self-reported, not a verified audit. Kenny review required.`,
  ];
  return {
    email:input.email,firstname:input.firstName,lastname:input.lastName,
    company:String(c.company),website:row.company_url,
    ...widgetAttributionProperties(originalSource),
    atlas_health_score:h.score===null?"":String(h.score),
    atlas_health_band:h.score===null?"incomplete":h.score<40?"foundational":h.score<60?"developing":h.score<80?"established":"managed",
    atlas_cmo_recommendation:a.fit.tier==="full_fractional"?"full-fractional":a.fit.tier??"not-yet-recommended",
    atlas_revenue_range:input.revenueBand,
    atlas_assessment_summary:lines.join("\n"),
    atlas_assessment_id:row.id,
    atlas_assessment_completed_at:row.created_at,
    atlas_internal_alert_state:"pending",
  };
}
export async function verifyInternalAlert(api:Api){
  const f=await api("GET","/automation/v4/flows/"+ALERT_WORKFLOW.id);
  if(f?.isEnabled!==true||publicWorkflowHash(f)!==ALERT_WORKFLOW.hash)
    throw Error("Internal alert configuration requires review");
}
export function createInternalAlertStore(db:any):AlertStore{
  const query=()=>db.from("widget_snapshots")
    .select("id,created_at,company_url,snapshot,lead_capture")
    .eq("lead_capture->alert->>version",ALERT_VERSION);
  return {
    async candidates(){
      const r=await query().in("lead_capture->alert->>state",["pending","processing","waiting","settling"])
        .order("created_at").order("id").limit(100);
      if(r.error)throw Error("Alert queue unavailable");
      return r.data??[];
    },
    async firstForEmail(email){
      // A held/uncertain older receipt blocks later writes for this email.
      // Never overwrite a contact while the previous notification is running.
      const r=await query().eq("lead_capture->>email",email)
        .in("lead_capture->alert->>state",["pending","processing","waiting","settling","needs-review"])
        .order("created_at").order("id").limit(1);
      if(r.error)throw Error("Alert ordering unavailable");
      return r.data?.[0]?.id;
    },
    async move(row,state,extra={}){
      const prior:Alert=row.lead_capture.alert;
      const capture={...row.lead_capture,alert:{...prior,...extra,state,updatedAt:new Date().toISOString()}};
      const r=await db.from("widget_snapshots").update({lead_capture:capture})
        .eq("id",row.id).eq("lead_capture->alert->>version",ALERT_VERSION)
        .eq("lead_capture->alert->>state",prior.state)
        .eq("lead_capture->alert->>updatedAt",prior.updatedAt).select("id");
      if(r.error)throw Error("Alert checkpoint unavailable");
      if(!r.data?.length)return false;
      row.lead_capture=capture;return true;
    },
  };
}
const readProps=["email","original_lead_source","atlas_assessment_id","atlas_internal_alert_state"];
async function contact(api:Api,idOrEmail:string,byEmail=false,properties=readProps){
  return api("GET",`/crm/v3/objects/contacts/${encodeURIComponent(idOrEmail)}?${byEmail?"idProperty=email&":""}properties=${properties.join(",")}`);
}
const age=(a:Alert,now:number)=>now-Date.parse(a.updatedAt);
export async function processInternalAlert(row:AlertRow,store:AlertStore,api:Api,now=Date.now()){
  let a:Alert=row.lead_capture?.alert;
  if(a?.version!==ALERT_VERSION||["queued","needs-review"].includes(a.state))return;
  if(a.state==="settling"){
    if(age(a,now)>=60_000)await store.move(row,"queued");return;
  }
  if(a.state==="waiting"){
    // Reconcile read-only after the one ready write. Timeout is not permission
    // to repeat a notification, even across a container restart.
    const c=await contact(api,a.contactId!);
    if(c?.properties?.atlas_assessment_id!==row.id){
      await store.move(row,"needs-review",{reason:"Contact projection changed"});return;
    }
    if(c.properties.atlas_internal_alert_state==="queued"){
      await store.move(row,"settling");return;
    }
    if(age(a,now)>15*60_000)await store.move(row,"needs-review",{reason:"Workflow outcome unconfirmed"});
    return;
  }
  if(a.state==="processing"){
    if(age(a,now)>5*60_000)await store.move(row,"needs-review",{reason:"Interrupted CRM staging"});
    return;
  }
  if(await store.firstForEmail(row.lead_capture.email)!==row.id)return;
  if(!await store.move(row,"processing"))return; // Atomic, durable claim.
  try{
    let c=await contact(api,row.lead_capture.email,true);
    if(c&&c.properties?.email?.trim().toLowerCase()!==row.lead_capture.email){
      await store.move(row,"needs-review",{reason:"Contact primary email requires review"});return;
    }
    if(c&&["ready","pending","needs-review"].includes(c.properties.atlas_internal_alert_state)){
      await store.move(row,"needs-review",{reason:"Prior contact alert needs review"});return;
    }
    const properties=assessmentAlertProperties(row,c?.properties?.original_lead_source);
    if(c){
      await api("PATCH","/crm/v3/objects/contacts/"+c.id,{properties});
    }else{
      // No retry on an ambiguous create response; the receipt is held for review.
      c=await api("POST","/crm/v3/objects/contacts",{properties});
    }
    if(!c?.id)throw Error("Contact creation unconfirmed");
    const check=await contact(api,String(c.id),false,Object.keys(properties));
    for(const [key,value] of Object.entries(properties)){
      const actual=check?.properties?.[key]??"";
      const equal=key==="atlas_assessment_completed_at"
        ?Date.parse(String(actual))===Date.parse(value)||Number(actual)===Date.parse(value)
        :String(actual)===value;
      if(!equal)throw Error("Staged contact verification failed");
    }
    // Durable point of no automatic retry BEFORE arming the workflow.
    if(!await store.move(row,"waiting",{contactId:String(c.id)}))return;
    try{
      await api("PATCH","/crm/v3/objects/contacts/"+c.id,
        {properties:{atlas_internal_alert_state:"ready"}});
    }catch{
      // Read-only reconciliation will distinguish ready/queued from uncertainty.
      // Do not log identity, URL bearer tokens, or raw provider responses.
      console.warn("[assessment-alert] trigger unconfirmed; reconciliation pending");
    }
  }catch{
    await store.move(row,"needs-review",{reason:"CRM staging unconfirmed"});
  }
}
let started=false,running=false,ready=false,lastCheckedAt:string|null=null;
export function internalAlertStatus(){
  return {enabled:process.env.SNAPSHOT_INTERNAL_ALERT_ENABLED==="true",ready,lastCheckedAt};
}
export function startInternalAlertWorker(){
  if(started||process.env.SNAPSHOT_INTERNAL_ALERT_ENABLED!=="true")return;
  started=true;
  const tick=async()=>{
    if(running)return;running=true;
    try{
      await verifyInternalAlert(snapshotPublicApi);
      ready=true;lastCheckedAt=new Date().toISOString();
      const store=createInternalAlertStore(widgetDb());
      for(const row of await store.candidates()){
        try{await processInternalAlert(row,store,snapshotPublicApi);}
        catch{console.warn("[assessment-alert] receipt remains pending review");}
      }
    }catch{ready=false;lastCheckedAt=new Date().toISOString();console.warn("[assessment-alert] worker not ready");}
    finally{running=false;}
  };
  setTimeout(()=>void tick(),1000).unref();
  setInterval(()=>void tick(),15_000).unref();
}
