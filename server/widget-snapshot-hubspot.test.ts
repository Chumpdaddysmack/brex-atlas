import test from "node:test";
import assert from "node:assert/strict";

test("snapshot CRM sync preserves original source, avoids old workflow triggers, creates no deals and retries safely",async()=>{
  process.env.HUBSPOT_ACCESS_TOKEN="test-placeholder-not-a-real-token";
  const original=globalThis.fetch;
  const {syncSnapshotToHubSpot}=await import("./hubspot");
  const input={email:"qa@example.invalid",company:"QA Company",url:"https://qa-company.com/",
    snapshotId:"snapshot-1",snapshotUrl:"https://atlas.brexconsulting.com/widget.html#snapshot="+"a".repeat(64),
    requestedAt:"2026-09-28T20:00:00Z"};
  try{
    for(const scenario of [
      {exists:false,source:null,retry:false},
      {exists:true,source:"",retry:false},
      {exists:true,source:"Referral",retry:false},
      {exists:true,source:"Website",retry:true},
    ]){
      const writes:any[]=[];
      globalThis.fetch=(async(url:any,init:any)=>{
        const u=new URL(String(url));
        assert.equal(u.hostname,"api.hubapi.com");
        assert.ok(u.pathname.startsWith("/crm/v3/objects/contacts"),"No deals, subscriptions or emails written");
        let data:any={id:"contact-1"};
        if(u.pathname.endsWith("/search"))data={results:scenario.exists?[{id:"contact-1"}]:[]};
        else if(init.method==="GET")data={properties:{original_lead_source:scenario.source,
          company:"Existing company",website:"https://existing-company.com/",
          ...(scenario.retry?{atlas_snapshot_id:input.snapshotId,atlas_snapshot_url:input.snapshotUrl}:{})}};
        else writes.push(JSON.parse(init.body).properties);
        return new Response(JSON.stringify(data),{status:200,headers:{"Content-Type":"application/json"}});
      }) as typeof fetch;
      const result=await syncSnapshotToHubSpot(input);
      assert.equal(result.status,"synced");assert.equal(result.dealId,null);
      assert.equal(writes.length,scenario.retry?0:1);
      if(writes.length){
        const props=writes[0];
        assert.equal(props.lead_source_tag,"Atlas Excavator Widget");
        assert.equal(props.original_lead_source,scenario.source?undefined:"Website");
        assert.equal(props.atlas_snapshot_id,"snapshot-1");
        for(const forbidden of ["atlas_fit_score","atlas_fit_tier","atlas_diagnostic_id","atlas_run_at",
          "atlas_verdict","hs_lead_status","lifecyclestage","hs_analytics_source"])assert.equal(forbidden in props,false);
        if(scenario.exists){assert.equal("company" in props,false);assert.equal("website" in props,false);}
      }
    }
  }finally{globalThis.fetch=original;delete process.env.HUBSPOT_ACCESS_TOKEN;}
});
