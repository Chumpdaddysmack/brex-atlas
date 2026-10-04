import {loadSnapshotPilotReceipt} from "./snapshot-pilot";
import {validateSnapshotReceipt,type SnapshotReceipt} from "./snapshot-subscriptions";
import {evaluateSnapshotReadiness,type DryRunEvidence,type ReadinessPlan} from "./snapshot-readiness";
import {SnapshotDryRunQueue} from "./snapshot-dry-run-queue";

/** Server-side store reader only; never accept permission or identity from a public request body. */
export async function stageStoredSnapshot(
  queue:SnapshotDryRunQueue,input:{requestId:string;snapshotUrl:string},
  read:(id:string)=>Promise<{request:any;snapshot:any}>,cutoff:string,now=Date.now(),
){
  const after=Date.parse(cutoff);
  if(!Number.isFinite(after)||after>now)throw new Error("Invalid staging cutoff");
  const receipt=await loadSnapshotPilotReceipt(input.requestId,input.snapshotUrl,async id=>{
    const stored=await read(id);
    if(stored.request?.consent_evidence?.liveEmailTest||stored.request?.consent_evidence?.noSendPilot||stored.request?.consent_evidence?.websiteNoSend)
      throw new Error("Prior test receipts cannot enter public staging");
    if(Date.parse(stored.request?.requested_at)<=after)throw new Error("Historical receipt");
    return stored;
  },now);
  return queue.enqueue(receipt,now);
}

export interface ReadOnlySnapshotInputs {
  readEvidence(receipt:SnapshotReceipt,signal:AbortSignal):Promise<DryRunEvidence>;
}
/** One queue iteration. Intentionally no subscribe, CRM-write, enroll or send methods. */
export async function runSnapshotDryRunOnce(
  queue:SnapshotDryRunQueue,inputs:ReadOnlySnapshotInputs,
  options:{enabled?:boolean;now?:()=>number;readTimeoutMs?:number}={},
){
  if(options.enabled!==true)return {status:"disabled",sendingEnabled:false};
  const now=options.now||Date.now,job=queue.claim(now());
  if(!job)return {status:"idle",sendingEnabled:false};
  let receipt:SnapshotReceipt;
  try{receipt=queue.receipt(job,now());}
  catch{
    const plan:ReadinessPlan={status:"review",reason:"stored_payload_unreadable",actions:[],sendingEnabled:false};
    return {status:queue.finish(job,plan,now())?"review":"lease_lost",sendingEnabled:false};
  }
  try{validateSnapshotReceipt(receipt,now());}catch{
    const plan:ReadinessPlan={status:"blocked",reason:"invalid_or_expired_receipt",actions:[],sendingEnabled:false};
    return {status:queue.finish(job,plan,now())?"blocked":"lease_lost",sendingEnabled:false};
  }
  const controller=new AbortController();
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    const ms=Math.min(10_000,Math.max(10,options.readTimeoutMs||10_000));
    const evidence=await Promise.race([
      inputs.readEvidence(receipt,controller.signal),
      new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error("Read timed out"));},ms);}),
    ]);
    const plan=evaluateSnapshotReadiness(receipt,evidence,now());
    return {status:queue.finish(job,plan,now())?plan.status:"lease_lost",sendingEnabled:false,plan};
  }catch{
    return {status:queue.readFailed(job,now())?"read_retry_or_review":"lease_lost",sendingEnabled:false};
  }finally{if(timer)clearTimeout(timer);controller.abort();}
}

/** Bounded scheduler; calling with disabled/default options performs zero reads. */
export async function runSnapshotDryRunBatch(
  queue:SnapshotDryRunQueue,inputs:ReadOnlySnapshotInputs,
  options:{enabled?:boolean;maxJobs?:number;now?:()=>number}={},
){
  const results=[];
  for(let i=0;i<Math.min(100,Math.max(1,options.maxJobs||20));i++){
    const item=await runSnapshotDryRunOnce(queue,inputs,options);
    results.push(item);
    if(item.status==="idle"||item.status==="disabled")break;
  }
  return {sendingEnabled:false,results};
}
