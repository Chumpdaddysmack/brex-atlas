import { useEffect, useMemo, useState } from "react";
import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
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
} from "lucide-react";
import type {
  Analysis,
  Extraction,
  Competitor,
  Strategy,
  SOW,
} from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

const STEPS = [
  { key: "extracting", label: "Website teardown", icon: ScanSearch, min: 0 },
  { key: "competitors", label: "Competitor set", icon: Target, min: 35 },
  { key: "strategy", label: "Strategy & 90-day plan", icon: Lightbulb, min: 60 },
  { key: "sow", label: "Scope of work", icon: FileText, min: 85 },
];

function statusIndex(status: string) {
  const order = ["queued", "extracting", "competitors", "strategy", "sow", "done", "error"];
  return order.indexOf(status);
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

        {/* Results */}
        {analysis.extraction && (
          <ExtractionSection extraction={JSON.parse(analysis.extraction)} />
        )}
        {analysis.competitors && (
          <CompetitorsSection competitors={JSON.parse(analysis.competitors)} />
        )}
        {analysis.strategy && (
          <StrategySection strategy={JSON.parse(analysis.strategy)} />
        )}
        {analysis.sow && <SOWSection sow={JSON.parse(analysis.sow)} clientName={analysis.clientName} />}

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
            </Card>
          ))}
        </div>
      </div>
    </section>
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
