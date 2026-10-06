import test from "node:test";
import assert from "node:assert/strict";
import {assessWidget,HEALTH_QUESTIONS,LEGACY_HEALTH_VERSION} from "../shared/widget-health";
import {buildSnapshotAssessmentRecap} from "./snapshot-assessment-recap";
import {assessmentAlertProperties,initialInternalAlert} from "./widget-internal-alert";
import {privateLeadCapture,LEAD_CAPTURE_NOTICE} from "../shared/widget-lead-capture";
test("widget, prospect recap and internal alert agree on conditional tier and readiness",()=>{
  const answers={health:Object.fromEntries(HEALTH_QUESTIONS.map(q=>[q.key,"2"])),
    fit:{ownership:"existing",need:"leadership",sponsor:"yes",execution:"none",
      budget:"fractional",readiness:"yes",growthGoal:"Grow sales",timeframe:"12 months"}};
  for(const version of [undefined,LEGACY_HEALTH_VERSION]){
    const a=assessWidget(answers,version);
    const row={id:"fixture",created_at:"2026-10-06T18:00:00Z",company_url:"https://company.example/",
      snapshot:{assessment:a},lead_capture:{
        ...privateLeadCapture({firstName:"QA",lastName:"Fixture",email:"qa@company.example",
          revenueBand:"1m5m",noticeVersion:LEAD_CAPTURE_NOTICE.version},"https://company.example/","Fixture"),
        alert:initialInternalAlert()}};
    const recap=buildSnapshotAssessmentRecap(row,{snapshotId:row.id,email:"qa@company.example",requestedAt:"2026-10-06T18:01:00Z"});
    const internal=assessmentAlertProperties(row);
    assert.ok(recap.includes(a.fit.label));
    assert.ok(internal.atlas_assessment_summary.includes(a.fit.label));
    assert.equal(internal.atlas_cmo_recommendation,version?"not-yet-recommended":"full-fractional");
    if(!version){
      assert.ok(recap.includes(a.fit.readinessLabel!));
      assert.ok(internal.atlas_assessment_summary.includes(a.fit.readinessLabel!));
    }
    assert.equal(a.health.score,67);
  }
});
