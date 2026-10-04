import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import express from "express";
import {dryRunFixture} from "./snapshot-dry-run-fixtures";
import {snapshotReceiptDigest} from "./snapshot-delivery-ledger";
import {captureWebsiteNoSend,encryptWebsiteReceipt,decryptWebsiteReceipt,runWebsiteNoSendOnce,websiteNoSendReady,WEBSITE_NO_SEND_VERSION,websiteReadOnlyGet} from "./snapshot-website-no-send";
import {registerSnapshotRoutes} from "./widget-snapshot";
import {SNAPSHOT_EMAIL_PERMISSION} from "../shared/snapshot-delivery";
import {WIDGET_MARKETING_CONSENT} from "../shared/widget-consent";
const names=["SNAPSHOT_WEBSITE_NO_SEND_ENABLED","SNAPSHOT_QUEUE_ENCRYPTION_KEY","SNAPSHOT_WEBSITE_NO_SEND_AFTER","HUBSPOT_ACCESS_TOKEN","SNAPSHOT_LIVE_TEST_CAPTURE_ENABLED","SNAPSHOT_NO_SEND_PILOT_ENABLED"];
async function configured(fn:()=>Promise<void>){
  const old=Object.fromEntries(names.map(n=>[n,process.env[n]]));
  Object.assign(process.env,{SNAPSHOT_WEBSITE_NO_SEND_ENABLED:"true",SNAPSHOT_QUEUE_ENCRYPTION_KEY:randomBytes(32).toString("hex"),
    SNAPSHOT_WEBSITE_NO_SEND_AFTER:new Date(Date.now()-60_000).toISOString(),HUBSPOT_ACCESS_TOKEN:"fixture-not-a-credential",
    SNAPSHOT_LIVE_TEST_CAPTURE_ENABLED:"true",SNAPSHOT_NO_SEND_PILOT_ENABLED:"true"});
  try{await fn();}finally{for(const n of names)if(old[n]===undefined)delete process.env[n];else process.env[n]=old[n];}
}
function fixture(){
  const f=dryRunFixture();f.receipt.email="kenny@brexconsulting.com";f.stored.request.email=f.receipt.email;
  f.evidence.contact!.email=f.receipt.email;f.evidence.preferences.email=f.receipt.email;
  (f.stored.request.consent_evidence as any).websiteNoSend=WEBSITE_NO_SEND_VERSION;
  const calls:any[]=[];
  const db:any={
    from(table:string){const chain:any={select(){return chain;},eq(){return chain;},single(){return chain;},
      then(resolve:any){resolve({data:table==="widget_snapshots"?f.stored.snapshot:f.stored.request,error:null});}};return chain;},
    async rpc(name:string,args:any){calls.push({name,args});return {data:{status:"queued"},error:null};},
  };
  return {...f,db,calls};
}
test("website test configuration is explicit and missing/invalid settings fail closed",async()=>{
  await configured(async()=>{
    assert.equal(websiteNoSendReady(),true);
    for(const [k,v] of [["SNAPSHOT_WEBSITE_NO_SEND_ENABLED","false"],["SNAPSHOT_QUEUE_ENCRYPTION_KEY","bad"],
      ["SNAPSHOT_WEBSITE_NO_SEND_AFTER",""],["HUBSPOT_ACCESS_TOKEN",""]]){
      assert.equal(websiteNoSendReady({...process.env,[k]:v}),false);
    }
    assert.equal(websiteNoSendReady({...process.env,SNAPSHOT_WEBSITE_NO_SEND_AFTER:"2999-01-01"}),false);
  });
});
test("production adapter stores encrypted bound receipt using only its isolated queue RPC",async()=>{
  await configured(async()=>{
    const f=fixture();
    const out=await captureWebsiteNoSend({requestId:f.receipt.requestId,snapshotUrl:f.receipt.snapshotUrl},f.db);
    assert.equal(out.status,"queued");assert.equal(f.calls.length,1);
    const {name,args}=f.calls[0];assert.equal(name,"enqueue_snapshot_no_send");
    assert.equal(args.p_ciphertext.includes(f.receipt.snapshotUrl),false);
    assert.equal(args.p_ciphertext.includes(f.receipt.email),false);
    const k=Buffer.from(process.env.SNAPSHOT_QUEUE_ENCRYPTION_KEY!,"hex");
    assert.deepEqual(decryptWebsiteReceipt(f.receipt.requestId,args.p_ciphertext,args.p_digest,k),f.receipt);
    assert.throws(()=>decryptWebsiteReceipt(f.receipt.requestId,args.p_ciphertext,args.p_digest,randomBytes(32)));
    assert.throws(()=>decryptWebsiteReceipt("wrong",args.p_ciphertext,args.p_digest,k));
    assert.throws(()=>decryptWebsiteReceipt(f.receipt.requestId,args.p_ciphertext,"b".repeat(64),k));
  });
});
test("capture refuses old cohorts, expired requests, wrong recipient and wrong private link",async()=>{
  await configured(async()=>{
    for(const change of [(f:any)=>{f.stored.request.consent_evidence.liveEmailTest="previous";},
      (f:any)=>{delete f.stored.request.consent_evidence.websiteNoSend;},
      (f:any)=>{f.stored.request.email="other@example.invalid";},
      (f:any)=>{f.stored.request.requested_at="2000-01-01";},
      (f:any)=>{f.stored.snapshot.expires_at="2000-01-01";},
      (f:any)=>{f.stored.snapshot.token_hash="b".repeat(64);}])
    {
      const f=fixture();change(f);
      await assert.rejects(()=>captureWebsiteNoSend({requestId:f.receipt.requestId,snapshotUrl:f.receipt.snapshotUrl},f.db));
      assert.equal(f.calls.length,0);
    }
  });
});
test("website worker uses live-shape read evidence, honestly holds unverified billing, and never changes CRM",async()=>{
  await configured(async()=>{
    const f=fixture(),k=Buffer.from(process.env.SNAPSHOT_QUEUE_ENCRYPTION_KEY!,"hex"),gets:string[]=[],rpcCalls:any[]=[];
    const job={request_id:f.receipt.requestId,lease_token:"fixture",receipt_digest:snapshotReceiptDigest(f.receipt),
      encrypted_payload:encryptWebsiteReceipt(f.receipt,k)};
    const db:any={rpc:async(name:string,args:any)=>{rpcCalls.push({name,args});return {data:name==="claim_snapshot_no_send"?{status:"claimed",job}:true,error:null};}};
    const out=await runWebsiteNoSendOnce(db,async path=>{
      gets.push(path);
      if(path.includes("unsubscribe-all"))return {status:"COMPLETE",results:[]};
      if(path.includes("communication-preferences"))return {status:"COMPLETE",results:[{businessUnitId:0,channel:"EMAIL",
        subscriberIdString:f.receipt.email,subscriptionId:3750294688,status:"SUBSCRIBED"}]};
      if(path.includes("/contacts/"))return {id:"fixture",archived:false,properties:f.evidence.contact};
      if(path.includes("/marketing/v3/emails/"))return {id:"405101719239",isPublished:true,state:"AUTOMATED",archived:false,
        subscriptionDetails:{subscriptionId:"3750294688"},updatedAt:"2026-10-03T23:40:04.983Z",
        subject:"Your requested company snapshot is ready",from:{replyTo:"kenny@brexconsulting.com"}};
      throw new Error("Unexpected read");
    });
    assert.equal(out.status,"review");
    assert.equal(rpcCalls[1].args.p_result.reason,"billing_guard_unknown");
    assert.deepEqual(rpcCalls.map(c=>c.name),["claim_snapshot_no_send","finish_snapshot_no_send"]);
    assert.equal(gets.length,4);
  });
});
test("read transport is host-pinned GET, redacts failures, and does not follow redirects",async()=>{
  await configured(async()=>{
    const original=globalThis.fetch;let calls=0;
    globalThis.fetch=async(url:any,options:any)=>{
      calls++;assert.ok(String(url).startsWith("https://api.hubapi.com/"));assert.equal(options.method,"GET");
      assert.equal(options.redirect,"error");assert.equal(options.body,undefined);
      return new Response("sensitive response",{status:403});
    };
    try{
      await assert.rejects(()=>websiteReadOnlyGet("//wrong.invalid",new AbortController().signal),/Invalid read path/);
      assert.equal(calls,0);
      await assert.rejects(()=>websiteReadOnlyGet("/marketing/v3/emails/405101719239",new AbortController().signal),/HubSpot read unavailable/);
      assert.equal(calls,1);
    }finally{globalThis.fetch=original;}
  });
});
test("HTTP website mode wins over previous modes, requires real permission, never falls through to legacy sync",async()=>{
  await configured(async()=>{
    const f=fixture();let captures=0;const rows:any[]=[];
    const db:any=()=>({from(table:string){
      const chain:any={select(){return chain;},eq(){return chain;},single(){return chain;},maybeSingle(){return chain;},
        upsert(p:any){if(!rows.length)rows.push({...f.stored.request,...p});return chain;},
        then(resolve:any){resolve({data:table==="widget_snapshots"?{...f.stored.snapshot,company_url:"https://example.com",snapshot:{companyName:"Fixture"}}:rows[0],error:null});}};
      return chain;
    }});
    const app=express();app.use(express.json());
    registerSnapshotRoutes(app,{db,research:async()=>{throw new Error("Not called");},
      sync:async()=>{throw new Error("LEGACY WRITE FORBIDDEN");},
      pilot:async()=>{throw new Error("OLD PILOT FORBIDDEN");},
      liveCapture:async()=>{throw new Error("OLD CAPTURE FORBIDDEN");},
      websiteCapture:async()=>{captures++;return {status:"queued"};}});
    const server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));
    const base=`http://127.0.0.1:${(server.address() as any).port}/api/widget/snapshot`;
    const body={email:f.receipt.email,token:"a".repeat(64),snapshotEmailConsent:true,
      snapshotEmailConsentVersion:SNAPSHOT_EMAIL_PERMISSION.version,marketingConsent:false,marketingConsentVersion:WIDGET_MARKETING_CONSENT.version};
    const post=(b:any)=>fetch(base+"/lead",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)});
    try{
      const config=await(await fetch(base+"/config")).json();
      assert.equal(config.websiteNoSend,true);assert.equal(config.liveTestCapture,false);assert.equal(config.noSendPilot,false);
      assert.equal(config.emailDeliveryReady,false);
      assert.equal((await post({...body,email:"other@example.invalid"})).status,403);
      assert.equal((await post({...body,snapshotEmailConsent:false})).status,400);
      const response=await(await post(body)).json();assert.equal(response.sendingEnabled,false);
      assert.equal(captures,1);assert.equal(rows[0].consent_evidence.websiteNoSend,WEBSITE_NO_SEND_VERSION);
      assert.equal(rows[0].consent_evidence.liveEmailTest,undefined);
      rows[0].consent_evidence.websiteNoSend="old";
      assert.equal((await post(body)).status,409);assert.equal(captures,1);
      delete process.env.SNAPSHOT_QUEUE_ENCRYPTION_KEY;
      assert.equal((await post(body)).status,503);assert.equal(captures,1);
    }finally{await new Promise<void>(r=>server.close(()=>r()));}
  });
});
