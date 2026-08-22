import { useMemo, useState } from "react";
import { useRoute, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  Sparkles,
  Loader2,
  AlertTriangle,
  FileText,
  Megaphone,
  Layout,
  Radio,
  Calendar,
  CheckCircle2,
  XCircle,
  Copy,
} from "lucide-react";
import type { Analysis, ContentPlan, ContentPiece, ContentPlanPayload } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

const CHANNELS: { key: string; label: string; icon: any }[] = [
  { key: "blog", label: "Blog calendar", icon: FileText },
  { key: "linkedin", label: "LinkedIn", icon: Radio },
  { key: "instagram", label: "Instagram", icon: Radio },
  { key: "x", label: "X", icon: Radio },
  { key: "meta_ad", label: "Meta ads", icon: Megaphone },
  { key: "linkedin_ad", label: "LinkedIn ads", icon: Megaphone },
  { key: "cold_email", label: "Cold email", icon: Radio },
  { key: "landing_page", label: "Landing pages", icon: Layout },
];

export default function ContentStudio() {
  const [, params] = useRoute("/analysis/:id/content");
  const analysisId = params?.id;
  const { toast } = useToast();
  const [activeChannel, setActiveChannel] = useState<string>("blog");
  const [selectedPiece, setSelectedPiece] = useState<ContentPiece | null>(null);

  const analysisQ = useQuery<Analysis>({
    queryKey: ["/api/analyses", analysisId],
    queryFn: async () => (await apiRequest("GET", `/api/analyses/${analysisId}`)).json(),
    enabled: !!analysisId,
  });

  const planQ = useQuery<ContentPlan | null>({
    queryKey: ["/api/analyses", analysisId, "content-plan"],
    queryFn: async () => {
      const r = await apiRequest("GET", `/api/analyses/${analysisId}/content-plan`);
      if (r.status === 404) return null;
      return r.json();
    },
    enabled: !!analysisId,
    refetchInterval: (query) => {
      const d = query.state.data as ContentPlan | null | undefined;
      if (!d) return false;
      return d.status === "ready" || d.status === "error" ? false : 2500;
    },
  });

  const generateMut = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/analyses/${analysisId}/content-plan`, {})).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/analyses", analysisId, "content-plan"] });
    },
    onError: (e: any) =>
      toast({ title: "Failed to start", description: e?.message ?? "Unknown error", variant: "destructive" }),
  });

  const piecesQ = useQuery<ContentPiece[]>({
    queryKey: ["/api/content-plans", planQ.data?.id, "pieces", activeChannel],
    queryFn: async () =>
      (await apiRequest("GET", `/api/content-plans/${planQ.data!.id}/pieces?channel=${activeChannel}`)).json(),
    enabled: !!planQ.data?.id && planQ.data?.status === "ready",
  });

  const planPayload: ContentPlanPayload | null = useMemo(() => {
    if (!planQ.data?.planJson) return null;
    try {
      return JSON.parse(planQ.data.planJson);
    } catch {
      return null;
    }
  }, [planQ.data?.planJson]);

  const copyChannelMarkdown = () => {
    if (!piecesQ.data || !planPayload) return;
    const md = renderChannelMarkdown(activeChannel, piecesQ.data, planPayload);
    navigator.clipboard.writeText(md).then(() =>
      toast({ title: "Copied", description: `${activeChannel.replace("_", " ")} exported to clipboard.` }),
    );
  };

  const copyFullPlan = () => {
    if (!planPayload) return;
    navigator.clipboard.writeText(renderFullPlanMarkdown(planPayload, analysisQ.data?.clientName ?? "")).then(() =>
      toast({ title: "Copied", description: "Full 12-week plan copied as Markdown." }),
    );
  };

  if (!analysisQ.data) {
    return (
      <AppShell>
        <div className="max-w-5xl mx-auto py-12 px-4">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      </AppShell>
    );
  }
  const analysis = analysisQ.data;
  const plan = planQ.data;

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto py-10 px-4 space-y-8">
        <div>
          <Link href={`/analysis/${analysisId}`}>
            <Button variant="ghost" size="sm" data-testid="button-back-to-analysis">
              <ArrowLeft className="h-4 w-4 mr-2" /> Back to analysis
            </Button>
          </Link>
          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Content Studio</div>
              <h1 className="font-display text-3xl md:text-4xl leading-tight mt-1">
                {analysis.clientName}{" "}
                <span className="text-muted-foreground font-sans font-normal text-xl">
                  — 12-week strategy plan
                </span>
              </h1>
              <p className="text-muted-foreground mt-2 text-sm max-w-2xl">
                Strategy-only: paid-ad briefs (Meta + LinkedIn), a 12-week × 10-post blog calendar (120 titled posts
                with target queries and pillars), organic-social cadence (LinkedIn / Instagram / X), and 5 AEO landing
                pages. No drafts — approve titles and angles, then hand execution to your team.
              </p>
            </div>
            {plan?.status === "ready" && (
              <Button variant="outline" onClick={copyFullPlan} data-testid="button-copy-full-plan">
                <Copy className="h-4 w-4 mr-2" /> Copy full plan
              </Button>
            )}
          </div>
        </div>

        {/* Empty state — no plan yet */}
        {!plan && (
          <Card className="p-8">
            <div className="flex flex-col md:flex-row md:items-center gap-6">
              <div className="flex-1 space-y-3">
                <div className="flex items-center gap-2 text-primary">
                  <Sparkles className="h-5 w-5" />
                  <span className="font-mono text-xs uppercase tracking-widest">Generate the plan</span>
                </div>
                <h2 className="font-display text-2xl">Build the 12-week strategy plan</h2>
                <p className="text-muted-foreground">
                  I'll produce the full 12-week blog editorial calendar (120 titled + keyword-tagged posts), 3
                  organic-social channels with 3–5 starter posts each, paid-ad briefs for Meta + LinkedIn, and 5
                  AEO-optimized landing pages. Titles and angles only — reviewers approve at the strategy layer, not
                  the copy layer.
                </p>
              </div>
              <Button
                size="lg"
                data-testid="button-generate-plan"
                onClick={() => generateMut.mutate()}
                disabled={generateMut.isPending}
              >
                {generateMut.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-2" />
                )}
                Generate the 12-week plan
              </Button>
            </div>
          </Card>
        )}

        {/* Generating state */}
        {plan && plan.status !== "ready" && plan.status !== "error" && (
          <Card className="p-6">
            <div className="flex items-center gap-3 mb-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                Building your plan
              </div>
            </div>
            <div className="text-sm font-medium mb-2">{plan.currentStep}</div>
            <Progress value={plan.progress} />
            <div className="text-xs text-muted-foreground mt-2">
              {plan.progress}% complete — this usually takes 60–120 seconds
            </div>
          </Card>
        )}

        {plan && plan.status === "error" && (
          <Card className="p-6 border-destructive/40">
            <div className="flex items-center gap-2 text-destructive mb-2">
              <AlertTriangle className="h-5 w-5" /> Plan generation failed
            </div>
            <div className="text-sm text-muted-foreground mb-3">{plan.errorMessage}</div>
            <Button onClick={() => generateMut.mutate()} variant="outline">
              Try again
            </Button>
          </Card>
        )}

        {/* Ready */}
        {plan && plan.status === "ready" && planPayload && (
          <>
            <Card className="p-6">
              <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-2">
                12-week thesis
              </div>
              <p className="text-lg leading-relaxed">{planPayload.summary}</p>
              <div className="mt-6 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {planPayload.contentPillars?.map((p) => (
                  <div key={p.name} className="rounded-lg border border-border p-4">
                    <div className="text-xs font-mono uppercase tracking-widest text-primary mb-1">Pillar</div>
                    <div className="font-semibold">{p.name}</div>
                    <div className="text-sm text-muted-foreground mt-1">{p.description}</div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Channel tabs */}
            <Tabs value={activeChannel} onValueChange={setActiveChannel}>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <TabsList className="flex-wrap h-auto">
                  {CHANNELS.map((c) => {
                    const Icon = c.icon;
                    return (
                      <TabsTrigger key={c.key} value={c.key} className="gap-2" data-testid={`tab-${c.key}`}>
                        <Icon className="h-4 w-4" />
                        {c.label}
                      </TabsTrigger>
                    );
                  })}
                </TabsList>
                <Button variant="ghost" size="sm" onClick={copyChannelMarkdown}>
                  <Copy className="h-4 w-4 mr-2" /> Copy this channel
                </Button>
              </div>

              {CHANNELS.map((c) => (
                <TabsContent key={c.key} value={c.key} className="mt-6">
                  <ChannelPanel
                    channel={c.key}
                    label={c.label}
                    planPayload={planPayload}
                    pieces={activeChannel === c.key ? piecesQ.data ?? [] : []}
                    isLoading={activeChannel === c.key && piecesQ.isLoading}
                    onReview={setSelectedPiece}
                  />
                </TabsContent>
              ))}
            </Tabs>
          </>
        )}
      </div>

      <ReviewDialog piece={selectedPiece} onOpenChange={(o) => !o && setSelectedPiece(null)} planPayload={planPayload} />
    </AppShell>
  );
}

// -------- Channel panel --------

function ChannelPanel({
  channel,
  label,
  pieces,
  isLoading,
  planPayload,
  onReview,
}: {
  channel: string;
  label: string;
  pieces: ContentPiece[];
  isLoading: boolean;
  planPayload: ContentPlanPayload;
  onReview: (p: ContentPiece) => void;
}) {
  if (isLoading) return <Loader2 className="h-6 w-6 animate-spin" />;
  if (pieces.length === 0 && channel !== "cold_email")
    return <div className="text-muted-foreground text-sm">No entries yet for {label}.</div>;

  // Blog: grouped by week + calendar header
  if (channel === "blog") {
    const byWeek = new Map<number, ContentPiece[]>();
    for (const p of pieces) {
      const w = p.weekNumber ?? 0;
      if (!byWeek.has(w)) byWeek.set(w, []);
      byWeek.get(w)!.push(p);
    }
    const weeks = Array.from(byWeek.entries()).sort((a, b) => a[0] - b[0]);
    const total = pieces.length;
    const approved = pieces.filter((p) => p.status === "approved").length;
    const rejected = pieces.filter((p) => p.status === "rejected").length;

    return (
      <div className="space-y-6">
        <Card className="p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <Calendar className="h-5 w-5 text-primary" />
            <div>
              <div className="text-sm font-semibold">{total} planned blog posts across 12 weeks</div>
              <div className="text-xs text-muted-foreground">
                {approved} approved · {rejected} rejected · {total - approved - rejected} pending review
              </div>
            </div>
          </div>
          <Progress value={((approved + rejected) / Math.max(total, 1)) * 100} className="w-48" />
        </Card>
        {weeks.map(([weekNum, weekPieces]) => (
          <Card key={weekNum} className="p-5">
            <div className="flex items-baseline justify-between mb-3">
              <div>
                <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Week {weekNum}</div>
                {weekPieces[0]?.scheduledDate && (
                  <div className="font-display text-lg">
                    Publishing week of {weekPieces[0].scheduledDate.slice(0, 10)}
                  </div>
                )}
              </div>
              <Badge variant="outline">{weekPieces.length} posts</Badge>
            </div>
            <div className="space-y-2">
              {weekPieces.map((p: ContentPiece) => (
                <PieceRow key={p.id} piece={p} onReview={() => onReview(p)} />
              ))}
            </div>
          </Card>
        ))}
      </div>
    );
  }

  // Ads: show the audience brief + FULL hero sample + creative concepts
  if (channel === "meta_ad" || channel === "linkedin_ad") {
    const brief = planPayload.adBrief?.find((b) => b.channel === channel);
    const hero = channel === "meta_ad" ? planPayload.heroMetaAd : planPayload.heroLinkedInAd;
    return (
      <div className="space-y-4">
        {brief && (
          <Card className="p-4 bg-muted/30">
            <div className="font-mono text-xs uppercase tracking-widest text-primary mb-1">Audience</div>
            <div className="text-sm leading-relaxed">{brief.audience}</div>
          </Card>
        )}
        {hero && <HeroAdCard channel={channel} hero={hero as any} />}
        {pieces.length > 0 && (
          <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground pt-2">
            {pieces.length} creative concepts (unfulfilled — write during retainer)
          </div>
        )}
        {pieces.map((p) => (
          <PieceRow key={p.id} piece={p} onReview={() => onReview(p)} />
        ))}
      </div>
    );
  }

  // Cold email: hero sequence only
  if (channel === "cold_email") {
    const hero = planPayload.heroColdEmail;
    if (!hero) {
      return (
        <Card className="p-6">
          <div className="text-sm text-muted-foreground">
            Cold email sequence is generated as a hero sample during plan build. Regenerate the plan to populate.
          </div>
        </Card>
      );
    }
    return <HeroColdEmailCard hero={hero} />;
  }

  // Social + landing pages: flat list
  return (
    <div className="space-y-2">
      {pieces.map((p) => (
        <PieceRow key={p.id} piece={p} onReview={() => onReview(p)} />
      ))}
    </div>
  );
}

function HeroAdCard({ channel, hero }: { channel: string; hero: any }) {
  const platformName = channel === "meta_ad" ? "Meta" : "LinkedIn";
  return (
    <Card className="p-6 border-primary/40">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="font-mono text-xs uppercase tracking-widest text-primary">
            Hero {platformName} ad — ready-to-ship sample
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Client-facing draft. Review, tweak, ship.
          </div>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          {channel === "linkedin_ad" && hero.introText && (
            <div>
              <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Intro text</div>
              <div className="text-sm mt-1 leading-relaxed">{hero.introText}</div>
            </div>
          )}
          {channel === "meta_ad" && hero.primaryText && (
            <div>
              <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Primary text</div>
              <div className="text-sm mt-1 leading-relaxed">{hero.primaryText}</div>
            </div>
          )}
          <div>
            <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Headline</div>
            <div className="font-semibold text-base mt-1">{hero.headline}</div>
          </div>
          <div>
            <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Description</div>
            <div className="text-sm mt-1">{hero.description}</div>
          </div>
          <div>
            <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">CTA</div>
            <Badge variant="default" className="mt-1">{hero.cta}</Badge>
          </div>
        </div>
        <div>
          <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Visual concept</div>
          <div className="text-sm mt-1 leading-relaxed text-muted-foreground italic">
            {hero.visualConcept}
          </div>
        </div>
      </div>
    </Card>
  );
}

function HeroColdEmailCard({ hero }: { hero: any }) {
  const touches = [
    { label: "Touch 1 (Day 0)", touch: hero.touch1 },
    { label: `Touch 2 (Day ${hero.touch2?.day ?? 4})`, touch: hero.touch2 },
    { label: `Touch 3 (Day ${hero.touch3?.day ?? 9}) — Breakup`, touch: hero.touch3 },
  ];
  return (
    <Card className="p-6 border-primary/40">
      <div className="mb-4">
        <div className="font-mono text-xs uppercase tracking-widest text-primary">
          Hero cold email sequence — 3-touch, ready to load in HubSpot
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          Client-facing draft. Review, personalize, load.
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 mb-6">
        <div>
          <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">ICP target</div>
          <div className="text-sm mt-1">{hero.icpTarget}</div>
        </div>
        <div className="space-y-2">
          <div>
            <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Subject A</div>
            <div className="text-sm mt-1 font-semibold">{hero.subjectLineA}</div>
          </div>
          <div>
            <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Subject B (test)</div>
            <div className="text-sm mt-1">{hero.subjectLineB}</div>
          </div>
        </div>
      </div>
      <div className="space-y-4">
        {touches.map(({ label, touch }) =>
          touch ? (
            <div key={label} className="rounded-lg border border-border p-4">
              <div className="font-mono text-xs uppercase tracking-widest text-primary mb-2">{label}</div>
              <div className="text-sm whitespace-pre-line leading-relaxed">{touch.body}</div>
            </div>
          ) : null,
        )}
      </div>
    </Card>
  );
}

function PieceRow({ piece, onReview }: { piece: ContentPiece; onReview: () => void }) {
  return (
    <Card className="p-4 flex items-center gap-4 flex-wrap">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={piece.status} />
          {piece.pillar && (
            <Badge variant="secondary" className="text-xs">
              {piece.pillar}
            </Badge>
          )}
          {piece.scheduledDate && (
            <span className="text-xs text-muted-foreground">{piece.scheduledDate}</span>
          )}
        </div>
        <div className="font-semibold mt-1 truncate">{piece.title}</div>
        {piece.targetQuery && (
          <div className="text-xs text-muted-foreground mt-1 italic">Answers: “{piece.targetQuery}”</div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={onReview} data-testid={`button-review-${piece.id}`}>
          Review
        </Button>
      </div>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string; Icon: any }> = {
    planned: { label: "Pending", className: "bg-muted text-muted-foreground", Icon: Calendar },
    approved: { label: "Approved", className: "bg-green-500/15 text-green-600", Icon: CheckCircle2 },
    rejected: { label: "Rejected", className: "bg-destructive/15 text-destructive", Icon: XCircle },
  };
  const cfg = map[status] ?? map.planned;
  const Icon = cfg.Icon;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono uppercase tracking-widest ${cfg.className}`}
    >
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

// -------- Review dialog --------

function ReviewDialog({
  piece,
  onOpenChange,
  planPayload,
}: {
  piece: ContentPiece | null;
  onOpenChange: (o: boolean) => void;
  planPayload: ContentPlanPayload | null;
}) {
  const { toast } = useToast();
  const [notes, setNotes] = useState("");

  const approveMut = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("POST", `/api/content-pieces/${piece!.id}/approve`, {
          notes: notes || undefined,
        })
      ).json(),
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast({ title: "Approved" });
      onOpenChange(false);
      setNotes("");
    },
  });

  const rejectMut = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("POST", `/api/content-pieces/${piece!.id}/reject`, {
          notes: notes || undefined,
        })
      ).json(),
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast({ title: "Rejected" });
      onOpenChange(false);
      setNotes("");
    },
  });

  const brief = useMemo(() => {
    if (!piece?.briefJson) return null;
    try {
      return JSON.parse(piece.briefJson);
    } catch {
      return null;
    }
  }, [piece?.briefJson]);

  if (!piece) return null;

  return (
    <Dialog open={!!piece} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl leading-tight">{piece.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="uppercase tracking-widest font-mono text-xs">
              {piece.channel.replace("_", " ")}
            </Badge>
            {piece.pillar && <Badge variant="secondary">{piece.pillar}</Badge>}
            <StatusBadge status={piece.status} />
          </div>
          {piece.targetQuery && (
            <div>
              <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-1">
                Target query
              </div>
              <div className="italic">“{piece.targetQuery}”</div>
            </div>
          )}
          {brief?.editorialBrief && (
            <div className="rounded-lg border border-primary/40 bg-primary/5 p-4 space-y-2">
              <div className="font-mono text-xs uppercase tracking-widest text-primary mb-1">Editorial brief</div>
              {brief.editorialBrief.readerQuestion && (
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Reader question</div>
                  <div className="text-sm leading-relaxed">{brief.editorialBrief.readerQuestion}</div>
                </div>
              )}
              {brief.editorialBrief.angleSummary && (
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Angle</div>
                  <div className="text-sm leading-relaxed">{brief.editorialBrief.angleSummary}</div>
                </div>
              )}
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs pt-1">
                {brief.editorialBrief.primaryKeyword && (
                  <div>
                    <span className="font-mono uppercase tracking-widest text-muted-foreground">Keyword: </span>
                    <span>{brief.editorialBrief.primaryKeyword}</span>
                  </div>
                )}
                {brief.editorialBrief.aeoQuery && (
                  <div>
                    <span className="font-mono uppercase tracking-widest text-muted-foreground">AEO: </span>
                    <span className="italic">“{brief.editorialBrief.aeoQuery}”</span>
                  </div>
                )}
              </div>
            </div>
          )}
          {brief && (
            <div className="space-y-2">
              {brief.angle && (
                <div>
                  <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-1">Angle</div>
                  <div className="text-sm leading-relaxed">{brief.angle}</div>
                </div>
              )}
              {brief.hook && (
                <div>
                  <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-1">Hook</div>
                  <div className="text-sm leading-relaxed">{brief.hook}</div>
                </div>
              )}
              {brief.primaryClaim && (
                <div>
                  <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-1">
                    Primary claim
                  </div>
                  <div className="text-sm leading-relaxed">{brief.primaryClaim}</div>
                </div>
              )}
              {brief.cta && (
                <div>
                  <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-1">CTA</div>
                  <div className="text-sm">{brief.cta}</div>
                </div>
              )}
              {brief.audience && (
                <div>
                  <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-1">Audience</div>
                  <div className="text-sm leading-relaxed">{brief.audience}</div>
                </div>
              )}
              {brief.keywords?.length ? (
                <div>
                  <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-1">Keywords</div>
                  <div className="text-sm flex flex-wrap gap-1">
                    {brief.keywords.map((k: string, i: number) => (
                      <Badge key={i} variant="outline" className="text-xs">
                        {k}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}
              {brief.outline?.length ? (
                <div>
                  <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-1">Outline</div>
                  <ul className="list-disc pl-5 text-sm space-y-1">
                    {brief.outline.map((o: string, i: number) => (
                      <li key={i}>{o}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {brief.slug && (
                <div className="text-xs text-muted-foreground font-mono">/{brief.slug}</div>
              )}
            </div>
          )}
          <div>
            <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-1">
              Review notes (optional)
            </div>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Anything you want your team to see when they draft this…"
            />
            {piece.reviewNotes && (
              <div className="mt-2 text-xs text-muted-foreground">
                <span className="font-mono uppercase tracking-widest">Previous:</span> {piece.reviewNotes}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button onClick={() => approveMut.mutate()} disabled={approveMut.isPending} data-testid="button-approve">
              <CheckCircle2 className="h-4 w-4 mr-2" /> Approve
            </Button>
            <Button
              variant="outline"
              onClick={() => rejectMut.mutate()}
              disabled={rejectMut.isPending}
              data-testid="button-reject"
            >
              <XCircle className="h-4 w-4 mr-2" /> Reject
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// -------- Markdown export helpers --------

function renderChannelMarkdown(channel: string, pieces: ContentPiece[], _payload: ContentPlanPayload): string {
  const lines: string[] = [];
  lines.push(`# ${channel.replace("_", " ")} — strategy plan\n`);
  const chan = channel;

  if (chan === "blog") {
    const byWeek = new Map<number, ContentPiece[]>();
    for (const p of pieces) {
      const w = p.weekNumber ?? 0;
      if (!byWeek.has(w)) byWeek.set(w, []);
      byWeek.get(w)!.push(p);
    }
    const weeks = Array.from(byWeek.entries()).sort((a, b) => a[0] - b[0]);
    for (const [weekNum, weekPieces] of weeks) {
      lines.push(`## Week ${weekNum}`);
      for (const p of weekPieces) {
        const brief = safeParse(p.briefJson);
        lines.push(`- **${p.title}**`);
        lines.push(`  - Pillar: ${p.pillar ?? "—"} · Schedule: ${p.scheduledDate ?? "—"} · Status: ${p.status}`);
        if (p.targetQuery) lines.push(`  - Target query: _${p.targetQuery}_`);
        if (brief?.angle) lines.push(`  - Angle: ${brief.angle}`);
        if (brief?.keywords?.length) lines.push(`  - Keywords: ${brief.keywords.join(", ")}`);
      }
      lines.push("");
    }
  } else {
    for (const p of pieces) {
      const brief = safeParse(p.briefJson);
      lines.push(`## ${p.title}`);
      lines.push(`- Status: ${p.status}${p.targetQuery ? ` · Target query: _${p.targetQuery}_` : ""}`);
      if (brief?.hook) lines.push(`- Hook: ${brief.hook}`);
      if (brief?.angle) lines.push(`- Angle: ${brief.angle}`);
      if (brief?.primaryClaim) lines.push(`- Primary claim: ${brief.primaryClaim}`);
      if (brief?.cta) lines.push(`- CTA: ${brief.cta}`);
      if (brief?.audience) lines.push(`- Audience: ${brief.audience}`);
      if (brief?.outline?.length) {
        lines.push(`- Outline:`);
        for (const o of brief.outline) lines.push(`  - ${o}`);
      }
      if (brief?.slug) lines.push(`- Slug: /${brief.slug}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

function renderFullPlanMarkdown(payload: ContentPlanPayload, clientName: string): string {
  const lines: string[] = [];
  lines.push(`# ${clientName} — 12-week content strategy plan\n`);
  lines.push(`## Thesis\n${payload.summary}\n`);
  lines.push(`## Content pillars`);
  for (const p of payload.contentPillars ?? []) lines.push(`- **${p.name}** — ${p.description}`);
  lines.push("");
  lines.push(`## Blog calendar`);
  for (const w of payload.blogCalendar ?? []) {
    lines.push(`### Week ${w.weekNumber} (${w.weekOf})`);
    for (const post of w.posts ?? []) {
      lines.push(`- **${post.title}** _(pillar: ${post.pillar}; schedule: ${post.scheduledDate})_`);
      lines.push(`  - Target query: _${post.targetQuery}_`);
      lines.push(`  - Angle: ${post.angle}`);
      if (post.keywords?.length) lines.push(`  - Keywords: ${post.keywords.join(", ")}`);
    }
    lines.push("");
  }
  lines.push(`## Social cadence`);
  for (const s of payload.socialCadence ?? []) {
    lines.push(`### ${s.channel} — ${s.postsPerWeek}/wk`);
    for (const post of s.starterPosts ?? []) {
      lines.push(`- **${post.title}** — hook: ${post.hook}`);
      if (post.targetQuery) lines.push(`  - Target query: _${post.targetQuery}_`);
      if (post.angle) lines.push(`  - Angle: ${post.angle}`);
    }
    lines.push("");
  }
  lines.push(`## Ad brief`);
  for (const b of payload.adBrief ?? []) {
    lines.push(`### ${b.channel}`);
    lines.push(`- Audience: ${b.audience}`);
    for (const c of b.creatives ?? []) {
      lines.push(`- **${c.title}** — ${c.angle}`);
      lines.push(`  - Primary claim: ${c.primaryClaim}`);
      lines.push(`  - CTA: ${c.cta}`);
    }
    lines.push("");
  }
  lines.push(`## Landing pages`);
  for (const p of payload.landingPages ?? []) {
    lines.push(`### ${p.title} — /${p.slug}`);
    lines.push(`- Sells: ${p.serviceOrProduct}`);
    lines.push(`- Target query: _${p.targetQuery}_`);
    if (p.outline?.length) {
      lines.push(`- Outline:`);
      for (const o of p.outline) lines.push(`  - ${o}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function safeParse(s: string | null): any {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
