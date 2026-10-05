import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {assessWidget,HEALTH_QUESTIONS} from "../shared/widget-health";
import {privateLeadCapture,LEAD_CAPTURE_NOTICE} from "../shared/widget-lead-capture";
import {ALERT_WORKFLOW,assessmentAlertProperties,initialInternalAlert,processInternalAlert,verifyInternalAlert,type AlertRow,type AlertStore} from "./widget-internal-alert";
import {publicWorkflowHash} from "./snapshot-public-delivery";
import {createClient} from "@supabase/supabase-js";
import ws from "ws";
import {createInternalAlertStore} from "./widget-internal-alert";
function row(answers:any={}):AlertRow{
  return {id:"assessment-1",created_at:"2026-10-05T21:00:00.000Z",company_url:"https://company.example/",
    snapshot:{assessment:assessWidget(answers)},
    lead_capture:{...privateLeadCapture({firstName:"Ari",lastName:"Example",email:"ari@company.example",
      revenueBand:"1m5m",noticeVersion:LEAD_CAPTURE_NOTICE.version},"https://company.example/","Company"),
      alert:initialInternalAlert()}};
}
function fixture(r=row(),initialContact:any=null){
  let stored=structuredClone(r),c=initialContact?structuredClone(initialContact):null;
  const writes:any[]=[],fail={ready:false,staging:false},dbWrites:any[]=[];
  const store:AlertStore={
    async candidates(){return [structuredClone(stored)];},
    async firstForEmail(){return stored.id;},
    async move(local,state,extra={}){
      if(local.lead_capture.alert.state!==stored.lead_capture.alert.state
        ||local.lead_capture.alert.updatedAt!==stored.lead_capture.alert.updatedAt)return false;
      stored.lead_capture.alert={...stored.lead_capture.alert,...extra,state,updatedAt:new Date().toISOString()};
      local.lead_capture=structuredClone(stored.lead_capture);dbWrites.push(state);return true;
    },
  };
  const api:any=async(method:string,path:string,body:any)=>{
    assert.ok(path.startsWith("/crm/v3/objects/contacts/")||path==="/crm/v3/objects/contacts","No other object or subscription APIs");
    if(method==="GET")return c?structuredClone(c):null;
    writes.push({method,path,body});
    if(body.properties.atlas_internal_alert_state==="ready"&&fail.ready)throw Error("Timeout");
    if(body.properties.atlas_internal_alert_state==="pending"&&fail.staging)throw Error("Timeout");
    c={id:"contact-1",properties:{...c?.properties,...body.properties}};
    return structuredClone(c);
  };
  return {store,api,writes,dbWrites,fail,read:()=>structuredClone(stored),contact:()=>c};
}
test("projection distinguishes incomplete from zero and clears stale score; excludes raw free-text and legacy send fields",()=>{
  const r=row({fit:{growthGoal:"private free-text",timeframe:"secret timeframe"},context:{industry:"private industry"}});
  const p=assessmentAlertProperties(r,"Referral");
  assert.equal(p.atlas_health_score,"");
  assert.equal(p.atlas_health_band,"incomplete");
  assert.equal(p.atlas_cmo_recommendation,"not-yet-recommended");
  assert.equal(p.original_lead_source,undefined);
  assert.equal(p.lead_source_tag,"Atlas Excavator Widget");
  for(const s of ["private free-text","secret timeframe","private industry","ari@company.example"])
    assert.equal(p.atlas_assessment_summary.includes(s),false);
  for(const k of Object.keys(p))assert.ok(!/atlas_fit_|atlas_snapshot_|hs_marketable|brex_icp|hs_lead_status/.test(k),k);
  const zeros=row({health:Object.fromEntries(HEALTH_QUESTIONS.map(q=>[q.key,"0"]))});
  assert.equal(assessmentAlertProperties(zeros).atlas_health_score,"0");
  assert.equal(assessmentAlertProperties(zeros).atlas_health_band,"foundational");
  assert.equal(assessmentAlertProperties(zeros).original_lead_source,"Website");
});
test("score and preliminary tier match the rubric, not revenue or a fabricated inference",()=>{
  const health=Object.fromEntries(HEALTH_QUESTIONS.map(q=>[q.key,"2"]));
  for(const [ownership,need,budget,want] of [
    ["existing","advice","advisor","advisor"],
    ["existing","strategy","strategist","strategist"],
    ["delegated","leadership","fractional","full-fractional"],
  ]){
    const p=assessmentAlertProperties(row({health,fit:{ownership,need,budget,sponsor:"yes",execution:"funded",
      readiness:"yes",growthGoal:"Grow",timeframe:"12 months"}}));
    assert.equal(p.atlas_health_score,"67");assert.equal(p.atlas_cmo_recommendation,want);
  }
});
test("one new contact and one ready write, with readback before notification; completion reconciles without resend",async()=>{
  const f=fixture();
  await processInternalAlert(f.read(),f.store,f.api);
  assert.deepEqual(f.dbWrites,["processing","waiting"]);
  assert.equal(f.writes.length,2);
  assert.equal(f.writes[0].method,"POST");
  assert.equal(f.writes[0].body.properties.atlas_internal_alert_state,"pending");
  assert.deepEqual(f.writes[1].body.properties,{atlas_internal_alert_state:"ready"});
  await processInternalAlert(f.read(),f.store,f.api);
  assert.equal(f.writes.length,2);
  f.contact().properties.atlas_internal_alert_state="queued";
  await processInternalAlert(f.read(),f.store,f.api);
  assert.equal(f.read().lead_capture.alert.state,"settling");
  await processInternalAlert(f.read(),f.store,f.api,Date.now()+61_000);
  assert.equal(f.read().lead_capture.alert.state,"queued");
  await processInternalAlert(f.read(),f.store,f.api);
  assert.equal(f.writes.length,2);
});
test("existing contact attribution preserved; independent of email-copy permission or marketing status",async()=>{
  const f=fixture(row(),{id:"contact-1",properties:{email:"ari@company.example",original_lead_source:"Referral",
    hs_marketable_status:"false",hs_email_optout:"true"}});
  await processInternalAlert(f.read(),f.store,f.api);
  assert.equal(f.contact().properties.original_lead_source,"Referral");
  assert.equal(f.contact().properties.hs_marketable_status,"false");
  assert.equal(f.contact().properties.hs_email_optout,"true");
  assert.equal(f.writes[0].method,"PATCH");
  assert.equal(f.read().lead_capture.alert.state,"waiting");
});
test("ready timeout never blindly retries; unconfirmed outcome is held",async()=>{
  const f=fixture();f.fail.ready=true;
  await processInternalAlert(f.read(),f.store,f.api);
  await processInternalAlert(f.read(),f.store,f.api,Date.now()+16*60_000);
  assert.equal(f.read().lead_capture.alert.state,"needs-review");
  assert.equal(f.writes.length,2);
  await processInternalAlert(f.read(),f.store,f.api);
  assert.equal(f.writes.length,2);
});
test("interrupted staging is not retried; prior contact alert is not overwritten",async()=>{
  const f=fixture();f.fail.staging=true;
  await processInternalAlert(f.read(),f.store,f.api);
  assert.equal(f.read().lead_capture.alert.state,"needs-review");
  assert.equal(f.writes.length,1);
  const blocked=fixture(row(),{id:"contact-1",properties:{atlas_internal_alert_state:"ready"}});
  await processInternalAlert(blocked.read(),blocked.store,blocked.api);
  assert.equal(blocked.writes.length,0);
  assert.equal(blocked.read().lead_capture.alert.state,"needs-review");
});
test("atomic claim prevents two workers from staging the same assessment",async()=>{
  const f=fixture(),a=f.read(),b=f.read();
  await Promise.all([processInternalAlert(a,f.store,f.api),processInternalAlert(b,f.store,f.api)]);
  assert.equal(f.writes.length,2);
});
test("earlier unresolved receipt blocks a later assessment for the same email; old unmarked rows ignored",async()=>{
  const f=fixture();f.store.firstForEmail=async()=>"older-assessment";
  await processInternalAlert(f.read(),f.store,f.api);
  assert.equal(f.writes.length,0);
  const old=f.read();delete old.lead_capture.alert;
  await processInternalAlert(old,f.store,f.api);
  assert.equal(f.writes.length,0);
});
test("secondary-email match does not replace a contact's primary email",async()=>{
  const f=fixture(row(),{id:"contact-1",properties:{email:"different@company.example"}});
  await processInternalAlert(f.read(),f.store,f.api);
  assert.equal(f.writes.length,0);
  assert.equal(f.read().lead_capture.alert.state,"needs-review");
});
test("workflow pin permits only exact approved configuration and Kenny recipient",async()=>{
  const f=JSON.parse(readFileSync("docs/assessment-alert-workflow.json","utf8")).workflow;
  assert.equal(publicWorkflowHash(f),ALERT_WORKFLOW.hash);
  assert.deepEqual(f.actions.filter((a:any)=>a.actionTypeId==="0-8").map((a:any)=>a.fields.user_ids),[["78405166"],["78405166"]]);
  await verifyInternalAlert(async()=>({...f,isEnabled:true}));
  await assert.rejects(verifyInternalAlert(async()=>({...f,isEnabled:false})));
  const changed=structuredClone(f);changed.actions[1].fields.user_ids.push("another-recipient");
  await assert.rejects(verifyInternalAlert(async()=>({...changed,isEnabled:true})));
});
test("Supabase queue adapter uses private fields and compare-and-swap predicates",async()=>{
  const r=row(),calls:any[]=[];
  const db=createClient("https://local-fixture.example","fixture-not-a-secret",{
    auth:{persistSession:false,autoRefreshToken:false},
    realtime:{transport:ws as any},
    global:{fetch:async(url,init)=>{
      calls.push({url:new URL(String(url)),init});
      return new Response(JSON.stringify(init?.method==="PATCH"?[{id:r.id}]:[r]),
        {status:200,headers:{"Content-Type":"application/json"}});
    }},
  });
  const store=createInternalAlertStore(db);
  assert.equal((await store.candidates())[0].id,r.id);
  assert.equal(await store.firstForEmail(r.lead_capture.email),r.id);
  const before=r.lead_capture.alert.updatedAt;
  assert.equal(await store.move(r,"processing"),true);
  assert.equal(calls[0].url.searchParams.get("lead_capture->alert->>version"),"eq."+initialInternalAlert().version);
  assert.equal(calls[1].url.searchParams.get("lead_capture->>email"),"eq.ari@company.example");
  assert.equal(calls[2].url.searchParams.get("lead_capture->alert->>state"),"eq.pending");
  assert.equal(calls[2].url.searchParams.get("lead_capture->alert->>updatedAt"),"eq."+before);
  const body=JSON.parse(calls[2].init.body);
  assert.deepEqual(Object.keys(body),["lead_capture"]);
  assert.equal(body.lead_capture.alert.state,"processing");
  assert.equal(body.lead_capture.email,"ari@company.example");
});
