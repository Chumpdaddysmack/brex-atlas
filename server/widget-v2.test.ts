import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {growthAssessment,storedGrowthAssessment,growthRecap} from "../shared/widget-growth";
import {exactBlock,competitorSupport,weaknessSupported,retrievalUrls,researchGrowth,GROWTH_DRAFT_SCHEMA} from "./widget-v2-research";
import {registerWidgetV2Routes,v2Snapshot,researchFailureCode} from "./widget-v2";
import {assessmentAlertProperties,initialInternalAlert} from "./widget-internal-alert";
import {LEAD_CAPTURE_NOTICE,privateLeadCapture} from "../shared/widget-lead-capture";
import {buildSnapshotAssessmentRecap} from "./snapshot-assessment-recap";

const answers={demand:"1",capacity:"1",funding:"1",ownership:"1"};
const capture={firstName:"Fixture",lastName:"Tester",email:"fixture@acmeindustrial.com",revenueBand:"1m5m",noticeVersion:LEAD_CAPTURE_NOTICE.version};
const pages={1:{url:"https://acmeindustrial.com/",title:"Acme Industrial",text:"Acme Industrial supplies industrial equipment to manufacturers in Chicago."},
  2:{url:"https://rivalindustrial.com/",title:"Rival Industrial",text:"Rival Industrial supplies industrial equipment to manufacturers in Chicago."}};
const b={text:"The two businesses serve equipment buyers in Chicago.",evidence:[{source_id:1,quote:pages[1].text},{source_id:2,quote:pages[2].text}]};
const checks={company_identity_confirmed:true,competitor_identity_confirmed:true,offering_overlap:true,buyer_overlap:true,geographic_overlap:true};
test("research diagnostics classify failures without retaining provider messages",()=>{
  assert.equal(researchFailureCode({status:401,message:"secret provider payload"}),"PROVIDER_HTTP_401");
  assert.equal(researchFailureCode({name:"ZodError",issues:[]}),"RESEARCH_FORMAT_INVALID");
  assert.equal(researchFailureCode(Error("secret provider payload")),"RESEARCH_FAILED");
  assert.equal(researchFailureCode(Error("ENTITY_UNCONFIRMED")),"ENTITY_UNCONFIRMED");
});
test("all 256 readiness combinations match the four-answer rubric; unknown never zero",()=>{
  for(const d of ["0","1","2","unknown"])for(const c of ["0","1","2","unknown"])for(const f of ["0","1","2","unknown"])for(const o of ["0","1","2","unknown"]){
    const a=growthAssessment({demand:d,capacity:c,funding:f,ownership:o});
    assert.equal(a.score,[d,c,f,o].includes("unknown")?null:Math.round([d,c,f,o].reduce((s,v)=>s+Number(v),0)/8*100));
  }
  assert.throws(()=>growthAssessment({...answers,score:100}));
  assert.throws(()=>storedGrowthAssessment({version:"wrong",answers}));
  assert.equal(storedGrowthAssessment({...growthAssessment(answers),score:100}).score,50);
});
test("competitor must have exact quotes, both entities, offering/buyer and geography for direct",()=>{
  assert.deepEqual(exactBlock(b,pages),b);
  assert.equal(exactBlock({...b,evidence:[{source_id:1,quote:"An invented source passage not present on the website."}]},pages),null);
  assert.equal(competitorSupport(b,pages[1].url,pages[2].url,pages,{competitor_checks:checks}),"direct");
  assert.equal(competitorSupport({...b,text:"Potential competitor: Rival Industrial."},pages[1].url,pages[2].url,pages,{competitor_checks:checks}),"potential");
  assert.equal(competitorSupport(b,pages[1].url,pages[2].url,pages,{competitor_checks:{...checks,buyer_overlap:false}}),"unsupported");
  assert.equal(competitorSupport({...b,text:"A direct competitor of Acme Industrial."},pages[1].url,pages[2].url,pages,{competitor_checks:{...checks,geographic_overlap:false}}),"unsupported");
});
test("weakness cannot be invented from competing dealers, missing pages, or a question",()=>{
  const audit={weakness_check:{deficiency_established:true,basis:"documented_limitation",logical_error:"none"}};
  assert.equal(weaknessSupported({...b,text:"Exclusive authorization conflicts with competitors."},audit),false);
  assert.equal(weaknessSupported({...b,text:"Discovery question: Which growth constraint is present?"},audit),false);
  assert.equal(weaknessSupported(b,{}),false);
  assert.equal(weaknessSupported({...b,text:"The company reports capacity constrained to one shift."},audit),true);
});
test("retrieval retains dealership paths, alternates and bounds per-host coverage",()=>{
  const urls=retrievalUrls({sources:[{url:"https://rivalindustrial.com/local/chicago/about"},{url:"https://rivalindustrial.com/third"}]},
    pages[1].url,["https://rivalindustrial.com/local/chicago"]);
  assert.deepEqual(urls,[pages[1].url,"https://rivalindustrial.com/local/chicago","https://rivalindustrial.com/local/chicago/about"]);
});
test("V2 alert/recap use readiness and never replace legacy health/tier properties",()=>{
  const snapshot=v2Snapshot(pages[1].url,answers);
  const row={id:"test-id",created_at:new Date().toISOString(),company_url:pages[1].url,snapshot,
    lead_capture:{...privateLeadCapture(capture,pages[1].url,"Acme Industrial"),alert:initialInternalAlert()}};
  const properties=assessmentAlertProperties(row,"Referral");
  assert.equal(properties.original_lead_source,undefined);
  assert.equal("atlas_health_score" in properties,false);assert.equal("atlas_cmo_recommendation" in properties,false);
  assert.match(properties.atlas_assessment_summary,/50\/100/);
  assert.match(properties.atlas_assessment_summary,/Company research: pending/);
  assert.equal(buildSnapshotAssessmentRecap(row,{snapshotId:row.id,email:capture.email,requestedAt:row.created_at}),growthRecap(snapshot.growth));
});
test("V2 route saves inquiry before research; retries reuse receipt; PII never reaches research or public snapshot",async()=>{
  const rows:any[]=[],calls:any[]=[];let fail=true;
  const db:any=()=>({from(table:string){
    assert.equal(table,"widget_snapshots");let payload:any,mode="",filters:any[]=[];
    const q:any={insert(p:any){payload=p;mode="insert";return q},update(p:any){payload=p;mode="update";return q},
      select(){return q},single(){return q},maybeSingle(){return q},eq(k:string,v:any){filters.push([k,v]);return q},
      then(resolve:any){
        let row=rows.find(r=>filters.every(([k,v])=>r[k]===v));
        if(mode==="insert"){row={id:String(rows.length+1),...payload};rows.push(row);}
        if(mode==="update"&&row)Object.assign(row,payload);
        return Promise.resolve(resolve({data:row||null,error:null}));
      }};return q;
  }});
  const app=express();app.use(express.json());
  registerWidgetV2Routes(app,{db,research:async(url,progress)=>{
    assert.equal(rows.length,1);calls.push(url);progress?.("Checking sources");
    if(fail)throw Error("Simulated provider failure");
    return {company_name:"Acme Industrial",company_url:url,researched_at:new Date().toISOString(),summary:[b],sources:[]};
  }});
  const server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));
  const post=(data:any)=>fetch(`http://127.0.0.1:${(server.address() as any).port}/api/widget/v2/research`,{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
  try{
    assert.equal((await post({website:pages[1].url,answers:{...answers,score:100},capture})).status,400);
    assert.equal((await post({website:"http://127.0.0.1",answers,capture})).status,400);
    const input={website:pages[1].url,answers,capture};
    const events=(await (await post(input)).text()).trim().split("\n").map(JSON.parse as any);
    assert.equal(events[0].type,"receipt");assert.equal(events.at(-1).type,"error");
    const resumeToken=events[0].token;assert.equal(rows[0].snapshot.researchStatus,"unavailable");
    assert.equal(rows[0].snapshot.researchDiagnostic.code,"RESEARCH_FAILED");
    assert.equal(rows[0].snapshot.researchDiagnostic.stage,"Checking sources");
    assert.equal(JSON.stringify(rows[0].snapshot).includes("Simulated provider failure"),false);
    assert.equal(JSON.stringify(rows[0].snapshot).includes(capture.email),false);
    fail=false;
    const completed=(await (await post({...input,resumeToken})).text()).trim().split("\n").map(JSON.parse as any);
    assert.equal(completed.at(-1).type,"result");assert.equal(rows.length,1);
    assert.equal(rows[0].snapshot.growth.score,50);assert.equal(rows[0].snapshot.researchStatus,"ready");
    assert.equal((await post({...input,capture:{...capture,lastName:"Different"},resumeToken})).status,409);
    assert.deepEqual(calls,[pages[1].url,pages[1].url]);
  }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
test("production research provider adapter preserves audit gating and weakness omission",async()=>{
  const identity={text:"The official website identifies Acme Industrial.",evidence:[{source_id:1,quote:pages[1].text}]};
  let calls=0;
  const result=await researchGrowth(pages[1].url,()=>{},{
    search:async()=>({answer:JSON.stringify({company_name:"Acme Industrial",competitor_urls:[pages[2].url],sources:[]}),citations:[]}),
    read:async u=>Object.values(pages).find(p=>p.url===u)||null,
    structure:async(_system,_user,_tokens,schema)=>{
      calls++;
      if(calls===1){assert.equal(schema,GROWTH_DRAFT_SCHEMA);return {company_name:"Acme Industrial",identity,summary:[identity],market:identity,competitor:b,competitor_url:pages[2].url,
        strength:identity,weakness:null,opportunity:null,threat:null,strategy:null};}
      return {reviews:["identity","summary_0","market","strength","competitor"].map(key=>({key,supported:true,text:key==="competitor"?b.text:identity.text})),
        competitor_checks:checks,competitor_match:"direct",weakness_check:{deficiency_established:false}};
    },
  });
  assert.equal(result.competitor_match,"direct");assert.equal(result.weakness,null);assert.equal(calls,2);
});
test("malformed research draft gets one schema repair, not a relaxed evidence gate",async()=>{
  let calls=0;const phases:string[]=[];
  await assert.rejects(researchGrowth(pages[1].url,m=>phases.push(m),{
    search:async()=>({answer:JSON.stringify({company_name:"Acme Industrial",competitor_urls:[pages[2].url],sources:[]}),citations:[]}),
    read:async u=>Object.values(pages).find(p=>p.url===u)||null,
    structure:async(_s,_u,_t,schema)=>{calls++;assert.equal(schema,GROWTH_DRAFT_SCHEMA);return {summary:"Wrong format"};},
  }),{name:"ZodError"});
  assert.equal(calls,2);assert.ok(phases.some(p=>p.includes("Correcting the research format")));
});
