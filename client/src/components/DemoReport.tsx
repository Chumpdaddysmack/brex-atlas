import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { AppShell } from "./AppShell";
import { DemoModeSwitch } from "./DemoMode";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Eye, LockKeyhole, ArrowUpRight, Loader2 } from "lucide-react";
import type { DemoGroup, DemoReport as DemoPayload } from "@shared/demo-report";
import { ReportVisual } from "./ReportVisuals";

const groups: { key: DemoGroup; label: string }[] = [
  { key: "overview", label: "Overview" }, { key: "strategy", label: "Strategy & scope" },
  { key: "frameworks", label: "Frameworks" }, { key: "buyer", label: "Buyer insights" },
  { key: "content", label: "Content & growth" },
];
export function DemoReport({ analysisId, content = false }: { analysisId: string; content?: boolean }) {
  const q = useQuery<DemoPayload>({
    queryKey: ["/api/analyses", analysisId, "demo"],
    queryFn: async () => (await apiRequest("GET", `/api/analyses/${analysisId}/demo`)).json(),
    staleTime: 0, retry: false,
    refetchInterval: query => {
      const status = query.state.data?.status;
      return status && status !== "done" && status !== "error" ? 3000 : false;
    },
  });
  return <AppShell>
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6" data-testid="demo-report">
      <div className="flex flex-wrap justify-between items-start gap-4">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-widest text-primary font-semibold flex items-center gap-2"><Eye className="h-4 w-4" /> Demonstration preview</div>
          <h1 className="font-serif text-3xl mt-2 break-words">{q.data?.clientName ?? "Report preview"}</h1>
          <p className="text-sm text-muted-foreground mt-2">A first look at each section. The full report stays unchanged.</p>
        </div>
        <DemoModeSwitch />
      </div>
      <div className="rounded-xl border border-primary/25 bg-primary/5 p-4 flex gap-3">
        <LockKeyhole className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-medium">Presenter preview · read-only</p>
          <p className="text-muted-foreground mt-1">Selected excerpts from this saved analysis, not a complete report. Findings and assumptions retain their original status; this preview is not additional validation. Full downloads, copy tools, editing, and generation controls are hidden.</p>
        </div>
      </div>
      {q.isPending && <Card className="p-8 flex items-center gap-3"><Loader2 className="h-5 w-5 animate-spin" /> Loading selected excerpts…</Card>}
      {q.isError && <Card className="p-6 space-y-3" role="alert">
        <p>We couldn’t load this preview. No report content has been changed.</p>
        <Button variant="outline" onClick={() => q.refetch()}>Retry preview</Button>
      </Card>}
      {q.data && <Tabs defaultValue={content ? "content" : "overview"}>
        <TabsList className="flex h-auto flex-wrap justify-start gap-1 w-full sm:w-fit">
          {groups.map(g => <TabsTrigger key={g.key} value={g.key} data-testid={`demo-tab-${g.key}`}>{g.label}</TabsTrigger>)}
        </TabsList>
        {groups.map(g => <TabsContent key={g.key} value={g.key} className="mt-5 space-y-4">
          <p className="text-sm text-muted-foreground">Opening examples only. Additional findings and implementation detail are reserved for the full view.</p>
          {q.data.visuals && <div className="space-y-6">
            {g.key === "overview" && <><ReportVisual kind="positioning" data={q.data.visuals} /><ReportVisual kind="competitors" data={q.data.visuals} /></>}
            {g.key === "strategy" && <ReportVisual kind="roadmap" data={q.data.visuals} />}
            {g.key === "frameworks" && <ReportVisual kind="swot" data={q.data.visuals} />}
            {g.key === "buyer" && <ReportVisual kind="journey" data={q.data.visuals} />}
          </div>}
          <div className="grid gap-4 md:grid-cols-2">
            {q.data.sections.filter(s => s.group === g.key && !(q.data.visuals && ["positioning", "competitor", "roadmap", "swot"].includes(s.id))).map(section => <Card key={section.id} className="p-5 flex flex-col gap-4 min-w-0" data-testid={`demo-section-${section.id}`}>
              <h2 className="font-semibold text-lg">{section.title}</h2>
              {section.items.length ? <div className="space-y-4">
                {section.items.map((item, i) => <div key={i}>
                  <p className="text-xs uppercase tracking-wide text-primary font-semibold break-words">{item.label}</p>
                  <p className="text-sm leading-relaxed mt-2 whitespace-pre-line break-words">{item.text}</p>
                  {!!item.sources?.length && <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                    {item.sources.map((s, n) => <a key={n} href={s.url} target="_blank" rel="noreferrer" className="text-xs underline text-muted-foreground break-all">{s.title}</a>)}
                  </div>}
                </div>)}
              </div> : <p className="text-sm text-muted-foreground">No preview available in this saved report. This section may not have been generated, or its data is incomplete.</p>}
              <div className="border-t border-border pt-3 mt-auto">
                <p className="text-xs font-semibold text-muted-foreground">Full report scope</p>
                <p className="text-xs leading-relaxed mt-1 text-muted-foreground">{section.fullReport}</p>
              </div>
            </Card>)}
          </div>
        </TabsContent>)}
      </Tabs>}
      <div className="border-t pt-4 flex flex-wrap gap-3 items-center justify-between">
        <p className="text-xs text-muted-foreground">Protected presenter view. This is not a customer sharing link.</p>
        <Link href={content ? `/analysis/${analysisId}` : `/analysis/${analysisId}/content`}>
          <Button variant="outline" size="sm" data-testid="demo-related-view">
            {content ? "Analysis preview" : "Content Studio preview"}<ArrowUpRight className="ml-2 h-4 w-4" />
          </Button>
        </Link>
      </div>
    </div>
  </AppShell>;
}
