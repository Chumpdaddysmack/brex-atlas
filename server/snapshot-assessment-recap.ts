import {assessWidget,HEALTH_VERSION} from "../shared/widget-health";

/**
 * Approved public recap. This module does not read/write CRM, change consent,
 * enroll workflows, or send email. A future caller must bind these properties
 * to the same immutable request/URL and hold its existing recipient send lock.
 */
export function buildSnapshotAssessmentRecap(row:{
  id:string;created_at:string;snapshot:any;
},request:{snapshotId:string;email:string;requestedAt:string}){
  if(!request.email||row.id!==request.snapshotId
    ||!Number.isFinite(Date.parse(row.created_at))
    ||!Number.isFinite(Date.parse(request.requestedAt))
    ||Date.parse(request.requestedAt)<Date.parse(row.created_at))
    throw Error("Matching requested assessment required");
  const stored=row.snapshot?.assessment;
  // Historical research-only snapshots continue to use the original email.
  if(!stored)return "";
  if(stored?.version!==HEALTH_VERSION||!stored.answers)
    throw Error("Assessment receipt unavailable or rubric requires review");
  const assessment=assessWidget(stored.answers);
  const h=assessment.health;
  const score=h.score===null
    ?"Incomplete: not enough answers to calculate."
    :`${h.score}/100 · ${h.band}`;
  return [
    "YOUR MARKETING-HEALTH ASSESSMENT",
    score,
    ...h.subScores.map(s=>`${s.label}: ${s.score===null?"Incomplete":`${s.score}/100`}`),
    "",
    "PRELIMINARY CMO RECOMMENDATION",
    assessment.fit.label,
    assessment.fit.reason,
    ...assessment.fit.concerns,
    ...assessment.fit.missing.map(m=>`Needs confirmation: ${m}`),
  ].join("\n");
}
