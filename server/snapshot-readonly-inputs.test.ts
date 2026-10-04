import test from "node:test";
import assert from "node:assert/strict";
import {createSnapshotReadOnlyInputs} from "./snapshot-readonly-inputs";
import {dryRunFixture} from "./snapshot-dry-run-fixtures";
import {inspectBoundSnapshotDelivery} from "./snapshot-readonly-reconciliation";
import {hubspotSnapshotMessageId,type BoundSnapshotMessage} from "./snapshot-provider-events";
const now=Date.parse("2026-10-04T02:00:00Z");
test("read-only evidence adapter reads exact category, global preferences and contact; no mutation ports",async()=>{
  const f=dryRunFixture(now),paths:string[]=[];
  const inputs=createSnapshotReadOnlyInputs({
    get:async(path)=>{
      paths.push(path);
      if(path.includes("unsubscribe-all"))return {status:"COMPLETE",results:[]};
      if(path.includes("communication-preferences"))return {status:"COMPLETE",results:[{
        businessUnitId:0,channel:"EMAIL",subscriberIdString:f.receipt.email,subscriptionId:3750294688,status:"SUBSCRIBED",
      }]};
      return {id:"fixture",archived:false,properties:f.evidence.contact};
    },
    readReviewedEmail:async()=>f.evidence.email,readVerifiedBilling:async()=>f.evidence.billing,
  },()=>now);
  const out=await inputs.readEvidence(f.receipt,new AbortController().signal);
  assert.equal(out.contact?.email,f.receipt.email);
  assert.equal(paths.length,3);
  assert.ok(paths[2].includes("idProperty=email"));
  assert.equal(Object.keys(inputs).join(","),"readEvidence");
});
test("unconfirmed CRM response, partial preferences or abort stops evidence collection",async()=>{
  const f=dryRunFixture(now);
  for(const mode of ["archived","partial_preferences","aborted"]){
    let billingReads=0;const controller=new AbortController();
    if(mode==="aborted")controller.abort();
    const inputs=createSnapshotReadOnlyInputs({
      get:async(path)=>{
        if(path.includes("unsubscribe-all"))return {status:"COMPLETE",results:[]};
        if(path.includes("communication-preferences"))return {status:mode==="partial_preferences"?"PENDING":"COMPLETE",results:[
          {businessUnitId:0,channel:"EMAIL",subscriberIdString:f.receipt.email,subscriptionId:3750294688,status:"SUBSCRIBED"}]};
        return {id:"fixture",archived:true,properties:f.evidence.contact};
      },readReviewedEmail:async()=>f.evidence.email,
      readVerifiedBilling:async()=>{billingReads++;return f.evidence.billing;},
    },()=>now);
    await assert.rejects(()=>inputs.readEvidence(f.receipt,controller.signal));
    assert.equal(billingReads,0);
  }
});
function providerFixture(){
  const sent={id:"6e8a164d-16e7-404e-aea6-a0f9a3452921",created:1791075281988};
  const binding:BoundSnapshotMessage={
    requestId:"efb004e6-9642-4e46-a5b2-8f011ca29573",attemptId:"3f6ad390-ff93-4c7f-9aa4-34b364662718",
    receiptDigest:"1".repeat(64),portalId:242249577,campaignId:38778777,email:"fixture@example.invalid",sentEvent:sent,
    providerMessageId:hubspotSnapshotMessageId(242249577,38778777,sent),
  };
  const common={portalId:binding.portalId,emailCampaignId:binding.campaignId,recipient:binding.email};
  return {binding,events:[{...common,...sent,type:"SENT"},{...common,type:"DELIVERED",
    id:"11f636e8-1c2f-3b95-9c21-d47ae98dc0dd",created:1791075283094,sentBy:sent}]};
}
test("provider pagination completes before proposing bound ledger events, without applying them",async()=>{
  const f=providerFixture();let reads=0;
  const out=await inspectBoundSnapshotDelivery(f.binding,async query=>{
    reads++;
    assert.equal(query.campaignId,f.binding.campaignId);
    return query.offset?{hasMore:false,events:[f.events[0]]}:{hasMore:true,offset:"next",events:[f.events[1]]};
  },now);
  assert.equal(out.status,"verified");assert.equal(reads,2);
  assert.deepEqual(out.events.map((e:any)=>e.eventType),["SENT","DELIVERED"]);
});
test("pagination loops, partial reads, provider errors, and bound mismatches hold rather than resend",async()=>{
  const f=providerFixture();
  for(const get of [
    async()=>({hasMore:true,offset:"same",events:[]}),
    async()=>({events:[]}),
    async()=>{throw new Error("Unavailable");},
    async()=>({hasMore:false,events:f.events.map(e=>({...e,recipient:"wrong@example.invalid"}))}),
  ]){
    const out=await inspectBoundSnapshotDelivery(f.binding,get,now);
    assert.equal(out.status,"hold");assert.deepEqual(out.events,[]);
  }
  let count=0;
  const bounded=await inspectBoundSnapshotDelivery(f.binding,async()=>({hasMore:true,offset:String(++count),events:[]}),now);
  assert.equal(bounded.status,"hold");assert.equal(count,20);
});
test("invalid stored binding causes zero provider reads; hung reads abort without replay",async()=>{
  const f=providerFixture();let reads=0,aborted=false;
  const invalid=await inspectBoundSnapshotDelivery({...f.binding,providerMessageId:""},async()=>{
    reads++;return {events:[],hasMore:false};
  },now);
  assert.equal(invalid.status,"hold");assert.equal(reads,0);
  const timeout=await inspectBoundSnapshotDelivery(f.binding,async(_,signal)=>{
    reads++;signal.addEventListener("abort",()=>{aborted=true;});return new Promise(()=>{});
  },now,10);
  assert.equal(timeout.status,"hold");assert.equal(reads,1);assert.equal(aborted,true);
});
