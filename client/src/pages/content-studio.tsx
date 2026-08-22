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
                <TabsList className="flex-wrap
