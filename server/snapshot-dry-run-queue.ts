import Database from "better-sqlite3";
import {createCipheriv,createDecipheriv,createHmac,randomBytes,randomUUID} from "node:crypto";
import {chmodSync} from "node:fs";
import {isAbsolute} from "node:path";
import {snapshotReceiptDigest} from "./snapshot-delivery-ledger";
import {validateSnapshotReceipt,type SnapshotReceipt} from "./snapshot-subscriptions";
import type {ReadinessPlan} from "./snapshot-readiness";

interface QueueRow {request_id:string;receipt_digest:string;payload:string|null;lease_token:string|null;attempts:number}
export interface DryRunJob {requestId:string;leaseToken:string;attempts:number}
/** Separate local SQLite staging queue. Never uses production tables or credentials. */
export class SnapshotDryRunQueue {
  private db:Database.Database;
  private key:Buffer;
  constructor(path:string,key:Buffer) {
    if(!isAbsolute(path)||!path.endsWith(".dry-run.sqlite"))throw new Error("Explicit local dry-run database path required");
    if(key.length!==32)throw new Error("A 32-byte staging encryption key is required");
    this.key=Buffer.from(key);
    this.db=new Database(path,{timeout:5000});
    chmodSync(path,0o600);
    this.db.pragma("journal_mode = DELETE");
    this.db.pragma("secure_delete = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS dry_run_metadata (id INTEGER PRIMARY KEY CHECK(id=1), fingerprint TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS dry_run_jobs (
        request_id TEXT PRIMARY KEY, recipient_key TEXT NOT NULL, receipt_digest TEXT NOT NULL,
        payload TEXT, state TEXT NOT NULL CHECK(state IN ('queued','checking','retry','review','completed','blocked')),
        attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL,
        lease_token TEXT, lease_until INTEGER, created_at INTEGER NOT NULL, result TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_dry_run_recipient ON dry_run_jobs(recipient_key)
        WHERE state IN ('queued','checking','retry','review');
    `);
    const fingerprint=this.hmac("atlas-snapshot-no-send-queue-v1");
    this.db.prepare("INSERT OR IGNORE INTO dry_run_metadata VALUES(1,?)").run(fingerprint);
    if((this.db.prepare("SELECT fingerprint FROM dry_run_metadata WHERE id=1").get() as any).fingerprint!==fingerprint){
      this.close();throw new Error("Staging queue key mismatch");
    }
  }
  private hmac(value:string){return createHmac("sha256",this.key).update(value).digest("hex");}
  private encrypt(r:SnapshotReceipt){
    const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",this.key,iv);
    cipher.setAAD(Buffer.from(r.requestId));
    const data=Buffer.concat([cipher.update(JSON.stringify(r),"utf8"),cipher.final()]);
    return [iv,cipher.getAuthTag(),data].map(x=>x.toString("base64")).join(".");
  }
  enqueue(r:SnapshotReceipt,now=Date.now()){
    validateSnapshotReceipt(r,now);
    const digest=snapshotReceiptDigest(r),recipient=this.hmac(r.email);
    return this.db.transaction(()=>{
      const existing=this.db.prepare("SELECT receipt_digest FROM dry_run_jobs WHERE request_id=?").get(r.requestId) as any;
      if(existing)return existing.receipt_digest===digest?"duplicate":"receipt_mismatch";
      if(this.db.prepare("SELECT 1 FROM dry_run_jobs WHERE recipient_key=? AND state IN ('queued','checking','retry','review')").get(recipient))
        return "recipient_busy";
      this.db.prepare("INSERT INTO dry_run_jobs(request_id,recipient_key,receipt_digest,payload,state,next_at,created_at) VALUES(?,?,?,?,'queued',?,?)")
        .run(r.requestId,recipient,digest,this.encrypt(r),now,now);
      return "queued";
    }).immediate();
  }
  claim(now=Date.now()):DryRunJob|null {
    return this.db.transaction(()=>{
      // Leases can safely be recovered ONLY because this worker has no mutation/send ports.
      this.db.prepare("UPDATE dry_run_jobs SET state='review',lease_token=NULL,lease_until=NULL,result=? WHERE state='checking' AND lease_until<=? AND attempts>=3")
        .run(JSON.stringify({status:"review",reason:"read_retry_limit",actions:[],sendingEnabled:false}),now);
      const row=this.db.prepare(`SELECT * FROM dry_run_jobs WHERE
        ((state IN ('queued','retry') AND next_at<=?) OR (state='checking' AND lease_until<=?))
        AND attempts<3 ORDER BY created_at,request_id LIMIT 1`).get(now,now) as QueueRow|undefined;
      if(!row)return null;
      const token=randomUUID();
      this.db.prepare("UPDATE dry_run_jobs SET state='checking',lease_token=?,lease_until=?,attempts=attempts+1 WHERE request_id=?")
        .run(token,now+30_000,row.request_id);
      return {requestId:row.request_id,leaseToken:token,attempts:row.attempts+1};
    }).immediate();
  }
  receipt(job:DryRunJob,now=Date.now()):SnapshotReceipt {
    const row=this.db.prepare("SELECT * FROM dry_run_jobs WHERE request_id=? AND lease_token=? AND state='checking' AND lease_until>?")
      .get(job.requestId,job.leaseToken,now) as QueueRow|undefined;
    if(!row?.payload)throw new Error("Stale or unavailable job");
    const [iv,tag,data]=row.payload.split(".").map(s=>Buffer.from(s,"base64"));
    const decipher=createDecipheriv("aes-256-gcm",this.key,iv);
    decipher.setAAD(Buffer.from(row.request_id));decipher.setAuthTag(tag);
    const r=JSON.parse(Buffer.concat([decipher.update(data),decipher.final()]).toString("utf8")) as SnapshotReceipt;
    if(r.requestId!==row.request_id||snapshotReceiptDigest(r)!==row.receipt_digest)throw new Error("Immutable receipt mismatch");
    return r;
  }
  finish(job:DryRunJob,plan:ReadinessPlan,now=Date.now()){
    const state=plan.status==="review"?"review":plan.status==="blocked"?"blocked":"completed";
    return this.db.prepare(`UPDATE dry_run_jobs SET state=?,result=?,payload=CASE WHEN ? IN ('completed','blocked') THEN NULL ELSE payload END,
      lease_token=NULL,lease_until=NULL WHERE request_id=? AND state='checking' AND lease_token=? AND lease_until>?`)
      .run(state,JSON.stringify(plan),state,job.requestId,job.leaseToken,now).changes===1;
  }
  readFailed(job:DryRunJob,now=Date.now()){
    const state=job.attempts>=3?"review":"retry";
    const plan:ReadinessPlan={status:"review",reason:state==="review"?"read_retry_limit":"read_temporarily_unavailable",actions:[],sendingEnabled:false};
    return this.db.prepare(`UPDATE dry_run_jobs SET state=?,result=?,next_at=?,lease_token=NULL,lease_until=NULL
      WHERE request_id=? AND state='checking' AND lease_token=? AND lease_until>?`)
      .run(state,JSON.stringify(plan),now+Math.min(60_000,1000*2**job.attempts),job.requestId,job.leaseToken,now).changes===1;
  }
  summary(){
    // No email, encryption material or private access link in reports.
    return this.db.prepare("SELECT request_id,state,attempts,result FROM dry_run_jobs ORDER BY created_at,request_id").all()
      .map((r:any)=>({...r,result:r.result?JSON.parse(r.result):null}));
  }
  close(){this.db.close();this.key.fill(0);}
}
