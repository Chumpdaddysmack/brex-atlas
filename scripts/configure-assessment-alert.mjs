// Approved October 5: Kenny-only internal notification. Never enrolls contacts.
import {execFileSync} from "node:child_process";
import {writeFileSync,readFileSync,existsSync} from "node:fs";
import {createHash} from "node:crypto";
const dir=new URL("../docs/",import.meta.url);
const receipt=new URL("assessment-alert-workflow.json",dir);
function api(method,path,body){
  const out=execFileSync("curl",["-sS","--fail-with-body","-X",method,
    "https://api.hubapi.com"+path,"-H","Content-Type: application/json",
    ...(body?["--data-binary",JSON.stringify(body)]:[])],{encoding:"utf8"});
  return out?JSON.parse(out):null;
}
const edge=id=>({edgeType:"STANDARD",nextActionId:id});
const ready={property:"atlas_internal_alert_state",operation:{operator:"IS_ANY_OF",
  includeObjectsWithNoValueSet:false,values:["ready"],operationType:"ENUMERATION"},filterType:"PROPERTY"};
const branch={filterBranches:[],filters:[ready],filterBranchType:"AND",filterBranchOperator:"AND"};
const token=n=>`{{ _0_1.${n} }}`;
function notification(id,incomplete){
  const score=incomplete?"Incomplete: not enough answers to calculate":`${token("atlas_health_score")}/100`;
  return {actionId:id,type:"SINGLE_CONNECTION",actionTypeId:"0-8",actionTypeVersion:0,
    connection:{edgeType:incomplete?"GOTO":"STANDARD",nextActionId:"4"},fields:{user_ids:["78405166"],
      subject:`New Atlas assessment: {{contact.company}} | ${incomplete?"Incomplete":"{{contact.atlas_health_score}}/100"} | {{contact.atlas_cmo_recommendation}}`,
      body:`<p>A prospect completed the Atlas widget assessment.</p>
<p>Name: ${token("firstname")} ${token("lastname")}<br>Company: ${token("company")}<br>Company email: ${token("email")}<br>Website: ${token("website")}<br>Annual revenue: ${token("atlas_revenue_range")}<br>Completed: ${token("atlas_assessment_completed_at")}</p>
<p>Marketing-health score: ${score}<br>Health band: ${token("atlas_health_band")}<br>Preliminary CMO recommendation: ${token("atlas_cmo_recommendation")}</p>
<p>Assessment summary:<br>${token("atlas_assessment_summary")}</p>
<p><a href="https://app-na2.hubspot.com/contacts/242249577/record/0-1/${token("hs_object_id")}">Open prospect in HubSpot</a><br>Assessment ID: ${token("atlas_assessment_id")}<br>Lead source: Atlas Excavator Widget</p>
<p>The health score is based on self-reported answers using the research-informed Brex rubric. It is not a verified audit or a service-fit percentage. The CMO recommendation requires Kenny's review.</p>
<p>This internal alert does not indicate that the prospect requested an email copy or consented to promotional emails.</p>`}};
}
function hash(f){return createHash("sha256").update(JSON.stringify({actions:f.actions,
  enrollmentCriteria:f.enrollmentCriteria,startActionId:f.startActionId,
  suppressionListIds:f.suppressionListIds,timeWindows:f.timeWindows,blockedDates:f.blockedDates})).digest("hex");}
const mode=process.argv[2];
if(mode==="create"){
  if(existsSync(receipt))throw Error("Workflow receipt already exists; inspect instead of creating a duplicate");
  const body={name:"Atlas Completed Assessment — Kenny Internal Alert",isEnabled:false,
    flowType:"WORKFLOW",type:"CONTACT_FLOW",objectTypeId:"0-1",
    startActionId:"1",nextAvailableActionId:"5",timeWindows:[],blockedDates:[],
    customProperties:{},dataSources:[],suppressionListIds:[],canEnrollFromSalesforce:false,
    actions:[
      {actionId:"1",type:"LIST_BRANCH",
        listBranches:[{branchName:"Incomplete assessment",connection:edge("3"),filterBranch:{
          filterBranches:[],filters:[{...ready,property:"atlas_health_band",operation:{...ready.operation,values:["incomplete"]}}],
          filterBranchType:"AND",filterBranchOperator:"AND"}}],
        defaultBranchName:"Scored assessment",defaultBranch:edge("2")},
      notification("2",false),notification("3",true),
      {actionId:"4",type:"SINGLE_CONNECTION",actionTypeId:"0-5",actionTypeVersion:0,
        fields:{property_name:"atlas_internal_alert_state",value:{type:"STATIC_VALUE",staticValue:"queued"}}}],
    enrollmentCriteria:{type:"LIST_BASED",shouldReEnroll:true,
      listFilterBranch:{filterBranches:[branch],filters:[],filterBranchType:"OR",filterBranchOperator:"OR"},
      unEnrollObjectsNotMeetingCriteria:false,reEnrollmentTriggersFilterBranches:[branch]}};
  const r=api("POST","/automation/v4/flows",body);
  writeFileSync(receipt,JSON.stringify({id:r.id},null,2));
  console.log({id:r.id,isEnabled:r.isEnabled});
}else{
  const {id}=JSON.parse(readFileSync(receipt,"utf8"));
  let f=api("GET","/automation/v4/flows/"+id);
  if(mode==="normalize"||mode==="enable"){
    const b=structuredClone(f);
    for(const k of ["id","createdAt","updatedAt","crmObjectCreationStatus"])delete b[k];
    b.isEnabled=mode==="enable";
    b.enrollmentCriteria.shouldReEnroll=true;
    b.enrollmentCriteria.reEnrollmentTriggersFilterBranches=[branch];
    api("PUT","/automation/v4/flows/"+id,b);
    f=api("GET","/automation/v4/flows/"+id);
  }
  const out={id:f.id,hash:hash(f),isEnabled:f.isEnabled,workflow:f};
  writeFileSync(receipt,JSON.stringify(out,null,2));
  console.log(JSON.stringify(out,null,2));
}
