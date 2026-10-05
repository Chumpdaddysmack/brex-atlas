import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { leadCaptureSchema, LEAD_CAPTURE_NOTICE, WIDGET_REVENUE_RANGES } from "../shared/widget-lead-capture";
import { registerSnapshotRoutes } from "./widget-snapshot";
const capture={firstName:"Ari",lastName:"O'Connor",email:"ari@business-corp.com",revenueBand:"500k1m",noticeVersion:LEAD_CAPTURE_NOTICE.version};
test("exactly five approved ranges; names and company email required",()=>{
  assert.equal(WIDGET_REVENUE_RANGES.length,5);
  for(const [revenueBand] of WIDGET_REVENUE_RANGES)
    assert.equal(leadCaptureSchema.safeParse({...capture,revenueBand}).success,true);
  for(const key of Object.keys(capture))
    assert.equal(leadCaptureSchema.safeParse({...capture,[key]:""}).success,false,key);
  for(const email of ["not-an-email","a@gmail.com","a@OUTLOOK.COM"])
    assert.equal(leadCaptureSchema.safeParse({...capture,email}).success,false);
  assert.equal(leadCaptureSchema.parse({...capture,email:" ARI@PARENT-COMPANY.COM "}).email,"ari@parent-company.com");
  assert.equal(leadCaptureSchema.safeParse({...capture,firstName:"李",lastName:"王"}).success,true);
  for(const firstName of ["  ","<script>","A\nB","1".repeat(5)])
    assert.equal(leadCaptureSchema.safeParse({...capture,firstName}).success,false);
  for(const revenueBand of ["unknown","under1m","5m25m","25mplus"])
    assert.equal(leadCaptureSchema.safeParse({...capture,revenueBand}).success,false);
});
test("capture gate persists privately before results without requiring or creating an email request",async()=>{
  process.env.SNAPSHOT_REQUIRED_LEAD_CAPTURE_ENABLED="true";
  const rows:any[]=[];let researchCount=0,failStore=false;
  const db:any=()=>({from(table:string){
    assert.equal(table,"widget_snapshots","Must not create email requests or invoke subscriptions");
    let payload:any,token:any;
    const c:any={insert(p:any){payload=p;return c;},select(){return c;},eq(_k:string,v:any){token=v;return c;},maybeSingle(){return c;},
      then(resolve:any){if(failStore)return resolve({error:{message:"store failed"}});if(payload)rows.push({id:"one",...payload});
        resolve({error:null,data:rows.find(r=>r.token_hash===token)||null});}};
    return c;
  }});
  const app=express();app.use(express.json());registerSnapshotRoutes(app,{db,
    sync:async()=>{throw Error("No CRM write is part of assessment capture");},
    research:async input=>{assert.deepEqual(Object.keys(input).sort(),["companyName","url"]);researchCount++;
      return {kind:"company-positioning-v1",companyName:input.companyName,companyUrl:input.url,
        researchedAt:new Date().toISOString(),introduction:[],finding:{text:"Fixture",sources:[]},
        interpretation:"Fixture",question:"Fixture",limitations:[]};}});
  const server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));
  const base=`http://127.0.0.1:${(server.address() as any).port}/api/widget/snapshot`;
  const post=(path:string,data:any)=>fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
  const intake={companyName:"Fixture",url:"https://business-corp.com",companyConfirmed:true};
  try{
    const cfg=await (await fetch(base+"/config")).json();assert.equal(cfg.leadCapture.required,true);
    assert.equal((await post("",intake)).status,400);
    assert.equal((await post("",{...intake,capture:{...capture,email:"a@gmail.com"}})).status,400);
    assert.equal(researchCount,0,"Validate required capture before research spend");
    const data=await (await post("",{...intake,capture,assessment:{}})).json();
    assert.equal(rows[0].lead_capture.email,capture.email);
    assert.equal(rows[0].lead_capture.firstName,capture.firstName);
    assert.equal(rows[0].lead_capture.inquiryOnly,true);
    assert.equal(rows[0].lead_capture.revenueBand,"500k1m");
    assert.equal(data.snapshot.assessment.answers.context.revenueBand,"500k1m");
    for(const raw of [JSON.stringify(data),JSON.stringify(await (await post("/view",{token:data.token})).json())])
      for(const secret of [capture.email,capture.firstName,capture.lastName,"lead_capture"])assert.equal(raw.includes(secret),false,secret);
    failStore=true;const failed=await post("",{...intake,capture});assert.equal(failed.status,503);
    assert.equal((await failed.json()).snapshot,undefined);
  }finally{delete process.env.SNAPSHOT_REQUIRED_LEAD_CAPTURE_ENABLED;await new Promise<void>(r=>server.close(()=>r()));}
});
