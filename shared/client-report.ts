import { z } from "zod";
import type { DemoReport } from "./demo-report";
import type { AssessmentRecord } from "./tier-assessment";
import type { Extraction, Competitor, Strategy, SwotAnalysis, PestelAnalysis, PortersFiveForces, CustomerInsights } from "./schema";
import type { ReportVisuals } from "./report-visuals";

export const REPORT_DAYS = 10;
export const BOOKING_URL = "https://meetings-na2.hubspot.com/kenny-peavy";
export function reportCtaLabel(mode: "full" | "demo") {
  return mode === "full" ? "Schedule your report presentation" : "Discuss your report";
}
export function reportPublishRequirements(input:{hasPreview:boolean;reviewed:boolean;protect:boolean;code:string}) {
  const missing:string[]=[];
  if(!input.hasPreview) missing.push("Open “Review client preview” and review the report.");
  if(!input.reviewed) missing.push("Approve the preview using “Approve preview and return” or the confirmation checkbox.");
  if(input.protect&&input.code.length<8) missing.push("Enter an access code with at least 8 characters.");
  if(input.protect&&input.code.length>80) missing.push("Use an access code with no more than 80 characters.");
  return missing;
}
export const publishReportSchema = z.object({
  mode: z.enum(["full", "demo"]), reviewed: z.literal(true), previewHash:z.string().regex(/^[a-f0-9]{64}$/),
  accessCode: z.string().min(8).max(80).optional(),
}).strict();
export type FullClientReport = {
  clientName: string; clientUrl: string; mode: "full";
  extraction: Extraction | null; competitors: Competitor[]; strategy: Strategy | null;
  swot: SwotAnalysis | null; pestel: PestelAnalysis | null; porters: PortersFiveForces | null;
  customerInsights: CustomerInsights | null; visuals: ReportVisuals;
  content: Record<string, unknown> | null;
};
export type ClientSnapshot = {
  version: 1; report: FullClientReport | DemoReport; recommendation: AssessmentRecord | null;
};
export type ShareSummary = {
  id: string; mode: "full" | "demo"; createdAt: number; expiresAt: number; revokedAt: number | null; protected: boolean;
};
export type SharedReport = {
  snapshot: ClientSnapshot; expiresAt: number; publishedAt: number; bookingUrl: string;
};
