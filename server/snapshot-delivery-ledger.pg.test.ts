import test from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID, createHash } from "node:crypto";
import { createSnapshotDeliveryLedger, snapshotReceiptDigest } from "./snapshot-delivery-ledger";
import { runSnapshotPilotDryRun, loadSnapshotPilotReceipt } from "./snapshot-pilot";
import { SNAPSHOT_EMAIL_PERMISSION, parseSnapshotEmailPermission, snapshotPermissionProperties } from "../shared/snapshot-delivery";
import type { SnapshotReceipt } from "./snapshot-subscriptions";

// Intentionally hard-coded LOCAL Unix socket and disposable database.
// No environment URL can redirect these integration tests to production.
const enabled=process.env.ATLAS_LOCAL_PG_QA==="1";
const pgtest=enabled?test:test.skip;
const args=["-u","postgres","psql","-h","/var/run/postgresql","-d","atlas_snapshot_qa","-v","ON_ERROR_STOP=1","-qAt","-c"];
const quote=(s:unknown)=>s==null?"null":"'"+String(s).replaceAll("'","''")+"'";
const sql=(query:string)=>execFileSync("sudo",[...args,query],{encoding:"utf8",stdio:["pipe","pipe","pipe"]}).trim();
const sqlAsync=async(query:string)=>(await promisify(execFile)("sudo",[...args,query],{encoding:"utf8"})).stdout.trim();
const service=(q:string)=>"set role service_role; "+q;
const claimSql=(r:SnapshotReceipt,digest=snapshotReceiptDigest(r))=>
  service(`select public.claim_snapshot_delivery(${quote(r.requestId)},${quote(digest)});`);
function seed(email=`${randomUUID()}@example.invalid`):SnapshotReceipt{
  const now=Date.now(), r:SnapshotReceipt={
    requestId:randomUUID(),snapshotId:randomUUID(),email,requestedAt:new Date(now-1_000).toISOString(),
    expiresAt:new Date(now+7*86_400_000).toISOString(),
    snapshotUrl:"https://atlas.brexconsulting.com/widget.html#snapshot="+"a".repeat(64),
    permission:parseSnapshotEmailPermission({snapshotEmailConsent:true,snapshotEmailConsentVersion:SNAPSHOT_EMAIL_PERMISSION.version}),
    marketingChoice:"not_selected",
  };
  sql(`insert into public.widget_snapshots(id,token_hash,expires_at,company_url,ip_hash,snapshot)
    values(${quote(r.snapshotId)},${quote(randomUUID())},${quote(r.expiresAt)},'https://example.invalid','qa','{}');
    insert into public.widget_snapshot_requests(id,snapshot_id,email,requested_at,consent_evidence)
    values(${quote(r.requestId)},${quote(r.snapshotId)},${quote(r.email)},${quote(r.requestedAt)},
      ${quote(JSON.stringify({decision:"not_selected",snapshotDelivery:r.permission}))}::jsonb);`);
  return r;
}
const ledger=createSnapshotDeliveryLedger(async(name,p)=>{
  const orders:Record<string,string[]>={
    claim_snapshot_delivery:["p_request_id","p_receipt_digest"],
    transition_snapshot_delivery:["p_request_id","p_attempt_id","p_from","p_to","p_reason"],
  };
  if(!orders[name])throw new Error("Unexpected RPC");
  try{
    const raw=sql(service(`select public.${name}(${orders[name].map(k=>quote(p[k])).join(",")});`));
    return {data:raw==="t"?true:raw==="f"?false:JSON.parse(raw),error:null};
  }catch(error){return {data:null,error};}
});
const state=(r:SnapshotReceipt)=>sql(`select state from public.widget_snapshot_delivery_attempts where request_id=${quote(r.requestId)};`);
const event=(id:string,message:string,type:string,time:string)=>sql(service(
  `select public.record_snapshot_delivery_event(${quote(id)},${quote(message)},${quote(type)},${quote(time)});`));

pgtest("PostgreSQL RLS and RPC permissions reject anon and authenticated access",()=>{
  for(const role of ["anon","authenticated"]){
    assert.throws(()=>sql(`set role ${role}; select * from public.widget_snapshot_delivery_attempts;`),/permission denied/);
    assert.throws(()=>sql(`set role ${role}; select public.claim_snapshot_delivery('${randomUUID()}','${"a".repeat(64)}');`),/permission denied/);
  }
  assert.equal(sql("select count(*) from pg_class where relname in ('widget_snapshot_delivery_attempts','widget_snapshot_delivery_events') and relrowsecurity;"),"2");
});

pgtest("six independent connections claiming one receipt yield exactly one durable claim",async()=>{
  const r=seed();
  const results=await Promise.all(Array.from({length:6},()=>sqlAsync(claimSql(r)).then(JSON.parse)));
  assert.equal(results.filter(x=>x.status==="claimed").length,1);
  assert.equal(results.filter(x=>x.status==="duplicate").length,5);
  assert.equal(JSON.parse(sql(claimSql(r))).status,"duplicate"); // new process/connection
  assert.equal(JSON.parse(sql(claimSql(r,"b".repeat(64)))).status,"receipt_mismatch");
  const a=results.find(x=>x.status==="claimed").attemptId;
  assert.equal(await ledger.transition(r.requestId,a,"prepared","dispatching","qa"),true);
  assert.equal(await ledger.transition(r.requestId,a,"prepared","dry_run","stale worker"),false);
  assert.equal(await ledger.transition(r.requestId,a,"dispatching","uncertain","timeout"),true);
  const newer=seed(r.email);
  assert.equal(JSON.parse(sql(claimSql(newer))).status,"email_busy");
  assert.equal(state(r),"uncertain");
});

pgtest("two simultaneous different requests for the same email cannot both claim",async()=>{
  const r1=seed(),r2=seed(r1.email);
  const results=await Promise.all([r1,r2].map(r=>sqlAsync(claimSql(r)).then(JSON.parse)));
  assert.equal(results.filter(x=>x.status==="claimed").length,1);
  assert.equal(results.filter(x=>x.status==="email_busy").length,1);
});

pgtest("correlated provider events deduplicate and late SENT does not regress delivered",async()=>{
  const r=seed(),claim=await ledger.claim(r),message=randomUUID(),id=randomUUID();
  assert.equal(await ledger.transition(r.requestId,claim.attemptId!,"prepared","dispatching","qa"),true);
  const timestamp=new Date().toISOString();
  assert.equal(event(id,"unbound-message","DELIVERED",timestamp),"unmatched");
  assert.equal(sql(service(`select public.bind_snapshot_delivery_message(${quote(r.requestId)},${quote(claim.attemptId)},${quote(message)});`)),"t");
  assert.equal(event(id,message,"DELIVERED",timestamp),"delivered");
  assert.equal(event(id,message,"DELIVERED",timestamp),"duplicate_event");
  assert.equal(event(id,message,"SENT",timestamp),"event_conflict");
  assert.equal(event(randomUUID(),message,"SENT",timestamp),"terminal_preserved");
  assert.equal(state(r),"delivered");
  assert.equal((await ledger.claim(r)).status,"duplicate");
  const newer=seed(r.email);
  assert.equal((await ledger.claim(newer)).status,"claimed"); // terminal event releases email lock
  assert.equal(sql(service(`select public.bind_snapshot_delivery_message(${quote(r.requestId)},${quote(claim.attemptId)},'different-message');`)),"f");
});

pgtest("expired or permissionless receipts never acquire a database claim",()=>{
  const r=seed();
  sql(`update public.widget_snapshots set expires_at=now()-interval '1 second' where id=${quote(r.snapshotId)};`);
  assert.equal(JSON.parse(sql(claimSql(r))).status,"expired");
  const absent=seed();
  sql(`update public.widget_snapshot_requests set consent_evidence='{}' where id=${quote(absent.requestId)};`);
  assert.equal(JSON.parse(sql(claimSql(absent))).status,"invalid_receipt");
  assert.equal(state(absent),"");
});

function evidence(r:SnapshotReceipt){
  return {
    preferences:{email:r.email,snapshot:"SUBSCRIBED" as const,globallyBlocked:false,checkedAt:Date.now()},
    contactCheckedAt:Date.now(),billingCapVerified:true,ledgerState:"pending" as const,
    email:{id:"405101719239",subscriptionId:"3750294688",published:true,resultsOnlyReviewed:true},
    contact:{...snapshotPermissionProperties(r),email:r.email,atlas_snapshot_id:r.snapshotId,
      atlas_snapshot_url:r.snapshotUrl,atlas_snapshot_requested_at:r.requestedAt,
      hs_email_optout:null,hs_email_bad_address:null,hs_email_quarantined:null,
      hs_email_hard_bounce_reason_enum:null,hs_marketable_status:"true"},
  };
}

pgtest("Kenny-only dry-run integrates real ledger without any send or subscription write port",async()=>{
  const r=seed("kenny@brexconsulting.com");
  let reads=0;
  const options={enabled:true,approvedRequestsAfter:new Date(Date.now()-60_000).toISOString()};
  const deps={ledger,subscriptions:{read:async()=>{reads++;return evidence(r).preferences;}},
    readEvidence:async()=>evidence(r)};
  const disabled=await runSnapshotPilotDryRun(r,{...options,enabled:false},deps);
  assert.equal(disabled.status,"disabled");assert.equal(reads,0);assert.equal(state(r),"");
  const outsider=await runSnapshotPilotDryRun(seed(),options,deps);
  assert.equal(outsider.status,"outside_pilot");assert.equal(reads,0);
  const output=await runSnapshotPilotDryRun(r,options,deps);
  assert.equal(output.status,"dry_run_completed");assert.equal(output.sendingEnabled,false);
  assert.equal(output.gate?.allow,true);assert.equal(state(r),"dry_run");
  const retry=await runSnapshotPilotDryRun(r,options,deps);
  assert.equal(retry.status,"duplicate");assert.equal(reads,1);
});

pgtest("draft email or missing data never sends; failed dry-run read releases only pre-send claim",async()=>{
  const options={enabled:true,approvedRequestsAfter:new Date(Date.now()-60_000).toISOString()};
  const r=seed("kenny@brexconsulting.com");
  const result=await runSnapshotPilotDryRun(r,options,{ledger,
    subscriptions:{read:async()=>evidence(r).preferences},
    readEvidence:async()=>({...evidence(r),email:{...evidence(r).email,published:false}})});
  assert.equal(result.gate?.reason,"email_not_ready");
  assert.equal(result.sendingEnabled,false);assert.equal(state(r),"dry_run");
  const fail=seed(r.email);
  const failed=await runSnapshotPilotDryRun(fail,options,{ledger,
    subscriptions:{read:async()=>evidence(fail).preferences},
    readEvidence:async()=>{throw new Error("missing contact");}});
  assert.equal(failed.status,"dry_run_blocked");assert.equal(state(fail),"blocked");
  assert.equal((await ledger.claim(fail)).status,"duplicate");
});

test("pilot receipt loader uses immutable stored evidence and binds the private access link",async()=>{
  const r:SnapshotReceipt={
    requestId:randomUUID(),snapshotId:randomUUID(),email:"kenny@brexconsulting.com",
    requestedAt:new Date(Date.now()-1_000).toISOString(),expiresAt:new Date(Date.now()+86_400_000).toISOString(),
    snapshotUrl:"https://atlas.brexconsulting.com/widget.html#snapshot="+"a".repeat(64),
    permission:parseSnapshotEmailPermission({snapshotEmailConsent:true,snapshotEmailConsentVersion:SNAPSHOT_EMAIL_PERMISSION.version}),
    marketingChoice:"not_selected",
  };
  const rows={request:{id:r.requestId,snapshot_id:r.snapshotId,email:r.email,requested_at:r.requestedAt,
    consent_evidence:{snapshotDelivery:r.permission,decision:r.marketingChoice}},
    snapshot:{id:r.snapshotId,expires_at:r.expiresAt,token_hash:createHash("sha256").update("a".repeat(64)).digest("hex")}};
  assert.deepEqual(await loadSnapshotPilotReceipt(r.requestId,r.snapshotUrl,async()=>rows),r);
  await assert.rejects(()=>loadSnapshotPilotReceipt(r.requestId,r.snapshotUrl.replace("a".repeat(64),"b".repeat(64)),async()=>rows));
  await assert.rejects(()=>loadSnapshotPilotReceipt(randomUUID(),r.snapshotUrl,async()=>rows));
  await assert.rejects(()=>loadSnapshotPilotReceipt(r.requestId,r.snapshotUrl,async()=>({...rows,
    request:{...rows.request,consent_evidence:{}}})));
});
