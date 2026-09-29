import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { publicCompanyUrl, normalizeSnapshot, researchSnapshot } from "./widget-snapshot-research";
import { registerSnapshotRoutes, isSnapshotExpired } from "./widget-snapshot";
import { WIDGET_MARKETING_CONSENT } from "../shared/widget-consent";
import { publicIpv4, evidenceText } from "./snapshot-page-evidence";

const citations=[{title:"Acme services",url:"https://acme-corp.com/services"}];
const raw={entityConfirmed:true,companyName:"Acme Corp",introduction:[
  {text:"Acme Corp provides specialist manufacturing services.",sourceIndexes:[0]},
  {text:"Its public website describes a focus on industrial buyers.",sourceIndexes:[0]}],
  finding:{text:"The services page emphasizes specialist manufacturing capabilities.",sourceIndexes:[0]},
  interpretation:"This emphasis may help buyers understand the company's area of specialization.",
  question:"Which capability matters most to the buyers you want to reach?",limitations:["Revenue and employee count were not verified."]};
const snapshot=normalizeSnapshot(raw,citations,"https://acme-corp.com/");
const readPage=async(url:string)=>({url,title:"Acme services",text:"Actual fetched page evidence about Acme Corp."});
test("page evidence blocks private IPv4 networks and removes executable markup",()=>{
  for(const ip of ["127.0.0.1","10.0.0.1","169.254.169.254","172.16.1.1","192.168.1.1","100.64.1.1","0.0.0.0","224.0.0.1","::1"])assert.equal(publicIpv4(ip),false);
  assert.equal(publicIpv4("8.8.8.8"),true);
  assert.equal(evidenceText("<script>bad()</script><p>Acme &amp; Co &#8482;</p>"),"Acme & Co ™");
});
test("public URL validation strips paths and rejects credentials, IPs and private names",()=>{
  assert.equal(publicCompanyUrl("acme-corp.com/private?token=secret"),"https://acme-corp.com/");
  for(const value of ["http://127.0.0.1","http://2130706433","https://[::1]","http://10.0.0.1","http://localhost","file:///etc/passwd","https://user:pass@acme-corp.com","https://acme-corp.com:444","https://host.internal","https://foo.invalid"])assert.equal(publicCompanyUrl(value),null,value);
});
test("facts require valid references and official-site evidence",()=>{
  assert.equal(snapshot.kind,"company-positioning-v1");
  assert.throws(()=>normalizeSnapshot({...raw,entityConfirmed:false},citations,snapshot.companyUrl));
  assert.throws(()=>normalizeSnapshot({...raw,finding:{...raw.finding,sourceIndexes:[99]}},citations,snapshot.companyUrl));
  assert.throws(()=>normalizeSnapshot(raw,[{title:"Wrong company",url:"https://other-company.com"}],snapshot.companyUrl));
  assert.throws(()=>normalizeSnapshot(raw,[{title:"Unsafe",url:"javascript:alert(1)"}],snapshot.companyUrl));
  assert.equal("overallScore" in snapshot,false);
});
test("missing research or rejected evidence audit never falls back to model memory",async()=>{
  await assert.rejects(researchSnapshot({companyName:"Acme",url:snapshot.companyUrl},{
    research:async()=>null,structure:async()=>{throw new Error("Must not structure without web sources");}
  }));
  let calls=0;
  await assert.rejects(researchSnapshot({companyName:"Acme",url:snapshot.companyUrl},{
    research:async()=>({answer:"Source-cited research",citations}),
    readPage,
    structure:async()=>++calls===1?raw:{supported:false},
  }),/EVIDENCE_AUDIT_FAILED/);
});
test("generation schema includes limits and one formatting repair keeps the same evidence",async()=>{
  let calls=0;
  const actual=await researchSnapshot({companyName:"Acme",url:snapshot.companyUrl},{
    research:async()=>({answer:"Source-cited research",citations}),
    readPage,
    structure:async(system,user,tokens,schema:any)=>{
      calls++;
      if(calls<=2){
        assert.equal(schema.properties.introduction.maxItems,4);
        assert.equal(schema.properties.finding.properties.sourceIndexes.maxItems,3);
        assert.ok(user.includes("Actual fetched page evidence"));
        assert.equal(user.includes("Source-cited research"),false);
      }
      if(calls===1)return {...raw,introduction:[]};
      if(calls===2){assert.ok(user.includes("formatRepair"));return raw;}
      return {supported:true};
    },
  });
  assert.equal(actual.companyName,"Acme Corp");assert.equal(calls,3);
});
test("unreadable official pages never fall back to search-generated prose",async()=>{
  await assert.rejects(researchSnapshot({companyName:"Acme",url:snapshot.companyUrl},{
    research:async()=>({answer:"Unverified search claims",citations}),
    readPage:async()=>null,
    structure:async()=>{throw new Error("Must not run");},
  }),/OFFICIAL_EVIDENCE_MISSING/);
});
test("ten-day expiry is enforced at the boundary and fails closed on invalid dates",()=>{
  assert.equal(isSnapshotExpired("2026-10-08T00:00:00Z",Date.parse("2026-10-07T23:59:59Z")),false);
  assert.equal(isSnapshotExpired("2026-10-08T00:00:00Z",Date.parse("2026-10-08T00:00:00Z")),true);
  assert.equal(isSnapshotExpired("invalid"),true);
});
test("snapshot routes preserve evidence, privacy, idempotency and failure safety",async()=>{
  const tables:Record<string,any[]>={widget_snapshots:[],widget_snapshot_requests:[]};
  let syncCount=0,failReceipt=false,researchError:Error|null=null;
  function db():any{return {from(table:string){
    assert.ok(table in tables,"Never query private report or analysis tables");
    let filters:Record<string,any>={},op="read",payload:any;
    const chain:any={
      select(){return chain;},eq(k:string,v:any){filters[k]=v;return chain;},
      insert(p:any){op="insert";payload=p;return chain;},
      upsert(p:any){op="upsert";payload=p;return chain;},
      update(p:any){op="update";payload=p;return chain;},
      single(){return chain;},maybeSingle(){return chain;},
      then(resolve:any,reject:any){try{
        if(failReceipt&&table==="widget_snapshot_requests")return resolve({error:{message:"offline"}});
        let found=tables[table].find(r=>Object.entries(filters).every(([k,v])=>r[k]===v));
        if(op==="insert"){tables[table].push({id:"snapshot-1",...payload});found=tables[table].at(-1);}
        if(op==="upsert"){
          found=tables[table].find(r=>r.snapshot_id===payload.snapshot_id&&r.email===payload.email);
          if(!found){found={id:"request-1",requested_at:new Date().toISOString(),sync_status:"pending",...payload};tables[table].push(found);}
        }
        if(op==="update"&&found)Object.assign(found,payload);
        resolve({data:found||null,error:null});
      }catch(e){reject(e);}}
    };return chain;
  }};}
  const app=express();app.use(express.json());
  registerSnapshotRoutes(app,{db,research:async()=>{if(researchError)throw researchError;return snapshot;},sync:async input=>{
    assert.equal(input.company,"Acme Corp");assert.ok(tables.widget_snapshot_requests.length,"Receipt before CRM");
    assert.equal("overallScore" in input,false);syncCount++;return {status:"synced",contactId:"test",dealId:null};
  }});
  const server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));
  const base=`http://127.0.0.1:${(server.address() as any).port}/api/widget/snapshot`;
  const post=(path:string,body:any)=>fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  try{
    assert.equal((await post("",{url:snapshot.companyUrl,companyName:"Acme"})).status,400);
    const created=await post("",{url:snapshot.companyUrl,companyName:"Acme",companyConfirmed:true});
    assert.equal(created.status,200);
    const data=await created.json();assert.match(data.token,/^[a-f0-9]{64}$/);
    assert.equal("token" in tables.widget_snapshots[0],false);assert.notEqual(tables.widget_snapshots[0].token_hash,data.token);
    const view=await (await post("/view",{token:data.token})).json();
    assert.equal(view.snapshot.companyName,"Acme Corp");assert.equal("email" in view,false);
    const lead={token:data.token,email:"qa@example.invalid",marketingConsent:false,marketingConsentVersion:WIDGET_MARKETING_CONSENT.version};
    assert.equal((await post("/lead",{...lead,marketingConsent:"yes"})).status,400);
    failReceipt=true;assert.equal((await post("/lead",lead)).status,503);assert.equal(syncCount,0);
    failReceipt=false;
    assert.equal((await post("/lead",lead)).status,200);assert.equal(syncCount,1);
    assert.equal(tables.widget_snapshot_requests[0].consent_evidence.decision,"not_selected");
    assert.equal((await post("/lead",lead)).status,200);assert.equal(syncCount,1);
    assert.equal((await post("/view",{token:"not-a-token"})).status,404);
    tables.widget_snapshots[0].expires_at="2020-01-01T00:00:00Z";
    assert.equal((await post("/view",{token:data.token})).status,410);
    assert.equal((await post("/lead",lead)).status,410);assert.equal(syncCount,1);
    researchError=new Error("Internal details must not be exposed");
    const failed=await (await post("",{url:snapshot.companyUrl,companyName:"Acme",companyConfirmed:true})).json();
    assert.equal(failed.code,"SNAPSHOT_UNAVAILABLE");
    assert.equal(JSON.stringify(failed).includes("Internal details"),false);
  }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
