# V2-Compatible Atlas Delivery Copy

These revisions work for both the original marketing-health assessment and the new Growth Readiness snapshot. They do not change enrollment criteria, recipients, subscription categories or permission requirements.

## Internal notification

Recipient: Kenny Peavy, HubSpot user `78405166` (kenny@brexconsulting.com).

Subject: New Atlas inquiry: {{contact.company}}

Body:

A prospect submitted the Atlas widget.

Name: {{contact.firstname}} {{contact.lastname}}  
Company or submitted domain: {{contact.company}}  
Company email: {{contact.email}}  
Website: {{contact.website}}  
Annual revenue: {{contact.atlas_revenue_range}}  
Submitted: {{contact.atlas_assessment_completed_at}}

Assessment summary:  
{{contact.atlas_assessment_summary}}

Open prospect in HubSpot:  
https://app-na2.hubspot.com/contacts/242249577/record/0-1/{{contact.hs_object_id}}

Assessment ID: {{contact.atlas_assessment_id}}  
Lead source: Atlas Excavator Widget

The summary identifies the assessment and its limitations. Growth Readiness and marketing health are different measures; do not compare their scores. V2 does not determine a CMO service tier. Company research may still be running when this inquiry arrives.

This internal alert does not indicate that the prospect requested an email copy or consented to promotional emails.

## Requested prospect email

Subscription, sender, reply-to, subject and results-link token remain unchanged.

Subject: Your Brex Atlas free assessment and company snapshot are ready

Body:

Hi there,

Your requested Atlas assessment and company snapshot are ready.

{{contact.atlas_snapshot_assessment_recap}}

Your assessment is calculated from your self-reported answers using the Brex rubric identified in your results. It is not a verified audit, an industry ranking, or a probability of growth. The one-page Growth Readiness snapshot does not determine a CMO service tier; any service recommendation requires Kenny's review.

Button: View My Assessment & Snapshot  
Destination: {{contact.atlas_snapshot_url}}

Your snapshot includes cited public research so you can review the supporting evidence. The access link expires 10 days after the snapshot was created; requesting another email does not extend that date.

This is an automated preview, not a completed Growth Excavation Report or a consultant-reviewed diagnosis. If you have trouble opening your results, reply to this email.

Sincerely,  
Kenny Peavy  
Lead Senior CMO | Big Rock Executive Consulting  
https://brexconsulting.com

Existing compliance footer remains unchanged.
