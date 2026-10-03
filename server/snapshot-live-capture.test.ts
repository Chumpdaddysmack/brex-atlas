import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import express from "express";
import { captureSnapshotLiveTest,LIVE_TEST_APPROVAL,LIVE_TEST_CUTOFF } from "./snapshot-live-capture";
import { parseSnapshotEmailPermission,SNAPSHOT_EMAIL_PERMISSION } from "../shared/snapshot-delivery";
import { WIDGET_MARKETING_CONSENT } from "../shared/widget-consent";
import { registerSnapshotRoutes } from "./widget-snapshot";

const token="a".repeat(64),url="https://atlas.brexconsulting.com/widget.html#snapshot="+token;
function fixture(){
  const request:any={id:"request",snapshot_id:"snapshot",email:"kenny@brexconsulting.com",
    requested_at:new Date().toISOString(),consent_evidence:{liveEmailTest:LIVE_TEST_APPROVAL,
      decision:"not_selected",snapshotDelivery:parseSnapshotEmailPermission({
        snapshotEmailConsent:true,snapshotEmailConsentVersion:SNAPSHOT_EMAIL_PERMISSION.version})}};
  const snapshot:any={id:"snapshot",token_hash:createHash("sha256").update(token).digest("hex"),
    expires_at:new Date(Date.now()+86400000).toISOString(),snapshot:{companyName:"Test"},company_url:"https://example.com"};
  let claims=0,state:string|null=null,prior:any[]=[],historyError=false;
  const db:any={
    from(table:string){
      const chain:any={select(){return chain;},eq(){return chain;},gte(){return chain;},
        single(){return chain;},maybeSingle(){return chain;},upsert(){return chain;},
        then(resolve:any){resolve({data:table==="widget_snapshots"?snapshot
          :table==="widget_snapshot_requests"?request:prior,
          error:table==="widget_snapshot_delivery_attempts"&&historyError?{}:null});}};
      return chain;
    },
    async rpc(name:string){
      assert.equal(name,"claim_snapshot_delivery","No send or transition RPC allowed");
      claims++;if(state)return {data:{status:"duplicate",state},error:null};
      state="prepared";return {data:{status:"claimed",state,attemptId:"attempt"},error:null};
    }
  };
  return {db,request,snapshot,get claims(){return claims;},get state(){return state;},
    setPrior:(value:any[])=>prior=value,failHistory:()=>historyError=true};
}
test("fresh live request is claimed but never dispatched; duplicate stays prepared",async()=>{
  const f=fixture(),input={requestId:"request",snapshotUrl:url};
  assert.equal((await captureSnapshotLiveTest(input,f.db)).status,"request_held");
  assert.equal(f.state,"prepared");
  assert.equal((await captureSnapshotLiveTest(input,f.db)).status,"request_held");
  assert.equal(f.state,"prepared");
});
test("no-send, old, other recipient, wrong link, missing consent and expiry fail before claim",async()=>{
  for(const mutate of [
    (f:any)=>f.request.consent_evidence.noSendPilot=true,
    (f:any)=>delete f.request.consent_evidence.liveEmailTest,
    (f:any)=>f.request.requested_at=LIVE_TEST_CUTOFF,
    (f:any)=>f.request.email="other@example.com",
    (f:any)=>delete f.request.consent_evidence.snapshotDelivery,
    (f:any)=>f.snapshot.expires_at="2020-01-01T00:00:00Z",
    (f:any)=>f.snapshot.token_hash="bad",
  ]){
    const f=fixture();mutate(f);
    await assert.rejects(()=>captureSnapshotLiveTest({requestId:"request",snapshotUrl:url},f.db));
    assert.equal(f.claims,0);
  }
});
test("another candidate even delivered, or unavailable history, cannot create a new claim",async()=>{
  const f=fixture();f.setPrior([{request_id:"another",state:"delivered"}]);
  assert.equal((await captureSnapshotLiveTest({requestId:"request",snapshotUrl:url},f.db)).status,"review_required");
  assert.equal(f.claims,0);f.failHistory();
  await assert.rejects(()=>captureSnapshotLiveTest({requestId:"request",snapshotUrl:url},f.db));
  assert.equal(f.claims,0);
});
test("HTTP mode precedence, real consent, recipient and immutable receipt gates; legacy CRM never runs",async()=>{
  const oldLive=process.env.SNAPSHOT_LIVE_TEST_CAPTURE_ENABLED,oldNo=process.env.SNAPSHOT_NO_SEND_PILOT_ENABLED;
  process.env.SNAPSHOT_LIVE_TEST_CAPTURE_ENABLED="true";process.env.SNAPSHOT_NO_SEND_PILOT_ENABLED="true";
  const f=fixture();let captures=0;
  const app=express();app.use(express.json());
  registerSnapshotRoutes(app,{db:()=>f.db,research:async()=>{throw new Error("Research not needed");},
    sync:async()=>{throw new Error("Legacy CRM prohibited");},
    pilot:async()=>{throw new Error("No-send path prohibited");},
    liveCapture:async input=>{captures++;return captureSnapshotLiveTest(input,f.db);}});
  const server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));
  const base=`http://127.0.0.1:${(server.address() as any).port}/api/widget/snapshot`;
  const body={token,email:f.request.email,snapshotEmailConsent:true,snapshotEmailConsentVersion:SNAPSHOT_EMAIL_PERMISSION.version,
    marketingConsent:false,marketingConsentVersion:WIDGET_MARKETING_CONSENT.version};
  const post=(b:any)=>fetch(base+"/lead",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)});
  try{
    const config=await (await fetch(base+"/config")).json();
    assert.equal(config.liveTestCapture,true);assert.equal(config.noSendPilot,false);assert.equal(config.emailDeliveryReady,false);
    assert.equal((await post({...body,email:"someone@example.com"})).status,403);
    assert.equal((await post({...body,snapshotEmailConsent:false})).status,400);
    assert.equal(captures,0);
    const response=await post(body);assert.equal(response.status,200);
    const result=await response.json();assert.equal(result.sendingEnabled,false);
    assert.match(result.message,/held for final eligibility checks/);assert.equal(f.state,"prepared");
    f.request.consent_evidence.noSendPilot=true;
    assert.equal((await post(body)).status,409);assert.equal(captures,1);
    delete f.request.consent_evidence.noSendPilot;delete f.request.consent_evidence.liveEmailTest;
    assert.equal((await post(body)).status,409);assert.equal(captures,1);
  }finally{
    await new Promise<void>(r=>server.close(()=>r()));
    if(oldLive===undefined)delete process.env.SNAPSHOT_LIVE_TEST_CAPTURE_ENABLED;else process.env.SNAPSHOT_LIVE_TEST_CAPTURE_ENABLED=oldLive;
    if(oldNo===undefined)delete process.env.SNAPSHOT_NO_SEND_PILOT_ENABLED;else process.env.SNAPSHOT_NO_SEND_PILOT_ENABLED=oldNo;
  }
});
