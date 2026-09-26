import type { Express } from "express";
import { randomBytes, randomUUID, createHash, scryptSync, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { requireAuth } from "./auth";
import { storage } from "./storage";
import { clientReportStore, summary, type ClientReportStore, type ShareRow } from "./client-report-store";
import { BOOKING_URL, REPORT_DAYS, publishReportSchema, type ClientSnapshot } from "@shared/client-report";
import { assessTier, assessmentInputSchema, safeHttp, type AssessmentRecord } from "@shared/tier-assessment";
import { buildDemoReport } from "./demo-report";
import { buildReportVisuals } from "@shared/report-visuals";
import type { Analysis, ContentPlan } from "@shared/schema";

const DAY = 86_400_000;
const parse = (s: string | null | undefined): any => { try { return JSON.parse(s ?? "null"); } catch { return null; } };
export const tokenHash = (s: string) => createHash("sha256").update(s).digest("hex");
export function hashAccessCode(code: string) { const salt = randomBytes(16).toString("hex"); return `${salt}:${scryptSync(code, salt, 32).toString("hex")}`; }
export function validAccessCode(code: string, stored: string) {
  const [salt, hex] = stored.split(":"); const target = Buffer.from(hex ?? "", "hex");
  return target.length === 32 && timingSafeEqual(scryptSync(code, salt, 32), target);
}
export function isShareActive(row: ShareRow | null, now = Date.now()): row is ShareRow {
  return !!row && row.revokedAt === null && Number.isFinite(row.expiresAt) && now < row.expiresAt;
}
// Only approved report data is copied. Intake notes, assumptions, operational IDs,
// errors, draft review notes, raw SOW and ROI costs never enter the snapshot.
function clean(node: any): any {
  if (Array.isArray(node)) return node.map(clean);
  if (!node || typeof node !== "object") return node;
  return Object.fromEntries(Object.entries(node).filter(([k]) => !/^(notes|internalNotes|reviewNotes|errorMessage|assumptions|password|token|secret|apiKey)$/i.test(k))
    .map(([k,v]) => [k, /^(url|href|sourceUrl|clientUrl)$/i.test(k) ? safeHttp(v) ?? "" : clean(v)]));
}
function pick(raw: any, keys: string[]): any {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return clean(Object.fromEntries(keys.filter(k => k in raw).map(k => [k, raw[k]])));
}
export function buildClientSnapshot(a: Analysis, plan: ContentPlan | null, mode: "full" | "demo", assessment: AssessmentRecord | null): ClientSnapshot {
  const e = pick(parse(a.extraction), ["companyProfile","title","description","positioningStatement","valueProps","offerings","targetAudience","evidenceElements","ctaAudit","seoNotes","aeoReadinessScore","aeoReadinessNotes"]);
  const s = pick(parse(a.strategy), ["icp","positioningGaps","messagingRecommendations","aeoRecommendations","contentPillars","channelMix","quickWins","ninetyDayPlan","salesRoutes","differentiationSummary"]);
  const competitors = (Array.isArray(parse(a.competitors)) ? parse(a.competitors) : []).map((c: any) => pick(c, ["name","url","positioning","strengths","weaknesses","hookIdeas"]));
  const swot = pick(parse(a.swot), ["strengths","weaknesses","opportunities","threats","summary","industry","companyName"]);
  const pestel = pick(parse(a.pestel), ["industry","summary","findings","strategicImplications"]);
  const porters = pick(parse(a.porters), ["industry","summary","forces","overallAttractiveness","strategicImplications"]);
  const ci = pick(parse(a.customerInsights), ["summary","industry","vocEvidenceMode","personas","psychographics","sociotype","painPoints","jtbd","voiceOfCustomer","wouldTheyBuySignals","momTestQuestions","buyingSignals","decisionCommittee","objections","journeyStages","vocSources"]);
  const content = pick(parse(plan?.planJson), ["summary","contentPillars","blogCalendar","socialCadence","adBrief","heroMetaAd","heroLinkedInAd","heroColdEmail","landingPages","sitemap"]);
  // Recommendation evidence is intentionally publishable only after human approval.
  const recommendation = assessment?.approvedAt && assessTier(assessment.input).tier ? structuredClone(assessment) : null;
  if (mode === "demo") {
    // Existing bounded demo projection excludes complete data and price tables.
    const demo = buildDemoReport({ ...a, sow: null }, plan);
    demo.id = ""; // no internal analysis identifier in a public payload
    return { version:1, report:clean(demo), recommendation:null };
  }
  return { version:1, recommendation, report: { mode:"full", clientName:a.clientName, clientUrl:safeHttp(a.clientUrl) ?? "",
    extraction:e, strategy:s, competitors, swot, pestel, porters, customerInsights:ci, content,
    visuals:buildReportVisuals({clientName:a.clientName, extraction:e, strategy:s, competitors, swot, customerInsights:ci}) } };
}
const limited = new Map<string, { count:number; reset:number }>();
function withinLimit(key: string) {
  const now=Date.now();
  limited.forEach((v,k)=>{if(v.reset<=now)limited.delete(k);});
  const r=limited.get(key) ?? {count:0,reset:now+60_000};
  r.count++; limited.set(key,r); return r.count <= 30;
}
export function registerClientReportRoutes(app: Express, deps = { storage, shares: clientReportStore }) {
  const shares = () => deps.shares();
  const noCache = (_req: any, res: any, next: any) => {
    res.set({"Cache-Control":"private, no-store, max-age=0","Pragma":"no-cache","X-Robots-Tag":"noindex, nofollow, noarchive","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"});
    next();
  };
  app.use(["/api/client-report", "/api/analyses/:id/report-shares", "/api/analyses/:id/tier-assessment"], noCache);
  app.use("/report", (req,res,next) => { noCache(req,res,()=>{ res.setHeader("Content-Security-Policy","frame-ancestors 'none'"); next(); }); });
  const publicInput = z.object({ token:z.string().regex(/^[a-f0-9]{64}$/), accessCode:z.string().max(80).optional() }).strict();
  app.post("/api/client-report/access", async (req,res) => {
    if(!withinLimit(req.ip ?? "unknown")) return res.status(429).json({error:"Too many attempts. Please wait a minute."});
    const input=publicInput.safeParse(req.body); if(!input.success) return res.status(404).json({error:"Report unavailable"});
    const row=await shares().byToken(tokenHash(input.data.token));
    if(!isShareActive(row)) return res.status(410).json({error:"This report link has expired or is unavailable.", bookingUrl:BOOKING_URL});
    if(row.codeHash && (!input.data.accessCode || !validAccessCode(input.data.accessCode,row.codeHash)))
      return res.status(403).json({error:"Enter the report access code supplied by Brex."});
    if(!isShareActive(row)) return res.status(410).json({error:"This report link has expired."});
    res.json({snapshot:row.snapshot, expiresAt:row.expiresAt,publishedAt:row.createdAt,bookingUrl:BOOKING_URL});
  });
  // These routes are mounted before the global auth guard, so each admin route
  // explicitly requires auth. Public token access never grants an admin session.
  app.get("/api/analyses/:id/tier-assessment", requireAuth, async (req,res) => {
    if(!await deps.storage.getAnalysis(String(req.params.id))) return res.sendStatus(404);
    res.json(await shares().assessment(String(req.params.id)));
  });
  app.put("/api/analyses/:id/tier-assessment", requireAuth, async (req,res) => {
    const id=String(req.params.id);
    if(!await deps.storage.getAnalysis(id)) return res.sendStatus(404);
    const input=assessmentInputSchema.safeParse(req.body?.input);
    if(!input.success) return res.status(400).json({error:"Every selected fact needs supporting evidence and a date. Public facts also need a source URL.",details:input.error.flatten()});
    const decision=assessTier(input.data);
    if(req.body.approve && decision.status!=="ready-for-review") return res.status(409).json({error:"Resolve missing evidence, readiness, or responsibility mismatches before approving."});
    const now=new Date().toISOString();
    const record: AssessmentRecord={input:input.data,decision,updatedAt:now,approvedAt:req.body.approve===true ? now : null};
    await shares().saveAssessment(id,record);
    res.json(record);
  });
  app.get("/api/analyses/:id/report-shares", requireAuth, async (req,res) => { res.json(await shares().list(String(req.params.id))); });
  app.get("/api/analyses/:id/client-report-preview", requireAuth, async (req,res) => {
    const a=await deps.storage.getAnalysis(String(req.params.id)); if(!a) return res.sendStatus(404);
    const plan=await deps.storage.getContentPlanByAnalysis(a.id);
    res.setHeader("Cache-Control","no-store");
    const snapshot=buildClientSnapshot(a,plan??null,req.query.mode==="demo"?"demo":"full",await shares().assessment(a.id));
    res.json({snapshot,previewHash:tokenHash(JSON.stringify(snapshot)),
      expiresAt:Date.now()+REPORT_DAYS*DAY,publishedAt:Date.now(),bookingUrl:BOOKING_URL});
  });
  app.post("/api/analyses/:id/report-shares", requireAuth, async (req,res) => {
    const input=publishReportSchema.safeParse(req.body);
    if(!input.success) return res.status(400).json({error:"Review the client preview and confirm publication. Optional access codes need at least 8 characters."});
    const a=await deps.storage.getAnalysis(String(req.params.id));
    if(!a) return res.sendStatus(404);
    if(a.status!=="done") return res.status(409).json({error:"Wait for this analysis to finish before publishing."});
    const token=randomBytes(32).toString("hex"), now=Date.now();
    const plan=await deps.storage.getContentPlanByAnalysis(a.id);
    const snapshot=buildClientSnapshot(a,plan??null,input.data.mode,await shares().assessment(a.id));
    if(tokenHash(JSON.stringify(snapshot))!==input.data.previewHash) return res.status(409).json({error:"The report changed after preview. Review the latest preview before publishing."});
    const row: ShareRow={id:randomUUID(),analysisId:a.id,tokenHash:tokenHash(token),codeHash:input.data.accessCode?hashAccessCode(input.data.accessCode):null,
      mode:input.data.mode,protected:!!input.data.accessCode,createdAt:now,expiresAt:now+REPORT_DAYS*DAY,revokedAt:null,
      snapshot};
    await shares().create(row);
    // Fragment keeps the capability token out of ordinary web server/referrer logs.
    res.status(201).json({...summary(row), path:`/report#${token}`});
  });
  app.patch("/api/analyses/:id/report-shares/:shareId", requireAuth, async (req,res) => {
    const input=z.object({action:z.enum(["extend","revoke"])}).strict().safeParse(req.body);
    if(!input.success) return res.sendStatus(400);
    const row=await shares().get(String(req.params.shareId));
    if(!row || row.analysisId!==req.params.id) return res.sendStatus(404);
    if(row.revokedAt!==null) return res.status(409).json({error:"Revoked links cannot be reactivated. Publish a new link."});
    await shares().update(row.id,input.data.action==="revoke"?{revokedAt:Date.now()}:{expiresAt:Math.max(Date.now(),row.expiresAt)+REPORT_DAYS*DAY});
    res.json(summary((await shares().get(row.id))!));
  });
}
