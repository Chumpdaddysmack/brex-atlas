// Keep displayed wording and the server-side evidence snapshot in sync.
export const WIDGET_MARKETING_CONSENT = Object.freeze({
  version: "atlas-marketing-v1-2026-09-22",
  text: "Yes, I would also like Brex Consulting to email me Growth Excavation report offers and marketing insights. This is optional, and I can unsubscribe at any time.",
  subscriptionTypeId: "711496982",
  subscriptionName: "Marketing Information",
  source: "atlas-widget",
});

export type ConsentDecision = "accepted" | "not_selected" | "not_presented";
export interface WidgetConsentEvidence {
  decision: ConsentDecision;
  policyVersion: string;
  consentText: string;
  subscriptionTypeId: string;
  source: string;
}

export function parseWidgetConsent(body: Record<string, unknown>): WidgetConsentEvidence {
  const present = Object.prototype.hasOwnProperty.call(body, "marketingConsent");
  if (!present) {
    if (body.marketingConsentVersion !== undefined) throw new Error("Please refresh the widget before submitting.");
    // An older cached widget must never be treated as granting permission.
    return { decision: "not_presented", policyVersion: "not-presented", consentText: "",
      subscriptionTypeId: WIDGET_MARKETING_CONSENT.subscriptionTypeId, source: WIDGET_MARKETING_CONSENT.source };
  }
  if (typeof body.marketingConsent !== "boolean") throw new Error("Please select your email preference again.");
  if (body.marketingConsentVersion !== WIDGET_MARKETING_CONSENT.version) {
    throw new Error("The email permission wording has changed. Please refresh the widget and choose again.");
  }
  return {
    decision: body.marketingConsent === true ? "accepted" : "not_selected",
    policyVersion: WIDGET_MARKETING_CONSENT.version,
    consentText: WIDGET_MARKETING_CONSENT.text,
    subscriptionTypeId: WIDGET_MARKETING_CONSENT.subscriptionTypeId,
    source: WIDGET_MARKETING_CONSENT.source,
  };
}
