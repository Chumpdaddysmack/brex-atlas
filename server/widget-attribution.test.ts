import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { WIDGET_ATTRIBUTION, widgetAttributionProperties } from "../shared/widget-attribution";

test("hidden defaults match the server and first-touch attribution is preserved",()=>{
  for(const value of [undefined,null,"","   "]) assert.deepEqual(widgetAttributionProperties(value),WIDGET_ATTRIBUTION);
  for(const value of ["Referral","Meta Ads","Website","Legacy import"]) {
    assert.deepEqual(widgetAttributionProperties(value),{lead_source_tag:"Atlas Excavator Widget"});
  }
  const html=readFileSync(new URL("../client/public/widget.html",import.meta.url),"utf8");
  for(const [name,value] of Object.entries(WIDGET_ATTRIBUTION)){
    assert.ok(html.includes(`name="${name}" value="${value}"`));
  }
});

test("CRM sync stamps widget attribution on create/update without overwriting original source",async(t)=>{
  const originalFetch=globalThis.fetch;
  const originalToken=process.env.HUBSPOT_ACCESS_TOKEN;
  process.env.HUBSPOT_ACCESS_TOKEN="test-placeholder-not-a-real-token";
  const {syncAtlasLeadToHubSpot}=await import("./hubspot");
  const input:any={diagnosticId:"qa-attribution",overallScore:30,fitTier:"not-a-fit",verdict:"critical",
    url:"https://example.invalid",industry:"Test",revenueBand:"Under $1M",primaryGoal:"Test",
    email:"qa@example.invalid",runAt:new Date("2026-09-28T00:00:00Z"),
    // Forged browser values must never override the server's canonical values.
    lead_source_tag:"forged",original_lead_source:"forged"};
  try{
    for(const scenario of [
      {name:"new",exists:false,source:null,expectSource:true},
      {name:"existing blank",exists:true,source:"",expectSource:true},
      {name:"existing null",exists:true,source:null,expectSource:true},
      {name:"existing referral",exists:true,source:"Referral",expectSource:false},
      {name:"existing paid source",exists:true,source:"Google Ads",expectSource:false},
      {name:"lookup fails",exists:false,source:null,searchFailure:true},
      {name:"source read fails",exists:true,source:null,readFailure:true},
    ]){
      await t.test(scenario.name,async()=>{
        const writes:any[]=[];let sourceRead=false;
        const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{"Content-Type":"application/json"}});
        globalThis.fetch=(async(url:any,init:any)=>{
          const u=new URL(String(url));assert.equal(u.hostname,"api.hubapi.com");
          if(u.pathname.endsWith("/search"))return scenario.searchFailure?json({message:"unavailable"},503):json({results:scenario.exists?[{id:"test-contact"}]:[]});
          if(init.method==="GET"){
            assert.equal(u.searchParams.get("properties"),"original_lead_source");sourceRead=true;
            return scenario.readFailure?json({message:"unavailable"},503):json({properties:{original_lead_source:scenario.source}});
          }
          assert.equal(u.pathname.startsWith("/crm/v3/objects/contacts"),true);
          if(scenario.exists)assert.ok(sourceRead,"Read first-touch source before updating");
          writes.push({method:init.method,...JSON.parse(init.body)});
          return json({id:"test-contact"},init.method==="POST"?201:200);
        }) as typeof fetch;
        const result=await syncAtlasLeadToHubSpot(input);
        if(scenario.searchFailure||scenario.readFailure){
          assert.equal(result.status,"failed");assert.equal(writes.length,0);return;
        }
        assert.equal(result.status,"synced");assert.equal(writes.length,1);
        assert.equal(writes[0].method,scenario.exists?"PATCH":"POST");
        assert.equal(writes[0].properties.lead_source_tag,"Atlas Excavator Widget");
        assert.equal("original_lead_source" in writes[0].properties,scenario.expectSource);
        if(scenario.expectSource)assert.equal(writes[0].properties.original_lead_source,"Website");
        assert.equal("hs_analytics_source" in writes[0].properties,false,"Do not change HubSpot's automatic traffic source");
      });
    }
  }finally{
    globalThis.fetch=originalFetch;
    if(originalToken===undefined)delete process.env.HUBSPOT_ACCESS_TOKEN;else process.env.HUBSPOT_ACCESS_TOKEN=originalToken;
  }
});
