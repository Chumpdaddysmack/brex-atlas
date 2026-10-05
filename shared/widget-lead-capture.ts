import { z } from "zod";

export const WIDGET_REVENUE_RANGES = [
  ["under500k", "Under $500K"],
  ["500k1m", "$500K–under $1 Million"],
  ["1m5m", "$1 Million–under $5 Million"],
  ["5m50m", "$5 Million–under $50 Million"],
  ["50m250m", "$50 Million–$250 Million"],
] as const;
export const LEAD_CAPTURE_NOTICE = {
  version: "atlas-assessment-inquiry-v1-2026-10-05",
  text: "Your contact details are required to view your assessment. By submitting, you provide Brex Consulting with your details and assessment for inquiry follow-up. This does not request an email copy or subscribe you to promotional emails; those choices remain separate.",
};
// A bounded common-provider screen, not mailbox ownership verification and not
// an exhaustive list. Do not equate domain mismatch with an invalid business.
const personalProviders = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "outlook.com",
  "hotmail.com", "live.com", "msn.com", "aol.com", "icloud.com", "me.com",
  "mac.com", "proton.me", "protonmail.com", "gmx.com", "mail.com",
]);
export const PERSONAL_EMAIL_DOMAINS = [...personalProviders];
const name = z.string().trim().min(1).max(80)
  .refine(s => /\p{L}/u.test(s) && !/[<>\u0000-\u001f\u007f]/.test(s), "Enter a valid name.");
export const leadCaptureSchema = z.object({
  firstName: name,
  lastName: name,
  email: z.string().trim().toLowerCase().max(254).email()
    .refine(s => !personalProviders.has(s.split("@").at(-1)!), "Use your company email rather than a common personal-email address."),
  revenueBand: z.enum(["under500k", "500k1m", "1m5m", "5m50m", "50m250m"]),
  noticeVersion: z.literal(LEAD_CAPTURE_NOTICE.version),
}).strict();
export function privateLeadCapture(raw: unknown, website: string, company: string) {
  const input = leadCaptureSchema.parse(raw);
  return { ...input, website, company, capturedAt: new Date().toISOString(),
    noticeText: LEAD_CAPTURE_NOTICE.text, source: "Atlas Excavator Widget",
    emailVerification: "format-and-common-provider-screen-only",
    inquiryOnly: true };
}
