// Local-only synthetic QA server. Never included in the production server bundle.
import express from "express";
import Database from "better-sqlite3";
import { registerClientReportRoutes } from "../server/client-report";
import { SqliteClientReportStore } from "../server/client-report-store";
import { buildDemoReport } from "../server/demo-report";
import { canonicalPriceTiers, PRICING_VERSION } from "../shared/service-packages";
import path from "node:path";

const a:any={id:"qa-client-report",clientName:"Example Industrial · QA only",clientUrl:"https://example.com",status:"done",progress:100,createdAt:Date.now(),
  extraction:JSON.stringify({title:"Example Industrial",description:"Synthetic QA company.",positioningStatement:"Precision components for complex industrial equipment.",valueProps:["Application expertise","Reliable delivery"],offerings:["Machining","Assembly"],targetAudience:"Industrial OEMs",evidenceElements:["QA fixture, not a real company"],ctaAudit:"Clarify the request-for-quote path.",seoNotes:"Explain application expertise.",aeoReadinessScore:45,aeoReadinessNotes:"Strengthen evidence in technical answers.",
    companyProfile:{version:1,researchedAt:"2026-09-25T12:00:00Z",facts:[{key:"business",sentence:"Example Industrial is a fictional manufacturer used only to verify report presentation.",status:"reported",sources:[{title:"Illustrative QA reference",url:"https://example.com"}]}]}}),
  competitors:JSON.stringify([{name:"Illustrative competitor",url:"https://example.com",positioning:"Broad catalog coverage.",strengths:["Visibility"],weaknesses:["Limited specialization"],hookIdeas:["Demonstrate application expertise"]}]),
  strategy:JSON.stringify({icp:{summary:"Equipment manufacturers with complex component requirements.",firmographics:["Mid-market OEM"],painPoints:["Delivery uncertainty"],buyingTriggers:["New product launch"]},positioningGaps:["Make specialized expertise explicit."],messagingRecommendations:["Lead with documented application outcomes."],aeoRecommendations:["Publish technical answers."],contentPillars:[{name:"Application expertise",description:"Answers for engineering and operations.",sampleTitles:["How to choose a component partner"]}],channelMix:[{channel:"LinkedIn",role:"Reach technical decision-makers",priority:"high"}],quickWins:["Clarify the RFQ call to action"],ninetyDayPlan:[{phase:"Foundation",weeks:"1–4",focus:"Validate positioning and measurement.",outcomes:["Agreed baseline"]},{phase:"Activation",weeks:"5–8",focus:"Launch priority content and outreach.",outcomes:["First qualified conversations"]},{phase:"Optimization",weeks:"9–12",focus:"Learn from early signals.",outcomes:["Quarter-two priorities"]}]}),
  sow:JSON.stringify({pricingVersion:PRICING_VERSION,engagementSummary:"A 12-month program with a six-month initial commitment.",priceTiers:canonicalPriceTiers(),phases:[],team:[],termsNotes:[]}),
  swot:JSON.stringify({industry:"Industrial manufacturing",summary:"Focus expertise into a clearer growth story.",strengths:[{id:"S1",title:"Technical capability",evidence:"Illustrative QA evidence."}],weaknesses:[{id:"W1",title:"Unclear proof",evidence:"Illustrative QA evidence."}],opportunities:[{id:"O1",title:"Application content",evidence:"Illustrative QA evidence."}],threats:[{id:"T1",title:"Broad competitors",evidence:"Illustrative QA evidence."}]}),pestel:null,porters:null,customerInsights:null};
const plan:any={id:"qa-plan",analysisId:a.id,status:"ready",planJson:JSON.stringify({summary:"An on-ramp content strategy to make expertise easier to evaluate.",contentPillars:[{name:"Expertise",description:"Demonstrate application knowledge."}],blogCalendar:[{weekNumber:1,weekOf:"2026-09-28",posts:[{title:"How to evaluate a technical partner",pillar:"Expertise",angle:"Reduce risk with evidence.",targetQuery:"How do I choose a component partner?",keywords:["industrial components"],scheduledDate:"2026-09-29"}]}],socialCadence:[],adBrief:[],landingPages:[]})};
const store=new SqliteClientReportStore(new Database(":memory:"));
const app=express();app.use(express.json());app.use((req:any,_res,next)=>{req.session={isAuthenticated:!req.path.startsWith("/api/client-report")};next();});
app.get("/api/auth/status",(_req,res)=>res.json({authenticated:true}));
app.get("/api/analyses",(_req,res)=>res.json([a]));
app.get("/api/config-status",(_req,res)=>res.json({}));
registerClientReportRoutes(app,{storage:{getAnalysis:async(id:string)=>id===a.id?a:undefined,getContentPlanByAnalysis:async()=>plan} as any,shares:()=>store});
app.get("/api/analyses/:id/demo",(_req,res)=>res.json(buildDemoReport(a,plan)));
app.get("/api/analyses/:id/content-plan",(_req,res)=>res.json(plan));
app.get("/api/analyses/:id",(_req,res)=>res.json(a));
app.use("/api",(_req,res)=>res.status(404).json({error:"QA fixture endpoint unavailable"}));
const root=path.resolve("dist/public");app.use(express.static(root));app.get("/{*path}",(_req,res)=>res.sendFile(path.join(root,"index.html")));
app.listen(Number(process.env.PORT??5065),"0.0.0.0",()=>console.log("Synthetic QA server ready"));
