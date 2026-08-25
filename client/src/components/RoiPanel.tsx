// =============================================================
// ROI Panel — 12-month projection dashboard for a content plan
// =============================================================
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, TrendingUp, DollarSign, Target, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts";
import type { RoiProjections } from "@shared/schema";

const BRAND = {
  navy: "#0B1929",
  accent: "#D97706",
  emerald: "#065F46",
  muted: "#6B7280",
  light: "#F3F4F6",
  border: "#E5E7EB",
};

function formatUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return Math.round(n).toLocaleString();
}

function formatPct(n: number): string {
  return `${(n * 100).toFixed(n < 0.05 ? 2 : 1)}%`;
}

export interface RoiPanelProps {
  planId: string;
  initialRoi?: RoiProjections;
}

export function RoiPanel({ planId, initialRoi }: RoiPanelProps) {
  const { toast } = useToast();
  const [roi, setRoi] = useState<RoiProjections | undefined>(initialRoi);
  const [loading, setLoading] = useState(!initialRoi);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    if (initialRoi) {
      setRoi(initialRoi);
      setLoading(false);
      return;
    }
    // No cached ROI — request computation
    computeRoi(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);

  async function computeRoi(force: boolean) {
    if (force) setRegenerating(true);
    else setLoading(true);
    try {
      const url = force
        ? `/api/content-plans/${planId}/roi?force=1`
        : `/api/content-plans/${planId}/roi`;
      const res = await fetch(url, { method: "POST", credentials: "include" });
      if (!res.ok) {
        const msg = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(msg?.error ?? "Failed to compute ROI");
      }
      const data = await res.json();
      setRoi(data.roi);
      if (force) {
        toast({
          title: "ROI regenerated",
          description: "Fresh conservative projections inferred from your analysis.",
        });
      }
    } catch (e: any) {
      toast({
        title: "ROI failed",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      setRegenerating(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-3" />
        Computing conservative 12-month projections…
      </div>
    );
  }

  if (!roi) {
    return (
      <Card className="p-8 text-center">
        <p className="text-muted-foreground">ROI projections not available.</p>
        <Button onClick={() => computeRoi(true)} className="mt-4">
          <RefreshCw className="h-4 w-4 mr-2" /> Compute now
        </Button>
      </Card>
    );
  }

  const { assumptions, outcomes, monthlyProjection } = roi;

  // Chart data
  const trafficData = monthlyProjection.map((m) => ({
    month: `M${m.month}`,
    visitors: m.monthlyVisitors,
    leads: m.monthlyLeads,
  }));

  const paybackData = monthlyProjection.map((m) => {
    const cumProgramCost = (assumptions.programCost12Mo / 12) * m.month;
    return {
      month: `M${m.month}`,
      programCost: cumProgramCost,
      grossProfit: m.cumulativeGrossProfit,
    };
  });

  const funnelData = [
    { stage: "Visitors", value: outcomes.month12CumulativeVisitors, color: BRAND.navy },
    { stage: "Leads", value: outcomes.totalLeads, color: "#1E3A5F" },
    { stage: "MQLs", value: outcomes.totalMqls, color: "#2C5C8A" },
    { stage: "SQLs", value: outcomes.totalSqls, color: BRAND.accent },
    { stage: "Closed Won", value: outcomes.totalClosedWon, color: BRAND.emerald },
  ];

  const costCompareData = [
    { label: "Brex program", cost: assumptions.programCost12Mo, color: BRAND.accent },
    { label: "Equivalent paid CPL", cost: outcomes.paidEquivalentCost, color: BRAND.navy },
  ];

  return (
    <div className="space-y-8">
      {/* Header row */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-display text-2xl font-bold text-foreground">
            12-Month ROI Projections
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Conservative estimates inferred from your client analysis. Adjust or regenerate if
            deal economics look off.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => computeRoi(true)}
          disabled={regenerating}
          data-testid="button-regenerate-roi"
        >
          {regenerating ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Regenerate
        </Button>
      </div>

      {/* Headline stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Total Revenue"
          value={formatUsd(outcomes.totalRevenue)}
          sub={`from ${outcomes.totalClosedWon} closed-won deals`}
        />
        <StatCard
          icon={<DollarSign className="h-4 w-4" />}
          label="ROI Multiple"
          value={`${outcomes.roiMultiple}x`}
          sub="gross profit vs program cost"
          highlight
        />
        <StatCard
          icon={<Target className="h-4 w-4" />}
          label="Cost / Lead"
          value={formatUsd(outcomes.brexCostPerLead)}
          sub={`vs ${formatUsd(assumptions.paidCacBaseline)} paid`}
        />
        <StatCard
          icon={<Clock className="h-4 w-4" />}
          label="Payback"
          value={
            outcomes.paybackMonth ? `Month ${outcomes.paybackMonth}` : ">12 months"
          }
          sub="cumulative gross profit ≥ cost"
        />
      </div>

      {/* Charts grid — 2x2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Traffic curve */}
        <Card className="p-5">
          <div className="mb-3">
            <h3 className="font-medium text-foreground">Organic Traffic Growth</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Monthly organic visitors ramping as SEO/AEO posts mature
            </p>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={trafficData} margin={{ top: 10, right: 15, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={BRAND.border} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke={BRAND.muted} />
              <YAxis
                tick={{ fontSize: 11 }}
                stroke={BRAND.muted}
                tickFormatter={(v) => formatNum(v)}
              />
              <Tooltip
                formatter={(v: any) => formatNum(v)}
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 8,
                  border: `1px solid ${BRAND.border}`,
                }}
              />
              <Line
                type="monotone"
                dataKey="visitors"
                stroke={BRAND.navy}
                strokeWidth={2.5}
                name="Monthly visitors"
                dot={{ r: 3, fill: BRAND.navy }}
              />
              <Line
                type="monotone"
                dataKey="leads"
                stroke={BRAND.accent}
                strokeWidth={2.5}
                name="Monthly leads"
                dot={{ r: 3, fill: BRAND.accent }}
              />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        {/* Payback timeline */}
        <Card className="p-5">
          <div className="mb-3">
            <h3 className="font-medium text-foreground">Payback Timeline</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Cumulative gross profit vs cumulative program cost
              {outcomes.paybackMonth && ` — breakeven month ${outcomes.paybackMonth}`}
            </p>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={paybackData} margin={{ top: 10, right: 15, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={BRAND.border} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke={BRAND.muted} />
              <YAxis
                tick={{ fontSize: 11 }}
                stroke={BRAND.muted}
                tickFormatter={(v) => formatUsd(v)}
              />
              <Tooltip
                formatter={(v: any) => formatUsd(v)}
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 8,
                  border: `1px solid ${BRAND.border}`,
                }}
              />
              {outcomes.paybackMonth && (
                <ReferenceLine
                  x={`M${outcomes.paybackMonth}`}
                  stroke={BRAND.emerald}
                  strokeDasharray="4 4"
                  label={{
                    value: "Breakeven",
                    position: "top",
                    fontSize: 10,
                    fill: BRAND.emerald,
                  }}
                />
              )}
              <Line
                type="monotone"
                dataKey="grossProfit"
                stroke={BRAND.accent}
                strokeWidth={2.5}
                name="Cumulative gross profit"
                dot={{ r: 3 }}
              />
              <Line
                type="monotone"
                dataKey="programCost"
                stroke={BRAND.navy}
                strokeWidth={2.5}
                name="Cumulative program cost"
                dot={{ r: 3 }}
                strokeDasharray="5 5"
              />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        {/* Funnel */}
        <Card className="p-5">
          <div className="mb-3">
            <h3 className="font-medium text-foreground">12-Month Conversion Funnel</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Visitors → leads → MQLs → SQLs → closed won
            </p>
          </div>
          <div className="space-y-2 mt-4">
            {funnelData.map((row, idx) => {
              const maxValue = funnelData[0].value;
              const widthPct = Math.max(6, (row.value / maxValue) * 100);
              return (
                <div key={row.stage} className="relative">
                  <div className="flex items-center justify-between text-xs font-medium mb-1">
                    <span className="text-foreground">{row.stage}</span>
                    <span className="text-muted-foreground">
                      {formatNum(row.value)}
                      {idx > 0 && funnelData[idx - 1].value > 0 && (
                        <span className="ml-2 text-muted-foreground/70">
                          ({formatPct(row.value / funnelData[idx - 1].value)})
                        </span>
                      )}
                    </span>
                  </div>
                  <div
                    className="h-9 rounded-md flex items-center justify-center text-white text-xs font-medium transition-all"
                    style={{
                      width: `${widthPct}%`,
                      backgroundColor: row.color,
                    }}
                  >
                    {widthPct > 20 && formatNum(row.value)}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Cost / CAC comparison */}
        <Card className="p-5">
          <div className="mb-3">
            <h3 className="font-medium text-foreground">Cost vs Paid Media Equivalent</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              What paid media would cost to generate {formatNum(outcomes.totalLeads)} leads
            </p>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={costCompareData} margin={{ top: 20, right: 15, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={BRAND.border} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke={BRAND.muted} />
              <YAxis
                tick={{ fontSize: 11 }}
                stroke={BRAND.muted}
                tickFormatter={(v) => formatUsd(v)}
              />
              <Tooltip
                formatter={(v: any) => formatUsd(v)}
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 8,
                  border: `1px solid ${BRAND.border}`,
                }}
              />
              <Bar dataKey="cost" name="12-month cost">
                {costCompareData.map((entry, idx) => (
                  <Cell key={idx} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-3 rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-900">
            <strong>Savings vs paid:</strong> {formatUsd(outcomes.savingsVsPaid)} over 12
            months. Content-generated leads compound; paid stops when spend stops.
          </div>
        </Card>
      </div>

      {/* Assumptions block */}
      <Card className="p-5">
        <h3 className="font-medium text-foreground mb-1">Assumptions</h3>
        <p className="text-xs text-muted-foreground mb-4">
          AI-inferred from your client analysis. Regenerate if these look off.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <Assumption
            label="Avg deal size"
            value={formatUsd(assumptions.avgDealSize)}
            sub={assumptions.dealType === "acv" ? "ACV" : "one-time"}
          />
          <Assumption
            label="Gross margin"
            value={formatPct(assumptions.grossMargin)}
          />
          <Assumption
            label="Sales cycle"
            value={`${assumptions.salesCycleDays} days`}
          />
          <Assumption
            label="Visitor → lead"
            value={formatPct(assumptions.visitorToLeadRate)}
          />
          <Assumption
            label="Lead → MQL"
            value={formatPct(assumptions.leadToMqlRate)}
          />
          <Assumption
            label="MQL → SQL"
            value={formatPct(assumptions.mqlToSqlRate)}
          />
          <Assumption
            label="SQL → won"
            value={formatPct(assumptions.sqlToWonRate)}
          />
          <Assumption
            label="Visitors/post/mo"
            value={formatNum(assumptions.monthlyVisitorsPerPost)}
            sub={`at maturity (~${assumptions.monthsToRank}mo)`}
          />
          <Assumption
            label="Program cost (12mo)"
            value={formatUsd(assumptions.programCost12Mo)}
          />
          <Assumption
            label="Paid CPL benchmark"
            value={formatUsd(assumptions.paidCacBaseline)}
          />
        </div>

        <div className="mt-5 pt-5 border-t border-border space-y-3 text-xs text-muted-foreground">
          <RationaleRow label="Deal size" text={assumptions.rationale.dealSize} />
          <RationaleRow label="Conversion rates" text={assumptions.rationale.conversionRates} />
          <RationaleRow label="Traffic ramp" text={assumptions.rationale.trafficRamp} />
          <RationaleRow label="Program cost" text={assumptions.rationale.programCost} />
        </div>
      </Card>

      <p className="text-xs text-muted-foreground italic px-1">{roi.disclaimer}</p>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <Card
      className={`p-4 ${highlight ? "border-2 border-amber-500 bg-amber-50/50" : ""}`}
    >
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
        {icon}
        {label}
      </div>
      <div
        className={`font-display text-3xl font-bold mt-2 ${
          highlight ? "text-amber-700" : "text-foreground"
        }`}
      >
        {value}
      </div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </Card>
  );
}

function Assumption({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="font-medium text-foreground mt-0.5">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function RationaleRow({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-foreground font-medium min-w-[100px]">{label}:</span>
      <span>{text}</span>
    </div>
  );
}
