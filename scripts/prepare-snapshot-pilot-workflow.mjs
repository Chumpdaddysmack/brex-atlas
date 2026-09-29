// User-approved Sep 28: future snapshot requests from Kenny's contact only.
// Does not subscribe, promote, enroll or update any contact.
import {execFileSync} from "node:child_process";
import fs from "node:fs";
const api=(method,path,body)=>JSON.parse(execFileSync("curl",[
  "--silent","--show-error","--fail-with-body","--max-time","30","-X",method,
  "https://api.hubapi.com"+path,"-H","Content-Type: application/json",
  ...(body?["--data-binary",JSON.stringify(body)]:[]),
],{encoding:"utf8"}));
const property=(name,operation)=>({filterType:"PROPERTY",property:name,
  operation:{includeObjectsWithNoValueSet:false,...operation}});
const known=name=>property(name,{operationType:"ALL_PROPERTY",operator:"IS_KNOWN"});
const branch=filters=>({filterBranches:[],filters,filterBranchType:"AND",filterBranchOperator:"AND"});
const criteria=branch([
  property("email",{operationType:"STRING",operator:"IS_EQUAL_TO",value:"kenny@brexconsulting.com"}),
  property("hs_object_id",{operationType:"NUMBER",operator:"IS_EQUAL_TO",value:559647691455}),
  known("atlas_snapshot_id"),known("atlas_snapshot_url"),known("atlas_snapshot_requested_at"),
  property("hs_marketable_status",{operationType:"BOOL",operator:"IS_EQUAL_TO",value:true}),
]);
const payload={
  name:"Atlas Snapshot Recap - Kenny Only Controlled Test",
  type:"CONTACT_FLOW",flowType:"WORKFLOW",objectTypeId:"0-1",
  isEnabled:true,canEnrollFromSalesforce:false,startActionId:"1",nextAvailableActionId:"2",
  enrollmentCriteria:{type:"LIST_BASED",shouldReEnroll:true,
    listFilterBranch:{filterBranches:[criteria],filters:[],filterBranchType:"OR",filterBranchOperator:"OR"},
    reEnrollmentTriggersFilterBranches:[branch([known("atlas_snapshot_id")])],
    unEnrollObjectsNotMeetingCriteria:true},
  timeWindows:[],blockedDates:[],customProperties:{},dataSources:[],suppressionListIds:[],
  actions:[{actionId:"1",actionTypeVersion:0,actionTypeId:"0-4",
    type:"SINGLE_CONNECTION",fields:{content_id:"402560948984"}}],
};
const listed=api("GET","/automation/v4/flows");
if(!Array.isArray(listed.results)||listed.paging?.next)throw new Error("Inspect full workflow list before creation");
const found=listed.results.find(x=>x.name===payload.name);
const result=found?api("GET",`/automation/v4/flows/${found.id}`):api("POST","/automation/v4/flows",payload);
if(!result.id)throw new Error("No workflow ID returned");
const verified=api("GET",`/automation/v4/flows/${result.id}`);
fs.writeFileSync("/home/user/workspace/snapshot-pilot-workflow-receipt.json",JSON.stringify(verified,null,2));
console.log(JSON.stringify({id:verified.id,name:verified.name,isEnabled:verified.isEnabled,
  enrollmentCriteria:verified.enrollmentCriteria,actions:verified.actions}));
