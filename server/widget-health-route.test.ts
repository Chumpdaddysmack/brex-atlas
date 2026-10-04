import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { registerSnapshotRoutes } from "./widget-snapshot";
import { HEALTH_QUESTIONS, HEALTH_VERSION } from "../shared/widget-health";

test("research route validates, computes, persists, and reloads immutable assessment without CRM writes",async()=>{
  const rows:any[]=[];let researched=0;
  const db:any=()=>({from(table:string){
    assert.equal(table,"widget_snapshots");
    let filter:any,payload:any;
    const c:any={insert(p:any){payload=p;return c;},select(){return c;},eq(_k:string,v:any){filter=v;return c;},maybeSingle(){return c;},
      then(resolve:any){if(payload)rows.push({id:"fixture",...payload});resolve({error:null,data:rows.find(x=>x.token_hash===filter)||null});}};
    return c;
  }});
  const app=express();app.use(express.json());
  registerSnapshotRoutes(app,{db,sync:async()=>{throw new Error("No CRM action authorized");},
    research:async input=>{researched++;return {kind:"company-positioning-v1",companyName:input.companyName,companyUrl:input.url,
      researchedAt:new Date().toISOString(),introduction:[],finding:{text:"Synthetic route fixture",sources:[]},
      interpretation:"Fixture only",question:"Fixture only",limitations:[]};}});
  const server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));
  const base=`http://127.0.0.1:${(server.address() as any).port}/api/widget/snapshot`;
  const post=(path:string,data:any)=>fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
  try{
    const config=await (await fetch(base+"/config")).json();assert.equal(config.healthRubric.version,HEALTH_VERSION);
    const input={companyName:"Fixture",url:"https://brexconsulting.com",companyConfirmed:true};
    assert.equal((await post("",{...input,assessment:{score:99}})).status,400);
    assert.equal(researched,0,"Validate before spending on research");
    const created=await (await post("",{...input,assessment:{health:Object.fromEntries(HEALTH_QUESTIONS.map(q=>[q.key,"1"]))}})).json();
    assert.equal(created.snapshot.assessment.health.score,33);
    assert.equal(rows[0].snapshot.assessment.health.score,33);
    const viewed=await (await post("/view",{token:created.token,assessment:{score:99}})).json();
    assert.deepEqual(viewed.snapshot.assessment,created.snapshot.assessment);
    const legacy=await (await post("",input)).json();assert.equal(legacy.snapshot.assessment,undefined);
    rows[0].expires_at=new Date(0).toISOString();assert.equal((await post("/view",{token:created.token})).status,410);
  }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
