// Local visual QA only: synthetic research and in-memory capture, no network APIs.
import express from "express";
import {readFileSync} from "node:fs";
import {randomUUID,randomBytes} from "node:crypto";
import {registerSnapshotRoutes} from "../server/widget-snapshot";
Object.assign(process.env,{SNAPSHOT_WEBSITE_NO_SEND_ENABLED:"true",SNAPSHOT_QUEUE_ENCRYPTION_KEY:randomBytes(32).toString("hex"),
  SNAPSHOT_WEBSITE_NO_SEND_AFTER:new Date(Date.now()-10000).toISOString(),HUBSPOT_ACCESS_TOKEN:"local-fixture"});
const snapshots:any[]=[],requests:any[]=[];
const publicPreview=process.argv.includes("--public");
if(publicPreview)process.env.SNAPSHOT_PUBLIC_DELIVERY_ENABLED="true";
if(process.argv.includes("--capture"))process.env.SNAPSHOT_REQUIRED_LEAD_CAPTURE_ENABLED="true";
const db:any=()=>({from(table:string){
  const filters:Record<string,any>={};let insert:any,upsert:any;
  const chain:any={select(){return chain;},single(){return chain;},maybeSingle(){return chain;},eq(k:string,v:any){filters[k]=v;return chain;},
    insert(p:any){insert=p;return chain;},upsert(p:any){upsert=p;return chain;},then(resolve:any){
      const rows=table==="widget_snapshots"?snapshots:requests;
      if(insert)rows.push({id:randomUUID(),...insert});
      if(upsert&&!rows.some(r=>r.snapshot_id===upsert.snapshot_id&&r.email===upsert.email))
        rows.push({id:randomUUID(),requested_at:new Date().toISOString(),...upsert});
      resolve({data:rows.find(r=>Object.entries(filters).every(([k,v])=>r[k]===v)),error:null});
    }};return chain;
}});
const app=express();app.use(express.json());
registerSnapshotRoutes(app,{db,sync:async()=>{throw new Error("No writes permitted");},
  websiteCapture:async()=>({status:"queued"}),
  ...(publicPreview?{publicDelivery:async()=>({status:"queued",sendingEnabled:true})}:{}),
  research:async input=>({kind:"company-positioning-v1",companyName:"LOCAL QA FIXTURE — "+input.companyName,
    companyUrl:input.url,researchedAt:new Date().toISOString(),
    introduction:[{text:"This is synthetic text for testing the layout, not research about a real company.",sources:[{title:"Example reference",url:"https://example.com"}]}],
    finding:{text:"This local demonstration checks the no-send request form.",sources:[{title:"Example reference",url:"https://example.com"}]},
    interpretation:"No business conclusions are being made in this preview.",
    question:"Does the website clearly distinguish a test request from a real email send?",
    limitations:["Synthetic local QA fixture. No external research, CRM writes, or email sends."]}),
});
app.get("/widget.html",(_req,res)=>res.type("html").send(readFileSync("client/public/widget.html","utf8")));
const port=publicPreview?5063:5062;
app.listen(port,"0.0.0.0",()=>console.log("Local fixture-only widget QA on "+port));
