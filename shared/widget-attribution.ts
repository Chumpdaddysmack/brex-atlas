// Fixed attribution for widget submissions, enforced by the server.
// Client-side hidden inputs are informational, not trusted CRM write authority.
export const WIDGET_ATTRIBUTION = Object.freeze({
  lead_source_tag: "Atlas Excavator Widget",
  original_lead_source: "Website",
});

export function widgetAttributionProperties(existingOriginalSource?: string | null): Record<string,string> {
  return {
    lead_source_tag: WIDGET_ATTRIBUTION.lead_source_tag,
    ...(existingOriginalSource?.trim() ? {} : {original_lead_source: WIDGET_ATTRIBUTION.original_lead_source}),
  };
}
