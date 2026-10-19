export const VERSION = 'brex-growth-readiness-preview-v1-2026-10-16';
export const questions = [
  {key:'demand',name:'Repeatable demand',question:'How consistently does your business win paying customers?',options:['Still validating demand','Paying customers, but sales are irregular','A repeatable pattern of paid sales'],next:'Validate repeatable demand with a focused customer segment before scaling acquisition.'},
  {key:'capacity',name:'Delivery capacity',question:'Could you serve more customers without hurting quality or delivery?',options:['Not with current resources','Only after specific capacity changes','Yes, capacity is available'],next:'Identify the delivery bottleneck and a capacity plan before increasing demand.'},
  {key:'funding',name:'Funding readiness',question:'Is funding available for growth without putting current obligations at risk?',options:['No','Planned, but not secured','Yes, available and allocated'],next:'Confirm available funding and cash requirements before committing to growth spending.'},
  {key:'ownership',name:'Execution ownership',question:'Who will be accountable for carrying out a growth plan?',options:['No owner assigned','Owner identified; time or authority unresolved','An owner has time and authority'],next:'Assign an accountable growth owner with time and decision authority.'},
];
export function assess(answers) {
  if (!answers || Object.keys(answers).length !== 4) throw new Error('Four answers required');
  const items=questions.map(q=>{
    const value=answers[q.key];
    if(!['0','1','2','unknown'].includes(value)) throw new Error('Invalid answer');
    return {...q,points:value==='unknown'?null:Number(value)};
  });
  const known=items.filter(x=>x.points!==null).length;
  const score=known===4?Math.round(items.reduce((sum,x)=>sum+x.points,0)/8*100):null;
  const constraints=items.filter(x=>x.points===0);
  const band=score===null?'Readiness not yet established':score<40?'Strengthen the foundation':score<70?'Prepare for growth':'Stronger readiness signals';
  const status=score===null?band:constraints.length?(constraints.length===1&&constraints[0].key==='demand'?'Validate demand before scaling':'Resolve constraints before scaling'):band;
  const next=constraints.length?constraints.map(x=>x.next).join(' '):score===null?'Confirm the unanswered areas before interpreting overall readiness. Your research snapshot can still be delivered.':score===100?'Validate these self-reported signals in a discovery discussion, then define a measurable growth test.':items.filter(x=>x.points===1).map(x=>x.next).slice(0,1).join('');
  return {version:VERSION,score,known,status,band,constraints:constraints.map(x=>x.key),next,items};
}
