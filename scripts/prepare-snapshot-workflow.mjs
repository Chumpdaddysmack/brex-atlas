// Creates a DISABLED workflow using the exact approved internal notification.
// Run only with the user's approved HubSpot credential proxy. No contacts enrolled.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
const api=(method,path,body)=>JSON.parse(execFileSync("curl",[
  "--silent","--show-error","--max-time","30","-X",method,
  "https://api.hubapi.com"+path,"-H","Content-Type: application/json",
  ...(body?["--data-binary",JSON.stringify(body)]:[]),
],{encoding:"utf8"}));
const criterion={filterBranches:[],filters:[{property:"atlas_snapshot_id",
  operation:{operator:"IS_KNOWN",includeObjectsWithNoValueSet:false,operationType:"ALL_PROPERTY"},
  filterType:"PROPERTY"}],filterBranchType:"AND",filterBranchOperator:"AND"};
const payload={
  name:"Atlas Research Snapshot Request — Internal Review",
  type:"CONTACT_FLOW",flowType:"WORKFLOW",objectTypeId:"0-1",isEnabled:false,startActionId:"1",nextAvailableActionId:"2",
  enrollmentCriteria:{type:"LIST_BASED",shouldReEnroll:true,
    listFilterBranch:{filterBranches:[criterion],filters:[],filterBranchType:"OR",filterBranchOperator:"OR"},
    reEnrollmentTriggersFilterBranches:[criterion],unEnrollObjectsNotMeetingCriteria:false},
  timeWindows:[],blockedDates:[],customProperties:{},dataSources:[],suppressionListIds:[],
  actions:[{actionId:"1",actionTypeVersion:0,actionTypeId:"0-8",type:"SINGLE_CONNECTION",
    fields:{user_ids:["78405166"],
      subject:"New Atlas research snapshot request: {{contact.company}}",
      body:"<p>A prospect requested a Company &amp; Positioning Snapshot.</p><p>Company: {{ _0_1.company }}<br>Email: {{ _0_1.email }}<br>Website: {{ _0_1.website }}<br>Snapshot: {{ _0_1.atlas_snapshot_url }}<br>HubSpot contact: https://app-na2.hubspot.com/contacts/242249577/record/0-1/{{ _0_1.hs_object_id }}</p><p>Qualification pending. This research preview does not assign a score or recommend a CMO tier.</p>"
    }}]
};
const listed=api("GET","/automation/v4/flows");
if(!Array.isArray(listed.results))throw new Error(JSON.stringify(listed));
const existing=listed.results.find(x=>x.name===payload.name);
let result=existing?api("GET",`/automation/v4/flows/${existing.id}`):api("POST","/automation/v4/flows",payload);
if(!result.id)throw new Error(JSON.stringify(result));
// Explicit user approval for activation received September 28, 2026, 2:04 PM PDT.
if(process.argv.includes("--enable")){
  const updated=api("PUT",`/automation/v4/flows/${result.id}`,{
    ...payload,isEnabled:true,revisionId:result.revisionId,
  });
  if(updated.status==="error")throw new Error(JSON.stringify(updated));
  result=api("GET",`/automation/v4/flows/${result.id}`);
  if(result.isEnabled!==true)throw new Error("Workflow activation was not confirmed.");
}
fs.writeFileSync("/home/user/workspace/snapshot-workflow-receipt.json",JSON.stringify(result,null,2));
console.log(JSON.stringify({id:result.id,name:result.name,isEnabled:result.isEnabled}));
