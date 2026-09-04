import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ArrowRight, Sparkles, Target, FileText, LayoutList } from "lucide-react";
import type { Analysis } from "@shared/schema";

const intakeSchema = z.object({
  clientName: z.string().min(2, "Client name required"),
  clientUrl: z
    .string()
    .min(1, "Website URL required")
    .refine(
      (v) => {
        try {
          new URL(v.startsWith("http") ? v : `https://${v}`);
          return true;
        } catch {
          return false;
        }
      },
      { message: "Must be a valid URL, e.g. concentrus.com" },
    ),
  industry: z.string().optional(),
  revenueBand: z.string().optional(),
  goals: z.string().optional(),
  budgetBand: z.string().optional(),
  notes: z.string().optional(),
  includePestel: z.boolean().optional(),
  includePorters: z.boolean().optional(),
  // Underlying assumptions (all string inputs; parsed to numbers before submit)
  currentAnnualRevenue: z.string().optional(),
  currentMarketingBudget: z.string().optional(),
  grossMarginPct: z.string().optional(),
  revenueGrowthTargetPct: z.string().optional(),
  topCompetitors: z.string().optional(),
  preferredTier: z.string().optional(),
});

type FormValues = z.infer<typeof intakeSchema>;

export default function Home() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(intakeSchema),
    defaultValues: {
      clientName: "",
      clientUrl: "",
      industry: "",
      revenueBand: "",
      goals: "",
      budgetBand: "",
      notes: "",
      includePestel: false,
      includePorters: false,
      currentAnnualRevenue: "",
      currentMarketingBudget: "",
      grossMarginPct: "",
      revenueGrowthTargetPct: "",
      topCompetitors: "",
      preferredTier: "",
    },
  });

  const submitMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      // Parse assumption strings → typed numbers/enums for the API
      const parseNum = (v?: string) => {
        if (!v) return undefined;
        const cleaned = String(v).replace(/[$,\s]/g, "");
        const n = parseFloat(cleaned);
        return Number.isFinite(n) && n > 0 ? n : undefined;
      };
      const assumptions: Record<string, unknown> = {};
      const rev = parseNum(values.currentAnnualRevenue);
      const mkt = parseNum(values.currentMarketingBudget);
      const gm = parseNum(values.grossMarginPct);
      const grow = parseNum(values.revenueGrowthTargetPct);
      if (rev !== undefined) assumptions.currentAnnualRevenue = rev;
      if (mkt !== undefined) assumptions.currentMarketingBudget = mkt;
      if (gm !== undefined && gm <= 100) assumptions.grossMarginPct = gm;
      if (grow !== undefined) assumptions.revenueGrowthTargetPct = grow;
      if (values.topCompetitors?.trim()) assumptions.topCompetitors = values.topCompetitors.trim();
      if (values.preferredTier && values.preferredTier !== "") assumptions.preferredTier = values.preferredTier;

      const {
        currentAnnualRevenue: _r, currentMarketingBudget: _b, grossMarginPct: _g,
        revenueGrowthTargetPct: _t, topCompetitors: _c, preferredTier: _p,
        ...intake
      } = values;

      const normalized = {
        ...intake,
        clientUrl: intake.clientUrl.startsWith("http")
          ? intake.clientUrl
          : `https://${intake.clientUrl}`,
        assumptions: Object.keys(assumptions).length > 0 ? assumptions : undefined,
      };
      const res = await apiRequest("POST", "/api/analyses", normalized);
      return (await res.json()) as Analysis;
    },
    onSuccess: (data) => {
      setLocation(`/analysis/${data.id}`);
    },
    onError: (err: any) => {
      setSubmitting(false);
      toast({
        title: "Could not start analysis",
        description: err?.message ?? "Please try again.",
        variant: "destructive",
      });
    },
  });

  function onSubmit(values: FormValues) {
    setSubmitting(true);
    submitMutation.mutate(values);
  }

  return (
    <AppShell>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border">
        <div
          className="absolute inset-0 opacity-40 pointer-events-none"
          style={{
            background:
              "radial-gradient(1000px 400px at 20% -10%, hsl(var(--accent) / 0.10), transparent 60%), radial-gradient(800px 500px at 100% 0%, hsl(var(--chart-3) / 0.10), transparent 60%)",
          }}
        />
        <div className="mx-auto max-w-6xl px-6 pt-14 pb-10 relative">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1 text-xs text-muted-foreground mb-6">
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            Phase 1 MVP · URL in, strategy + SOW out
          </div>
          <h1 className="font-serif text-4xl sm:text-5xl leading-[1.05] tracking-tight max-w-3xl">
            One URL. A complete{" "}
            <span className="text-accent">competitive analysis</span>,{" "}
            <span className="italic">strategy</span>, and{" "}
            <span className="text-accent">scope of work</span>.
          </h1>
          <p className="mt-4 max-w-2xl text-muted-foreground">
            Drop in a prospect or client website. Brex Atlas runs the full Big Rock diagnostic —
            positioning teardown, competitor set, ICP definition, channel plan, 90-day roadmap,
            and a priced SOW you can send.
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-4 max-w-3xl">
            {[
              { icon: Target, label: "Site + positioning teardown" },
              { icon: LayoutList, label: "Competitor set (4)" },
              { icon: Sparkles, label: "Strategy + 90-day plan" },
              { icon: FileText, label: "Priced 3-tier SOW" },
            ].map(({ icon: Icon, label }) => (
              <div
                key={label}
                className="flex items-start gap-2 rounded-md border border-card-border bg-card/70 p-3 text-xs"
              >
                <Icon className="h-4 w-4 text-accent flex-shrink-0 mt-0.5" />
                <span className="text-muted-foreground">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Intake form */}
      <section className="mx-auto max-w-3xl px-6 py-12">
        <Card className="p-6 sm:p-8">
          <h2 className="text-xl font-semibold tracking-tight mb-1">Start a new analysis</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Only the website is required. Adding context sharpens the recommendations.
          </p>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" autoComplete="off">
              <div className="grid sm:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="clientName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Client name</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g. Acme Corp"
                          autoComplete="off"
                          data-testid="input-client-name"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="clientUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Website URL</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g. acme.com"
                          autoComplete="off"
                          data-testid="input-client-url"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid sm:grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="industry"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Industry</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g. SaaS, manufacturing"
                          autoComplete="off"
                          data-testid="input-industry"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="revenueBand"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Revenue band</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-revenue">
                            <SelectValue placeholder="Select" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Under $1M">Under $1M</SelectItem>
                          <SelectItem value="$1M-$5M">$1M-$5M</SelectItem>
                          <SelectItem value="$5M-$20M">$5M-$20M</SelectItem>
                          <SelectItem value="$20M-$50M">$20M-$50M</SelectItem>
                          <SelectItem value="$50M+">$50M+</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="budgetBand"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Monthly marketing budget</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-budget">
                            <SelectValue placeholder="Select" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Under $5K/mo">Under $5K/mo</SelectItem>
                          <SelectItem value="$5K-$15K/mo">$5K-$15K/mo</SelectItem>
                          <SelectItem value="$15K-$30K/mo">$15K-$30K/mo</SelectItem>
                          <SelectItem value="$30K-$60K/mo">$30K-$60K/mo</SelectItem>
                          <SelectItem value="$60K+/mo">$60K+/mo</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="goals"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Goals (optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="e.g. Grow qualified pipeline by 40% in 6 months; open Acumatica segment; get cited in AI answer engines for ERP selection."
                        data-testid="input-goals"
                        rows={3}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Additional context (optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Known competitors to watch, past channels that worked, dealbreakers, etc."
                        data-testid="input-notes"
                        rows={2}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      This is passed into the strategy prompts as context.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Underlying Assumptions — grounds ROI math + framework outputs in prospect reality */}
              <div className="space-y-4 rounded-lg border border-accent/30 p-4 bg-accent/5">
                <div>
                  <div className="text-sm font-semibold text-foreground">
                    Underlying assumptions (optional)
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Fill in what you know. These drive the ROI math, growth targets, and framework recommendations.
                    You can also edit them later on the analysis page.
                  </p>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="currentAnnualRevenue"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Current annual revenue (USD)</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. 5000000" data-testid="input-assumption-revenue" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="currentMarketingBudget"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Current marketing budget (USD/yr)</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. 250000" data-testid="input-assumption-marketing-budget" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="grossMarginPct"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Gross margin %</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. 65" data-testid="input-assumption-margin" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="revenueGrowthTargetPct"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Revenue growth target (next 12mo, %)</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. 25" data-testid="input-assumption-growth" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="topCompetitors"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Top 3 known competitors</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Sage Intacct, SAP Business One, Microsoft Dynamics" data-testid="input-assumption-competitors" {...field} />
                      </FormControl>
                      <FormDescription className="text-xs">Comma-separated. Feeds directly into SWOT and Porter's Five Forces.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="preferredTier"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Preferred engagement tier</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? ""}>
                        <FormControl>
                          <SelectTrigger data-testid="select-assumption-tier">
                            <SelectValue placeholder="No preference" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="advisor">Advisor — 17% discount</SelectItem>
                          <SelectItem value="strategist">Strategist — 24% discount</SelectItem>
                          <SelectItem value="fractional">Fractional — 32% discount</SelectItem>
                          <SelectItem value="unknown">Not sure yet</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="space-y-3 rounded-lg border border-border/60 p-4 bg-muted/20">
                <div className="text-sm font-semibold text-foreground">
                  Strategic frameworks (optional)
                </div>
                <p className="text-xs text-muted-foreground">
                  SWOT is always included. Add deep macro & industry-structure research
                  (adds ≈60–120s and pulls cited sources from 2025–2026).
                </p>
                <FormField
                  control={form.control}
                  name="includePestel"
                  render={({ field }) => (
                    <FormItem className="flex items-center gap-3 space-y-0">
                      <FormControl>
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-border accent-primary"
                          checked={!!field.value}
                          onChange={(e) => field.onChange(e.target.checked)}
                          data-testid="toggle-pestel"
                        />
                      </FormControl>
                      <FormLabel className="font-normal cursor-pointer">
                        Include PESTEL analysis (macro factors with cited sources)
                      </FormLabel>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="includePorters"
                  render={({ field }) => (
                    <FormItem className="flex items-center gap-3 space-y-0">
                      <FormControl>
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-border accent-primary"
                          checked={!!field.value}
                          onChange={(e) => field.onChange(e.target.checked)}
                          data-testid="toggle-porters"
                        />
                      </FormControl>
                      <FormLabel className="font-normal cursor-pointer">
                        Include Porter's Five Forces (industry structure with cited sources)
                      </FormLabel>
                    </FormItem>
                  )}
                />
              </div>

              <div className="pt-2 flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Typical run time: 90 – 180 seconds.
                </p>
                <Button
                  type="submit"
                  size="lg"
                  data-testid="button-run-analysis"
                  disabled={submitting || submitMutation.isPending}
                >
                  {submitting || submitMutation.isPending
                    ? "Starting analysis…"
                    : "Run analysis"}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </form>
          </Form>
        </Card>
      </section>
    </AppShell>
  );
}
