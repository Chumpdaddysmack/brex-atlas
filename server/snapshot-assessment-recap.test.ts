import test from "node:test";
import assert from "node:assert/strict";
import {assessWidget,HEALTH_QUESTIONS} from "../shared/widget-health";
import {buildSnapshotAssessmentRecap} from "./snapshot-assessment-recap";
const receipt={snapshotId:"fixture-snapshot",email:"prospect@company.example",requestedAt:"2026-10-05T22:01:00Z"};
const fixture=(answers:any={})=>({
  id:receipt.snapshotId,created_at:"2026-10-05T22:00:00Z",
  lead_capture:{email:receipt.email},
  snapshot:{assessment:assessWidget(answers)},
});
test("recap preserves real zero and unknown scores without stale CRM or research values",()=>{
  const zero=fixture({health:Object.fromEntries(HEALTH_QUESTIONS.map(q=>[q.key,"0"]))});
  const text=buildSnapshotAssessmentRecap(zero,receipt);
  assert.match(text,/0\/100 · Foundational gaps/);
  assert.equal(text.includes("Incomplete"),false);
  const unknown=buildSnapshotAssessmentRecap(fixture(),receipt);
  assert.match(unknown,/Incomplete: not enough answers to calculate/);
  assert.equal(unknown.includes("0/100"),false);
});
test("recap scores from stored self-reported answers, not persisted totals or raw free text",()=>{
  const r=fixture({health:Object.fromEntries(HEALTH_QUESTIONS.map(q=>[q.key,"3"])),
    fit:{growthGoal:"private goal <script>",timeframe:"private timeframe"},
    context:{industry:"private industry"}});
  r.snapshot.assessment.health.score=19;
  const text=buildSnapshotAssessmentRecap(r,receipt);
  assert.match(text,/100\/100 · Managed & improving/);
  for(const value of ["19/100","private goal","private timeframe","private industry","<script>","kenny@"])
    assert.equal(text.includes(value),false);
});
test("public recap supports any explicitly permitted recipient but refuses mismatched snapshots and invalid request times",()=>{
  assert.match(buildSnapshotAssessmentRecap(fixture(),{...receipt,email:"another@company.example"}),/Incomplete/);
  assert.throws(()=>buildSnapshotAssessmentRecap(fixture(),{...receipt,snapshotId:"wrong"}));
  assert.throws(()=>buildSnapshotAssessmentRecap(fixture(),{...receipt,requestedAt:"2026-10-05T21:59:00Z"}));
  assert.throws(()=>buildSnapshotAssessmentRecap(fixture(),{...receipt,requestedAt:"invalid"}));
  assert.equal(buildSnapshotAssessmentRecap({...fixture(),snapshot:{}},receipt),"");
});
test("recap rejects missing and old assessment versions and includes a supported preliminary tier",()=>{
  const r=fixture();r.snapshot.assessment.version="old";
  assert.throws(()=>buildSnapshotAssessmentRecap(r,receipt));
  const ready=fixture({fit:{ownership:"existing",need:"advice",sponsor:"yes",execution:"funded",
    budget:"advisor",readiness:"yes",growthGoal:"Grow",timeframe:"12 months"}});
  assert.match(buildSnapshotAssessmentRecap(ready,receipt),/Advisor CMO/);
});
