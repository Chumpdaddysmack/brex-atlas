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
    },
  });

  const submitMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const normalized = {
        ...values,
        clientUrl: values.clientUrl.startsWith("http")
          ? values.clientUrl
          : `https://${values.clientUrl}`,
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
