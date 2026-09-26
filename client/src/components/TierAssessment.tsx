import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { QUESTIONS, RESEARCH_BASIS, assessTier, safeHttp, type AssessmentInput, type AssessmentRecord } from "@shared/tier-assessment";
import { packageFor } from "@shared/service-packages";

export function RecommendationCard({ record }: { record: AssessmentRecord }) {
  const d=record.decision, tier=packageFor(d.tier);
  return <Card className="p-5 sm:p-6 space-y-4" data-testid="tier-recommendation">
    <div className="flex flex-wrap justify-between gap-3">
      <div><p className="text-xs uppercase tracking-wider text-primary">Evidence-informed service fit</p>
        <h3 className="text-xl font-semibold mt-1">{tier?.name ?? (d.status==="readiness-first"?"Readiness first":"Discovery required")}</h3>
        {d.price && <p className="text-lg mt-1">{d.price}</p>}</div>
      <Badge variant="outline" className="self-start">{record.approvedAt?"Approved by Brex":"Review required"}</Badge>
    </div>
    {record.input.growthGoal && <p className="text-sm"><strong>Growth objective:</strong> {record.input.growthGoal}</p>}
    {d.reasons.map((r,i)=><p key={i} className="text-sm leading-relaxed">{r}</p>)}
    {d.missing.length>0 && <div className="text-sm"><p className="font-semibold">Still to confirm</p><ul className="list-disc pl-5 mt-2 space-y-1">{d.missing.map(m=><li key={m}>{m}</li>)}</ul></div>}
    <p className="text-sm text-muted-foreground">{d.alternatives}</p>
    {d.tier && <p className="text-sm text-muted-foreground">{d.scopePosition} Final fee and delivery scope require a proposal.</p>}
    <details className="border-t pt-3" data-testid="recommendation-evidence"><summary className="cursor-pointer text-sm font-semibold">Company evidence and research basis</summary>
      <div className="mt-4 space-y-4">
        {QUESTIONS.map(q=>{const f=record.input.facts[q.key];return f && f.value!=="unknown"?<div key={q.key} className="text-sm">
          <p className="font-medium">{q.label}</p><p className="mt-1 whitespace-pre-line">{f.note}</p>
          <p className="text-xs text-muted-foreground mt-1">{f.kind==="client-confirmed"?"Client-confirmed":"Publicly reported"} · {f.asOf}
            {safeHttp(f.url) && <> · <a href={safeHttp(f.url)!} target="_blank" rel="noreferrer" className="underline">Supporting reference</a></>}</p>
        </div>:null;})}
        <p className="text-xs text-muted-foreground">The studies below inform the decision rules. They do not verify this company's facts, validate these prices, or predict a guaranteed outcome.</p>
        {RESEARCH_BASIS.map(s=><div key={s.url} className="text-sm"><a href={s.url} target="_blank" rel="noreferrer" className="font-medium underline">{s.title}</a>
          <p className="mt-1">{s.finding}</p><p className="text-xs text-muted-foreground mt-1">{s.limitation}</p></div>)}
      </div>
    </details>
  </Card>;
}
function AssessmentEditor({ id, initial, close }: {id:string;initial:AssessmentRecord|null;close:()=>void}) {
  const [input,setInput]=useState<AssessmentInput>(initial?.input??{facts:{},growthGoal:"",scopeNotes:""});
  const query=useQueryClient();
  const decision=assessTier(input);
  const draft:AssessmentRecord={input,decision,approvedAt:null,updatedAt:new Date().toISOString()};
  const save=useMutation({mutationFn:async(approve:boolean)=>(await apiRequest("PUT",`/api/analyses/${id}/tier-assessment`,{input,approve})).json(),
    onSuccess:async()=>{await query.invalidateQueries({queryKey:["/api/analyses",id,"tier-assessment"]});close();}});
  const fact=(key:string)=>input.facts[key]??{value:"unknown",note:"",kind:"client-confirmed" as const,url:"",asOf:new Date().toISOString().slice(0,10)};
  const setFact=(key:string,patch:any)=>setInput(v=>({...v,facts:{...v.facts,[key]:{...fact(key),...patch}}}));
  return <div className="space-y-5 mt-5">
    <p className="text-sm text-muted-foreground">Record what discovery actually confirms. Unknowns stay unknown; title, employee count, and revenue never select a tier automatically. Evidence notes appear in the approved client recommendation, so use client-ready wording.</p>
    <label className="block text-sm font-medium">Growth objective, baseline, and time horizon
      <Textarea data-testid="assessment-goal" className="mt-2" value={input.growthGoal} onChange={e=>setInput({...input,growthGoal:e.target.value})} placeholder="Document the client's goal. Label any unconfirmed baseline." /></label>
    <div className="grid md:grid-cols-2 gap-4">{QUESTIONS.map(q=><fieldset key={q.key} className="border rounded-lg p-4 min-w-0 space-y-3">
      <legend className="text-sm font-medium px-1">{q.label}</legend>
      <select aria-label={q.label} data-testid={`assessment-${q.key}`} className="w-full text-sm rounded-md border bg-background p-2" value={fact(q.key).value} onChange={e=>setFact(q.key,{value:e.target.value})}>
        {q.options.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
      {fact(q.key).value!=="unknown" && <>
        <Textarea aria-label={`${q.label} Evidence`} data-testid={`evidence-${q.key}`} value={fact(q.key).note} onChange={e=>setFact(q.key,{note:e.target.value})} placeholder="Supporting fact, who confirmed it, and any qualification." />
        <div className="flex flex-wrap gap-2"><select aria-label={`${q.label} Provenance`} className="min-w-0 rounded-md border bg-background p-2 text-sm" value={fact(q.key).kind} onChange={e=>setFact(q.key,{kind:e.target.value})}>
          <option value="client-confirmed">Client-confirmed</option><option value="public-source">Public source</option></select>
          <Input aria-label={`${q.label} Evidence date`} className="w-40" type="date" value={fact(q.key).asOf} onChange={e=>setFact(q.key,{asOf:e.target.value})}/></div>
        {fact(q.key).kind==="public-source" && <Input aria-label={`${q.label} Source URL`} value={fact(q.key).url} onChange={e=>setFact(q.key,{url:e.target.value})} placeholder="https://..." />}
      </>}
    </fieldset>)}</div>
    <label className="block text-sm font-medium">Scope drivers and capacity notes
      <Textarea className="mt-2" value={input.scopeNotes} onChange={e=>setInput({...input,scopeNotes:e.target.value})} placeholder="Workstreams, deliverables, cadence, coordination, and exclusions. Do not invent a final fee."/></label>
    <RecommendationCard record={draft}/>
    {save.isError && <p className="text-sm text-destructive" role="alert">{save.error.message}</p>}
    <div className="flex flex-wrap gap-2">
      <Button data-testid="save-assessment" variant="outline" disabled={save.isPending} onClick={()=>save.mutate(false)}>Save draft</Button>
      <Button data-testid="approve-assessment" disabled={save.isPending||decision.status!=="ready-for-review"} onClick={()=>save.mutate(true)}>{save.isPending?"Saving…":"Approve recommendation"}</Button>
      <Button variant="ghost" disabled={save.isPending} onClick={close}>Cancel</Button>
    </div><p className="text-xs text-muted-foreground">Saving a draft removes approval from the current assessment. Published snapshots stay unchanged until you publish a new link.</p>
  </div>;
}
export function TierAssessmentPanel({analysisId}:{analysisId:string}) {
  const [edit,setEdit]=useState(false);
  const q=useQuery<AssessmentRecord|null>({queryKey:["/api/analyses",analysisId,"tier-assessment"],queryFn:async()=>(await apiRequest("GET",`/api/analyses/${analysisId}/tier-assessment`)).json()});
  return <section className="space-y-3" data-testid="tier-assessment-panel">
    <div className="flex flex-wrap justify-between items-center gap-3"><h2 className="text-lg font-semibold">Service recommendation</h2>
      {!edit && <Button variant="outline" data-testid="edit-assessment" disabled={q.isPending||q.isError} onClick={()=>setEdit(true)}>{q.data?"Review evidence":"Assess tier fit"}</Button>}</div>
    {q.isPending && <p className="text-sm text-muted-foreground">Loading assessment…</p>}
    {q.isError && <p role="alert" className="text-sm text-destructive">Could not load the assessment. <button className="underline" onClick={()=>q.refetch()}>Retry</button></p>}
    {!q.isPending&&!q.isError&&!q.data&&!edit && <Card className="p-5 text-sm text-muted-foreground">No evidence-approved recommendation yet. Confirm leadership responsibility, growth goals, resources, and readiness before selecting a tier.</Card>}
    {!edit&&q.data&&<RecommendationCard record={q.data}/>}
    {edit&&<AssessmentEditor id={analysisId} initial={q.data??null} close={()=>setEdit(false)}/>}
  </section>;
}
