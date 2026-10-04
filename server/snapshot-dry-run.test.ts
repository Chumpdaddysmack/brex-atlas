import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomBytes,randomUUID} from "node:crypto";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import Database from "better-sqlite3";
import {SnapshotDryRunQueue} from "./snapshot-dry-run-queue";
import {evaluateSnapshotReadiness} from "./snapshot-readiness";
import {runSnapshotDryRunOnce,runSnapshotDryRunBatch,stageStoredSnapshot} from "./snapshot-dry-run-worker";
import {dryRunFixture} from "./snapshot-dry-run-fixtures";

const now=Date.parse("2026-10-04T02:00:00Z");
function sandbox(){
  const dir=mkdtempSync(join(tmpdir(),"atlas-no-send-")),path=join(dir,"jobs.dry-run.sqlite"),key=randomBytes(32);
  const q=new SnapshotDryRunQueue(path,key);
  return {dir,path,key,q,clean:()=>{q.close();rmSync(dir,{recursive:true,force:true});}};
}
test("eligible public-recipient fixture produces no-send result, not live authorization",()=>{
  const f=dryRunFixture(now);
  assert.deepEqual(evaluateSnapshotReadiness(f.receipt,f.evidence,now),{
    status:"eligible_no_send",reason:"read_checks_passed_no_send_authorized",actions:[],sendingEnabled:false});
});
test("new and non-marketing contacts produce narrow proposed changes only",()=>{
  const f=dryRunFixture(now);f.evidence.contact=null;f.evidence.preferences.snapshot="NOT_SPECIFIED";
  const out=evaluateSnapshotReadiness(f.receipt,f.evidence,now);
  assert.equal(out.status,"needs_preparation");
  assert.deepEqual(out.actions,["sync_request_fields","subscribe_snapshot_only","mark_marketing_contact"]);
  f.receipt.marketingChoice="accepted";
  assert.deepEqual(evaluateSnapshotReadiness(f.receipt,f.evidence,now).actions,out.actions);
});
test("permission, opt-outs, suppressions, and terminal requests block without proposed writes",()=>{
  const changes=[(f:any)=>{f.receipt.permission.decision="declined";},
    (f:any)=>{f.receipt.expiresAt=new Date(now).toISOString();},
    (f:any)=>{f.evidence.preferences.snapshot="UNSUBSCRIBED";},
    (f:any)=>{f.evidence.preferences.globallyBlocked=true;},
    (f:any)=>{f.evidence.contact.hs_email_bad_address="true";},
    (f:any)=>{f.evidence.contact.hs_email_quarantined="true";},
    (f:any)=>{f.evidence.contact.hs_email_optout="true";},
    (f:any)=>{f.evidence.contact.hs_email_hard_bounce_reason_enum="UNKNOWN_USER";},
    ...["sent","delivered","failed","blocked"].map(state=>(f:any)=>{f.evidence.contact.atlas_snapshot_delivery_state=state;})];
  for(const change of changes){const f=dryRunFixture(now);change(f);
    const out=evaluateSnapshotReadiness(f.receipt,f.evidence,now);
    assert.equal(out.status,"blocked");assert.deepEqual(out.actions,[]);}
});
test("unknown, stale, conflicting, or mismatched evidence goes to review",()=>{
  const changes=[(f:any)=>{delete f.evidence.contact.hs_email_optout;},
    (f:any)=>{f.evidence.contact.hs_email_quarantined="maybe";},
    (f:any)=>{f.evidence.contact.hs_marketable_status=null;},
    (f:any)=>{f.evidence.contact.email="other@example.invalid";},
    (f:any)=>{f.evidence.contact.atlas_snapshot_url=f.receipt.snapshotUrl.replace(/a$/,"b");},
    (f:any)=>{f.evidence.contact.atlas_snapshot_request_id="other-request";},
    (f:any)=>{f.evidence.contact.atlas_snapshot_delivery_state="uncertain";},
    (f:any)=>{f.evidence.contact.atlas_snapshot_delivery_state=null;},
    (f:any)=>{f.evidence.preferences.checkedAt=now-60001;},
    (f:any)=>{f.evidence.preferences.email="other@example.invalid";},
    (f:any)=>{f.evidence.contactCheckedAt=now+1;},
    (f:any)=>{f.evidence.email.published=false;},
    (f:any)=>{f.evidence.email.subscriptionId="711496982";},
    (f:any)=>{f.evidence.email.checkedAt=now-60001;},
    (f:any)=>{f.evidence.billing.checkedAt=now-60001;},
    (f:any)=>{f.evidence.billing.capVerified=false;},
    (f:any)=>{f.evidence.billing.cap=10000;},
    (f:any)=>{f.evidence.billing.reserved=-1;}];
  for(const change of changes){const f=dryRunFixture(now);change(f);
    const out=evaluateSnapshotReadiness(f.receipt,f.evidence,now);
    assert.equal(out.status,"review");assert.deepEqual(out.actions,[]);}
});
test("marketing cap includes reservations; eligible existing marketing contacts need no new slot",()=>{
  const f=dryRunFixture(now);f.evidence.billing.current=1999;f.evidence.billing.reserved=1;
  f.evidence.contact!.hs_marketable_status="false";
  assert.equal(evaluateSnapshotReadiness(f.receipt,f.evidence,now).reason,"marketing_cap_reached");
  f.evidence.contact!.hs_marketable_status="true";
  assert.equal(evaluateSnapshotReadiness(f.receipt,f.evidence,now).status,"eligible_no_send");
});
test("queue encrypts link and email, binds immutable identity, and preserves duplicates after restart",()=>{
  const s=sandbox(),f=dryRunFixture(now);
  try{
    assert.equal(s.q.enqueue(f.receipt,now),"queued");
    assert.equal(s.q.enqueue(f.receipt,now),"duplicate");
    assert.equal(s.q.enqueue({...f.receipt,marketingChoice:"accepted"},now),"receipt_mismatch");
    assert.equal(s.q.enqueue({...f.receipt,requestId:randomUUID()},now),"recipient_busy");
    const bytes=readFileSync(s.path);
    assert.equal(bytes.includes(Buffer.from(f.receipt.email)),false);
    assert.equal(bytes.includes(Buffer.from(f.receipt.snapshotUrl)),false);
    const reopened=new SnapshotDryRunQueue(s.path,s.key);
    assert.equal(reopened.enqueue(f.receipt,now),"duplicate");reopened.close();
    assert.throws(()=>new SnapshotDryRunQueue(s.path,randomBytes(32)),/key mismatch/);
  }finally{s.clean();}
});
test("stored loader rejects historic, mismatched, and prior test receipts before queue",async()=>{
  const s=sandbox();
  try{
    for(const change of [
      (f:any)=>{f.stored.request.consent_evidence.liveEmailTest="old-test";},
      (f:any)=>{f.stored.request.consent_evidence.noSendPilot=true;},
      (f:any)=>{f.stored.request.consent_evidence.websiteNoSend="kenny-website-no-send-v1";},
      (f:any)=>{f.stored.request.requested_at=new Date(now-60000).toISOString();},
      (f:any)=>{f.stored.snapshot.token_hash="0".repeat(64);},
      (f:any)=>{delete f.stored.request.consent_evidence.snapshotDelivery;},
    ]){
      const f=dryRunFixture(now);change(f);
      await assert.rejects(()=>stageStoredSnapshot(s.q,{requestId:f.receipt.requestId,snapshotUrl:f.receipt.snapshotUrl},
        async()=>f.stored,new Date(now-2000).toISOString(),now));
    }
    assert.equal(s.q.summary().length,0);
    const f=dryRunFixture(now);
    assert.equal(await stageStoredSnapshot(s.q,{requestId:f.receipt.requestId,snapshotUrl:f.receipt.snapshotUrl},
      async()=>f.stored,new Date(now-2000).toISOString(),now),"queued");
  }finally{s.clean();}
});
test("worker default is disabled; enabled batch evaluates without mutation capabilities",async()=>{
  const s=sandbox(),f=dryRunFixture(now);let reads=0;
  const inputs={readEvidence:async()=>{reads++;return f.evidence;}};
  try{
    s.q.enqueue(f.receipt,now);
    assert.equal((await runSnapshotDryRunOnce(s.q,inputs,{now:()=>now})).status,"disabled");
    assert.equal(reads,0);
    const out=await runSnapshotDryRunBatch(s.q,inputs,{enabled:true,now:()=>now});
    assert.equal(out.results[0].status,"eligible_no_send");
    assert.equal(out.results[1].status,"idle");
    assert.equal(reads,1);
    assert.equal(s.q.summary()[0].state,"completed");
    assert.equal((await runSnapshotDryRunOnce(s.q,inputs,{enabled:true,now:()=>now})).status,"idle");
    assert.equal(s.q.enqueue(f.receipt,now),"duplicate");
    const db=new Database(s.path);assert.equal((db.prepare("SELECT payload FROM dry_run_jobs").get() as any).payload,null);db.close();
  }finally{s.clean();}
});
test("read-only retry is bounded and review keeps recipient lock",async()=>{
  const s=sandbox(),f=dryRunFixture(now);let clock=now,reads=0;
  try{
    s.q.enqueue(f.receipt,now);
    const inputs={readEvidence:async()=>{reads++;throw new Error("Secret provider response must not be logged");}};
    for(let i=0;i<3;i++){
      assert.equal((await runSnapshotDryRunOnce(s.q,inputs,{enabled:true,now:()=>clock})).status,"read_retry_or_review");
      clock+=10_000;
    }
    assert.equal(s.q.summary()[0].state,"review");assert.equal(reads,3);
    assert.equal(s.q.summary()[0].result.reason,"read_retry_limit");
    assert.equal(JSON.stringify(s.q.summary()).includes("Secret"),false);
    assert.equal(s.q.enqueue({...f.receipt,requestId:randomUUID()},clock),"recipient_busy");
  }finally{s.clean();}
});
test("timeout aborts a read and queues only a read retry",async()=>{
  const s=sandbox(),f=dryRunFixture(now);let aborted=false;
  try{
    s.q.enqueue(f.receipt,now);
    await runSnapshotDryRunOnce(s.q,{readEvidence:async(_,signal)=>{
      signal.addEventListener("abort",()=>{aborted=true;});return new Promise(()=>{});
    }},{enabled:true,now:()=>now,readTimeoutMs:10});
    assert.equal(aborted,true);assert.equal(s.q.summary()[0].state,"retry");
  }finally{s.clean();}
});
test("restart reclaims only expired no-send lease and fences stale worker completion",()=>{
  const s=sandbox(),f=dryRunFixture(now);
  try{
    s.q.enqueue(f.receipt,now);const old=s.q.claim(now)!;
    const other=new SnapshotDryRunQueue(s.path,s.key);
    assert.equal(other.claim(now+1),null);
    const fresh=other.claim(now+30001)!;
    assert.notEqual(fresh.leaseToken,old.leaseToken);
    const plan=evaluateSnapshotReadiness(f.receipt,f.evidence,now);
    assert.equal(s.q.finish(old,plan,now+30002),false);
    assert.equal(other.finish(fresh,plan,now+30002),true);other.close();
  }finally{s.clean();}
});
test("expired queued receipt stops before external reads; tampered ciphertext is held",async()=>{
  const s=sandbox(),f=dryRunFixture(now);let reads=0;
  try{
    s.q.enqueue(f.receipt,now);
    const inputs={readEvidence:async()=>{reads++;return f.evidence;}};
    assert.equal((await runSnapshotDryRunOnce(s.q,inputs,{enabled:true,now:()=>now+86_400_001})).status,"blocked");
    assert.equal(reads,0);
    const next=dryRunFixture(now);s.q.enqueue(next.receipt,now);
    const db=new Database(s.path);db.prepare("UPDATE dry_run_jobs SET payload='bad' WHERE request_id=?").run(next.receipt.requestId);db.close();
    assert.equal((await runSnapshotDryRunOnce(s.q,inputs,{enabled:true,now:()=>now})).status,"review");
    assert.equal(reads,0);
  }finally{s.clean();}
});
test("six independent processes cannot claim one staged request twice",async()=>{
  const s=sandbox(),f=dryRunFixture(now);
  try{
    s.q.enqueue(f.receipt,now);
    const code=`import {SnapshotDryRunQueue} from './server/snapshot-dry-run-queue.ts';
      const q=new SnapshotDryRunQueue(process.env.QA_DB,Buffer.from(process.env.QA_KEY,'hex'));
      console.log(JSON.stringify(q.claim(${now})));q.close();`;
    const outcomes=await Promise.all(Array.from({length:6},()=>promisify(execFile)(process.execPath,
      ["--import","tsx","--input-type=module","-e",code],
      {env:{...process.env,QA_DB:s.path,QA_KEY:s.key.toString("hex")}}).then(x=>JSON.parse(x.stdout))));
    assert.equal(outcomes.filter(Boolean).length,1);
  }finally{s.clean();}
});
