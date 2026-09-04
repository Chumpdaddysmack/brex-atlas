import { Component, ReactNode, useEffect, useMemo, useState } from "react";
import { useRoute, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  Circle,
  Copy,
  Loader2,
  ScanSearch,
  Target,
  Lightbulb,
  FileText,
  AlertTriangle,
  Sparkles,
  Sliders,
  RotateCw,
} from "lucide-react";
import {
  BREX_LINE_ITEMS,
  BREX_TIERS,
  BREX_BLENDED_HOURLY,
  formatBrexPrice,
  computeSavings,
  positioningColor,
} from "@shared/brex-pricing";
import type {
  Analysis,
  Extraction,
  Competitor,
  Strategy,
  SOW,
  SwotAnalysis,
  PestelAnalysis,
  PortersFiveForces,
  StrategicRationale,
  PestelFinding,
  PortersForce,
} from "@shared/schema";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";

const STEPS = [
  { key: "extracting", label: "Website teardown", icon: ScanSearch, min: 0 },
  { key: "competitors", label: "Competitor set", icon: Target, min: 35 },
  { key: "strategy", label: "Strategy & 90-day plan", icon: Lightbulb, min: 60 },
  { key: "sow", label: "Scope of work", icon: FileText, min: 85 },
  { key: "frameworks", label: "Strategic frameworks", icon: Sparkles, min: 90 },
];

function statusIndex(status: string) {
  const order = ["queued", "extracting", "competitors", "strategy", "sow", "frameworks", "done", "error"];
  return order.indexOf(status);
}

// Safe JSON.parse — returns null on any failure instead of throwing.
// Also recursively normalizes any string-that-should-be-array fields: if a
// known list key comes back as a string (e.g. LLM leaked XML into offerings),
// we split-and-clean instead of letting .map() blow up the render.
const ARRAY_KEYS = new Set([
  "offerings", "valueProps", "evidenceElements", "strengths", "weaknesses",
  "opportunities", "threats", "quickWins", "positioningGaps",
  "messagingRecommendations", "aeoRecommendations", "contentPillars",
  "sampleTitles", "channelMix", "ninetyDayPlan", "outcomes",
  "citations", "priceTiers", "hookIdeas", "items", "findings", "forces",
  "pillars", "deliverables", "weeks", "posts", "tags", "sources",
]);

function normalizeArrays(node: any): any {
  if (Array.isArray(node)) return node.map(normalizeArrays);
  if (node && typeof node === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(node)) {
      if (ARRAY_KEYS.has(k) && !Array.isArray(v)) {
        // LLM leaked a string/object into a list field — coerce to empty array
        // so downstream .map() calls don't crash the whole page.
        console.warn(`[analysis] coercing non-array field '${k}' to []`, v);
        out[k] = [];
      } else {
        out[k] = normalizeArrays(v);
      }
    }
    return out;
  }
  return node;
}

function safeParse<T = any>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return normalizeArrays(JSON.parse(raw)) as T;
  } catch (err) {
    console.error("[analysis] JSON.parse failed", err, raw?.slice(0, 200));
    return null;
  }
}

// React error boundary — catches render-time errors and shows a readable
// message instead of blanking the whole app to white.
class SectionErrorBoundary extends Component<
  { label: string; children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(err: Error) { console.error("[analysis] render error", err); }
  render() {
    if (this.state.error) {
      return (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <div className="font-semibold text-destructive mb-1">
            Couldn't render the {this.props.label} section
          </div>
          <div className="text-muted-foreground text-xs font-mono">
            {this.state.error.message}
          </div>
          <div className="text-muted-foreground text-xs mt-2">
            The analysis data returned by the LLM was malformed for this section.
            Try Edit assumptions → Save & regenerate to re-run.
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function AnalysisPage() {
  const [, params] = useRoute("/analysis/:id");
  const id = params?.id;
  const { toast } = useToast();

  const q = useQuery<Analysis>({
    queryKey: ["/api/analyses", id],
    queryFn: async () => {
      const r = await apiRequest("GET", `/api/analyses/${id}`);
      return r.json();
    },
    enabled: !!id,
    refetchInterval: (query) => {
      const data = query.state.data as Analysis | undefined;
      if (!data) return 2000;
      return data.status === "done" || data.status === "error" ? false : 2500;
    },
  });

  const analysis = q.data;

  if (!id) return null;

  if (q.isLoading && !analysis) {
    return (
      <AppShell>
        <div className="mx-auto max-w-4xl px-6 py-16 text-center text-muted-foreground">
          Loading analysis…
        </div>
      </AppShell>
    );
  }

  if (!analysis) {
    return (
      <AppShell>
        <div className="mx-auto max-w-4xl px-6 py-16">
          <Card className="p-8 text-center">
            <AlertTriangle className="h-8 w-8 mx-auto text-destructive mb-3" />
            <h2 className="text-lg font-semibold">Analysis not found</h2>
            <p className="text-muted-foreground text-sm mt-1">
              This analysis doesn't exist or was cleared.
            </p>
            <Link href="/">
              <a>
                <Button className="mt-4">
                  <ArrowLeft className="h-4 w-4 mr-2" /> Start a new analysis
                </Button>
              </a>
            </Link>
          </Card>
        </div>
      </AppShell>
    );
  }

  const isDone = analysis.status === "done";
  const isErr = analysis.status === "error";

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-6 py-10 space-y-8">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
              <Link href="/">
                <a data-testid="link-back" className="hover:text-foreground inline-flex items-center gap-1">
                  <ArrowLeft className="h-3.5 w-3.5" /> Back
                </a>
              </Link>
              <span>·</span>
              <span className="font-mono">{analysis.id.slice(0, 8)}</span>
            </div>
            <h1 className="font-serif text-3xl tracking-tight" data-testid="text-client-name">
              {analysis.clientName}
            </h1>
            <a
              href={analysis.clientUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-muted-foreground hover:text-accent inline-flex items-center gap-1"
              data-testid="link-client-url"
            >
              {analysis.clientUrl.replace(/^https?:\/\//, "")}
              <ArrowUpRight className="h-3 w-3" />
            </a>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {analysis.industry && <Badge variant="secondary">{analysis.industry}</Badge>}
            {analysis.revenueBand && <Badge variant="secondary">{analysis.revenueBand}</Badge>}
            {analysis.budgetBand && <Badge variant="secondary">{analysis.budgetBand}</Badge>}
            {isDone && <AssumptionsDialog analysis={analysis} />}
          </div>
        </div>

        {/* Progress card */}
        {!isDone && (
          <ProgressCard analysis={analysis} error={isErr} />
        )}

        {/* Error state */}
        {isErr && (
          <Card className="p-6 border-destructive/40 bg-destructive/5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
              <div>
                <div className="font-semibold">Analysis failed</div>
                <p className="text-sm text-muted-foreground mt-1">
                  {analysis.errorMessage ?? "Unknown error"}
                </p>
                <Link href="/">
                  <a><Button variant="outline" className="mt-3">Try again</Button></a>
                </Link>
              </div>
            </div>
          </Card>
        )}

        {/* Results — tabbed */}
        {(analysis.extraction || analysis.competitors || analysis.strategy || analysis.sow) && (
          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="grid grid-cols-4 w-full max-w-2xl">
              <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
              <TabsTrigger value="strategy" data-testid="tab-strategy">Strategy</TabsTrigger>
              <TabsTrigger value="sow" data-testid="tab-sow">SOW</TabsTrigger>
              <TabsTrigger value="frameworks" data-testid="tab-frameworks">Frameworks</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-8 pt-6">
              <SectionErrorBoundary label="Website extraction">
                {analysis.extraction && (
                  <ExtractionSection extraction={safeParse(analysis.extraction)!} />
                )}
              </SectionErrorBoundary>
              <SectionErrorBoundary label="Competitors">
                {analysis.competitors && (
                  <CompetitorsSection competitors={safeParse(analysis.competitors)!} />
                )}
              </SectionErrorBoundary>
            </TabsContent>

            <TabsContent value="strategy" className="space-y-8 pt-6">
              <SectionErrorBoundary label="Strategy">
                {analysis.strategy ? (
                  <StrategySection strategy={safeParse(analysis.strategy)!} />
                ) : (
                  <Card className="p-6 text-sm text-muted-foreground">Strategy still generating…</Card>
                )}
              </SectionErrorBoundary>
            </TabsContent>

            <TabsContent value="sow" className="space-y-8 pt-6">
              <SectionErrorBoundary label="Scope of Work">
                {analysis.sow ? (
                  <SOWSection sow={safeParse(analysis.sow)!} clientName={analysis.clientName} />
                ) : (
                  <Card className="p-6 text-sm text-muted-foreground">SOW still generating…</Card>
                )}
              </SectionErrorBoundary>
            </TabsContent>

            <TabsContent value="frameworks" className="space-y-8 pt-6">
              <SectionErrorBoundary label="Strategic Frameworks">
                <FrameworksSection
                  swot={safeParse<SwotAnalysis>(analysis.swot)}
                  pestel={safeParse<PestelAnalysis>(analysis.pestel)}
                  porters={safeParse<PortersFiveForces>(analysis.porters)}
                  status={analysis.status}
                />
              </SectionErrorBoundary>
            </TabsContent>
          </Tabs>
        )}

        {isDone && (
          <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-border">
            <div className="text-sm text-muted-foreground">
              Analysis complete. Build the 12-week content plan, or copy the brief as Markdown.
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/analysis/${analysis.id}/content`}>
                <Button data-testid="button-open-content-studio">
                  <ArrowUpRight className="h-4 w-4 mr-2" /> Open Content Studio
                </Button>
              </Link>
              <Button
                variant="outline"
                data-testid="button-copy-markdown"
                onClick={() => {
                  const md = renderMarkdown(analysis);
                  navigator.clipboard.writeText(md).then(() =>
                    toast({ title: "Copied", description: "Full brief copied as Markdown." }),
                  );
                }}
              >
                <Copy className="h-4 w-4 mr-2" /> Copy full brief as Markdown
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

// -------- Progress --------

function ProgressCard({ analysis, error }: { analysis: Analysis; error: boolean }) {
  const idx = statusIndex(analysis.status);
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold">
          {error ? "Failed" : analysis.status === "done" ? "Complete" : "Running analysis"}
        </div>
        <div className="text-xs text-muted-foreground font-mono">
          {analysis.progress}%
        </div>
      </div>
      <Progress value={analysis.progress} className="h-1.5 mb-5" />
      <ol className="space-y-2.5">
        {STEPS.map((s) => {
          const done = analysis.progress > s.min + 15 || analysis.status === "done";
          const active =
            !done && analysis.status === s.key && !error;
          const Icon = s.icon;
          return (
            <li key={s.key} className="flex items-center gap-3 text-sm">
              {done ? (
                <CheckCircle2 className="h-4 w-4 text-accent flex-shrink-0" />
              ) : active ? (
                <Loader2 className="h-4 w-4 animate-spin text-accent flex-shrink-0" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground/40 flex-shrink-0" />
              )}
              <Icon className={`h-4 w-4 ${done || active ? "text-foreground" : "text-muted-foreground/60"}`} />
              <span className={done || active ? "text-foreground" : "text-muted-foreground"}>
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

// -------- Extraction --------

function SectionHeader({
  index,
  eyebrow,
  title,
  description,
}: {
  index: string;
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-5">
      <div className="text-xs font-mono text-accent mb-1">
        {index} · {eyebrow}
      </div>
      <h2 className="font-serif text-2xl tracking-tight">{title}</h2>
      {description && (
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{description}</p>
      )}
    </div>
  );
}

function ExtractionSection({ extraction }: { extraction: Extraction }) {
  return (
    <section>
      <SectionHeader
        index="01"
        eyebrow="Website teardown"
        title="What the site says today"
        description="Positioning, value props, and AI-answer-engine readiness inferred from the client's public pages."
      />

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
          <div className="text-xs font-mono text-muted-foreground mb-1">CURRENT POSITIONING</div>
          <p className="text-sm leading-relaxed" data-testid="text-positioning">
            {extraction.positioningStatement}
          </p>
          <Separator className="my-4" />
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <div className="text-xs font-mono text-muted-foreground mb-2">VALUE PROPS</div>
              <ul className="space-y-1 text-sm">
                {extraction.valueProps?.map((v, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-accent">›</span>
                    <span>{v}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-xs font-mono text-muted-foreground mb-2">OFFERINGS</div>
              <ul className="space-y-1 text-sm">
                {extraction.offerings?.map((v, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-accent">›</span>
                    <span>{v}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="text-xs font-mono text-muted-foreground mb-1">AEO READINESS</div>
          <div className="flex items-baseline gap-2">
            <span className="font-serif text-4xl text-accent" data-testid="text-aeo-score">
              {extraction.aeoReadinessScore}
            </span>
            <span className="text-sm text-muted-foreground">/ 100</span>
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            {extraction.aeoReadinessNotes}
          </p>
          <Separator className="my-4" />
          <div className="text-xs font-mono text-muted-foreground mb-1">CTA AUDIT</div>
          <p className="text-sm">{extraction.ctaAudit}</p>
        </Card>
      </div>

      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        <Card className="p-5">
          <div className="text-xs font-mono text-muted-foreground mb-2">TARGET AUDIENCE (INFERRED)</div>
          <p className="text-sm">{extraction.targetAudience}</p>
        </Card>
        <Card className="p-5">
          <div className="text-xs font-mono text-muted-foreground mb-2">EVIDENCE ELEMENTS</div>
          <ul className="space-y-1 text-sm">
            {extraction.evidenceElements?.map((v, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-accent">›</span>
                <span>{v}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </section>
  );
}

// -------- Competitors --------

function CompetitorsSection({ competitors }: { competitors: Competitor[] }) {
  return (
    <section>
      <SectionHeader
        index="02"
        eyebrow="Competitive set"
        title="Who you're actually competing with"
        description="Four category-relevant competitors with positioning, strengths, weaknesses, and paid-ad hook angles you can use to steal share."
      />
      <div className="grid md:grid-cols-2 gap-4">
        {competitors?.map((c, i) => (
          <Card key={i} className="p-5" data-testid={`card-competitor-${i}`}>
            <div className="flex items-start justify-between mb-1">
              <div>
                <div className="font-semibold text-base">{c.name}</div>
                {c.url && (
                  <a
                    href={c.url.startsWith("http") ? c.url : `https://${c.url}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-muted-foreground hover:text-accent inline-flex items-center gap-1"
                  >
                    {c.url.replace(/^https?:\/\//, "")}
                    <ArrowUpRight className="h-3 w-3" />
                  </a>
                )}
              </div>
              <Badge variant="outline">#{i + 1}</Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-2">{c.positioning}</p>
            <Separator className="my-4" />
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-xs font-mono text-muted-foreground mb-2">STRENGTHS</div>
                <ul className="space-y-1">
                  {c.strengths?.map((v, j) => (
                    <li key={j} className="text-xs flex gap-2">
                      <span className="text-accent">+</span>
                      <span>{v}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="text-xs font-mono text-muted-foreground mb-2">WEAKNESSES</div>
                <ul className="space-y-1">
                  {c.weaknesses?.map((v, j) => (
                    <li key={j} className="text-xs flex gap-2">
                      <span className="text-destructive">−</span>
                      <span>{v}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="mt-4">
              <div className="text-xs font-mono text-muted-foreground mb-2">
                HOOK ANGLES TO STEAL SHARE
              </div>
              <ul className="space-y-1.5">
                {c.hookIdeas?.map((v, j) => (
                  <li
                    key={j}
                    className="text-sm rounded-md border border-card-border bg-muted/40 px-3 py-2"
                  >
                    "{v}"
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}

// -------- Strategy --------

function StrategySection({ strategy }: { strategy: Strategy }) {
  return (
    <section>
      <SectionHeader
        index="03"
        eyebrow="Strategy"
        title="The recommended play"
        description="ICP, positioning gaps, messaging shifts, content pillars, channel mix, and a 90-day plan."
      />

      <div className="grid lg:grid-cols-3 gap-4">
        {/* ICP */}
        <Card className="p-5 lg:col-span-2">
          <div className="text-xs font-mono text-muted-foreground mb-1">IDEAL CUSTOMER PROFILE</div>
          <p className="text-sm mb-4">{strategy.icp?.summary}</p>
          <div className="grid sm:grid-cols-3 gap-4">
            {[
              { label: "FIRMOGRAPHICS", items: strategy.icp?.firmographics },
              { label: "PAIN POINTS", items: strategy.icp?.painPoints },
              { label: "BUYING TRIGGERS", items: strategy.icp?.buyingTriggers },
            ].map((col) => (
              <div key={col.label}>
                <div className="text-xs font-mono text-muted-foreground mb-2">{col.label}</div>
                <ul className="space-y-1 text-xs">
                  {col.items?.map((v, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-accent">›</span>
                      <span>{v}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>

        {/* Quick wins */}
        <Card className="p-5">
          <div className="text-xs font-mono text-muted-foreground mb-2">QUICK WINS (30 DAYS)</div>
          <ol className="space-y-2 text-sm">
            {strategy.quickWins?.map((v, i) => (
              <li key={i} className="flex gap-3">
                <span className="font-mono text-accent text-xs mt-0.5">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span>{v}</span>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      {/* Positioning gaps + messaging + AEO */}
      <div className="grid md:grid-cols-3 gap-4 mt-4">
        <Card className="p-5">
          <div className="text-xs font-mono text-muted-foreground mb-2">POSITIONING GAPS</div>
          <ul className="space-y-2 text-sm">
            {strategy.positioningGaps?.map((v, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-destructive">△</span>
                <span>{v}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-5">
          <div className="text-xs font-mono text-muted-foreground mb-2">MESSAGING SHIFTS</div>
          <ul className="space-y-2 text-sm">
            {strategy.messagingRecommendations?.map((v, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-accent">›</span>
                <span>{v}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-5">
          <div className="text-xs font-mono text-muted-foreground mb-2">AEO / AI-SEARCH MOVES</div>
          <ul className="space-y-2 text-sm">
            {strategy.aeoRecommendations?.map((v, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-accent">›</span>
                <span>{v}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* Content pillars */}
      <div className="mt-4">
        <div className="text-xs font-mono text-muted-foreground mb-2">CONTENT PILLARS</div>
        <div className="grid md:grid-cols-3 gap-4">
          {strategy.contentPillars?.map((p, i) => (
            <Card key={i} className="p-5">
              <div className="text-xs font-mono text-accent mb-1">
                Pillar 0{i + 1}
              </div>
              <div className="font-semibold text-base mb-1">{p.name}</div>
              <p className="text-sm text-muted-foreground mb-3">{p.description}</p>
              <div className="text-xs font-mono text-muted-foreground mb-2">SAMPLE TITLES</div>
              <ul className="space-y-1 text-sm">
                {p.sampleTitles?.map((t, j) => (
                  <li key={j} className="text-sm">
                    · {t}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      </div>

      {/* Channel mix */}
      <div className="mt-4">
        <div className="text-xs font-mono text-muted-foreground mb-2">CHANNEL MIX</div>
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Channel</th>
                <th className="text-left px-4 py-2 font-medium">Role</th>
                <th className="text-left px-4 py-2 font-medium">Priority</th>
              </tr>
            </thead>
            <tbody>
              {strategy.channelMix?.map((c, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-4 py-3 font-medium">{c.channel}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.role}</td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={
                        c.priority === "High"
                          ? "default"
                          : c.priority === "Medium"
                          ? "secondary"
                          : "outline"
                      }
                    >
                      {c.priority}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      {/* 90-day plan */}
      <div className="mt-4">
        <div className="text-xs font-mono text-muted-foreground mb-2">90-DAY PLAN</div>
        <div className="grid md:grid-cols-3 gap-4">
          {strategy.ninetyDayPlan?.map((phase, i) => (
            <Card key={i} className="p-5">
              <div className="flex items-baseline justify-between mb-1">
                <div className="font-semibold text-base">{phase.phase}</div>
                <div className="text-xs font-mono text-muted-foreground">{phase.weeks}</div>
              </div>
              <p className="text-sm text-muted-foreground mb-3">{phase.focus}</p>
              <div className="text-xs font-mono text-muted-foreground mb-2">OUTCOMES</div>
              <ul className="space-y-1 text-sm">
                {phase.outcomes?.map((o, j) => (
                  <li key={j} className="flex gap-2">
                    <span className="text-accent">›</span>
                    <span>{o}</span>
                  </li>
                ))}
              </ul>
              {(phase as any).rationale && (
                <RationaleBlock rationale={(phase as any).rationale} />
              )}
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

function RationaleBlock({ rationale }: { rationale: StrategicRationale }) {
  return (
    <div className="mt-4 pt-3 border-t border-border/60">
      <div className="text-[10px] font-mono text-accent mb-1 tracking-wider">STRATEGIC RATIONALE</div>
      <p className="text-xs leading-relaxed text-muted-foreground italic">{rationale.why}</p>
      {rationale.citations && rationale.citations.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {rationale.citations.map((c, i) => (
            <span
              key={i}
              className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent/10 text-accent"
              data-testid={`rationale-cite-${c}`}
            >
              {c}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// -------- SOW --------

function SOWSection({ sow, clientName }: { sow: SOW; clientName: string }) {
  return (
    <section>
      <SectionHeader
        index="04"
        eyebrow="Scope of work"
        title="Priced engagement — ready to send"
        description={`A modular fractional CMO SOW for ${clientName}. Three tiers, phase deliverables, team, and terms.`}
      />

      <Card className="p-6 mb-4">
        <div className="text-xs font-mono text-muted-foreground mb-2">EXECUTIVE SUMMARY</div>
        <p className="text-sm leading-relaxed">{sow.engagementSummary}</p>
      </Card>

      {/* Price tiers */}
      <div className="grid md:grid-cols-3 gap-4 mb-6">
        {sow.priceTiers?.map((tier, i) => {
          const featured = i === 1;
          return (
            <Card
              key={i}
              className={`p-6 relative ${
                featured
                  ? "border-accent/60 bg-gradient-to-b from-accent/[0.06] to-transparent"
                  : ""
              }`}
              data-testid={`card-tier-${i}`}
            >
              {featured && (
                <Badge className="absolute -top-2 right-4" variant="default">
                  Recommended
                </Badge>
              )}
              <div className="text-xs font-mono text-muted-foreground mb-1">
                TIER 0{i + 1}
              </div>
              <div className="font-serif text-xl mb-1">{tier.name}</div>
              <div className="font-serif text-3xl text-accent mb-3">{tier.monthly}</div>
              <div className="text-xs text-muted-foreground mb-4">
                Best for: {tier.bestFor}
              </div>
              <Separator className="my-3" />
              <ul className="space-y-2 text-sm">
                {tier.inclusions?.map((v, j) => (
                  <li key={j} className="flex gap-2">
                    <CheckCircle2 className="h-4 w-4 text-accent flex-shrink-0 mt-0.5" />
                    <span>{v}</span>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>

      {/* Brex vs. Market comparative matrix */}
      <BrexVsMarketMatrix />

      {/* Phases */}
      <div className="mb-6">
        <div className="text-xs font-mono text-muted-foreground mb-2">ENGAGEMENT PHASES</div>
        <div className="grid md:grid-cols-2 gap-4">
          {sow.phases?.map((p, i) => (
            <Card key={i} className="p-5">
              <div className="flex items-baseline justify-between mb-1">
                <div className="font-semibold text-base">{p.name}</div>
                <div className="text-xs font-mono text-muted-foreground">{p.weeks}</div>
              </div>
              <div className="grid grid-cols-2 gap-4 mt-3">
                <div>
                  <div className="text-xs font-mono text-muted-foreground mb-2">
                    DELIVERABLES
                  </div>
                  <ul className="space-y-1 text-xs">
                    {p.deliverables?.map((v, j) => (
                      <li key={j} className="flex gap-2">
                        <span className="text-accent">›</span>
                        <span>{v}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="text-xs font-mono text-muted-foreground mb-2">OUTCOMES</div>
                  <ul className="space-y-1 text-xs">
                    {p.outcomes?.map((v, j) => (
                      <li key={j} className="flex gap-2">
                        <span className="text-accent">›</span>
                        <span>{v}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              {(p as any).rationale && (
                <RationaleBlock rationale={(p as any).rationale} />
              )}
            </Card>
          ))}
        </div>
      </div>

      {/* Team + terms */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card className="p-5">
          <div className="text-xs font-mono text-muted-foreground mb-2">TEAM</div>
          <ul className="space-y-2 text-sm">
            {sow.team?.map((v, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-accent">›</span>
                <span>{v}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-5">
          <div className="text-xs font-mono text-muted-foreground mb-2">TERMS</div>
          <ul className="space-y-2 text-sm">
            {sow.termsNotes?.map((v, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-accent">›</span>
                <span>{v}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </section>
  );
}

// -------- Markdown export --------

function renderMarkdown(a: Analysis): string {
  const parts: string[] = [];
  parts.push(`# ${a.clientName} — Brex Atlas brief`);
  parts.push(`Website: ${a.clientUrl}`);
  if (a.industry) parts.push(`Industry: ${a.industry}`);
  if (a.revenueBand) parts.push(`Revenue band: ${a.revenueBand}`);
  if (a.budgetBand) parts.push(`Budget band: ${a.budgetBand}`);
  parts.push("");

  const ext = a.extraction ? (JSON.parse(a.extraction) as Extraction) : null;
  const comps = a.competitors ? (JSON.parse(a.competitors) as Competitor[]) : null;
  const strat = a.strategy ? (JSON.parse(a.strategy) as Strategy) : null;
  const sow = a.sow ? (JSON.parse(a.sow) as SOW) : null;

  if (ext) {
    parts.push(`## 01 · Website teardown`);
    parts.push(`**Positioning:** ${ext.positioningStatement}`);
    parts.push(`**Value props:**\n${ext.valueProps.map((v) => `- ${v}`).join("\n")}`);
    parts.push(`**Offerings:**\n${ext.offerings.map((v) => `- ${v}`).join("\n")}`);
    parts.push(`**Target audience:** ${ext.targetAudience}`);
    parts.push(`**AEO readiness:** ${ext.aeoReadinessScore}/100 — ${ext.aeoReadinessNotes}`);
    parts.push(`**CTA audit:** ${ext.ctaAudit}`);
    parts.push("");
  }

  if (comps) {
    parts.push(`## 02 · Competitors`);
    comps.forEach((c) => {
      parts.push(`### ${c.name} (${c.url})`);
      parts.push(c.positioning);
      parts.push(`**Strengths:** ${c.strengths.join("; ")}`);
      parts.push(`**Weaknesses:** ${c.weaknesses.join("; ")}`);
      parts.push(`**Hook angles:** ${c.hookIdeas.map((h) => `"${h}"`).join("; ")}`);
      parts.push("");
    });
  }

  if (strat) {
    parts.push(`## 03 · Strategy`);
    parts.push(`**ICP:** ${strat.icp.summary}`);
    parts.push(`**Positioning gaps:**\n${strat.positioningGaps.map((v) => `- ${v}`).join("\n")}`);
    parts.push(`**Messaging shifts:**\n${strat.messagingRecommendations.map((v) => `- ${v}`).join("\n")}`);
    parts.push(`**AEO moves:**\n${strat.aeoRecommendations.map((v) => `- ${v}`).join("\n")}`);
    parts.push(`**Quick wins (30d):**\n${strat.quickWins.map((v) => `- ${v}`).join("\n")}`);
    parts.push(`**Channel mix:**`);
    strat.channelMix.forEach((c) => parts.push(`- **${c.channel}** (${c.priority}) — ${c.role}`));
    parts.push(`**90-day plan:**`);
    strat.ninetyDayPlan.forEach((p) => {
      parts.push(`- **${p.phase} (${p.weeks})** — ${p.focus}`);
      p.outcomes.forEach((o) => parts.push(`  - ${o}`));
    });
    parts.push("");
  }

  if (sow) {
    parts.push(`## 04 · Scope of work`);
    parts.push(sow.engagementSummary);
    parts.push(`### Price tiers`);
    sow.priceTiers.forEach((t) => {
      parts.push(`- **${t.name}** — ${t.monthly} — Best for: ${t.bestFor}`);
      t.inclusions.forEach((i) => parts.push(`  - ${i}`));
    });
    parts.push(`### Phases`);
    sow.phases.forEach((p) => {
      parts.push(`**${p.name} — ${p.weeks}**`);
      parts.push(`Deliverables: ${p.deliverables.join("; ")}`);
      parts.push(`Outcomes: ${p.outcomes.join("; ")}`);
    });
    parts.push(`### Team`);
    sow.team.forEach((v) => parts.push(`- ${v}`));
    parts.push(`### Terms`);
    sow.termsNotes.forEach((v) => parts.push(`- ${v}`));
  }

  return parts.join("\n");
}

// =============================================================
// Brex vs. Market comparative matrix
// =============================================================
function BrexVsMarketMatrix() {
  return (
    <div className="mb-6">
      <div className="text-xs font-mono text-muted-foreground mb-2">
        BREX VS. MARKET RATE
      </div>

      {/* Tier comparison table */}
      <Card className="p-0 overflow-hidden mb-4">
        <div className="bg-primary/95 text-primary-foreground grid grid-cols-12 gap-2 px-4 py-3 text-xs font-mono uppercase tracking-wider">
          <div className="col-span-3">Brex Tier</div>
          <div className="col-span-2">Brex Price</div>
          <div className="col-span-3">Industry Mid-Market</div>
          <div className="col-span-2">vs Industry Mid</div>
          <div className="col-span-2">Bundle Savings</div>
        </div>
        {BREX_TIERS.map((tier, idx) => {
          const industryMid = (tier.industryLow + tier.industryHigh) / 2;
          const vsMid = computeSavings(tier.monthly, industryMid);
          return (
            <div
              key={tier.key}
              className={`grid grid-cols-12 gap-2 px-4 py-4 items-center border-t text-sm ${
                idx % 2 === 1 ? "bg-muted/30" : ""
              }`}
              data-testid={`row-tier-${tier.key}`}
            >
              <div className="col-span-3">
                <div className="font-semibold">{tier.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5 leading-tight">
                  {tier.bestFor}
                </div>
              </div>
              <div className="col-span-2">
                <div className="font-serif text-2xl text-accent">
                  ${tier.monthly.toLocaleString()}
                </div>
                <div className="text-xs text-muted-foreground">per month</div>
              </div>
              <div className="col-span-3">
                <div className="font-semibold">
                  ${(tier.industryLow / 1000).toFixed(0)}k – $
                  {(tier.industryHigh / 1000).toFixed(0)}k
                </div>
                <div className="text-xs text-muted-foreground">
                  Mid: ${(industryMid / 1000).toFixed(0)}k/mo
                </div>
              </div>
              <div className="col-span-2">
                <div
                  className={`font-serif text-2xl ${
                    vsMid.deltaPct >= 0 ? "text-emerald-600" : "text-red-600"
                  }`}
                >
                  {vsMid.label}
                </div>
                <div className="text-xs text-muted-foreground">vs mid</div>
              </div>
              <div className="col-span-2">
                <div className="font-semibold text-teal-700">
                  −{tier.discountPct}%
                </div>
                <div className="text-xs text-muted-foreground">
                  vs ${tier.aLaCarteMonthly.toLocaleString()} à la carte
                </div>
              </div>
            </div>
          );
        })}
      </Card>

      {/* Per-service line items */}
      <div className="text-xs font-mono text-muted-foreground mb-2">
        TACTICAL CMO LINE ITEMS · ${BREX_BLENDED_HOURLY}/HR BLENDED SENIOR RATE
      </div>
      <Card className="p-0 overflow-hidden">
        <div className="bg-primary/95 text-primary-foreground grid grid-cols-12 gap-2 px-4 py-2 text-xs font-mono uppercase tracking-wider">
          <div className="col-span-4">Service</div>
          <div className="col-span-2">Brex</div>
          <div className="col-span-3">Industry Mid-Market</div>
          <div className="col-span-1">vs Mid</div>
          <div className="col-span-2">Positioning</div>
        </div>
        {BREX_LINE_ITEMS.map((item, idx) => {
          const vs = computeSavings(item.brexPrice, item.benchmarkMid);
          const pos = positioningColor(item.positioning);
          return (
            <div
              key={item.key}
              className={`grid grid-cols-12 gap-2 px-4 py-3 items-center border-t text-sm ${
                idx % 2 === 1 ? "bg-muted/30" : ""
              }`}
              data-testid={`row-service-${item.key}`}
            >
              <div className="col-span-4">
                <div className="font-semibold">{item.service}</div>
                {item.notes && (
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {item.notes}
                  </div>
                )}
              </div>
              <div className="col-span-2 font-semibold text-accent">
                {formatBrexPrice(item.brexPrice, item.brexUnit)}
              </div>
              <div className="col-span-3 text-muted-foreground">
                {formatBrexPrice(item.benchmarkLow, item.benchmarkUnit)} –{" "}
                {formatBrexPrice(item.benchmarkHigh, item.benchmarkUnit)}
              </div>
              <div
                className={`col-span-1 font-semibold ${
                  vs.deltaPct >= 0 ? "text-emerald-600" : "text-red-600"
                }`}
              >
                {vs.label}
              </div>
              <div
                className="col-span-2 text-xs font-semibold uppercase tracking-wider"
                style={{ color: pos.hex }}
              >
                {pos.label}
              </div>
            </div>
          );
        })}
      </Card>

      <p className="text-xs text-muted-foreground italic mt-3">
        Bundle discounts (17% Advisor, 24% Strategist, 32% Fractional) reflect
        commitment and utilization efficiency. Industry ranges compiled from 2026
        pricing surveys: Treetop Fractional Executive Report, MarkCMO, Averi,
        Pitchkitchen, O-CMO, RankedCMO, Digital Applied, Windmill Growth,
        Remarkable Agency, and Troo Inbound. Full citations in the exported
        report.
      </p>
    </div>
  );
}

// -------- Frameworks (SWOT / PESTEL / Porter's) --------

function FrameworksSection({
  swot,
  pestel,
  porters,
  status,
}: {
  swot: SwotAnalysis | null;
  pestel: PestelAnalysis | null;
  porters: PortersFiveForces | null;
  status: string;
}) {
  const anyLoaded = !!(swot || pestel || porters);
  const isRunning = status !== "done" && status !== "error";

  if (!anyLoaded) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        {isRunning
          ? "Strategic frameworks are generating…"
          : "No frameworks generated for this analysis. Re-run the intake with PESTEL / Porter's toggles enabled to get macro + industry-structure research with cited sources."}
      </Card>
    );
  }

  return (
    <div className="space-y-10">
      {swot && <SwotView swot={swot} />}
      {pestel && <PestelView pestel={pestel} />}
      {porters && <PortersView porters={porters} />}
      {!pestel && !porters && (
        <Card className="p-5 bg-muted/30 border-dashed">
          <div className="text-xs font-mono text-muted-foreground mb-1">TIP</div>
          <p className="text-sm">
            Turn on <span className="font-semibold">PESTEL</span> or{" "}
            <span className="font-semibold">Porter's Five Forces</span> in the intake form
            to add macro & industry-structure research with cited 2025–2026 sources.
          </p>
        </Card>
      )}
    </div>
  );
}

function SwotView({ swot }: { swot: SwotAnalysis }) {
  const quadrants: Array<{
    key: "strengths" | "weaknesses" | "opportunities" | "threats";
    label: string;
    tone: string;
    items: Array<{ id: string; title: string; evidence: string }>;
  }> = [
    { key: "strengths", label: "Strengths", tone: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200/50 dark:border-emerald-800/50", items: swot.strengths },
    { key: "weaknesses", label: "Weaknesses", tone: "text-rose-600 bg-rose-50 dark:bg-rose-950/30 border-rose-200/50 dark:border-rose-800/50", items: swot.weaknesses },
    { key: "opportunities", label: "Opportunities", tone: "text-sky-600 bg-sky-50 dark:bg-sky-950/30 border-sky-200/50 dark:border-sky-800/50", items: swot.opportunities },
    { key: "threats", label: "Threats", tone: "text-amber-700 bg-amber-50 dark:bg-amber-950/30 border-amber-200/50 dark:border-amber-800/50", items: swot.threats },
  ];

  return (
    <section>
      <SectionHeader
        index="F1"
        eyebrow="SWOT"
        title="Strengths, weaknesses, opportunities, threats"
        description={`Grounded in the ${swot.industry} extraction and competitor teardown. Every item has a stable ID for cross-referencing.`}
      />
      {swot.summary && (
        <Card className="p-5 mb-4 bg-accent/[0.04] border-accent/20">
          <div className="text-xs font-mono text-accent mb-1">STRATEGIC READ</div>
          <p className="text-sm leading-relaxed">{swot.summary}</p>
        </Card>
      )}
      <div className="grid md:grid-cols-2 gap-4">
        {quadrants.map((q) => (
          <Card key={q.key} className={`p-5 border ${q.tone}`}>
            <div className="text-xs font-mono uppercase tracking-wider mb-3 font-semibold">
              {q.label}
            </div>
            <ul className="space-y-3">
              {q.items?.map((item) => (
                <li key={item.id} className="text-sm" data-testid={`swot-${item.id}`}>
                  <div className="flex gap-2 items-baseline">
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-background border border-border">
                      {item.id}
                    </span>
                    <span className="font-semibold">{item.title}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {item.evidence}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </section>
  );
}

function PestelView({ pestel }: { pestel: PestelAnalysis }) {
  const factors: Array<{ key: PestelFinding["factor"]; label: string }> = [
    { key: "political", label: "Political & Regulatory" },
    { key: "economic", label: "Economic" },
    { key: "social", label: "Social & Demographic" },
    { key: "technological", label: "Technological" },
    { key: "environmental", label: "Environmental & ESG" },
    { key: "legal", label: "Legal & Compliance" },
  ];

  const grouped = factors.map((f) => ({
    ...f,
    findings: pestel.findings.filter((x) => x.factor === f.key),
  }));

  return (
    <section>
      <SectionHeader
        index="F2"
        eyebrow="PESTEL"
        title="Macro factors with cited sources"
        description={`External forces shaping the ${pestel.industry} industry in 2025–2026. Each finding is tied to industry publications, government reports, or analyst commentary.`}
      />
      {pestel.summary && (
        <Card className="p-5 mb-4 bg-accent/[0.04] border-accent/20">
          <div className="text-xs font-mono text-accent mb-1">MACRO THEME</div>
          <p className="text-sm leading-relaxed">{pestel.summary}</p>
        </Card>
      )}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {grouped.map((g) => (
          <Card key={g.key} className="p-5">
            <div className="text-xs font-mono uppercase tracking-wider text-accent mb-3">
              {g.label}
            </div>
            {g.findings.length === 0 && (
              <div className="text-xs text-muted-foreground italic">
                No findings for this factor.
              </div>
            )}
            <ul className="space-y-4">
              {g.findings.map((f) => (
                <li key={f.id} className="text-sm" data-testid={`pestel-${f.id}`}>
                  <div className="flex gap-2 items-baseline mb-1">
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-background border border-border">
                      {f.id}
                    </span>
                    <ImpactBadge impact={f.impact} />
                    <HorizonBadge horizon={f.timeHorizon} />
                  </div>
                  <p className="text-sm leading-relaxed">{f.insight}</p>
                  {f.sources && f.sources.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {f.sources.map((s, i) => (
                        <a
                          key={i}
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-teal-700 text-white hover:bg-teal-800 transition-colors"
                          data-testid={`pestel-source-${f.id}-${i}`}
                        >
                          <span>{s.publisher || domainFromUrl(s.url)}</span>
                          <ArrowUpRight className="h-2.5 w-2.5" />
                        </a>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </section>
  );
}

function PortersView({ porters }: { porters: PortersFiveForces }) {
  const orderedForces = [
    porters.forces.find((f) => f.force === "rivalry"),
    porters.forces.find((f) => f.force === "newEntrants"),
    porters.forces.find((f) => f.force === "substitutes"),
    porters.forces.find((f) => f.force === "buyerPower"),
    porters.forces.find((f) => f.force === "supplierPower"),
  ].filter((f): f is PortersForce => !!f);

  const forceLabels: Record<PortersForce["force"], string> = {
    rivalry: "Competitive Rivalry",
    newEntrants: "Threat of New Entrants",
    substitutes: "Threat of Substitutes",
    buyerPower: "Buyer Power",
    supplierPower: "Supplier Power",
  };

  return (
    <section>
      <SectionHeader
        index="F3"
        eyebrow="Porter's Five Forces"
        title="Industry structure & competitive intensity"
        description={`Five-force analysis of ${porters.industry}. Each force has an intensity rating (low/medium/high), drivers, and cited 2025–2026 sources.`}
      />
      {(porters.overallStructure || porters.summary) && (
        <Card className="p-5 mb-4 bg-accent/[0.04] border-accent/20 space-y-2">
          {porters.overallStructure && (
            <div>
              <div className="text-xs font-mono text-accent mb-1">INDUSTRY STRUCTURE</div>
              <p className="text-sm leading-relaxed">{porters.overallStructure}</p>
            </div>
          )}
          {porters.summary && (
            <div>
              <div className="text-xs font-mono text-accent mb-1">DECISIVE FORCE</div>
              <p className="text-sm leading-relaxed">{porters.summary}</p>
            </div>
          )}
        </Card>
      )}
      <div className="space-y-4">
        {orderedForces.map((f) => (
          <Card key={f.id} className="p-5" data-testid={`porters-${f.id}`}>
            <div className="flex items-center gap-3 mb-3">
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-background border border-border">
                {f.id}
              </span>
              <div className="font-semibold text-base flex-1">{forceLabels[f.force]}</div>
              <IntensityBadge intensity={f.intensity} />
            </div>
            <p className="text-sm leading-relaxed mb-3">{f.rationale}</p>
            {f.drivers && f.drivers.length > 0 && (
              <div className="mb-3">
                <div className="text-xs font-mono text-muted-foreground mb-2">KEY DRIVERS</div>
                <ul className="space-y-1 text-sm">
                  {f.drivers.map((d, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-accent">›</span>
                      <span>{d}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {f.sources && f.sources.length > 0 && (
              <div className="pt-3 border-t border-border/50">
                <div className="text-xs font-mono text-muted-foreground mb-2">SOURCES</div>
                <div className="flex flex-wrap gap-1.5">
                  {f.sources.map((s, i) => (
                    <a
                      key={i}
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-teal-700 text-white hover:bg-teal-800 transition-colors"
                      data-testid={`porters-source-${f.id}-${i}`}
                    >
                      <span>{s.publisher || domainFromUrl(s.url)}</span>
                      <ArrowUpRight className="h-2.5 w-2.5" />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>
    </section>
  );
}

function ImpactBadge({ impact }: { impact: "positive" | "negative" | "neutral" }) {
  const map = {
    positive: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
    negative: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
    neutral: "bg-slate-100 text-slate-700 dark:bg-slate-800/40 dark:text-slate-300",
  };
  return (
    <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded uppercase tracking-wider ${map[impact]}`}>
      {impact}
    </span>
  );
}

function HorizonBadge({ horizon }: { horizon: "near" | "mid" | "long" }) {
  const label = horizon === "near" ? "<12mo" : horizon === "mid" ? "12-36mo" : "3yr+";
  return (
    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded uppercase tracking-wider bg-muted text-muted-foreground">
      {label}
    </span>
  );
}

function IntensityBadge({ intensity }: { intensity: "low" | "medium" | "high" }) {
  const map = {
    low: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
    medium: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
    high: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
  };
  return (
    <span className={`text-[10px] font-mono px-2 py-0.5 rounded uppercase tracking-wider font-semibold ${map[intensity]}`}>
      {intensity}
    </span>
  );
}

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// ============================================================================
// Underlying Assumptions dialog — edit assumptions live with a prospect and
// optionally regenerate the analysis with the new numbers.
// ============================================================================
type AssumptionsForm = {
  currentAnnualRevenue: string;
  currentMarketingBudget: string;
  grossMarginPct: string;
  revenueGrowthTargetPct: string;
  topCompetitors: string;
  preferredTier: string;
};

function AssumptionsDialog({ analysis }: { analysis: Analysis }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  // Parse existing assumptions JSON from the analysis row into form strings
  const parseInitial = (): AssumptionsForm => {
    let saved: any = {};
    try {
      saved = analysis.assumptions ? JSON.parse(analysis.assumptions as string) : {};
    } catch { saved = {}; }
    return {
      currentAnnualRevenue: saved.currentAnnualRevenue?.toString() ?? "",
      currentMarketingBudget: saved.currentMarketingBudget?.toString() ?? "",
      grossMarginPct: saved.grossMarginPct?.toString() ?? "",
      revenueGrowthTargetPct: saved.revenueGrowthTargetPct?.toString() ?? "",
      topCompetitors: saved.topCompetitors ?? "",
      preferredTier: saved.preferredTier ?? "",
    };
  };

  const [form, setForm] = useState<AssumptionsForm>(parseInitial);

  // Re-parse when dialog opens (in case the row updated since mount)
  useEffect(() => {
    if (open) setForm(parseInitial());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, analysis.assumptions]);

  // Parse the string form into the API payload
  function buildPayload(): Record<string, unknown> {
    const parseNum = (v: string) => {
      if (!v) return undefined;
      const cleaned = v.replace(/[$,\s]/g, "");
      const n = parseFloat(cleaned);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    };
    const out: Record<string, unknown> = {};
    const rev = parseNum(form.currentAnnualRevenue);
    const mkt = parseNum(form.currentMarketingBudget);
    const gm = parseNum(form.grossMarginPct);
    const grow = parseNum(form.revenueGrowthTargetPct);
    if (rev !== undefined) out.currentAnnualRevenue = rev;
    if (mkt !== undefined) out.currentMarketingBudget = mkt;
    if (gm !== undefined && gm <= 100) out.grossMarginPct = gm;
    if (grow !== undefined) out.revenueGrowthTargetPct = grow;
    if (form.topCompetitors.trim()) out.topCompetitors = form.topCompetitors.trim();
    if (form.preferredTier && form.preferredTier !== "") out.preferredTier = form.preferredTier;
    return out;
  }

  // Save without regenerating — just persist the JSON blob
  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/analyses/${analysis.id}/assumptions`, buildPayload());
      return await res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/analyses", analysis.id] });
      toast({ title: "Assumptions saved", description: "Click Regenerate to re-run the analysis with these values." });
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: err?.message ?? "Try again.", variant: "destructive" });
    },
  });

  // Save AND regenerate the analysis with these assumptions
  const regenerateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/analyses/${analysis.id}/regenerate`, buildPayload());
      return await res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/analyses", analysis.id] });
      setOpen(false);
      toast({
        title: "Regeneration started",
        description: "The analysis is re-running with the updated assumptions. Refresh in ~2 minutes.",
      });
    },
    onError: (err: any) => {
      toast({ title: "Regenerate failed", description: err?.message ?? "Try again.", variant: "destructive" });
    },
  });

  const busy = saveMutation.isPending || regenerateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid="btn-edit-assumptions">
          <Sliders className="h-3.5 w-3.5 mr-1.5" />
          Edit assumptions
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Underlying assumptions</DialogTitle>
          <DialogDescription>
            These drive the ROI math, growth targets, and framework recommendations.
            Save to persist, or Regenerate to re-run the full analysis with new numbers.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Current annual revenue (USD)</Label>
              <Input
                placeholder="e.g. 5000000"
                value={form.currentAnnualRevenue}
                onChange={(e) => setForm({ ...form, currentAnnualRevenue: e.target.value })}
                data-testid="dialog-assumption-revenue"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Current marketing budget (USD/yr)</Label>
              <Input
                placeholder="e.g. 250000"
                value={form.currentMarketingBudget}
                onChange={(e) => setForm({ ...form, currentMarketingBudget: e.target.value })}
                data-testid="dialog-assumption-marketing-budget"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Gross margin %</Label>
              <Input
                placeholder="e.g. 65"
                value={form.grossMarginPct}
                onChange={(e) => setForm({ ...form, grossMarginPct: e.target.value })}
                data-testid="dialog-assumption-margin"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Revenue growth target (12mo, %)</Label>
              <Input
                placeholder="e.g. 25"
                value={form.revenueGrowthTargetPct}
                onChange={(e) => setForm({ ...form, revenueGrowthTargetPct: e.target.value })}
                data-testid="dialog-assumption-growth"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Top 3 known competitors</Label>
            <Input
              placeholder="e.g. Sage Intacct, SAP Business One, Microsoft Dynamics"
              value={form.topCompetitors}
              onChange={(e) => setForm({ ...form, topCompetitors: e.target.value })}
              data-testid="dialog-assumption-competitors"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Preferred engagement tier</Label>
            <Select value={form.preferredTier} onValueChange={(v) => setForm({ ...form, preferredTier: v })}>
              <SelectTrigger data-testid="dialog-assumption-tier"><SelectValue placeholder="No preference" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="advisor">Advisor — 17% discount</SelectItem>
                <SelectItem value="strategist">Strategist — 24% discount</SelectItem>
                <SelectItem value="fractional">Fractional — 32% discount</SelectItem>
                <SelectItem value="unknown">Not sure yet</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={() => saveMutation.mutate()}
            disabled={busy}
            data-testid="btn-save-assumptions"
          >
            {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
            Save only
          </Button>
          <Button
            onClick={() => regenerateMutation.mutate()}
            disabled={busy}
            data-testid="btn-regenerate-analysis"
          >
            {regenerateMutation.isPending
              ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              : <RotateCw className="h-3.5 w-3.5 mr-1.5" />}
            Save & regenerate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
