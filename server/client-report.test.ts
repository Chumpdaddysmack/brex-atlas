import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import express from "express";
import { once } from "node:events";
import { SqliteClientReportStore } from "./client-report-store";
import { buildClientSnapshot, hashAccessCode, validAccessCode, isShareActive, registerClientReportRoutes, tokenHash } from "./client-report";
import { ready } from "../shared/tier-assessment.test";
import { assessTier } from "../shared/tier-assessment";
import type { Analysis } from "../shared/schema";

const analysis=():Analysis=>({id:"fixture",clientName:"QA Example",clientUrl:"https://example.com",status:"done",progress:100,createdAt:1,
  notes:"PRIVATE INTAKE",assumptions:JSON.stringify({private:"PRIVATE ECONOMICS"}),
  extraction:JSON.stringify({title:"QA",description:"Example",positioningStatement:"Verified positioning",valueProps:["Reliable"],offerings:["Service"],targetAudience:"Buyers",evidenceElements:[],ctaAudit:"Contact",seoNotes:"Notes",aeoReadinessScore:50,aeoReadinessNotes:"Caveat",internalNotes:"PRIVATE NESTED"}),
  competitors:"[]",strategy:null,sow:JSON.stringify({engagementSummary:"PRIVATE SOW",priceTiers:[{monthly:"$999999"}]}),
  swot:null,pestel:null,porters:null,customerInsights:null} as Analysis);
test("snapshots exclude operational data, drafts, and ROI assumptions; demo stays bounded",()=>{
  const a=analysis(),p:any={planJson:JSON.stringify({summary:"Client-facing plan",roiProjections:{private:"PRIVATE ROI"},reviewNotes:"PRIVATE REVIEW"})};
  const full=buildClientSnapshot(a,p,"full",null),demo=buildClientSnapshot(a,p,"demo",null);
  assert.doesNotMatch(JSON.stringify(full),/PRIVATE|999999/);assert.doesNotMatch(JSON.stringify(demo),/PRIVATE|999999/);
  assert.equal((demo.report as any).id,"");assert.equal((full.report as any).content.summary,"Client-facing plan");
  a.clientName="Changed";assert.equal(full.report.clientName,"QA Example");
});
test("only approved recommendation evidence enters a full snapshot, never a demo",()=>{
  const input=ready(),record={input,decision:assessTier(input),approvedAt:null,updatedAt:"today"};
  assert.equal(buildClientSnapshot(analysis(),null,"full",record).recommendation,null);
  const approved={...record,approvedAt:"2026-09-25"};
  assert.equal(buildClientSnapshot(analysis(),null,"full",approved).recommendation?.decision.tier,"advisor");
  assert.equal(buildClientSnapshot(analysis(),null,"demo",approved).recommendation,null);
});
test("code hashing uses unique salts and expiration is fail-closed at the boundary",()=>{
  const a=hashAccessCode("secret-test-code"),b=hashAccessCode("secret-test-code");
  assert.notEqual(a,b);assert.ok(validAccessCode("secret-test-code",a));assert.ok(!validAccessCode("wrong-code",a));
  assert.ok(!a.includes("secret-test-code"));
  assert.equal(isShareActive({expiresAt:100,revokedAt:null} as any,99),true);
  assert.equal(isShareActive({expiresAt:100,revokedAt:null} as any,100),false);
  assert.equal(isShareActive({expiresAt:100,revokedAt:50} as any,60),false);
});
test("real HTTP lifecycle: admin approval, preview integrity, protected link, extension, revocation",async()=>{
  const db=new Database(":memory:"),shares=new SqliteClientReportStore(db),a=analysis();
  const app=express();app.use(express.json());app.use((req:any,_res,next)=>{req.session={isAuthenticated:req.get("x-test-admin")==="yes"};next();});
  registerClientReportRoutes(app,{storage:{getAnalysis:async(id:string)=>id==="fixture"?a:undefined,getContentPlanByAnalysis:async()=>undefined} as any,shares:()=>shares});
  app.use("/api",(_req,res)=>res.status(401).json({error:"Not authenticated"}));
  const server=app.listen(0,"127.0.0.1");await once(server,"listening");const base=`http://127.0.0.1:${(server.address() as any).port}`;
  async function request(path:string,method="GET",body?:any,admin=false) {return fetch(base+path,{method,headers:{"Content-Type":"application/json",...(admin?{"x-test-admin":"yes"}:{})},...(body?{body:JSON.stringify(body)}:{})});}
  try {
    assert.equal((await request("/api/analyses/fixture/report-shares")).status,401);
    assert.equal((await request("/api/analyses/fixture/tier-assessment","PUT",{input:{facts:{},growthGoal:"",scopeNotes:""},approve:true},true)).status,409);
    assert.equal((await request("/api/analyses/fixture/tier-assessment","PUT",{input:ready(),approve:true},true)).status,200);
    const preview=await (await request("/api/analyses/fixture/client-report-preview", "GET",undefined,true)).json();
    const payload={mode:"full",reviewed:true,previewHash:preview.previewHash,accessCode:"secret-test-code"};
    assert.equal((await request("/api/analyses/fixture/report-shares","POST",payload)).status,401);
    assert.equal((await request("/api/analyses/fixture/report-shares","POST",{...payload,reviewed:false},true)).status,400);
    a.clientName="Changed after preview";
    assert.equal((await request("/api/analyses/fixture/report-shares","POST",payload,true)).status,409);a.clientName="QA Example";
    const publishedResponse=await request("/api/analyses/fixture/report-shares","POST",payload,true);assert.equal(publishedResponse.status,201);
    const published=await publishedResponse.json(),token=published.path.split("#")[1];
    assert.equal(published.expiresAt-published.createdAt,10*86_400_000);
    const saved=await shares.get(published.id);assert.equal(saved?.tokenHash,tokenHash(token));assert.notEqual(saved?.tokenHash,token);
    assert.equal((await request("/api/client-report/access","POST",{token})).status,403);
    assert.equal((await request("/api/client-report/access","POST",{token,accessCode:"wrong"})).status,403);
    let response=await request("/api/client-report/access","POST",{token,accessCode:"secret-test-code"});
    assert.equal(response.status,200);assert.match(response.headers.get("cache-control")!,/no-store/);
    const data=await response.json();assert.equal(data.snapshot.recommendation.decision.tier,"advisor");
    a.clientName="New live name";await shares.saveAssessment("fixture",{input:ready(),decision:assessTier(ready()),approvedAt:null,updatedAt:"later"});
    response=await request("/api/client-report/access","POST",{token,accessCode:"secret-test-code"});
    assert.equal((await response.json()).snapshot.report.clientName,"QA Example");
    assert.equal((await request("/api/analyses/fixture","GET")).status,401);
    await shares.update(published.id,{expiresAt:Date.now()-1});
    assert.equal((await request("/api/client-report/access","POST",{token,accessCode:"secret-test-code"})).status,410);
    assert.equal((await request(`/api/analyses/fixture/report-shares/${published.id}`,"PATCH",{action:"extend"},true)).status,200);
    assert.equal((await request("/api/client-report/access","POST",{token,accessCode:"secret-test-code"})).status,200);
    assert.equal((await request(`/api/analyses/other/report-shares/${published.id}`,"PATCH",{action:"revoke"},true)).status,404);
    assert.equal((await request(`/api/analyses/fixture/report-shares/${published.id}`,"PATCH",{action:"revoke"},true)).status,200);
    assert.equal((await request("/api/client-report/access","POST",{token,accessCode:"secret-test-code"})).status,410);
    assert.equal((await request(`/api/analyses/fixture/report-shares/${published.id}`,"PATCH",{action:"extend"},true)).status,409);
    const history=await (await request("/api/analyses/fixture/report-shares","GET",undefined,true)).json();
    assert.doesNotMatch(JSON.stringify(history),/tokenHash|codeHash|snapshot|secret-test-code/);
  } finally {server.close();db.close();}
});
