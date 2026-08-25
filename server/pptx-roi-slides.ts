// =============================================================
// PPTX ROI Slides — Called from pptx-export.ts
// 5 slides: headline + 4 charts
// =============================================================
import PptxGenJS from "pptxgenjs";
import type { ContentPlanPayload } from "@shared/schema";

const BRAND = {
  navy: "0B1929",
  accent: "D97706",
  text: "1F2937",
  muted: "6B7280",
  light: "F3F4F6",
  border: "E5E7EB",
  white: "FFFFFF",
};

const SLIDE_W = 10;
const SLIDE_H = 5.625;

function formatUsdShort(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}

function formatNumShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(Math.round(n));
}

// Section header pattern (matches pptx-export.ts addSectionHeader)
function addHeader(slide: PptxGenJS.Slide, title: string, subtitle?: string) {
  slide.addShape("rect", {
    x: 0.5,
    y: 0.5,
    w: 0.15,
    h: 0.55,
    fill: { color: BRAND.accent },
    line: { color: BRAND.accent, width: 0 },
  });
  slide.addText(title, {
    x: 0.75,
    y: 0.5,
    w: SLIDE_W - 1.2,
    h: 0.55,
    fontSize: 28,
    fontFace: "Georgia",
    bold: true,
    color: BRAND.navy,
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.75,
      y: 1.05,
      w: SLIDE_W - 1.2,
      h: 0.3,
      fontSize: 12,
      fontFace: "Arial",
      italic: true,
      color: BRAND.muted,
    });
  }
}

export function buildRoiHeadlineSlide(pptx: PptxGenJS, payload: ContentPlanPayload): void {
  if (!payload.roiProjections) return;
  const { outcomes } = payload.roiProjections;
  const slide = pptx.addSlide();
  addHeader(
    slide,
    "12-Month ROI Projections",
    "Conservative projections modeled from client-specific assumptions",
  );

  const stats = [
    {
      label: "TOTAL REVENUE (12MO)",
      value: formatUsdShort(outcomes.totalRevenue),
      sub: `${outcomes.totalClosedWon} closed-won deals`,
      color: BRAND.navy,
      accent: false,
    },
    {
      label: "ROI MULTIPLE",
      value: `${outcomes.roiMultiple.toFixed(2)}x`,
      sub: "Gross profit / program cost",
      color: BRAND.accent,
      accent: true,
    },
    {
      label: "COST PER LEAD",
      value: formatUsdShort(outcomes.brexCostPerLead),
      sub: "vs paid CPL benchmark",
      color: BRAND.navy,
      accent: false,
    },
    {
      label: "PAYBACK",
      value: outcomes.paybackMonth ? `Month ${outcomes.paybackMonth}` : ">12mo",
      sub: "Cumulative profit meets cost",
      color: "065F46",
      accent: false,
    },
  ];

  const cardW = 2.15;
  const cardH = 2.3;
  const gap = 0.12;
  const totalW = 4 * cardW + 3 * gap;
  const startX = (SLIDE_W - totalW) / 2;
  const startY = 1.7;

  stats.forEach((stat, idx) => {
    const x = startX + idx * (cardW + gap);
    slide.addShape("rect", {
      x,
      y: startY,
      w: cardW,
      h: cardH,
      fill: { color: stat.accent ? "FEF3C7" : BRAND.light },
      line: { color: stat.accent ? BRAND.accent : BRAND.border, width: stat.accent ? 2 : 1 },
    });
    slide.addText(stat.label, {
      x: x + 0.15,
      y: startY + 0.2,
      w: cardW - 0.3,
      h: 0.3,
      fontSize: 9,
      fontFace: "Arial",
      bold: true,
      color: BRAND.muted,
      charSpacing: 1,
    });
    slide.addText(stat.value, {
      x: x + 0.1,
      y: startY + 0.55,
      w: cardW - 0.2,
      h: 1.05,
      fontSize: 32,
      fontFace: "Georgia",
      bold: true,
      color: stat.color,
      align: "center",
      valign: "middle",
      shrinkText: true,
    });
    slide.addText(stat.sub, {
      x: x + 0.15,
      y: startY + 1.7,
      w: cardW - 0.3,
      h: 0.5,
      fontSize: 9,
      fontFace: "Arial",
      color: BRAND.muted,
      align: "center",
    });
  });

  slide.addText(
    "Projections are conservative estimates based on industry benchmarks and assumptions inferred from the client's business context. Actual results depend on execution quality, market conditions, and product-market fit.",
    {
      x: 0.5,
      y: SLIDE_H - 0.9,
      w: SLIDE_W - 1,
      h: 0.5,
      fontSize: 9,
      fontFace: "Arial",
      italic: true,
      color: BRAND.muted,
      align: "center",
    },
  );
}

export function buildRoiTrafficSlide(pptx: PptxGenJS, payload: ContentPlanPayload): void {
  if (!payload.roiProjections) return;
  const { monthlyProjection } = payload.roiProjections;
  const slide = pptx.addSlide();
  addHeader(slide, "Organic Traffic & Lead Growth", "Monthly volume as SEO/AEO posts mature");

  const labels = monthlyProjection.map((p) => `M${p.month}`);
  const visitors = monthlyProjection.map((p) => p.monthlyVisitors);
  const leads = monthlyProjection.map((p) => p.monthlyLeads);

  slide.addChart(
    pptx.ChartType.line,
    [
      { name: "Monthly visitors", labels, values: visitors },
      { name: "Monthly leads", labels, values: leads },
    ],
    {
      x: 0.6,
      y: 1.6,
      w: SLIDE_W - 1.2,
      h: 3.4,
      chartColors: [BRAND.navy, BRAND.accent],
      lineDataSymbolSize: 6,
      lineSize: 2.5,
      showLegend: true,
      legendPos: "t",
      legendFontSize: 10,
      catAxisLabelFontSize: 9,
      valAxisLabelFontSize: 9,
      showValue: false,
    },
  );

  slide.addText(
    "Traffic ramps linearly over months-to-rank, then plateaus at mature per-post visitor volume. Leads scale proportionally at the visitor-to-lead conversion rate.",
    {
      x: 0.6,
      y: SLIDE_H - 0.75,
      w: SLIDE_W - 1.2,
      h: 0.4,
      fontSize: 10,
      fontFace: "Arial",
      italic: true,
      color: BRAND.muted,
    },
  );
}

export function buildRoiFunnelSlide(pptx: PptxGenJS, payload: ContentPlanPayload): void {
  if (!payload.roiProjections) return;
  const { outcomes } = payload.roiProjections;
  const slide = pptx.addSlide();
  addHeader(slide, "12-Month Conversion Funnel", "Visitors to Leads to MQLs to SQLs to Closed Won");

  const stages = [
    { label: "Visitors", value: outcomes.month12CumulativeVisitors, color: BRAND.navy },
    { label: "Leads", value: outcomes.totalLeads, color: "1E3A5F" },
    { label: "MQLs", value: outcomes.totalMqls, color: "3B82F6" },
    { label: "SQLs", value: outcomes.totalSqls, color: BRAND.accent },
    { label: "Closed Won", value: outcomes.totalClosedWon, color: "065F46" },
  ];
  const maxVal = Math.max(...stages.map((s) => s.value));

  const barMaxW = 6.5;
  const barH = 0.55;
  const rowGap = 0.15;
  const startY = 1.7;
  const labelX = 0.7;
  const barX = 2.0;
  const rateX = SLIDE_W - 1.0;

  stages.forEach((s, i) => {
    const y = startY + i * (barH + rowGap);
    const w = maxVal > 0 ? (s.value / maxVal) * barMaxW : 0.1;
    slide.addText(s.label, {
      x: labelX,
      y,
      w: 1.2,
      h: barH,
      fontSize: 12,
      fontFace: "Arial",
      bold: true,
      color: BRAND.text,
      valign: "middle",
    });
    slide.addShape("rect", {
      x: barX,
      y: y + 0.08,
      w,
      h: barH - 0.16,
      fill: { color: s.color },
      line: { color: s.color, width: 0 },
    });
    slide.addText(formatNumShort(s.value), {
      x: barX + w + 0.1,
      y,
      w: 1.0,
      h: barH,
      fontSize: 11,
      fontFace: "Arial",
      bold: true,
      color: BRAND.text,
      valign: "middle",
    });
    if (i > 0) {
      const prior = stages[i - 1].value;
      const rate = prior > 0 ? (s.value / prior) * 100 : 0;
      slide.addText(`${rate.toFixed(1)}%`, {
        x: rateX,
        y,
        w: 0.7,
        h: barH,
        fontSize: 10,
        fontFace: "Arial",
        color: BRAND.muted,
        align: "right",
        valign: "middle",
      });
    }
  });
}

export function buildRoiCostSlide(pptx: PptxGenJS, payload: ContentPlanPayload): void {
  if (!payload.roiProjections) return;
  const { outcomes, assumptions } = payload.roiProjections;
  const slide = pptx.addSlide();
  addHeader(
    slide,
    "Program Cost vs Paid Media Equivalent",
    `What paid CPL would cost to generate ${formatNumShort(outcomes.totalLeads)} leads`,
  );

  slide.addChart(
    pptx.ChartType.bar,
    [
      {
        name: "12-Month Cost",
        labels: ["Brex program", "Equivalent paid CPL"],
        values: [assumptions.programCost12Mo, outcomes.paidEquivalentCost],
      },
    ],
    {
      x: 1.5,
      y: 1.6,
      w: SLIDE_W - 3,
      h: 2.8,
      barDir: "col",
      chartColors: [BRAND.accent, BRAND.navy],
      chartColorsOpacity: 100,
      showValue: true,
      dataLabelFontSize: 12,
      dataLabelColor: BRAND.text,
      dataLabelFormatCode: "$#,##0",
      catAxisLabelFontSize: 11,
      valAxisLabelFontSize: 9,
      showLegend: false,
    },
  );

  const savings = outcomes.savingsVsPaid;
  slide.addShape("rect", {
    x: 1.5,
    y: SLIDE_H - 1.05,
    w: SLIDE_W - 3,
    h: 0.75,
    fill: { color: "D1FAE5" },
    line: { color: "065F46", width: 1 },
  });
  slide.addText(`Savings vs Paid: ${formatUsdShort(savings)} over 12 months`, {
    x: 1.6,
    y: SLIDE_H - 1.0,
    w: SLIDE_W - 3.2,
    h: 0.35,
    fontSize: 14,
    fontFace: "Arial",
    bold: true,
    color: "065F46",
  });
  slide.addText("Content-generated leads compound; paid stops when spend stops.", {
    x: 1.6,
    y: SLIDE_H - 0.65,
    w: SLIDE_W - 3.2,
    h: 0.3,
    fontSize: 10,
    fontFace: "Arial",
    color: "065F46",
  });
}

export function buildRoiPaybackSlide(pptx: PptxGenJS, payload: ContentPlanPayload): void {
  if (!payload.roiProjections) return;
  const { monthlyProjection, outcomes, assumptions } = payload.roiProjections;
  const slide = pptx.addSlide();
  addHeader(
    slide,
    "Payback Timeline",
    outcomes.paybackMonth
      ? `Cumulative gross profit crosses program cost at month ${outcomes.paybackMonth}`
      : "Cumulative gross profit trajectory vs cumulative program cost",
  );

  const monthlyProgramCost = assumptions.programCost12Mo / 12;
  const labels = monthlyProjection.map((p) => `M${p.month}`);
  const profit = monthlyProjection.map((p) => p.cumulativeGrossProfit);
  const cost = monthlyProjection.map((p) => monthlyProgramCost * p.month);

  slide.addChart(
    pptx.ChartType.line,
    [
      { name: "Cumulative gross profit", labels, values: profit },
      { name: "Cumulative program cost", labels, values: cost },
    ],
    {
      x: 0.6,
      y: 1.6,
      w: SLIDE_W - 1.2,
      h: 3.4,
      chartColors: [BRAND.accent, BRAND.navy],
      lineDataSymbolSize: 6,
      lineSize: 2.5,
      showLegend: true,
      legendPos: "t",
      legendFontSize: 10,
      catAxisLabelFontSize: 9,
      valAxisLabelFontSize: 9,
      valAxisLabelFormatCode: "$#,##0",
    },
  );

  if (outcomes.paybackMonth) {
    slide.addText(
      `Breakeven at month ${outcomes.paybackMonth}. Every additional month compounds return.`,
      {
        x: 0.6,
        y: SLIDE_H - 0.75,
        w: SLIDE_W - 1.2,
        h: 0.4,
        fontSize: 11,
        fontFace: "Arial",
        italic: true,
        color: "065F46",
      },
    );
  } else {
    slide.addText(
      "Payback extends beyond 12 months under conservative assumptions; ROI continues to compound in year two as content matures.",
      {
        x: 0.6,
        y: SLIDE_H - 0.75,
        w: SLIDE_W - 1.2,
        h: 0.4,
        fontSize: 11,
        fontFace: "Arial",
        italic: true,
        color: BRAND.muted,
      },
    );
  }
}
