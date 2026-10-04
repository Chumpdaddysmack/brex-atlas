// Operator utility. Default is read-only; explicit prepare/enable phases only.
import {execFileSync} from "node:child_process";
import {readFileSync,writeFileSync,existsSync} from "node:fs";
import {createHash} from "node:crypto";
const output="/home/user/workspace/snapshot-public-workflows.json";
const api=(method,path,body)=>{
  const s=execFileSync("curl",["-sS","--fail-with-body","--max-time","30","-X",method,
    "https://api.hubapi.com"+path,"-H","Content-Type: application/json",
    ...(body?["--data-binary",JSON.stringify(body)]:[])],{encoding:"utf8"});
  return s.trim()?JSON.parse(s):null;
};
const version="atlas-snapshot-delivery-v1-2026-10-03";
const legacy=["5015673537","5014906568","5051336409","5051781861"];
const shape=f=>({actions:f.actions,enrollmentCriteria:f.enrollmentCriteria,startActionId:f.startActionId,
  suppressionListIds:f.suppressionListIds,timeWindows:f.timeWindows,blockedDates:f.blockedDates});
const digest=f=>createHash("sha256").update(JSON.stringify(shape(f))).digest("hex");
const clean=f=>{const b=structuredClone(f);for(const k of ["id","createdAt","updatedAt","crmObjectCreationStatus"])delete b[k];return b;};
function isolation(){
  for(const id of legacy)if(api("GET","/automation/v4/flows/"+id).isEnabled!==false)
    throw Error("Legacy workflow is enabled: "+id);
}
function emptyReady(){
  const r=api("POST","/crm/v3/objects/contacts/search",{filterGroups:[{filters:[
    {propertyName:"atlas_snapshot_delivery_state",operator:"EQ",value:"ready"},
    {propertyName:"atlas_snapshot_permission_version",operator:"EQ",value:version},
    {propertyName:"atlas_snapshot_email_permission",operator:"EQ",value:"true"},
  ]}],properties:["atlas_snapshot_request_id"],limit:1});
  if(r.total!==0)throw Error("Existing eligible records: activation held");
}
const phase=process.argv[2]||"read";
isolation();
if(phase==="prepare"){
  if(existsSync(output))throw Error("Creation receipt exists; do not duplicate");
  const listed=api("GET","/automation/v4/flows");
  if(!Array.isArray(listed.results)||listed.paging?.next)throw Error("Incomplete workflow list");
  if(listed.results.some(f=>f.name.startsWith("Atlas Snapshot PUBLIC —")))throw Error("Public workflows already exist; inspect");
  emptyReady();
  const base=api("GET","/automation/v4/flows/5051336409");
  const body=clean(base);delete body.revisionId;
  const branch=body.enrollmentCriteria.listFilterBranch.filterBranches[0];
  branch.filters=branch.filters.filter(f=>!["email","atlas_snapshot_request_id","hs_marketable_status"].includes(f.property));
  body.enrollmentCriteria.shouldReEnroll=true;
  body.enrollmentCriteria.reEnrollmentTriggersFilterBranches=[{
    filterBranches:[],filters:branch.filters.filter(f=>f.property==="atlas_snapshot_delivery_state"),
    filterBranchType:"AND",filterBranchOperator:"AND",
  }];
  body.enrollmentCriteria.unEnrollObjectsNotMeetingCriteria=true;
  body.isEnabled=false;
  body.description="Fresh explicitly requested results only. App validates permission and exclusively claims each request before ready. No scores, promotions, historical enrollment, or subscription overrides. Native maximum remains 2000.";
  const receipt={createdAt:new Date().toISOString(),workflows:[]};
  for(const kind of ["status","sender"]){
    const b=structuredClone(body);
    b.name=kind==="status"?"Atlas Snapshot PUBLIC — Marketing eligibility":"Atlas Snapshot PUBLIC — Results delivery";
    b.actions=kind==="status"?[{actionId:"1",actionTypeId:"0-31",actionTypeVersion:14,
      fields:{targetContact:"{{ enrolled_object }}",marketableType:"MARKETABLE"},type:"SINGLE_CONNECTION"}]:base.actions;
    b.enrollmentCriteria.listFilterBranch.filterBranches[0].filters.push({
      property:"hs_marketable_status",operation:{operator:"IS_EQUAL_TO",includeObjectsWithNoValueSet:kind==="status",
        value:kind==="sender",operationType:"BOOL"},filterType:"PROPERTY"});
    const made=api("POST","/automation/v4/flows",b);
    if(!made?.id)throw Error("Unconfirmed creation; inspect before retrying");
    const f=api("GET","/automation/v4/flows/"+made.id);
    receipt.workflows.push({kind,id:f.id,hash:digest(f),flow:f});
    writeFileSync(output,JSON.stringify(receipt,null,2));
    if(f.isEnabled!==false||f.enrollmentCriteria.shouldReEnroll!==true)throw Error("Draft readback mismatch");
  }
  console.log(JSON.stringify(receipt));
}else if(phase==="normalize-enum"){
  // HubSpot normalized only the re-enrollment condition on create. Use the
  // property's actual ENUMERATION schema in both places so they stay equal.
  const r=JSON.parse(readFileSync(output,"utf8"));emptyReady();
  for(const w of r.workflows){
    const f=api("GET","/automation/v4/flows/"+w.id),b=clean(f);
    b.isEnabled=false;
    const filters=b.enrollmentCriteria.listFilterBranch.filterBranches[0].filters;
    const state=filters.find(f=>f.property==="atlas_snapshot_delivery_state");
    state.operation={operator:"IS_ANY_OF",includeObjectsWithNoValueSet:false,values:["ready"],operationType:"ENUMERATION"};
    b.enrollmentCriteria.reEnrollmentTriggersFilterBranches=[{filterBranches:[],filters:[structuredClone(state)],
      filterBranchType:"AND",filterBranchOperator:"AND"}];
    api("PUT","/automation/v4/flows/"+w.id,b);
    const check=api("GET","/automation/v4/flows/"+w.id);
    if(check.isEnabled||check.enrollmentCriteria.reEnrollmentTriggersFilterBranches.length!==1)
      throw Error("Enum trigger normalization not retained");
    w.flow=check;w.hash=digest(check);
    writeFileSync(output,JSON.stringify(r,null,2));
  }
  console.log(JSON.stringify(r.workflows.map(w=>({kind:w.kind,id:w.id,hash:w.hash}))));
}else if(phase==="enable"){
  const r=JSON.parse(readFileSync(output,"utf8"));emptyReady();
  if(r.workflows.length!==2)throw Error("Incomplete preparation");
  for(const w of r.workflows){
    const f=api("GET","/automation/v4/flows/"+w.id);
    if(digest(f)!==w.hash)throw Error("Workflow changed");
    if(!f.isEnabled)api("PUT","/automation/v4/flows/"+w.id,{...clean(f),isEnabled:true});
    const check=api("GET","/automation/v4/flows/"+w.id);
    if(!check.isEnabled||digest(check)!==w.hash)throw Error("Activation readback failed");
    w.flow=check;
  }
  writeFileSync(output,JSON.stringify(r,null,2));console.log(JSON.stringify(r));
}else if(phase==="read"){
  console.log(JSON.stringify(existsSync(output)?JSON.parse(readFileSync(output,"utf8")).workflows.map(w=>{
    const f=api("GET","/automation/v4/flows/"+w.id);return {id:w.id,isEnabled:f.isEnabled,hash:digest(f),expected:w.hash};
  }):{prepared:false}));
}else throw Error("Unknown phase");
