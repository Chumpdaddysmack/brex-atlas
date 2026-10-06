import test from "node:test";
import assert from "node:assert/strict";
import { assessWidget, assessStoredWidget, LEGACY_HEALTH_VERSION, widgetAssessmentInputSchema, HEALTH_QUESTIONS, TIER_QUESTIONS } from "./widget-health";

function complete(level = "2", need = "advice", ownership = "existing", budget = "advisor") {
  return {health:Object.fromEntries(HEALTH_QUESTIONS.map(q=>[q.key,level])),
    fit:{ownership,need,sponsor:"yes",execution:"funded",budget,readiness:"yes",
      growthGoal:"Improve qualified pipeline",timeframe:"12 months"},context:{industry:"Manufacturing",revenueBand:"under1m"}};
}
test("all eight scored answers determine a reproducible 0–100 health score",()=>{
  for(const [level,expected] of [["0",0],["1",33],["2",67],["3",100]] as const){
    const a=assessWidget(complete(level));assert.equal(a.health.score,expected);
    assert.ok(a.health.subScores.every(d=>d.score===expected));
  }
});
test("missing and unknown answers are unscored, not zero or normalized away",()=>{
  const input=complete();input.health.metrics="unknown";
  const a=assessWidget(input);assert.equal(a.health.score,null);assert.equal(a.health.answered,7);
  assert.equal(a.health.subScores[0].score,67);assert.equal(a.health.subScores[3].score,null);
  assert.equal(assessWidget({}).health.score,null);
});
test("health and tier are independent, including a low-health advisory candidate",()=>{
  assert.equal(assessWidget(complete("0")).fit.tier,"advisor");
  assert.equal(assessWidget(complete("3")).fit.tier,"advisor");
  assert.equal(assessWidget(complete("2","strategy","existing","strategist")).fit.tier,"strategist");
  assert.equal(assessWidget(complete("2","leadership","delegated","fractional")).fit.tier,"full_fractional");
});
test("industry and revenue never change health or select a higher tier",()=>{
  const a=complete();const b=complete();b.context={industry:"Different industry",revenueBand:"25mplus"};
  assert.deepEqual(assessWidget(a).health,assessWidget(b).health);
  assert.deepEqual(assessWidget(a).fit,assessWidget(b).fit);
});
test("reported leadership need yields conditional Full CMO without hiding ownership or staffing gaps",()=>{
  const input=complete("3","leadership","existing","fractional");input.fit.execution="none";
  const a=assessWidget(input);assert.equal(a.fit.status,"conditional");assert.equal(a.fit.tier,"full_fractional");
  assert.equal(a.fit.readinessStatus,"needs_discussion");
  assert.match(a.fit.missing.join(" "),/delegated/);
  assert.match(a.fit.concerns.join(" "),/staffing and budget plan/);
  assert.equal(a.health.score,100);
  const advice=complete("3","advice","existing","fractional");advice.fit.execution="none";
  assert.equal(assessWidget(advice).fit.tier,"advisor");
});
test("lower budget never substitutes cheaper scope for an unmet leadership need",()=>{
  for(const budget of ["below","advisor","strategist"]){
    const a=assessWidget(complete("2","leadership","delegated",budget));
    assert.equal(a.fit.tier,"full_fractional");assert.equal(a.fit.readinessStatus,"not_ready");
    assert.match(a.fit.concerns.join(" "),/budget/);
  }
});
test("only unknown support need prevents potential tier; other gaps remain explicit readiness conditions",()=>{
  for(const key of TIER_QUESTIONS.map(q=>q.key)){
    const a=complete();a.fit[key]="unknown";
    assert.equal(assessWidget(a).fit.tier,key==="need"?null:"advisor",key);
    assert.ok(assessWidget(a).fit.missing.length>0);
  }
  for(const [key,value] of [["sponsor","pending"],["sponsor","no"],["budget","pending"],
    ["execution","planned"],["readiness","pending"],["readiness","no"],["growthGoal",""],["timeframe",""]]){
    const a:any=complete();a.fit[key]=value;
    const out=assessWidget(a);assert.equal(out.fit.tier,"advisor",key);
    assert.notEqual(out.fit.readinessStatus,"discovery_ready",key);
  }
});
test("legacy snapshots retain the original decision; unsupported versions fail closed",()=>{
  const input=complete("2","leadership","existing","fractional");input.fit.execution="none";
  const legacy=assessStoredWidget({version:LEGACY_HEALTH_VERSION,answers:input});
  assert.equal(legacy.fit.tier,null);assert.equal(legacy.fit.label,"Not yet recommended");
  assert.equal(legacy.fit.readinessLabel,undefined);
  assert.equal(assessWidget(input).fit.tier,"full_fractional");
  assert.deepEqual(legacy.health,assessWidget(input).health);
  assert.throws(()=>assessStoredWidget({version:"unrecognized",answers:input}));
});
test("client-generated scores, tiers, bad enums, and unbounded input are rejected",()=>{
  for(const data of [{...complete(),score:99},{...complete(),fit:{...complete().fit,tier:"full_fractional"}},
    {...complete(),health:{...complete().health,metrics:"10"}},{...complete(),health:{...complete().health,metrics:3}},
    {...complete(),fit:{...complete().fit,growthGoal:"x".repeat(601)}}])
    assert.equal(widgetAssessmentInputSchema.safeParse(data).success,false);
});
test("every answer retains provenance and methodology disclaims validation and ranking",()=>{
  const a=assessWidget(complete());
  assert.ok(a.health.subScores.flatMap(d=>d.items).every(i=>i.provenance==="self-reported"));
  assert.match(a.health.note,/not a verified audit/);assert.match(a.health.note,/not the numerical weights/);
  assert.match(a.fit.note,/Kenny/);assert.equal(a.sources.length,3);
  assert.ok(a.sources.every(s=>new URL(s.url).protocol==="https:"));
});
test("all questionnaire options agree with the server schema",()=>{
  for(const q of TIER_QUESTIONS)for(const [value] of q.options){
    const a=complete();a.fit[q.key]=value;assert.equal(widgetAssessmentInputSchema.safeParse(a).success,true);
  }
});
