import test from "node:test";
import assert from "node:assert/strict";
import { assessTier, assessmentInputSchema, QUESTIONS, type AssessmentInput } from "./tier-assessment";
export function ready(need="advice",ownership="existing"):AssessmentInput {
  return {growthGoal:"Client-confirmed: grow qualified pipeline over 12 months; establish baseline in the on-ramp quarter.",scopeNotes:"Focused single-market remit.",
    facts:Object.fromEntries(QUESTIONS.map(q=>[q.key,{value:q.key==="need"?need:q.key==="ownership"?ownership:q.key==="scope"?"bounded":"yes",note:`Client confirmed ${q.key} in discovery.`,kind:"client-confirmed",asOf:"2026-09-25",url:""}]))};
}
test("documented responsibilities select the three packages without a numeric fit score",()=>{
  assert.equal(assessTier(ready()).tier,"advisor");
  assert.equal(assessTier(ready("strategy")).tier,"strategist");
  assert.equal(assessTier(ready("leadership","delegated")).tier,"fractional");
});
test("existing accountable CMO is not assigned a competing executive",()=>assert.equal(assessTier(ready("leadership")).tier,null));
test("no leadership and no implementation funding does not trigger an upsell",()=>{
  const i=ready("leadership","delegated"); i.facts.execution.value="no";
  assert.equal(assessTier(i).status,"readiness-first");assert.equal(assessTier(i).tier,null);
});
test("missing evidence and public-only permission claims block approval",()=>{
  const i=ready();i.facts.authority.kind="public-source";i.facts.authority.url="https://example.com";
  assert.equal(assessTier(i).status,"discovery-required");
  delete i.facts.authority;assert.equal(assessTier(i).tier,null);
});
test("unfunded, unwilling, or over-capacity engagements are gated",()=>{
  for(const k of ["budget","readiness","capacity","sponsor"]) {const i=ready();i.facts[k].value="no";assert.equal(assessTier(i).status,"readiness-first");}
});
test("ranges remain ranges and extra scope never invents a fee",()=>{
  const i=ready("leadership","delegated");i.facts.scope.value="expanded";
  assert.equal(assessTier(i).price,"$9,500–$15,500/mo");assert.match(assessTier(i).scopePosition,/Upper-end candidate/);
});
test("selected facts require evidence, date, valid values, and public source URLs",()=>{
  const i=ready();assert.equal(assessmentInputSchema.safeParse(i).success,true);
  i.facts.need.note="";assert.equal(assessmentInputSchema.safeParse(i).success,false);
  i.facts.need.note="Supported";i.facts.need.value="guess";assert.equal(assessmentInputSchema.safeParse(i).success,false);
  i.facts.need.value="advice";i.facts.need.kind="public-source";i.facts.need.url="javascript:alert(1)";assert.equal(assessmentInputSchema.safeParse(i).success,false);
});
