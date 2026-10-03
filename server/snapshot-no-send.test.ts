import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import express from "express";
import { captureNoSendContact, noSendContactProperties, runNoSendCapture } from "./snapshot-no-send";
import { parseSnapshotEmailPermission, SNAPSHOT_EMAIL_PERMISSION } from "../shared/snapshot-delivery";
import { WIDGET_MARKETING_CONSENT } from "../shared/widget-consent";
import type { SnapshotReceipt } from "./snapshot-subscriptions";

const token = "c".repeat(64);
const receipt = (): SnapshotReceipt => ({
  email: "kenny@brexconsulting.com", requestId: "test-request", snapshotId: "test-snapshot",
  requestedAt: new Date(Date.now()-1000).toISOString(),
  expiresAt: new Date(Date.now()+86400000).toISOString(),
  snapshotUrl: "https://atlas.brexconsulting.com/widget.html#snapshot="+token,
  permission: parseSnapshotEmailPermission({snapshotEmailConsent:true,
    snapshotEmailConsentVersion:SNAPSHOT_EMAIL_PERMISSION.version}),
  marketingChoice:"not_selected",
});
const workflows = [
  ["4634293988",3],["4634514155",4],["4634532561",9],["4634749687",2],
  ["4946745055",6],["4955775714",5],["4957609704",3],["5014906568",4],["5015673537",22],
].map(([id,revisionId])=>({id,revisionId,isEnabled:true}));
function apiFixture(r=receipt(), existing=false, drift=false) {
  const calls:any[]=[];
  const api=async(method:string,path:string,body?:any)=>{
    calls.push({method,path,body});
    if(path==="/automation/v4/flows")return {results:workflows.map((w,i)=>({...w,
      revisionId:drift&&i===0?999:w.revisionId}))};
    if(path==="/automation/v4/flows/5050995440")return {id:"5050995440",isEnabled:false,actions:[]};
    if(path.endsWith("/search"))return {total:existing?1:0,results:existing?[{id:"old-contact"}]:[]};
    if(path==="/crm/v3/objects/contacts")return {id:"new-test-contact"};
    if(method==="GET"&&path.startsWith("/crm/v3/objects/contacts/"))
      return {properties:{...Object.fromEntries(path.split("?properties=")[1].split(",").map(k=>[k,null])),
        ...noSendContactProperties(r),hs_analytics_source:"OFFLINE"}};
    throw new Error("Unexpected API capability: "+path);
  };
  return {api,calls};
}
function dbFixture(r=receipt()) {
  const request:any={id:r.requestId,snapshot_id:r.snapshotId,email:r.email,requested_at:r.requestedAt,
    consent_evidence:{snapshotDelivery:r.permission,decision:r.marketingChoice,noSendPilot:true}};
  const snapshot={id:r.snapshotId,expires_at:r.expiresAt,token_hash:createHash("sha256").update(token).digest("hex")};
  let state:string|null=null;
  const db={
    from(table:string){let payload:any;const chain:any={
      select(){return chain;},eq(){return chain;},single(){return chain;},
      update(p:any){payload=p;return chain;},
      then(resolve:any){if(payload)Object.assign(request,payload);resolve({data:table==="widget_snapshots"?snapshot:request,error:null});},
    };return chain;},
    async rpc(name:string,args:any){
      if(name==="claim_snapshot_delivery"){
        if(state)return {data:{status:"duplicate",state},error:null};
        state="prepared";return {data:{status:"claimed",attemptId:"attempt"},error:null};
      }
      if(name==="transition_snapshot_delivery"){
        assert.equal(state,args.p_from);state=args.p_to;return {data:true,error:null};
      }
      throw new Error("Unexpected RPC");
    },
  };
  return {db,request,getState:()=>state};
}

test("capture writes only email and six fields; no legacy triggers or subscriptions",async()=>{
  const r=receipt(),{api,calls}=apiFixture(r);
  assert.equal(await captureNoSendContact(r,api),"new-test-contact");
  const write=calls.find(c=>c.path==="/crm/v3/objects/contacts");
  assert.deepEqual(Object.keys(write.body.properties).sort(),[
    "email","atlas_snapshot_email_permission","atlas_snapshot_permission_version",
    "atlas_snapshot_request_id","atlas_snapshot_expires_at","atlas_optional_marketing_choice",
    "atlas_snapshot_delivery_state"].sort());
  assert.equal(write.body.properties.atlas_snapshot_delivery_state,"blocked");
  assert.ok(calls.every(c=>!/(subscribe|enroll|marketing|email\/)/.test(c.path.split("?")[0])));
});
test("existing contacts, workflow drift, and other recipients cause no CRM writes",async()=>{
  for(const scenario of [{existing:true},{drift:true},{other:true}]){
    const r={...receipt(),...(scenario.other?{email:"someone@example.invalid"}:{})};
    const {api,calls}=apiFixture(r,scenario.existing,scenario.drift);
    await assert.rejects(()=>captureNoSendContact(r,api));
    assert.equal(calls.some(c=>c.path==="/crm/v3/objects/contacts"),false);
  }
});
test("stored receipt, durable claim, contact capture and terminal dry-run connect end to end",async()=>{
  const r=receipt(),{db,request,getState}=dbFixture(r),{api,calls}=apiFixture(r);
  const result=await runNoSendCapture({requestId:r.requestId,snapshotUrl:r.snapshotUrl},{db,api});
  assert.equal(result.status,"dry_run_completed");assert.equal(result.sendingEnabled,false);
  assert.equal(getState(),"dry_run");assert.equal(request.contact_id,"new-test-contact");
  assert.equal(request.sync_status,"synced");
  const count=calls.length;
  assert.equal((await runNoSendCapture({requestId:r.requestId,snapshotUrl:r.snapshotUrl},{db,api})).status,"already_claimed");
  assert.equal(calls.length,count);
});
test("missing genuine pilot receipt or mismatched link stops before HubSpot",async()=>{
  const r=receipt(),{db,request}=dbFixture(r),{api,calls}=apiFixture(r);
  delete request.consent_evidence.noSendPilot;
  await assert.rejects(()=>runNoSendCapture({requestId:r.requestId,snapshotUrl:r.snapshotUrl},{db,api}));
  request.consent_evidence.noSendPilot=true;
  await assert.rejects(()=>runNoSendCapture({requestId:r.requestId,snapshotUrl:r.snapshotUrl.replace(token,"d".repeat(64))},{db,api}));
  assert.equal(calls.length,0);
});
test("uncertain contact creation is held for review and never automatically retried",async()=>{
  const r=receipt(),{db,getState}=dbFixture(r),f=apiFixture(r);
  let creates=0;
  const api=async(method:any,path:string,body?:any)=>{
    if(path==="/crm/v3/objects/contacts"){creates++;throw new Error("timeout after possible write");}
    return f.api(method,path,body);
  };
  const input={requestId:r.requestId,snapshotUrl:r.snapshotUrl};
  assert.equal((await runNoSendCapture(input,{db,api})).status,"manual_review_required");
  assert.equal(getState(),"blocked");
  await runNoSendCapture(input,{db,api});assert.equal(creates,1);
});
test("pilot HTTP route requires real checkbox, restricts Kenny and bypasses legacy sync",async()=>{
  const old=process.env.SNAPSHOT_NO_SEND_PILOT_ENABLED;
  process.env.SNAPSHOT_NO_SEND_PILOT_ENABLED="true";
  const {registerSnapshotRoutes}=await import("./widget-snapshot");
  const r=receipt(),rows:any[]=[];let pilotCalls=0;
  const db:any=()=>({from(table:string){
    let payload:any,operation="read";const filters:any={};
    const chain:any={select(){return chain;},eq(k:string,v:any){filters[k]=v;return chain;},
      single(){return chain;},maybeSingle(){return chain;},
      upsert(p:any){operation="upsert";payload=p;return chain;},
      then(resolve:any){
        if(table==="widget_snapshots")return resolve({data:{id:r.snapshotId,expires_at:r.expiresAt,
          company_url:"https://example.com",snapshot:{companyName:"Test"}},error:null});
        if(operation==="upsert"&&!rows.length)rows.push({id:r.requestId,requested_at:r.requestedAt,...payload});
        resolve({data:rows[0],error:null});
      }};
    return chain;
  }});
  const app=express();app.use(express.json());
  registerSnapshotRoutes(app,{db,research:async()=>{throw new Error("No research");},
    sync:async()=>{throw new Error("Legacy sync must never be called");},
    pilot:async()=>{
      pilotCalls++;assert.equal(rows[0].consent_evidence.noSendPilot,true);
      assert.equal(rows[0].consent_evidence.snapshotDelivery.decision,"accepted");
      return {status:"dry_run_completed",sendingEnabled:false,contactId:"test"};
    }});
  const server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));
  const base=`http://127.0.0.1:${(server.address() as any).port}/api/widget/snapshot`;
  const body={token,email:r.email,snapshotEmailConsent:true,snapshotEmailConsentVersion:SNAPSHOT_EMAIL_PERMISSION.version,
    marketingConsent:false,marketingConsentVersion:WIDGET_MARKETING_CONSENT.version};
  const post=(b:any)=>fetch(base+"/lead",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)});
  try{
    const cfg=await (await fetch(base+"/config")).json();
    assert.equal(cfg.noSendPilot,true);assert.equal(cfg.emailDeliveryReady,false);
    assert.equal((await post({...body,email:"other@example.invalid"})).status,403);
    assert.equal((await post({...body,snapshotEmailConsent:false})).status,400);
    assert.equal(rows.length,0);
    const result=await post(body);assert.equal(result.status,200);
    assert.equal((await result.json()).sendingEnabled,false);assert.equal(pilotCalls,1);
    delete rows[0].consent_evidence.noSendPilot;
    assert.equal((await post(body)).status,409);assert.equal(pilotCalls,1);
  } finally {
    await new Promise<void>(r=>server.close(()=>r()));
    if(old===undefined)delete process.env.SNAPSHOT_NO_SEND_PILOT_ENABLED;
    else process.env.SNAPSHOT_NO_SEND_PILOT_ENABLED=old;
  }
});
