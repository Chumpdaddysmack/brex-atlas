// Operator-only: exact approved October 19 copy. Never calls enrollment or send APIs.
import {execFileSync} from "node:child_process";
import {writeFileSync} from "node:fs";
import {isDeepStrictEqual} from "node:util";
import {ALERT_WORKFLOW} from "../server/widget-internal-alert";
import {publicWorkflowHash,COMBINED_SNAPSHOT_EMAIL,COMBINED_EMAIL_UPDATED_AT} from "../server/snapshot-public-delivery";
const root="/home/user/workspace/";
const omitNull=(v:any):any=>Array.isArray(v)?v.map(omitNull):v&&typeof v==="object"
  ?Object.fromEntries(Object.entries(v).filter(([,x])=>x!==null).map(([k,x])=>[k,omitNull(x)])):v;
const api=async(method:string,path:string,body?:any)=>{
  const out=execFileSync("curl",["-sS","--fail-with-body","--max-time","30","-X",method,"https://api.hubapi.com"+path,
    "-H","Content-Type: application/json",...(body?["--data-binary",JSON.stringify(body)]:[])],{encoding:"utf8"});
  return out.trim()?JSON.parse(out):null;
};
const bodyHtml=`<p>A prospect submitted the Atlas widget.</p>
<p>Name: {{ _0_1.firstname }} {{ _0_1.lastname }}<br>Company or submitted domain: {{ _0_1.company }}<br>Company email: {{ _0_1.email }}<br>Website: {{ _0_1.website }}<br>Annual revenue: {{ _0_1.atlas_revenue_range }}<br>Submitted: {{ _0_1.atlas_assessment_completed_at }}</p>
<p>Assessment summary:<br>{{ _0_1.atlas_assessment_summary }}</p>
<p><a href="https://app-na2.hubspot.com/contacts/242249577/record/0-1/{{ _0_1.hs_object_id }}">Open prospect in HubSpot</a><br>Assessment ID: {{ _0_1.atlas_assessment_id }}<br>Lead source: Atlas Excavator Widget</p>
<p>The summary identifies the assessment and its limitations. Growth Readiness and marketing health are different measures; do not compare their scores. V2 does not determine a CMO service tier. Company research may still be running when this inquiry arrives.</p>
<p>This internal alert does not indicate that the prospect requested an email copy or consented to promotional emails.</p>`;
const emailHtml=`<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; color: #0f1824; line-height: 1.5;">
<p>Hi there,</p>
<p>Your requested Atlas assessment and company snapshot are ready.</p>
<p>{{ personalization_token('contact.atlas_snapshot_assessment_recap', 'Incomplete: assessment details are unavailable. Please open your snapshot to review the available results.')|escape|replace('\\n', '<br>') }}</p>
<p>Your assessment is calculated from your self-reported answers using the Brex rubric identified in your results. It is not a verified audit, an industry ranking, or a probability of growth. The one-page Growth Readiness snapshot does not determine a CMO service tier; any service recommendation requires Kenny's review.</p>
<p><strong><a href="{{ personalization_token('contact.atlas_snapshot_url', 'https://brexconsulting.com') }}">View My Assessment &amp; Snapshot</a></strong></p>
<p>Your snapshot includes cited public research so you can review the supporting evidence. The access link expires 10 days after the snapshot was created; requesting another email does not extend that date.</p>
<p>This is an automated preview, not a completed Growth Excavation Report or a consultant-reviewed diagnosis. If you have trouble opening your results, reply to this email.</p>
<p>Sincerely,</p><p style="margin: 0 0 4px; font-weight: 600;">Kenny Peavy</p>
<p style="margin: 0; color: #607382; font-size: 14px;">Lead Senior CMO | Big Rock Executive Consulting</p>
<p style="margin: 4px 0 0; color: #607382; font-size: 14px;"><a href="https://brexconsulting.com" style="color: #00a6fb; text-decoration: none;">brexconsulting.com</a></p></div>`;
const operation=process.argv[2];
if(operation==="draft-email"){
  const path="/marketing/v3/emails/"+COMBINED_SNAPSHOT_EMAIL;
  const before=await api("GET",path),draft=await api("GET",path+"/draft");
  if(before.updatedAt!==COMBINED_EMAIL_UPDATED_AT||!before.isPublished||before.type!=="AUTOMATED_EMAIL")
    throw Error("Live email changed; review before editing");
  if(!isDeepStrictEqual(omitNull(before.content),omitNull(draft.content)))throw Error("Unpublished edits already exist; do not overwrite");
  writeFileSync(root+"v2-email-before.json",JSON.stringify(before,null,2));
  const content=structuredClone(before.content);
  if(!content.widgets?.primary_rich_text_module?.body?.html)throw Error("Expected content module missing");
  content.widgets.primary_rich_text_module.body.html=emailHtml;
  await api("PATCH",path+"/draft",{content});
  const after=await api("GET",path+"/draft");
  if(after.content.widgets.primary_rich_text_module.body.html!==emailHtml)throw Error("Draft readback mismatch");
  writeFileSync(root+"v2-email-draft-readback.json",JSON.stringify(after,null,2));
  console.log({draftSaved:true,emailId:before.id,liveUnchanged:(await api("GET",path)).updatedAt===before.updatedAt});
}else if(operation==="publish-email"){
  const draft=await api("GET","/marketing/v3/emails/"+COMBINED_SNAPSHOT_EMAIL+"/draft");
  if(draft.content?.widgets?.primary_rich_text_module?.body?.html!==emailHtml)throw Error("Approved draft mismatch");
  // Existing automated email only: never regular/batch email, no recipient list, no send payload.
  if(draft.type!=="AUTOMATED_EMAIL")throw Error("Not an automated email");
  await api("POST","/marketing/emails/2026-03/"+COMBINED_SNAPSHOT_EMAIL+"/publish");
  const after=await api("GET","/marketing/v3/emails/"+COMBINED_SNAPSHOT_EMAIL);
  writeFileSync(root+"v2-email-live-readback.json",JSON.stringify(after,null,2));
  console.log({published:after.isPublished,updatedAt:after.updatedAt,copyMatches:after.content.widgets.primary_rich_text_module.body.html===emailHtml});
}else if(operation==="apply-alert"){
  const path="/automation/v4/flows/"+ALERT_WORKFLOW.id,before=await api("GET",path);
  if(!before.isEnabled||publicWorkflowHash(before)!==ALERT_WORKFLOW.hash)throw Error("Alert changed; inspect instead of retrying");
  writeFileSync(root+"v2-alert-before.json",JSON.stringify(before,null,2));
  const desired=structuredClone(before);
  for(const action of desired.actions)if(["2","3"].includes(action.actionId)){
    if(action.actionTypeId!=="0-8"||String(action.fields.user_ids)!=="78405166")throw Error("Unexpected notification audience");
    action.fields.subject="New Atlas inquiry: {{contact.company}}";action.fields.body=bodyHtml;
  }
  const payload={...desired};
  for(const k of ["id","createdAt","updatedAt","crmObjectCreationStatus"])delete payload[k];
  await api("PUT",path,payload);
  const after=await api("GET",path);
  writeFileSync(root+"v2-alert-readback.json",JSON.stringify(after,null,2));
  if(publicWorkflowHash(after)!==publicWorkflowHash(desired))throw Error("Workflow readback mismatch");
  console.log({updated:true,enabled:after.isEnabled,hash:publicWorkflowHash(after)});
}else throw Error("Choose draft-email, publish-email, or apply-alert");
