// This replaces NO existing workflow. Never use the older enabled-pilot script.
import {execFileSync} from "node:child_process";
import {writeFileSync} from "node:fs";
const name="Atlas Snapshot Delivery - Kenny Only NO SEND Test";
const property=(name,operation)=>({filterType:"PROPERTY",property:name,
  operation:{includeObjectsWithNoValueSet:false,...operation}});
const known=name=>property(name,{operationType:"ALL_PROPERTY",operator:"IS_KNOWN"});
const equals=(name,value)=>property(name,{operationType:"MULTISTRING",operator:"IS_EQUAL_TO",values:[value]});
const payload={
  name,description:"DISABLED no-send test shell. No actions. Do not add email actions or enable before approved cutover and end-to-end checks.",
  type:"CONTACT_FLOW",flowType:"WORKFLOW",objectTypeId:"0-1",isEnabled:false,
  canEnrollFromSalesforce:false,actions:[],timeWindows:[],blockedDates:[],
  customProperties:{},dataSources:[],suppressionListIds:[],
  enrollmentCriteria:{type:"LIST_BASED",shouldReEnroll:false,
    listFilterBranch:{filterBranches:[{filterBranches:[],filters:[
      equals("email","kenny@brexconsulting.com"),
      known("atlas_snapshot_request_id"),known("atlas_snapshot_id"),known("atlas_snapshot_url"),
      known("atlas_snapshot_expires_at"),
      equals("atlas_snapshot_permission_version","atlas-snapshot-delivery-v1-2026-10-03"),
      property("atlas_snapshot_email_permission",{operationType:"BOOL",operator:"IS_EQUAL_TO",value:true}),
      equals("atlas_snapshot_delivery_state","ready"),
    ],filterBranchType:"AND",filterBranchOperator:"AND"}],filters:[],filterBranchType:"OR",filterBranchOperator:"OR"},
    reEnrollmentTriggersFilterBranches:[],unEnrollObjectsNotMeetingCriteria:true},
};
// Default prints a proposed payload only. Explicit switch required for creation.
if(!process.argv.includes("--create-disabled")){
  console.log(JSON.stringify(payload,null,2));
}else{
  const api=(method,path,body)=>JSON.parse(execFileSync("curl",[
    "--silent","--show-error","--fail-with-body","--max-time","30","-X",method,
    "https://api.hubapi.com"+path,"-H","Content-Type: application/json",
    ...(body?["--data-binary",JSON.stringify(body)]:[]),
  ],{encoding:"utf8"}));
  const listed=api("GET","/automation/v4/flows");
  if(!Array.isArray(listed.results)||listed.paging?.next)throw new Error("Complete workflow listing required.");
  const matches=listed.results.filter(x=>x.name===name);
  if(matches.length>1)throw new Error("Ambiguous workflow name.");
  const found=matches[0]||api("POST","/automation/v4/flows",payload);
  if(!found.id)throw new Error("No workflow ID.");
  const verified=api("GET",`/automation/v4/flows/${found.id}`);
  if(verified.isEnabled!==false || verified.actions?.length!==0
      || verified.enrollmentCriteria?.shouldReEnroll!==false)
    throw new Error("No-send safeguards not verified. No automatic update attempted.");
  const receipt={...verified,url:`https://app-na2.hubspot.com/workflows/242249577/platform/flow/${found.id}/edit`};
  writeFileSync("/home/user/workspace/snapshot-no-send-workflow-receipt.json",JSON.stringify(receipt,null,2));
  console.log(JSON.stringify(receipt,null,2));
}
