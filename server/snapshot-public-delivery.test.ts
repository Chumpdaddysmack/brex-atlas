import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import express from "express";
import {dryRunFixture} from "./snapshot-dry-run-fixtures";
import {sendPublicSnapshot,PUBLIC_SNAPSHOT_COHORT,assertPublicReceiptRow,snapshotClickBinding,
  matchesPublicProjection,PUBLIC_WORKFLOWS,publicWorkflowHash,publicSubscriptionReader,reconcilePublicSnapshot} from "./snapshot-public-delivery";
import {snapshotReceiptDigest} from "./snapshot-delivery-ledger";
import {registerSnapshotRoutes} from "./widget-snapshot";
import {SNAPSHOT_EMAIL_PERMISSION} from "../shared/snapshot-delivery";
import {WIDGET_MARKETING_CONSENT} from "../shared/widget-consent";
// Exact provider draft readbacks, not a synthetic simplified workflow contract.
const workflows=JSON.parse(readFileSync(new URL("../docs/public-snapshot-workflow-fixture.json",import.meta.url),"utf8"));
function fixture(){
  const f=dryRunFixture();f.receipt.email="prospect@example.invalid";f.stored.request.email=f.receipt.email;
  (f.stored.request.consent_evidence as any).publicDelivery=PUBLIC_SNAPSHOT_COHORT;
  (f.stored.snapshot as any).snapshot={companyName:"Fixture Company"};
  (f.stored.snapshot as any).company_url="https://example.invalid";
  let claimState="prepared",already=false,sub="NOT_SPECIFIED",global=false;
  let contact:any=null,failArm=false,badWorkflow=false;
  const writes:any[]=[],rpcCalls:any[]=[];
  const db:any={from(table:string){
    let patch:any;const chain:any={select(){return chain;},eq(){return chain;},single(){return chain;},
      update(p:any){patch=p;return chain;},
      then(resolve:any){if(patch)Object.assign(f.stored.request,patch);
        resolve({data:table==="widget_snapshots"?f.stored.snapshot:f.stored.request,error:null});}};
    return chain;
  },async rpc(name:string,args:any){
    rpcCalls.push({name,args});
    if(name==="claim_snapshot_delivery"){
      if(already)return {data:{status:"duplicate",state:claimState},error:null};
      already=true;return {data:{status:"claimed",attemptId:"e405f15a-e071-4696-bcb6-352324f996da"},error:null};
    }
    if(name==="transition_snapshot_delivery"){
      if(args.p_from!==claimState)return {data:false,error:null};
      claimState=args.p_to;return {data:true,error:null};
    }
    throw Error("Unexpected RPC");
  }};
  const api:any=async(method:string,path:string,body:any)=>{
    if(method!=="GET")writes.push({method,path,body});
    if(path.startsWith("/automation/")){
      const w=workflows.workflows.find((w:any)=>path.endsWith("/"+w.id));
      return w?{...w.flow,isEnabled:!badWorkflow}:{isEnabled:false};
    }
    if(path.startsWith("/marketing/v3/emails/"))return {isPublished:true,state:"AUTOMATED",type:"AUTOMATED_EMAIL",archived:false,
      subscriptionDetails:{subscriptionId:"3750294688"},subject:"Your requested company snapshot is ready",
      updatedAt:"2026-10-03T23:40:04.983Z",from:{replyTo:"kenny@brexconsulting.com"}};
    if(path.includes("unsubscribe-all"))return {status:"COMPLETE",results:global?[{subscriberIdString:f.receipt.email,
      channel:"EMAIL",wideStatusType:"PORTAL_WIDE",status:"UNSUBSCRIBED",businessUnitId:0}]:[]};
    if(path.startsWith("/communication-preferences/v4/"))return {status:"COMPLETE",results:[{subscriptionId:3750294688,
      subscriberIdString:f.receipt.email,channel:"EMAIL",businessUnitId:0,status:sub}]};
    if(path==="/communication-preferences/v3/subscribe"){
      assert.equal(body.subscriptionId,"3750294688");assert.equal(body.emailAddress,f.receipt.email);
      sub="SUBSCRIBED";return {};
    }
    if(path.startsWith("/crm/v3/objects/contacts")){
      if(method==="GET")return contact;
      if(failArm&&body.properties.atlas_snapshot_delivery_state==="ready")throw Error("Timeout after write may apply");
      contact||={id:"123",properties:{email:f.receipt.email,hs_email_optout:null,hs_email_bad_address:null,
        hs_email_quarantined:null,hs_email_hard_bounce_reason_enum:null,hs_marketable_status:"false"}};
      Object.assign(contact.properties,body.properties);return contact;
    }
    throw Error("Unexpected API operation "+method+" "+path);
  };
  return {...f,db,api,writes,rpcCalls,input:{requestId:f.receipt.requestId,snapshotUrl:f.receipt.snapshotUrl},
    state:()=>claimState,contact:()=>contact,setContact:(c:any)=>{contact=c;},
    optOut:()=>{sub="UNSUBSCRIBED";},globalOut:()=>{global=true;},
    failArm:()=>{failArm=true;},badWorkflow:()=>{badWorkflow=true;}};
}
test("public workflow contracts pin results-only sender and native status prerequisite",()=>{
  for(const w of workflows.workflows){
    assert.equal(publicWorkflowHash(w.flow),PUBLIC_WORKFLOWS.find(p=>p.id===w.id)!.hash);
    assert.equal(w.flow.enrollmentCriteria.shouldReEnroll,true);
    const filters=w.flow.enrollmentCriteria.listFilterBranch.filterBranches[0].filters;
    assert.equal(filters.some((f:any)=>f.property==="email"),false);
    assert.equal(filters.find((f:any)=>f.property==="hs_marketable_status").operation.value,w.kind==="sender");
  }
});
test("new subscriber OBJECT_NOT_FOUND means unspecified, never subscribed; other errors fail closed",async()=>{
  const email="new@example.com";
  const absent={status:"COMPLETE",results:[],numErrors:1,errors:[{category:"OBJECT_NOT_FOUND",context:{subscriberIdString:[email]}}]};
  const client=publicSubscriptionReader(async(_m,p)=>p.includes("unsubscribe-all")?{status:"COMPLETE",results:[]}:absent,email);
  assert.equal((await client.read(email)).snapshot,"NOT_SPECIFIED");
  const bad=publicSubscriptionReader(async()=>({...absent,errors:[{category:"MISSING_SCOPES"}]}),email);
  await assert.rejects(()=>bad.read(email));
  const denied=publicSubscriptionReader(async(_m,p)=>p.includes("unsubscribe-all")?{status:"COMPLETE",results:[
    {subscriberIdString:email,businessUnitId:0,channel:"EMAIL",wideStatusType:"PORTAL_WIDE",status:"UNSUBSCRIBED"}]}:absent,email);
  assert.equal((await denied.read(email)).globallyBlocked,true);
});
test("any fresh requester can queue exactly once, only snapshot subscription is changed",async()=>{
  const f=fixture(),out=await sendPublicSnapshot(f.input,f.db,f.api);
  assert.equal(out.status,"queued");assert.equal(f.state(),"dispatching");
  assert.equal(f.contact().properties.atlas_snapshot_delivery_state,"ready");
  assert.equal(f.contact().properties.hs_marketable_status,"false"); // Native workflow, never API override.
  assert.equal(f.contact().properties.original_lead_source,"Website");
  assert.equal(f.contact().properties.lead_source_tag,"Atlas Excavator Widget");
  assert.equal(f.writes.filter(w=>w.path.includes("/subscribe")).length,1);
  assert.ok(f.writes.every(w=>!Object.hasOwn(w.body?.properties||{},"hs_marketable_status")));
  assert.equal(f.writes.some(w=>JSON.stringify(w.body).includes("711496982")),false);
  const n=f.writes.length;
  assert.equal((await sendPublicSnapshot(f.input,f.db,f.api)).status,"already_recorded");
  assert.equal(f.writes.length,n);
});
test("existing source is preserved and contact name/site are not overwritten",async()=>{
  const f=fixture();f.setContact({id:"123",properties:{email:f.receipt.email,company:"Original",website:"https://original.invalid",
    original_lead_source:"Referral",hs_email_optout:null,hs_email_bad_address:null,hs_email_quarantined:null,
    hs_email_hard_bounce_reason_enum:null,hs_marketable_status:"true"}});
  assert.equal((await sendPublicSnapshot(f.input,f.db,f.api)).status,"queued");
  assert.equal(f.contact().properties.original_lead_source,"Referral");
  assert.equal(f.contact().properties.company,"Original");
  assert.equal(f.contact().properties.website,"https://original.invalid");
});
test("category opt-out, global opt-out, suppression and changed workflow stop before sends",async()=>{
  for(const setup of [(f:any)=>f.optOut(),(f:any)=>f.globalOut(),(f:any)=>f.badWorkflow(),
    (f:any)=>f.setContact({id:"123",properties:{email:f.receipt.email,hs_email_optout:"true"}})]){
    const f=fixture();setup(f);
    assert.equal((await sendPublicSnapshot(f.input,f.db,f.api)).status,"blocked");
    assert.equal(f.state(),"blocked");assert.equal(f.writes.length,0);
  }
});
test("ambiguous ready write retains lock, does not retry or falsely mark delivered",async()=>{
  const f=fixture();f.failArm();
  assert.equal((await sendPublicSnapshot(f.input,f.db,f.api)).status,"held");
  assert.equal(f.state(),"uncertain");const n=f.writes.length;
  assert.equal((await sendPublicSnapshot(f.input,f.db,f.api)).status,"already_recorded");
  assert.equal(f.writes.length,n);
});
test("all historical/test cohorts and expired/mismatched links are rejected before claiming",async()=>{
  const changes=[(f:any)=>{delete f.stored.request.consent_evidence.publicDelivery;},
    (f:any)=>{f.stored.request.requested_at="2026-10-03T00:00:00Z";},
    (f:any)=>{f.stored.snapshot.expires_at="2026-01-01";},
    (f:any)=>{f.stored.snapshot.token_hash="b".repeat(64);},
    ...["liveEmailTest","noSendPilot","websiteNoSend"].map(k=>(f:any)=>{f.stored.request.consent_evidence[k]=true;})];
  for(const change of changes){const f=fixture();change(f);
    await assert.rejects(()=>sendPublicSnapshot(f.input,f.db,f.api));
    assert.equal(f.rpcCalls.length,0);assert.equal(f.writes.length,0);}
});
test("binding needs the exact private link and an unambiguous provider parent, never email/time alone",()=>{
  const f=fixture(),base={type:"CLICK",recipient:f.receipt.email,portalId:242249577,
    url:f.receipt.snapshotUrl,sentBy:{id:"one",created:1}};
  assert.deepEqual(snapshotClickBinding([base],f.receipt.email,f.receipt.snapshotUrl),base.sentBy);
  assert.equal(snapshotClickBinding([{...base,type:"SENT"}],f.receipt.email,f.receipt.snapshotUrl),null);
  assert.equal(snapshotClickBinding([{...base,url:"https://other.invalid/"}],f.receipt.email,f.receipt.snapshotUrl),null);
  assert.equal(snapshotClickBinding([base,{...base,sentBy:{id:"two",created:2}}],f.receipt.email,f.receipt.snapshotUrl),null);
  assert.equal(snapshotClickBinding([{...base,recipient:"different@example.invalid"}],f.receipt.email,f.receipt.snapshotUrl),null);
});
test("projection matching rejects changed URL, request, permission or expiry",async()=>{
  const f=fixture();await sendPublicSnapshot(f.input,f.db,f.api);
  assert.equal(matchesPublicProjection(f.contact().properties,f.receipt),true);
  for(const key of ["atlas_snapshot_url","atlas_snapshot_request_id","atlas_snapshot_expires_at","atlas_snapshot_permission_version"])
    assert.equal(matchesPublicProjection({...f.contact().properties,[key]:"changed"},f.receipt),false);
});
test("reconciliation only records an exactly link-bound SENT/DELIVERED lineage and never rewrites contact state",async()=>{
  for(const scenario of ["complete","no-click","click-only","wrong-link","incomplete"]){
    const f=fixture();await sendPublicSnapshot(f.input,f.db,f.api);const writes=f.writes.length;
    const now=Date.now(),parent={id:"6e8a164d-16e7-404e-aea6-a0f9a3452921",created:now-10};
    const common={portalId:242249577,emailCampaignId:38781164,recipient:f.receipt.email};
    const events:any[]=[
      {...common,...parent,type:"SENT"},
      {...common,id:"11f636e8-1c2f-3b95-9c21-d47ae98dc0dd",created:now-5,type:"DELIVERED",sentBy:parent},
      {...common,id:"141a3fee-c257-364e-a123-98c6452e2936",created:now,type:"CLICK",sentBy:parent,
        url:scenario==="wrong-link"?"https://example.com":f.receipt.snapshotUrl},
    ];
    const recorded:any[]=[];
    const db:any={from(table:string){
      if(table!=="widget_snapshot_delivery_attempts")return f.db.from(table);
      const chain:any={select(){return chain;},in(){return chain;},gte(){return chain;},limit(){return chain;},
        then(resolve:any){resolve({error:null,data:[{request_id:f.receipt.requestId,attempt_id:"e405f15a-e071-4696-bcb6-352324f996da",
          email:f.receipt.email,receipt_digest:snapshotReceiptDigest(f.receipt),created_at:new Date(now-100).toISOString()}]});}};
      return chain;
    },async rpc(name:string,args:any){recorded.push({name,args});return {data:true,error:null};}};
    const api:any=async(m:any,path:string,b:any)=>{
      if(path.includes("email-campaigns"))return {results:[{flowId:PUBLIC_WORKFLOWS[1].id,emailContentId:"405101719239",emailCampaignId:"38781164"}]};
      if(path.startsWith("/email/public/v1/events"))return {hasMore:scenario==="incomplete",events:
        scenario==="no-click"?events.slice(0,2):scenario==="click-only"?events.slice(2):events};
      return f.api(m,path,b);
    };
    await reconcilePublicSnapshot(db,api);
    assert.equal(f.writes.length,writes);
    assert.equal(f.contact().properties.atlas_snapshot_delivery_state,"ready");
    if(scenario==="complete"){
      assert.deepEqual(recorded.map(x=>x.name),["bind_snapshot_delivery_message","record_snapshot_delivery_event","record_snapshot_delivery_event"]);
      assert.deepEqual(recorded.slice(1).map(x=>x.args.p_event_type),["SENT","DELIVERED"]);
    }else assert.equal(recorded.length,0,scenario);
  }
});
test("public HTTP mode accepts non-Kenny requests, requires checkbox, excludes old modes/legacy sync",async()=>{
  const names=["SNAPSHOT_PUBLIC_DELIVERY_ENABLED","SNAPSHOT_WEBSITE_NO_SEND_ENABLED","SNAPSHOT_LIVE_TEST_CAPTURE_ENABLED"];
  const old=names.map(n=>process.env[n]);names.forEach(n=>process.env[n]="true");
  const f=fixture();let captures=0;const rows:any[]=[];
  const db:any=()=>({from(table:string){const c:any={select(){return c;},eq(){return c;},single(){return c;},maybeSingle(){return c;},
    upsert(p:any){if(!rows.length)rows.push({...f.stored.request,...p});return c;},
    then(resolve:any){resolve({data:table==="widget_snapshots"?f.stored.snapshot:rows[0],error:null});}};return c;}});
  const app=express();app.use(express.json());
  registerSnapshotRoutes(app,{db,research:async()=>{throw Error("not called");},sync:async()=>{throw Error("legacy prohibited");},
    publicDelivery:async()=>{captures++;return {status:"queued",sendingEnabled:true};}});
  const server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));
  const base=`http://127.0.0.1:${(server.address() as any).port}/api/widget/snapshot`;
  const body={email:f.receipt.email,token:"a".repeat(64),snapshotEmailConsent:true,snapshotEmailConsentVersion:SNAPSHOT_EMAIL_PERMISSION.version,
    marketingConsent:false,marketingConsentVersion:WIDGET_MARKETING_CONSENT.version};
  const post=(b:any)=>fetch(base+"/lead",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)});
  try{
    const config=await(await fetch(base+"/config")).json();
    assert.equal(config.publicDelivery,true);assert.equal(config.liveTestCapture,false);assert.equal(config.websiteNoSend,false);
    assert.equal((await post({...body,snapshotEmailConsent:false})).status,400);
    const r=await(await post(body)).json();assert.equal(r.deliveryStatus,"queued");assert.equal(captures,1);
    assertPublicReceiptRow(rows[0]);rows[0].consent_evidence.liveEmailTest="old";
    assert.equal((await post(body)).status,409);assert.equal(captures,1);
  }finally{await new Promise<void>(r=>server.close(()=>r()));names.forEach((n,i)=>old[i]===undefined?delete process.env[n]:process.env[n]=old[i]);}
});
