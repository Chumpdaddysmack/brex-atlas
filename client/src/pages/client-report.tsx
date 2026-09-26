import { Component, useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CompanyIntroduction } from "@/components/CompanyIntroduction";
import { ReportVisual, ReportDetails } from "@/components/ReportVisuals";
import { EngagementTerms } from "@/components/EngagementTerms";
import { RecommendationCard } from "@/components/TierAssessment";
import { ExtractionSection, CompetitorsSection, StrategySection, SwotView, PestelView, PortersView, CustomerInsightsSection } from "./analysis";
import { BOOKING_URL, type SharedReport } from "@shared/client-report";
import { safeHttp } from "@shared/tier-assessment";
import { ArrowUpRight, Sun, Moon, LockKeyhole } from "lucide-react";
import { Logo } from "@/components/Logo";

class ReportBoundary extends Component<{children:ReactNode},{error:boolean}> {
  state={error:false}; static getDerivedStateFromError(){return{error:true};}
  render(){return this.state.error?<Card className="p-5">This section is unavailable in the saved report. Please discuss it with Brex.</Card>:this.props.children;}
}
const label=(s:string)=>s.replace(/([a-z])([A-Z])/g,"$1 $2").replace(/_/g," ").replace(/^./,c=>c.toUpperCase());
// Structured, read-only content. React escapes all text; no raw HTML or live
// content-generation endpoints are used by the client view.
function ContentValue({value,depth=0}:{value:unknown;depth?:number}):ReactNode {
  if(value==null||value==="")return null;
  if(typeof value==="string")return <p className="text-sm leading-relaxed whitespace-pre-line break-words">{value}</p>;
  if(typeof value==="number"||typeof value==="boolean")return <p className="text-sm">{String(value)}</p>;
  if(Array.isArray(value))return <div className="space-y-4">{value.map((v,i)=><div key={i} className={typeof v==="object"?"border-l-2 border-primary/25 pl-4":""}><ContentValue value={v} depth={depth+1}/></div>)}</div>;
  return <div className="space-y-3">{Object.entries(value as object).map(([k,v])=>
    <div key={k} className="min-w-0">{/^(url|sourceUrl)$/i.test(k)&&safeHttp(v)?<a href={safeHttp(v)!} target="_blank" rel="noreferrer" className="text-sm underline break-all">Supporting reference</a>:<><p className="text-xs font-semibold text-muted-foreground mb-1">{label(k)}</p><ContentValue value={v} depth={depth+1}/></>}</div>)}</div>;
}
export function ClientReportView({data,preview=false}:{data:SharedReport;preview?:boolean}) {
  const [dark,setDark]=useState(document.documentElement.classList.contains("dark"));
  const r=data.snapshot.report, full=r.mode==="full"?r:null, demo=r.mode==="demo"?r:null;
  const groups=[["overview","Overview"],["strategy","Strategy"],["frameworks","Frameworks"],["buyer","Buyer insights"],["content","Content plan"],...(full?[["recommendation","Next steps"]]:[])];
  return <div className="min-h-screen bg-background text-foreground" data-testid="client-report-view">
    <header className="border-b"><div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
      <div><Logo className="h-7"/><p className="text-xs font-medium mt-2">Growth Excavation Report</p>
        <p className="text-xs text-muted-foreground mt-1">{preview?"Unpublished preview":r.mode==="demo"?"Selected report preview":"Private client report"}</p></div>
      <div className="flex items-center gap-2"><Button size="icon" variant="ghost" aria-label="Toggle color theme" data-testid="report-theme" onClick={()=>{document.documentElement.classList.toggle("dark",!dark);setDark(!dark);}}>{dark?<Sun className="w-4 h-4"/>:<Moon className="w-4 h-4"/>}</Button>
        <Button asChild data-testid="report-cta"><a href={data.bookingUrl} target="_blank" rel="noreferrer">Discuss your report<ArrowUpRight className="ml-2 w-4 h-4"/></a></Button></div>
    </div></header>
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div><p className="text-xs uppercase tracking-widest text-primary">{r.mode==="demo"?"Demonstration preview":"Growth Excavation Report"}</p>
        <h1 className="text-xl font-semibold mt-2 break-words">{r.clientName}</h1>
        <p className="text-sm text-muted-foreground mt-2">Published {new Date(data.publishedAt).toLocaleDateString()} · Available until {new Date(data.expiresAt).toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"})} (your local time)</p></div>
      <div className="rounded-lg border bg-muted/30 p-4 text-sm flex gap-3"><LockKeyhole className="h-4 w-4 shrink-0 mt-1"/><p>{demo?"Selected excerpts only. Additional findings and implementation detail are reserved for the full report.":"This read-only report is a reviewed snapshot. Findings retain their original evidence and estimate labels; publication is not independent verification."} PDF and presentation copies are provided separately and remain yours to keep.</p></div>
      <Tabs defaultValue="overview">
        <TabsList className="flex flex-wrap h-auto justify-start gap-1 mb-5">{groups.map(([key,name])=><TabsTrigger key={key} value={key} data-testid={`client-tab-${key}`}>{name}</TabsTrigger>)}</TabsList>
        {groups.map(([key])=><TabsContent key={key} value={key} className="space-y-6"><ReportBoundary>
          {key==="overview"&&<CompanyIntroduction profile={full?.extraction?.companyProfile??demo?.companyProfile}/>}
          {key==="overview"&&r.visuals&&<><ReportVisual kind="positioning" data={r.visuals}/>{full?.extraction&&<ReportDetails id="shared-positioning" label="Read the complete positioning analysis"><ExtractionSection extraction={full.extraction}/></ReportDetails>}<ReportVisual kind="competitors" data={r.visuals}/>{full&&full.competitors.length>0&&<ReportDetails id="shared-competitors" label="Read the competitive analysis"><CompetitorsSection competitors={full.competitors}/></ReportDetails>}</>}
          {key==="strategy"&&<><EngagementTerms/>{r.visuals&&<ReportVisual kind="roadmap" data={r.visuals}/>} {full?.strategy&&<ReportDetails id="shared-strategy" label="Read the strategy and on-ramp roadmap"><StrategySection strategy={full.strategy}/></ReportDetails>}</>}
          {key==="frameworks"&&<>{r.visuals&&<ReportVisual kind="swot" data={r.visuals}/>} {full&&<ReportDetails id="shared-frameworks" label="Read the full framework evidence"><div className="space-y-8">{full.swot&&<SwotView swot={full.swot}/>} {full.pestel&&<PestelView pestel={full.pestel}/>} {full.porters&&<PortersView porters={full.porters}/>}</div></ReportDetails>}</>}
          {key==="buyer"&&<>{r.visuals&&<ReportVisual kind="journey" data={r.visuals}/>} {full?.customerInsights&&<ReportDetails id="shared-buyer" label="Read the buyer intelligence"><CustomerInsightsSection ci={full.customerInsights} status="done" analysisId="" wantsCI={false}/></ReportDetails>}</>}
          {key==="content"&&full&&(full.content?<div className="space-y-4"><EngagementTerms/>{Object.entries(full.content).map(([k,v])=><details key={k} className="border rounded-lg p-5" open={k==="summary"}><summary className="font-semibold cursor-pointer">{label(k)}</summary><div className="mt-4"><ContentValue value={v}/></div></details>)}</div>:<Card className="p-5 text-sm text-muted-foreground">A content plan was not included in this published snapshot.</Card>)}
          {key==="recommendation"&&full&&<><EngagementTerms/>{data.snapshot.recommendation?<RecommendationCard record={data.snapshot.recommendation}/>:<Card className="p-5"><h2 className="font-semibold">Let's confirm the right scope together</h2><p className="text-sm text-muted-foreground mt-2">A service recommendation requires confirmed leadership responsibility, resources, and readiness. No tier has been approved in this snapshot.</p></Card>}</>}
          {demo&&<div className="grid md:grid-cols-2 gap-4">{demo.sections.filter(s=>s.group===(key==="recommendation"?"strategy":key)).map(s=><Card key={s.id} className="p-5 space-y-3 min-w-0"><h2 className="font-semibold">{s.title}</h2>{s.items.map((i,n)=><div key={n}><p className="text-xs font-semibold text-primary">{i.label}</p><p className="text-sm leading-relaxed mt-1 whitespace-pre-line break-words">{i.text}</p>{i.sources?.map(src=><a key={src.url} href={safeHttp(src.url)??undefined} target="_blank" rel="noreferrer" className="text-xs underline">{src.title}</a>)}</div>)}{!s.items.length&&<p className="text-sm text-muted-foreground">No excerpt available in this section.</p>}<p className="text-xs text-muted-foreground border-t pt-3">Full report: {s.fullReport}</p></Card>)}</div>}
        </ReportBoundary></TabsContent>)}
      </Tabs>
      <footer className="border-t pt-6 flex flex-wrap gap-4 items-center justify-between"><div><h2 className="font-semibold">Turn the findings into priorities</h2><p className="text-sm text-muted-foreground mt-1">Walk through the opportunities and agree on the next practical move.</p></div>
        <Button asChild><a href={data.bookingUrl} target="_blank" rel="noreferrer">Discuss your report<ArrowUpRight className="ml-2 h-4 w-4"/></a></Button></footer>
    </main>
  </div>;
}
export default function ClientReportPage() {
  const [token,setToken]=useState(window.location.hash.slice(1));
  const [entry,setEntry]=useState(""),[code,setCode]=useState<string|undefined>(),[expired,setExpired]=useState(false);
  useEffect(()=>{const change=()=>{setToken(window.location.hash.slice(1));setCode(undefined);setExpired(false);};window.addEventListener("hashchange",change);return()=>window.removeEventListener("hashchange",change);},[]);
  useEffect(()=>{const m=document.createElement("meta");m.name="robots";m.content="noindex,nofollow,noarchive";document.head.appendChild(m);return()=>m.remove();},[]);
  const q=useQuery<SharedReport>({queryKey:["client-report",token,code],queryFn:async()=>(await apiRequest("POST","/api/client-report/access",{token,accessCode:code})).json(),
    retry:false,staleTime:0,gcTime:0,refetchInterval:20_000,refetchIntervalInBackground:true,refetchOnWindowFocus:"always"});
  useEffect(()=>{if(!q.data)return;setExpired(Date.now()>=q.data.expiresAt);const t=setTimeout(()=>setExpired(true),Math.min(Math.max(0,q.data.expiresAt-Date.now()),2_147_483_647));return()=>clearTimeout(t);},[q.data?.expiresAt]);
  // Never keep cached content on screen after an expired/revoked/error response.
  if(q.data&&!q.isError&&!expired)return <ClientReportView data={q.data}/>;
  const locked=(q.error as any)?.status===403;
  return <main className="min-h-screen grid place-items-center p-4"><Card className="max-w-lg w-full p-6 sm:p-8 space-y-5">
    <p className="text-xs uppercase tracking-widest text-primary">Brex · Growth Excavation</p>
    <h1 className="text-xl font-semibold">{q.isPending?"Opening your report…":locked?"Enter your access code":"Report access unavailable"}</h1>
    {locked?<form onSubmit={e=>{e.preventDefault();if(entry===code)q.refetch();else setCode(entry);}} className="space-y-3">
      <p className="text-sm text-muted-foreground">Use the code supplied separately by Brex. Access does not grant entry to the Atlas workspace.</p>
      <Input aria-label="Report access code" data-testid="report-access-code" type="password" value={entry} onChange={e=>setEntry(e.target.value)} autoComplete="off"/>
      <Button type="submit" data-testid="unlock-report" disabled={!entry||q.isFetching}>Open report</Button>
    </form>:!q.isPending&&<><p className="text-sm text-muted-foreground">{expired||[404,410].includes((q.error as any)?.status)?"This link has expired, was revoked, or is no longer available. Your saved PDF and slide copies are unaffected.":"We could not load the report. Please retry or contact Brex."}</p>
      <Button asChild data-testid="request-renewed-access"><a href={BOOKING_URL} target="_blank" rel="noreferrer">Request renewed access<ArrowUpRight className="ml-2 h-4 w-4"/></a></Button>
      {!expired&&!([404,410].includes((q.error as any)?.status))&&<Button variant="outline" onClick={()=>q.refetch()}>Retry</Button>}</>}
  </Card></main>;
}
