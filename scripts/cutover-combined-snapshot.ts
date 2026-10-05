// Operator-only. Explicit approved cutover; no contacts, sends, or enrollment APIs.
import {execFileSync} from "node:child_process";
import {writeFileSync} from "node:fs";
import {COMBINED_SENDER_ACTIONS,isCombinedSnapshotFlow,publicWorkflowHash,PUBLIC_WORKFLOWS,
  verifyPublicSnapshotSetup} from "../server/snapshot-public-delivery";
const api=async(method:any,path:string,body?:any)=>{
  const out=execFileSync("curl",["-sS","--fail-with-body","--max-time","30","-X",method,
    "https://api.hubapi.com"+path,"-H","Content-Type: application/json",
    ...(body?["--data-binary",JSON.stringify(body)]:[])],{encoding:"utf8"});
  return out.trim()?JSON.parse(out):null;
};
const path="/automation/v4/flows/"+PUBLIC_WORKFLOWS[1].id;
const before=await api("GET",path);
if(process.argv[2]==="apply"){
  if(!before.isEnabled||publicWorkflowHash(before)!==PUBLIC_WORKFLOWS[1].hash)
    throw Error("Sender changed; no automatic retry");
  const desired={...structuredClone(before),actions:structuredClone(COMBINED_SENDER_ACTIONS),
    startActionId:"2",nextAvailableActionId:"4",
    description:"Fresh explicitly requested Atlas assessments: snapshot-bound marketing-health score, preliminary CMO recommendation and results link. Legacy research-only snapshots retain the original email. Consent, marketing eligibility, suppression and no-backfill gates unchanged."};
  await verifyPublicSnapshotSetup(async(m,p,b)=>p===path?desired:api(m,p,b));
  const body:any={...desired};
  for(const k of ["id","createdAt","updatedAt","crmObjectCreationStatus"])delete body[k];
  writeFileSync("/home/user/workspace/public-sender-cutover-backup.json",JSON.stringify(before,null,2));
  await api("PUT",path,body);
}
const after=await api("GET",path);
writeFileSync("/home/user/workspace/public-sender-cutover-readback.json",JSON.stringify(after,null,2));
if(!isCombinedSnapshotFlow(after)&&process.argv[2]==="apply")throw Error("Cutover shape mismatch: inspect readback; never resend");
console.log({id:after.id,revisionId:after.revisionId,enabled:after.isEnabled,
  combined:isCombinedSnapshotFlow(after),mode:await verifyPublicSnapshotSetup(api)});
