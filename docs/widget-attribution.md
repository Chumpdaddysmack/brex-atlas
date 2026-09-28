# Widget hidden attribution

Approved September 28, 2026.

- Contact property `lead_source_tag`: set to `Atlas Excavator Widget` on every widget contact sync.
- Contact property `original_lead_source`: set to `Website` only on creation or when the existing property is blank.
- Existing nonblank Original Lead Source values are omitted from the update, preserving first-touch attribution.
- These are existing HubSpot contact properties, not newly created fields. HubSpot's separate `hs_analytics_source` field is not changed.
- Both fields appear as hidden inputs in `client/public/widget.html`; values are included in the lead payload but enforced independently on the server, so changing a hidden input does not change the CRM defaults.
- Existing contacts are looked up, then read directly before their source is updated. A failed lookup/read stops the sync rather than treating the contact as new.
- No historical records are backfilled. The change applies to future widget submissions.
- Consent, qualification, lead notifications, and deal routing are unchanged.

Verification uses mocked HubSpot calls for new contacts, returning contacts with blank sources, returning contacts with existing sources, and API failure conditions. Browser QA intercepts the lead submission to verify hidden values without sending real emails, creating CRM records, or enrolling contacts in workflows.
