// Local-only UI harness. Synthetic research; no database, CRM or email calls.
import express from "express";
import {assessWidget,WIDGET_HEALTH_CONFIG} from "../shared/widget-health";
import {LEAD_CAPTURE_NOTICE,WIDGET_REVENUE_RANGES,PERSONAL_EMAIL_DOMAINS} from "../shared/widget-lead-capture";
import {WIDGET_MARKETING_CONSENT} from "../shared/widget-consent";
import {SNAPSHOT_EMAIL_PERMISSION} from "../shared/snapshot-delivery";
const app=express();app.use(express.json());
app.get("/api/widget/snapshot/config",(_q,r)=>r.json({healthRubric:WIDGET_HEALTH_CONFIG,
  leadCapture:{required:true,notice:LEAD_CAPTURE_NOTICE,revenueRanges:WIDGET_REVENUE_RANGES,personalEmailDomains:PERSONAL_EMAIL_DOMAINS},
  marketingConsent:WIDGET_MARKETING_CONSENT,snapshotEmailConsent:SNAPSHOT_EMAIL_PERMISSION,
  publicDelivery:true,emailDeliveryReady:false}));
app.post("/api/widget/snapshot",(q,r)=>r.json({token:"a".repeat(64),expiresAt:"2026-10-16T18:00:00Z",
  snapshot:{companyName:"Synthetic QA fixture",companyUrl:"https://example.com",
    researchedAt:"2026-10-06T18:00:00Z",introduction:[],finding:{text:"Synthetic layout fixture; not real company research.",sources:[]},
    interpretation:"Local QA only",question:"Local QA only",limitations:[],assessment:assessWidget(q.body.assessment)}}));
app.use(express.static(new URL("../client/public",import.meta.url).pathname));
app.listen(5117,"0.0.0.0",()=>console.log("Local no-send tier QA on 5117"));
