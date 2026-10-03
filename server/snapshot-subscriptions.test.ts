import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SNAPSHOT_EMAIL_PERMISSION, parseSnapshotEmailPermission, snapshotPermissionProperties } from "../shared/snapshot-delivery";
import {
  createSnapshotSubscriptionClient, prepareSnapshotSubscription,
  type SnapshotReceipt, type PreferenceRead, type SubscriptionClient,
} from "./snapshot-subscriptions";
import { evaluateSnapshotWorkflow, type WorkflowEvidence, SNAPSHOT_RESULTS_EMAIL_ID } from "./snapshot-workflow-guard";

const now = Date.parse("2026-10-03T22:00:00Z");
const receipt = (): SnapshotReceipt => ({
  email: "kenny@brexconsulting.com", requestId: "receipt-test",
  snapshotId: "snapshot-test", snapshotUrl: "https://atlas.brexconsulting.com/widget.html#snapshot=" + "a".repeat(64),
  requestedAt: "2026-10-03T21:59:00Z", expiresAt: "2026-10-13T21:58:00Z",
  permission: parseSnapshotEmailPermission({snapshotEmailConsent: true, snapshotEmailConsentVersion: SNAPSHOT_EMAIL_PERMISSION.version}),
  marketingChoice: "not_selected",
});
const preferences = (status: PreferenceRead["snapshot"] = "NOT_SPECIFIED"): PreferenceRead => ({
  email: "kenny@brexconsulting.com", snapshot: status, globallyBlocked: false, checkedAt: now,
});
const pilot = {mode: "controlled-pilot" as const, pilotEnabled: true,
  approvedRequestsAfter: "2026-10-03T21:58:00Z", now: () => now};

function mockClient(sequence: (PreferenceRead | Error)[] = [preferences()]) {
  const writes: any[] = [];
  let reads = 0;
  const client: SubscriptionClient = {
    async read() { const value = sequence[Math.min(reads++, sequence.length - 1)]; if (value instanceof Error) throw value; return value; },
    async subscribe(body) { writes.push(body); },
  };
  return {client, writes, get reads() {return reads;}};
}

test("default preparation is dry-run, including opted-in optional marketing choice", async () => {
  const mock = mockClient();
  const output = await prepareSnapshotSubscription({...receipt(), marketingChoice: "accepted"}, mock.client, {now: () => now});
  assert.equal(output.reason, "dry_run_would_subscribe");
  assert.equal(output.wouldSubscribe, true);
  assert.equal(output.mutation, "not_attempted");
  assert.equal(mock.writes.length, 0);
});

test("global, brand and category opt-outs never produce opt-in writes", async () => {
  for (const pref of [{...preferences(), globallyBlocked: true}, preferences("UNSUBSCRIBED")]) {
    const mock = mockClient([pref]);
    assert.equal((await prepareSnapshotSubscription(receipt(), mock.client, pilot)).state, "blocked");
    assert.equal(mock.writes.length, 0);
  }
});

test("controlled execution refuses wrong email, disabled pilot and historical receipts", async () => {
  for (const [r, options] of [
    [{...receipt(), email:"prospect@example.invalid"}, pilot],
    [receipt(), {...pilot, pilotEnabled:false}],
    [receipt(), {...pilot, approvedRequestsAfter:undefined}],
    [receipt(), {...pilot, approvedRequestsAfter:"2026-10-03T21:59:00Z"}],
    [receipt(), {...pilot, approvedRequestsAfter:"2026-10-03T23:00:00Z"}],
  ] as const) {
    const mock = mockClient();
    assert.equal((await prepareSnapshotSubscription(r, mock.client, options)).reason, "pilot_not_authorized");
    assert.equal(mock.reads, 0);
    assert.equal(mock.writes.length, 0);
  }
});

test("pilot subscribes snapshot only and requires readback, never mutates promotional state", async () => {
  const mock = mockClient([preferences(), preferences(), preferences("SUBSCRIBED")]);
  const result = await prepareSnapshotSubscription(receipt(), mock.client, pilot);
  assert.equal(result.reason, "opt_in_readback_verified");
  assert.equal(result.state, "subscription_verified");
  assert.equal(mock.reads, 3);
  assert.equal(mock.writes.length, 1);
  assert.equal(mock.writes[0].subscriptionId, "3750294688");
  assert.equal(mock.writes[0].legalBasis, "CONSENT_WITH_NOTICE");
  assert.match(mock.writes[0].legalBasisExplanation, /receipt-test/);
  assert.ok(!mock.writes[0].legalBasisExplanation.includes("#snapshot="));
  const retry = mockClient([preferences("SUBSCRIBED")]);
  assert.equal((await prepareSnapshotSubscription(receipt(), retry.client, pilot)).reason, "already_subscribed");
  assert.equal(retry.writes.length, 0);
});

test("recheck catches an opt-out race and does not blindly retry ambiguous mutations", async () => {
  const race = mockClient([preferences(), preferences("UNSUBSCRIBED")]);
  assert.equal((await prepareSnapshotSubscription(receipt(), race.client, pilot)).reason, "opt_out_before_write");
  assert.equal(race.writes.length, 0);
  const timeout = mockClient([preferences()]);
  timeout.client.subscribe = async body => {timeout.writes.push(body); throw new Error("timeout");};
  const out = await prepareSnapshotSubscription(receipt(), timeout.client, pilot);
  assert.equal(out.reason, "mutation_outcome_unconfirmed");
  assert.equal(out.mutation, "attempted");
  assert.equal(timeout.writes.length, 1);
  const unconfirmed = mockClient([preferences()]);
  assert.equal((await prepareSnapshotSubscription(receipt(), unconfirmed.client, pilot)).reason, "opt_in_not_confirmed");
});

test("invalid receipts, stale reads, malformed recipients, and API errors fail closed", async () => {
  for (const r of [{...receipt(), expiresAt:"2020-01-01"}, {...receipt(), snapshotUrl:"https://evil.example/#snapshot=abc"},
    {...receipt(), requestedAt:"2027-01-01"}, {...receipt(), email:"KENNY@brexconsulting.com"},
    {...receipt(), permission:{...receipt().permission, policyVersion:"wrong"}}]) {
    const mock = mockClient();
    assert.equal((await prepareSnapshotSubscription(r, mock.client, pilot)).state, "pending");
    assert.equal(mock.reads, 0);
  }
  for (const p of [new Error("429"), {...preferences(),checkedAt:now-61_000},
    {...preferences(),checkedAt:now+1}, {...preferences(),email:"other@example.invalid"}]) {
    const mock=mockClient([p]);
    assert.equal((await prepareSnapshotSubscription(receipt(),mock.client,pilot)).state,"pending");
    assert.equal(mock.writes.length,0);
  }
});

function apiFixture() {
  return {status:"COMPLETE",results:[{businessUnitId:0,channel:"EMAIL",
    subscriberIdString:receipt().email,subscriptionId:3750294688,status:"NOT_SPECIFIED"}]};
}

test("adapter honors v4 NOT_SPECIFIED and exact narrow v3 write endpoint", async () => {
  const calls: any[] = [];
  const client = createSnapshotSubscriptionClient(async(method,path,body)=>{
    calls.push({method,path,body});
    return path.includes("unsubscribe-all") ? {status:"COMPLETE",results:[]} : apiFixture();
  },()=>now);
  assert.equal((await client.read(receipt().email)).snapshot,"NOT_SPECIFIED");
  await client.subscribe({emailAddress:receipt().email,subscriptionId:"3750294688",
    legalBasis:"CONSENT_WITH_NOTICE",legalBasisExplanation:"Explicit test fixture consent"});
  assert.equal(calls.at(-1).path,"/communication-preferences/v3/subscribe");
  assert.equal(calls.at(-1).method,"POST");
  assert.ok(calls[1].path.endsWith("/unsubscribe-all?channel=EMAIL"));
  await assert.rejects(()=>client.subscribe({emailAddress:receipt().email,subscriptionId:"711496982",
    legalBasis:"CONSENT_WITH_NOTICE",legalBasisExplanation:"Not permitted"}));
  assert.equal(calls.length,3);
});

test("adapter rejects incomplete, ambiguous, wrong-channel and unknown global responses", async () => {
  for (const raw of [{status:"PENDING",results:[]},{status:"COMPLETE",results:[]},
    {...apiFixture(),numErrors:1}, {...apiFixture(),paging:{next:{after:"x"}}},
    {...apiFixture(),results:[...apiFixture().results,...apiFixture().results]},
    {...apiFixture(),results:[{...apiFixture().results[0],status:"INVALID"}]},
    {...apiFixture(),results:[{...apiFixture().results[0],channel:"SMS"}]}]) {
    const client=createSnapshotSubscriptionClient(async()=>raw,()=>now);
    await assert.rejects(()=>client.read(receipt().email));
  }
  for(const kind of ["PORTAL_WIDE","BUSINESS_UNIT_WIDE"]) {
    const client=createSnapshotSubscriptionClient(async(_,path)=>path.includes("unsubscribe-all")
      ? {status:"COMPLETE",results:[{subscriberIdString:receipt().email,channel:"EMAIL",
        businessUnitId:0,wideStatusType:kind,status:"UNSUBSCRIBED"}]}:apiFixture(),()=>now);
    assert.equal((await client.read(receipt().email)).globallyBlocked,true);
  }
  const client=createSnapshotSubscriptionClient(async(_,path)=>path.includes("unsubscribe-all")
    ? {status:"COMPLETE",results:[{}]}:apiFixture(),()=>now);
  await assert.rejects(()=>client.read(receipt().email));
});

function workflow(): WorkflowEvidence {
  const r=receipt();
  return {
    pilotEnabled:true,approvedRequestsAfter:pilot.approvedRequestsAfter,receipt:r,
    preferences:preferences("SUBSCRIBED"),contactCheckedAt:now,
    billingCapVerified:true,requestClaimVerified:true,ledgerState:"pending",
    email:{id:SNAPSHOT_RESULTS_EMAIL_ID,subscriptionId:"3750294688",published:true,resultsOnlyReviewed:true},
    contact:{...snapshotPermissionProperties(r,now),email:r.email,atlas_snapshot_id:r.snapshotId,
      atlas_snapshot_url:r.snapshotUrl,atlas_snapshot_requested_at:r.requestedAt,
      hs_email_optout:null,hs_email_bad_address:null,hs_email_quarantined:"false",
      hs_email_hard_bounce_reason_enum:null,hs_marketable_status:"true"},
  };
}

test("workflow pure guard passes only a fully verified controlled-test fixture", () => {
  assert.deepEqual(evaluateSnapshotWorkflow(workflow(),now),{allow:true,reason:"eligible_for_controlled_test"});
  const alterations: ((e:WorkflowEvidence)=>void)[]=[
    e=>{e.pilotEnabled=false;},e=>{e.receipt.email="other@example.invalid";},
    e=>{e.approvedRequestsAfter="";},e=>{e.receipt.expiresAt="2020-01-01";},
    e=>{e.ledgerState="sent";},e=>{e.ledgerState="delivered";},e=>{e.ledgerState="failed";},
    e=>{e.requestClaimVerified=false;},e=>{e.contact.atlas_snapshot_request_id="newer-request";},
    e=>{e.contact.atlas_snapshot_url="https://wrong.example/";},
    e=>{e.contact.atlas_snapshot_email_permission="false";},e=>{e.contact.atlas_snapshot_permission_version="old";},
    e=>{e.contact.atlas_snapshot_expires_at="0";},e=>{e.contact.atlas_snapshot_delivery_state="delivered";},
    e=>{e.contactCheckedAt=now-61_000;},e=>{e.preferences.checkedAt=now-61_000;},
    e=>{e.preferences.snapshot="NOT_SPECIFIED";},e=>{e.preferences.globallyBlocked=true;},
    e=>{delete e.contact.hs_email_bad_address;},e=>{e.contact.hs_email_bad_address="true";},
    e=>{e.contact.hs_email_optout="true";},e=>{e.contact.hs_email_quarantined="true";},
    e=>{e.contact.hs_email_hard_bounce_reason_enum="UNKNOWN_USER";},
    e=>{e.billingCapVerified=false;},e=>{e.contact.hs_marketable_status="false";},
    e=>{e.email.published=false;},e=>{e.email.resultsOnlyReviewed=false;},
    e=>{e.email.id="402560948984";},e=>{e.email.subscriptionId="711496982";},
  ];
  for (const alter of alterations) {const e=workflow();alter(e);assert.equal(evaluateSnapshotWorkflow(e,now).allow,false);}
});

test("local workflow manifest is disabled and cannot be mistaken for an API upload", () => {
  const draft=JSON.parse(readFileSync(new URL("../docs/snapshot-workflow-draft.json",import.meta.url),"utf8"));
  assert.equal(draft.kind,"atlas-workflow-design-not-hubspot-api-payload");
  assert.equal(draft.isEnabled,false);
  assert.equal(draft.publicEnrollment,false);
  assert.equal(draft.enrollExistingContacts,false);
  assert.equal(draft.pilotRecipient,receipt().email);
  assert.equal(draft.resultsEmailId,SNAPSHOT_RESULTS_EMAIL_ID);
  assert.equal(draft.subscriptionId,SNAPSHOT_EMAIL_PERMISSION.subscriptionTypeId);
});
