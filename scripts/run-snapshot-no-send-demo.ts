import {mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {randomBytes} from "node:crypto";
import {SnapshotDryRunQueue} from "../server/snapshot-dry-run-queue";
import {dryRunFixture} from "../server/snapshot-dry-run-fixtures";
import {stageStoredSnapshot,runSnapshotDryRunBatch} from "../server/snapshot-dry-run-worker";

// This script has no network transport, production credentials, or email port.
// Its optional output contains scenario names and decisions, not recipients/links.
if(!process.argv.includes("--run-no-send")){
  console.log(JSON.stringify({status:"disabled",sendingEnabled:false,
    usage:"npx tsx scripts/run-snapshot-no-send-demo.ts --run-no-send [--output=report.json]"}));
}else{
  const directory=mkdtempSync(join(tmpdir(),"atlas-worker-demo-")),key=randomBytes(32);
  const queue=new SnapshotDryRunQueue(join(directory,"demo.dry-run.sqlite"),key);
  try{
    const now=Date.now(),scenarios=[
      ["eligible",(_f:any)=>{}],
      ["new_contact",(f:any)=>{f.evidence.contact=null;f.evidence.preferences.snapshot="NOT_SPECIFIED";}],
      ["opted_out",(f:any)=>{f.evidence.preferences.snapshot="UNSUBSCRIBED";}],
      ["cap_reached",(f:any)=>{f.evidence.contact!.hs_marketable_status="false";f.evidence.billing.current=2000;}],
      ["mismatched_link",(f:any)=>{f.evidence.contact!.atlas_snapshot_url="https://wrong.example.invalid";}],
      ["unknown_previous_send",(f:any)=>{f.evidence.contact!.atlas_snapshot_delivery_state="uncertain";}],
    ] as const;
    const records=new Map();
    for(const [name,change] of scenarios){
      const f=dryRunFixture(now);change(f);records.set(f.receipt.requestId,{name,...f});
      await stageStoredSnapshot(queue,{requestId:f.receipt.requestId,snapshotUrl:f.receipt.snapshotUrl},
        async()=>f.stored,new Date(now-5000).toISOString(),now);
    }
    await runSnapshotDryRunBatch(queue,{readEvidence:async r=>records.get(r.requestId).evidence},
      {enabled:true,now:()=>now,maxJobs:10});
    const report={mode:"local-synthetic-no-send",sendingEnabled:false,
      networkRequests:0,crmWrites:0,subscriptionWrites:0,workflowEnrollments:0,emailSends:0,
      scenarios:queue.summary().map(r=>({scenario:records.get(r.request_id).name,state:r.state,
        checks:r.attempts,...r.result}))};
    console.log(JSON.stringify(report,null,2));
    const output=process.argv.find(x=>x.startsWith("--output="))?.slice("--output=".length);
    if(output)writeFileSync(resolve(output),JSON.stringify(report,null,2)+"\n",{mode:0o600});
  }finally{queue.close();key.fill(0);rmSync(directory,{recursive:true,force:true});}
}
