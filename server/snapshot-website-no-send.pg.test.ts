import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync,execFile} from "node:child_process";
import {promisify} from "node:util";
import {randomUUID} from "node:crypto";
import {dryRunFixture} from "./snapshot-dry-run-fixtures";
const pgtest=process.env.ATLAS_LOCAL_PG_QA==="1"?test:test.skip;
const args=["-u","postgres","psql","-h","/var/run/postgresql","-d","atlas_snapshot_qa","-v","ON_ERROR_STOP=1","-qAt","-c"];
const q=(s:any)=>"'"+String(s).replaceAll("'","''")+"'";
const sql=(s:string)=>execFileSync("sudo",[...args,s],{encoding:"utf8",stdio:["pipe","pipe","pipe"]}).trim();
const service=(s:string)=>"set role service_role;"+s;
function seed(){
  const f=dryRunFixture();f.receipt.email="kenny@brexconsulting.com";
  const evidence={decision:"not_selected",snapshotDelivery:f.receipt.permission,websiteNoSend:"kenny-website-no-send-v1"};
  sql(`insert into public.widget_snapshots(id,token_hash,expires_at,company_url,ip_hash,snapshot)
    values(${q(f.receipt.snapshotId)},${q(randomUUID())},now()+interval '1 day','https://example.invalid','qa','{}');
    insert into public.widget_snapshot_requests(id,snapshot_id,email,requested_at,consent_evidence)
    values(${q(f.receipt.requestId)},${q(f.receipt.snapshotId)},'kenny@brexconsulting.com',now(),${q(JSON.stringify(evidence))}::jsonb);`);
  return f.receipt.requestId;
}
const enqueue=(id:string,hash="a".repeat(64))=>`select public.enqueue_snapshot_no_send(${q(id)},${q(hash)},${q("b".repeat(64))},${q("ciphertext".repeat(20))},now()-interval '1 minute');`;
const reset=()=>sql("truncate public.widget_snapshot_no_send_jobs;");
pgtest("new queue is RLS-protected and every RPC rejects anonymous/authenticated roles",()=>{
  assert.equal(sql("select relrowsecurity from pg_class where relname='widget_snapshot_no_send_jobs'"),"t");
  for(const role of ["anon","authenticated"]){
    assert.throws(()=>sql(`set role ${role};select * from public.widget_snapshot_no_send_jobs`),/permission denied/);
    assert.throws(()=>sql(`set role ${role};select public.claim_snapshot_no_send()`),/permission denied/);
    assert.throws(()=>sql(`set role ${role};${enqueue(randomUUID())}`),/permission denied/);
    assert.throws(()=>sql(`set role ${role};select public.finish_snapshot_no_send('${randomUUID()}','${randomUUID()}','{}')`),/permission denied/);
    assert.throws(()=>sql(`set role ${role};select public.retry_snapshot_no_send('${randomUUID()}','${randomUUID()}')`),/permission denied/);
  }
});
pgtest("enqueue requires new cohort, canonical permission and Kenny; duplicate and rotated-key recipient remain protected",()=>{
  reset();const id=seed();
  assert.equal(JSON.parse(sql(service(enqueue(id)))).status,"queued");
  assert.equal(JSON.parse(sql(service(enqueue(id)))).status,"duplicate");
  assert.equal(JSON.parse(sql(service(enqueue(seed(),"c".repeat(64))))).status,"recipient_busy");
  reset();const bad=seed();
  sql(`update public.widget_snapshot_requests set consent_evidence=consent_evidence||'{"liveEmailTest":"old"}'::jsonb where id=${q(bad)}`);
  assert.equal(JSON.parse(sql(service(enqueue(bad)))).status,"invalid_receipt");
  sql(`update public.widget_snapshot_requests set consent_evidence=consent_evidence-'liveEmailTest',email='other@example.invalid' where id=${q(bad)}`);
  assert.equal(JSON.parse(sql(service(enqueue(bad)))).status,"invalid_receipt");
});
pgtest("six database connections claim one queued website request once",async()=>{
  reset();sql(service(enqueue(seed())));
  const out=await Promise.all(Array.from({length:6},()=>promisify(execFile)("sudo",
    [...args,service("select public.claim_snapshot_no_send()")],{encoding:"utf8"}).then(x=>JSON.parse(x.stdout))));
  assert.equal(out.filter(x=>x.status==="claimed").length,1);assert.equal(out.filter(x=>x.status==="idle").length,5);
});
pgtest("expired leases fence stale finish; no-send completion purges ciphertext; duplicates stay terminal",()=>{
  reset();const id=seed();sql(service(enqueue(id)));
  const old=JSON.parse(sql(service("select public.claim_snapshot_no_send()"))).job;
  sql(`update public.widget_snapshot_no_send_jobs set lease_until=now()-interval '1 second' where request_id=${q(id)}`);
  const fresh=JSON.parse(sql(service("select public.claim_snapshot_no_send()"))).job;
  const plan=q(JSON.stringify({status:"needs_preparation",reason:"changes_required_not_applied",actions:["sync_request_fields"],sendingEnabled:false}));
  assert.equal(sql(service(`select public.finish_snapshot_no_send(${q(id)},${q(old.lease_token)},${plan})`)),"f");
  assert.equal(sql(service(`select public.finish_snapshot_no_send(${q(id)},${q(fresh.lease_token)},${plan})`)),"t");
  assert.equal(sql(`select state||':'||(encrypted_payload is null)::text from public.widget_snapshot_no_send_jobs where request_id=${q(id)}`),"completed:true");
  assert.equal(JSON.parse(sql(service(enqueue(id)))).state,"completed");
  assert.equal(sql("select count(*) from public.widget_snapshot_delivery_attempts where request_id="+q(id)),"0");
});
pgtest("read errors retry at most three times then retain a review hold; live-like result is rejected",()=>{
  reset();const id=seed();sql(service(enqueue(id)));
  for(let i=0;i<3;i++){
    const job=JSON.parse(sql(service("select public.claim_snapshot_no_send()"))).job;
    assert.throws(()=>sql(service(`select public.finish_snapshot_no_send(${q(id)},${q(job.lease_token)},'{"status":"delivered","reason":"sent","actions":[],"sendingEnabled":true}')`)),/Invalid no-send result/);
    assert.equal(sql(service(`select public.retry_snapshot_no_send(${q(id)},${q(job.lease_token)})`)),"t");
    sql(`update public.widget_snapshot_no_send_jobs set next_at=now()-interval '1 second' where request_id=${q(id)}`);
  }
  assert.equal(sql("select state from public.widget_snapshot_no_send_jobs where request_id="+q(id)),"review");
  assert.equal(JSON.parse(sql(service("select public.claim_snapshot_no_send()"))).status,"idle");reset();
});
