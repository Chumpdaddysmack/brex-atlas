import test from "node:test";
import assert from "node:assert/strict";
import {hubspotSnapshotMessageId, planBoundSnapshotEvents, type BoundSnapshotMessage} from "./snapshot-provider-events";
const now=Date.parse("2026-10-04T01:00:00Z");
const binding:BoundSnapshotMessage={
  requestId:"efb004e6-9642-4e46-a5b2-8f011ca29573",
  attemptId:"3f6ad390-ff93-4c7f-9aa4-34b364662718",
  receiptDigest:"1be1a07d6e158dcaa45bc27e32119f141fb1a1c8cacf6182e0f6c8f708dc6b6e",
  portalId:242249577,campaignId:38778777,email:"kenny@brexconsulting.com",
  sentEvent:{id:"6e8a164d-16e7-404e-aea6-a0f9a3452921",created:1791075281988},
  providerMessageId:"hubspot:242249577:38778777:1791075281988:6e8a164d-16e7-404e-aea6-a0f9a3452921",
};
function fixture(){
  const common={portalId:binding.portalId,emailCampaignId:binding.campaignId,recipient:binding.email};
  const sent={...common,...binding.sentEvent,type:"SENT",sentBy:binding.sentEvent};
  const delivered={...common,type:"DELIVERED",id:"11f636e8-1c2f-3b95-9c21-d47ae98dc0dd",
    created:1791075283094,sentBy:{...binding.sentEvent}};
  return {hasMore:false,events:[delivered,sent]};
}
test("plans correlated SENT then DELIVERED for an already-bound message without I/O",()=>{
  const result=planBoundSnapshotEvents(binding,fixture(),now);
  assert.equal(result.status,"verified");
  assert.deepEqual(result.events.map(e=>e.eventType),["SENT","DELIVERED"]);
  assert.equal(result.events[1].occurredAt,"2026-10-04T00:54:43.094Z");
  assert.equal(hubspotSnapshotMessageId(binding.portalId,binding.campaignId,binding.sentEvent),binding.providerMessageId);
});
test("refuses incomplete reads and absent stored identity",()=>{
  for(const response of [null,{}, {events:[]}, {...fixture(),hasMore:true}, {events:"bad",hasMore:false}])
    assert.equal(planBoundSnapshotEvents(binding,response,now).status,"hold");
  for(const change of [{requestId:""},{attemptId:""},{receiptDigest:"x"},{providerMessageId:""},
    {email:"KENNY@brexconsulting.com"},{campaignId:0},{sentEvent:{...binding.sentEvent,created:now+1}}])
    assert.equal(planBoundSnapshotEvents({...binding,...change},fixture(),now).status,"hold");
});
test("same recipient or timestamp cannot bind an unrelated provider message",()=>{
  for(const change of [{id:"00000000-0000-4000-8000-000000000000"},{created:1791075281989}]){
    const page=fixture();page.events[0].sentBy={...binding.sentEvent,...change};
    assert.equal(planBoundSnapshotEvents(binding,page,now).status,"hold");
  }
  const page=fixture();page.events[1].id="00000000-0000-4000-8000-000000000000";
  assert.equal(planBoundSnapshotEvents(binding,page,now).status,"hold");
});
test("wrong portal, campaign, recipient, and invalid event times fail closed",()=>{
  for(const change of [{portalId:1},{emailCampaignId:1},{recipient:"other@example.invalid"},
    {created:now+1},{created:binding.sentEvent.created-1},{id:""}, {type:null}]){
    const page=fixture();Object.assign(page.events[0],change);
    assert.equal(planBoundSnapshotEvents(binding,page,now).status,"hold");
  }
});
test("duplicate provider event is idempotent, contradictory identity is held",()=>{
  const page=fixture();page.events.push({...page.events[0]});
  assert.equal(planBoundSnapshotEvents(binding,page,now).events.length,2);
  page.events[2].type="BOUNCE";
  assert.equal(planBoundSnapshotEvents(binding,page,now).status,"hold");
});
test("CLICK and PROCESSED cannot prove send or delivery",()=>{
  const page=fixture();page.events=page.events.map(e=>({...e,type:"CLICK"}));
  assert.equal(planBoundSnapshotEvents(binding,page,now).status,"hold");
  const sentOnly=fixture();sentOnly.events[0].type="PROCESSED";
  assert.deepEqual(planBoundSnapshotEvents(binding,sentOnly,now).events.map(e=>e.eventType),["SENT"]);
});
test("correlated failure is recorded but conflicting terminal events require review",()=>{
  for(const type of ["BOUNCE","DROPPED"]){
    const page=fixture();page.events[0].type=type;
    assert.deepEqual(planBoundSnapshotEvents(binding,page,now).events.map(e=>e.eventType),["SENT",type]);
    page.events.push({...page.events[0],type:"DELIVERED",id:"00000000-0000-4000-8000-000000000001"});
    assert.equal(planBoundSnapshotEvents(binding,page,now).status,"hold");
  }
});
