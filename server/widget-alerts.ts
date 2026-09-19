// server/widget-alerts.ts
// Hot-lead email alert for Atlas widget captures.
// Fires ONLY when: fitTier ∈ {strategist, full-fractional} AND score ≥ 65.
//
// Delivery: Resend transactional email API.
// Env: RESEND_API_KEY, ALERT_TO_EMAIL (default: Kenny@brexconsulting.com),
//      ALERT_FROM_EMAIL (default: alerts@brexconsulting.com).

import { Resend } from "resend";
import { hubspotContactUrl, hubspotDealUrl } from "./hubspot";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ALERT_TO = process.env.ALERT_TO_EMAIL || "Kenny@brexconsulting.com";
const ALERT_FROM = process.env.ALERT_FROM_EMAIL || "alerts@brexconsulting.com";

let resend: Resend | null = null;
function client(): Resend {
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY not set");
  if (!resend) resend = new Resend(RESEND_API_KEY);
  return resend;
}

export interface HotLeadAlertInput {
  overallScore: number;
  fitTier: string;
  verdict: string;
  positioningScore?: number;
  offerScore?: number;
  buyerScore?: number;
  growthScore?: number;
  headline?: string;
  url: string;
  industry: string;
  revenueBand: string;
  primaryGoal: string;
  email: string;
  company?: string;
  hubspotContactId?: string | null;
  hubspotDealId?: string | null;
}

export function shouldAlert(fitTier: string, overallScore: number): boolean {
  return (
    (fitTier === "strategist" || fitTier === "full-fractional") &&
    overallScore >= 65
  );
}

export async function sendHotLeadAlert(input: HotLeadAlertInput): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.warn("[widget-alerts] RESEND_API_KEY not set — skipping hot-lead alert.");
    return false;
  }

  const tierLabel = input.fitTier === "full-fractional" ? "Full Fractional CMO" : "Strategist";
  const domain = input.url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0];
  const companyOrDomain = input.company || domain;

  const subject = `🔥 Hot Atlas lead — ${companyOrDomain} — ${tierLabel} — score ${Math.round(input.overallScore)}`;

  const subScoreLine =
    input.positioningScore !== undefined
      ? `Positioning ${Math.round(input.positioningScore)} · Offer ${Math.round(input.offerScore ?? 0)} · Buyer ${Math.round(input.buyerScore ?? 0)} · Growth ${Math.round(input.growthScore ?? 0)}`
      : "";

  const contactLink = input.hubspotContactId
    ? `<p style="margin:8px 0"><a href="${hubspotContactUrl(input.hubspotContactId)}" style="color:#00A6FB">→ Open contact in HubSpot</a></p>`
    : "";
  const dealLink = input.hubspotDealId
    ? `<p style="margin:8px 0"><a href="${hubspotDealUrl(input.hubspotDealId)}" style="color:#00A6FB">→ Open deal in HubSpot</a></p>`
    : "";

  const html = `<!DOCTYPE html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color:#0F1824; max-width:640px; margin:0 auto; padding:24px;">
  <div style="background:#0F1824; color:#F4BD11; padding:20px 24px; margin:-24px -24px 24px; border-radius:0 0 8px 8px;">
    <h1 style="margin:0; font-size:22px; font-weight:700;">🔥 Hot Atlas lead</h1>
    <p style="margin:6px 0 0; color:#DDE8EE; font-size:14px;">${tierLabel} fit · score ${Math.round(input.overallScore)} · ${input.verdict}</p>
  </div>

  <h2 style="font-size:18px; margin:24px 0 8px; color:#2A4365;">Contact</h2>
  <table style="width:100%; border-collapse:collapse; font-size:14px;">
    <tr><td style="padding:6px 0; color:#607382; width:120px;">Email</td><td style="padding:6px 0;"><a href="mailto:${input.email}" style="color:#00A6FB;">${input.email}</a></td></tr>
    ${input.company ? `<tr><td style="padding:6px 0; color:#607382;">Company</td><td style="padding:6px 0;">${input.company}</td></tr>` : ""}
    <tr><td style="padding:6px 0; color:#607382;">Website</td><td style="padding:6px 0;"><a href="${input.url}" style="color:#00A6FB;">${input.url}</a></td></tr>
  </table>

  <h2 style="font-size:18px; margin:24px 0 8px; color:#2A4365;">Diagnostic</h2>
  <table style="width:100%; border-collapse:collapse; font-size:14px;">
    <tr><td style="padding:6px 0; color:#607382; width:120px;">Overall score</td><td style="padding:6px 0; font-weight:600;">${Math.round(input.overallScore)}/100 (${input.verdict})</td></tr>
    ${subScoreLine ? `<tr><td style="padding:6px 0; color:#607382;">Sub-scores</td><td style="padding:6px 0;">${subScoreLine}</td></tr>` : ""}
    <tr><td style="padding:6px 0; color:#607382;">Industry</td><td style="padding:6px 0;">${input.industry}</td></tr>
    <tr><td style="padding:6px 0; color:#607382;">Revenue</td><td style="padding:6px 0;">${input.revenueBand}</td></tr>
    <tr><td style="padding:6px 0; color:#607382;">Primary goal</td><td style="padding:6px 0;">${input.primaryGoal}</td></tr>
    ${input.headline ? `<tr><td style="padding:6px 0; color:#607382; vertical-align:top;">Headline</td><td style="padding:6px 0; font-style:italic; color:#2A4365;">${input.headline}</td></tr>` : ""}
  </table>

  ${contactLink}${dealLink}

  <div style="margin-top:32px; padding:16px 20px; background:#EDF2F7; border-left:3px solid #C02B0A; border-radius:0 4px 4px 0;">
    <p style="margin:0; font-size:14px; color:#0F1824;"><strong>This lead just captured.</strong> If you can respond in the next 5 minutes, close rate ~3x higher.</p>
  </div>

  <p style="margin-top:32px; font-size:12px; color:#607382;">Atlas Excavator · brexconsulting.com/atlas</p>
</body></html>`;

  try {
    const { error } = await client().emails.send({
      from: `Brex Atlas <${ALERT_FROM}>`,
      to: ALERT_TO,
      subject,
      html,
      replyTo: input.email,
    });
    if (error) {
      console.error("[widget-alerts] Resend error:", error);
      return false;
    }
    console.log(`[widget-alerts] hot-lead alert sent for ${input.email}`);
    return true;
  } catch (err) {
    console.error("[widget-alerts] send failed:", err);
    return false;
  }
}
