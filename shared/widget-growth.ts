import {z} from "zod";
// The browser and server execute the same deterministic rubric.
import {assess, VERSION, questions} from "../client/public/widget-v2/rubric.mjs";

export const growthAnswersSchema=z.object({
  demand:z.enum(["0","1","2","unknown"]),capacity:z.enum(["0","1","2","unknown"]),
  funding:z.enum(["0","1","2","unknown"]),ownership:z.enum(["0","1","2","unknown"]),
}).strict();
export function growthAssessment(raw:unknown){
  const answers=growthAnswersSchema.parse(raw);
  return {...assess(answers),answers};
}
export function storedGrowthAssessment(raw:any){
  if(raw?.version!==VERSION)throw Error("Unsupported growth-readiness rubric");
  return growthAssessment(raw.answers);
}
export function growthRecap(raw:unknown){
  const a=storedGrowthAssessment(raw);
  return ["YOUR GROWTH READINESS",a.score===null?"Pending: confirm the unknown answers.":`${a.score}/100`,
    a.status,...a.items.map((i:any)=>`${i.name}: ${i.points===null?"Not sure":`${i.points}/2`}`),
    "",a.next,"","Self-reported screening, not a probability of growth or a verified audit.",
    "This four-question snapshot does not determine a CMO service tier. Kenny reviews service fit separately.",
    `Rubric: ${VERSION}`].join("\n");
}
export {questions};
