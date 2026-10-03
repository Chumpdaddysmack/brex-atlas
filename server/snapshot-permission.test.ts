import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import express from "express";
import {
  SNAPSHOT_EMAIL_PERMISSION, parseSnapshotEmailPermission, snapshotPermissionProperties,
} from "../shared/snapshot-delivery";
import { WIDGET_MARKETING_CONSENT } from "../shared/widget-consent";

const consentBody = {
  snapshotEmailConsent: true,
  snapshotEmailConsentVersion: SNAPSHOT_EMAIL_PERMISSION.version,
};
const tracking = () => ({
  requestId: "receipt-123",
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
  permission: parseSnapshotEmailPermission(consentBody),
  marketingChoice: "not_selected" as const,
});

test("snapshot permission is explicit, versioned and separate from marketing consent", () => {
  for (const body of [{}, {...consentBody, snapshotEmailConsent:false},
    {...consentBody, snapshotEmailConsent:"true"},
    {...consentBody, snapshotEmailConsentVersion:"stale"},
    {marketingConsent:true}]) {
    assert.throws(() => parseSnapshotEmailPermission(body));
  }
  const evidence = parseSnapshotEmailPermission({...consentBody, marketingConsent:false});
  assert.equal(evidence.decision, "accepted");
  assert.equal(evidence.subscriptionTypeId, "3750294688");
  assert.notEqual(evidence.subscriptionTypeId, WIDGET_MARKETING_CONSENT.subscriptionTypeId);
});

test("six properties map to pending evidence, never an opt-in or delivery claim", () => {
  const input = tracking();
  const props = snapshotPermissionProperties(input);
  assert.equal(Object.keys(props).length, 6);
  assert.equal(props.atlas_snapshot_request_id, input.requestId);
  assert.equal(props.atlas_snapshot_email_permission, "true");
  assert.equal(props.atlas_optional_marketing_choice, "not_selected");
  assert.equal(props.atlas_snapshot_delivery_state, "pending");
  assert.equal(props.atlas_snapshot_expires_at, String(Date.parse(input.expiresAt)));
  assert.equal("hs_marketable_status" in props, false);
  for (const expiresAt of ["bad", "2020-01-01T00:00:00Z"]) {
    assert.throws(() => snapshotPermissionProperties({...input, expiresAt}));
  }
  assert.throws(() => snapshotPermissionProperties({...input, requestId:""}));
  assert.throws(() => snapshotPermissionProperties({...input,
    permission:{...input.permission, subscriptionTypeId:WIDGET_MARKETING_CONSENT.subscriptionTypeId}}));
});

test("CRM mapping is side-effect bounded and same-request retries preserve delivery state", async () => {
  const oldToken = process.env.HUBSPOT_ACCESS_TOKEN;
  process.env.HUBSPOT_ACCESS_TOKEN = "local-test-not-a-real-token";
  const {syncSnapshotToHubSpot} = await import("./hubspot");
  const originalFetch = globalThis.fetch;
  let calls:{url:string;method:string;body:any}[] = [];
  let existing=false, failSearch=false;
  const input = {
    email:"test@example.invalid",company:"QA Company",url:"https://example.com/",
    snapshotId:"snapshot-123",snapshotUrl:"https://atlas.brexconsulting.com/widget.html#snapshot="+"a".repeat(64),
    requestedAt:new Date().toISOString(),permissionTracking:tracking(),
  };
  globalThis.fetch = (async (url:any, opts:any) => {
    const request={url:String(url),method:opts.method,body:opts.body?JSON.parse(opts.body):null};
    calls.push(request);
    if(request.url.endsWith("/search")) {
      return new Response(JSON.stringify({results:existing?[{id:"contact-123"}]:[]}), {status:failSearch?503:200});
    }
    if(request.method==="GET") {
      return new Response(JSON.stringify({properties:{
        atlas_snapshot_id:input.snapshotId,atlas_snapshot_url:input.snapshotUrl,
        atlas_snapshot_request_id:input.permissionTracking.requestId,
        atlas_snapshot_delivery_state:"delivered",original_lead_source:"Referral",
      }}));
    }
    return new Response(JSON.stringify({id:"contact-123"}));
  }) as typeof fetch;
  try {
    assert.equal((await syncSnapshotToHubSpot(input)).status,"synced");
    const write=calls.find(x=>x.url.endsWith("/contacts"))!;
    assert.equal(write.body.properties.atlas_snapshot_request_id,"receipt-123");
    assert.equal(write.body.properties.atlas_optional_marketing_choice,"not_selected");
    assert.equal(write.body.properties.atlas_snapshot_delivery_state,"pending");
    assert.equal(write.body.properties.hs_marketable_status,undefined);
    assert.equal(calls.some(x=>/communication-preferences|enrollments|email\//.test(x.url)),false);
    existing=true;calls=[];
    assert.equal((await syncSnapshotToHubSpot(input)).status,"synced");
    assert.equal(calls.some(x=>x.method==="PATCH"),false);
    calls=[];failSearch=true;
    assert.equal((await syncSnapshotToHubSpot(input)).status,"failed");
    assert.equal(calls.length,1);
    calls=[];
    assert.equal((await syncSnapshotToHubSpot({...input,permissionTracking:{...tracking(),expiresAt:"bad"}})).status,"failed");
    assert.equal(calls.length,0);
  } finally {
    globalThis.fetch=originalFetch;
    if(oldToken===undefined)delete process.env.HUBSPOT_ACCESS_TOKEN;else process.env.HUBSPOT_ACCESS_TOKEN=oldToken;
  }
});

test("tracking route stores both choices before sync and preserves the original receipt", async () => {
  const oldFlag=process.env.SNAPSHOT_PERMISSION_TRACKING_ENABLED;
  process.env.SNAPSHOT_PERMISSION_TRACKING_ENABLED="true";
  const {registerSnapshotRoutes}=await import("./widget-snapshot");
  const token="b".repeat(64), rows:any[]=[];
  const snapshotRow={id:"snapshot-123",token_hash:createHash("sha256").update(token).digest("hex"),
    expires_at:new Date(Date.now()+86400000).toISOString(),company_url:"https://example.com/",
    snapshot:{companyName:"QA Company"}};
  let syncs:any[]=[];
  const db=()=>({from(table:string){
    const filters:Record<string,unknown>={};let operation="read",payload:any;
    const chain:any={
      select(){return chain;},eq(k:string,v:any){filters[k]=v;return chain;},
      maybeSingle(){return chain;},single(){return chain;},
      upsert(p:any){operation="upsert";payload=p;return chain;},
      update(p:any){operation="update";payload=p;return chain;},
      then(resolve:any){
        if(table==="widget_snapshots")return resolve({data:filters.token_hash===snapshotRow.token_hash?snapshotRow:null,error:null});
        assert.equal(table,"widget_snapshot_requests");
        if(operation==="upsert"&&!rows.some(x=>x.email===payload.email&&x.snapshot_id===payload.snapshot_id)){
          rows.push({id:"receipt-"+rows.length,requested_at:new Date().toISOString(),sync_status:"pending",...payload});
        }
        const found=rows.find(x=>Object.entries(filters).every(([k,v])=>x[k]===v));
        if(operation==="update"&&found)Object.assign(found,payload);
        resolve({data:found||null,error:null});
      },
    };return chain;
  }});
  const app=express();app.use(express.json());
  registerSnapshotRoutes(app,{db:db as any,research:async()=>{throw new Error("Research must not run");},
    sync:async input=>{
      assert.ok(rows[0].consent_evidence.snapshotDelivery,"Evidence exists before CRM");
      syncs.push(input);return {status:"synced",contactId:"contact-123",dealId:null};
    }});
  const server=app.listen(0,"127.0.0.1");
  await new Promise<void>(r=>server.once("listening",r));
  const base=`http://127.0.0.1:${(server.address() as any).port}/api/widget/snapshot`;
  const post=(data:any)=>fetch(base+"/lead",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
  const body={token,email:"route@example.invalid",marketingConsent:false,
    marketingConsentVersion:WIDGET_MARKETING_CONSENT.version,...consentBody};
  try {
    const config=await (await fetch(base+"/config")).json();
    assert.equal(config.snapshotEmailConsent.version,SNAPSHOT_EMAIL_PERMISSION.version);
    assert.equal(config.emailDeliveryReady,false);
    assert.equal((await post({...body,snapshotEmailConsent:undefined})).status,400);
    assert.equal(rows.length,0);
    const response=await post(body);assert.equal(response.status,200);
    assert.match((await response.json()).message,/does not mean an email has been sent/);
    assert.equal(syncs.length,1);
    assert.equal(syncs[0].permissionTracking.requestId,"receipt-0");
    assert.equal(syncs[0].permissionTracking.marketingChoice,"not_selected");
    assert.equal(syncs[0].permissionTracking.expiresAt,snapshotRow.expires_at);
    assert.equal((await post({...body,marketingConsent:true})).status,200);
    assert.equal(syncs.length,1);
    assert.equal(rows[0].consent_evidence.decision,"not_selected");
    // An older receipt cannot be upgraded to new consent by an HTTP retry.
    delete rows[0].consent_evidence.snapshotDelivery;
    assert.equal((await post(body)).status,409);
    assert.equal(syncs.length,1);
  } finally {
    await new Promise<void>(r=>server.close(()=>r()));
    if(oldFlag===undefined)delete process.env.SNAPSHOT_PERMISSION_TRACKING_ENABLED;
    else process.env.SNAPSHOT_PERMISSION_TRACKING_ENABLED=oldFlag;
  }
});
