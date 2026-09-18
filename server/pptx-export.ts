// =============================================================
// PPTX Export — Brex-branded slide deck of main findings
// Uses pptxgenjs to build a 12-15 slide deck (16:9)
// =============================================================
import PptxGenJS from "pptxgenjs";
import type {
  ContentPlanPayload,
  SwotAnalysis,
  SwotItem,
  PestelAnalysis,
  PortersFiveForces,
  PortersForce,
  PortersForceName,
  CustomerInsights,
} from "@shared/schema";
import { PRICING_BENCHMARKS, BENCHMARK_SOURCES, formatMoney } from "./pricing-benchmarks";
import {
  BREX_LINE_ITEMS,
  BREX_TIERS,
  BREX_BLENDED_HOURLY,
  formatBrexPrice,
  computeSavings,
  positioningColor,
} from "@shared/brex-pricing";
import { fetchProspectLogo } from "./logo-fetch";
import {
  buildRoiHeadlineSlide,
  buildRoiTrafficSlide,
  buildRoiFunnelSlide,
  buildRoiCostSlide,
  buildRoiPaybackSlide,
} from "./pptx-roi-slides";
import { buildSitemapSlides } from "./pptx-sitemap-slides";

// Brex brand palette
const BRAND = {
  navy: "2A4365",       // Brex Primary Navy
  accent: "00A6FB",     // Brex Sky Blue
  text: "0F1824",       // Brex Deep Navy text
  muted: "607382",      // Brex Muted
  light: "EDF2F7",      // Brex Chip Surface
  border: "DDE8EE",     // Brex Blue Light
  white: "FFFFFF",
};

// Pillar palette (cycled) — Brex brand palette
const PILLAR_COLORS = ["00A6FB", "2A4365", "1B998B", "F4BD11", "607382", "0F1824"];

// Slide dims (16:9 at 10 in x 5.625 in)
const SLIDE_W = 10;
const SLIDE_H = 5.625;

export interface PptxExportArgs {
  payload: ContentPlanPayload;
  clientName: string;
  clientUrl: string;
  generatedAt?: Date;
  swot?: SwotAnalysis | null;
  pestel?: PestelAnalysis | null;
  porters?: PortersFiveForces | null;
  customerInsights?: CustomerInsights | null;
}

// -------- Helpers --------

function safe(v: unknown, fallback = ""): string {
  if (v === null || v === undefined) return fallback;
  const s = String(v);
  // Strip control chars that break XML
  return s.replace(/[\u0000-\u001F\u007F]/g, "");
}

function countPillarPosts(payload: ContentPlanPayload): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of payload.contentPillars ?? []) counts.set(p.name, 0);
  for (const week of payload.blogCalendar ?? []) {
    for (const post of week.posts ?? []) {
      if (post.pillar) {
        counts.set(post.pillar, (counts.get(post.pillar) ?? 0) + 1);
      }
    }
  }
  return Array.from(counts.entries()).map(([name, count]) => ({ name, count }));
}

// -------- Slide builders --------

function addFooter(slide: PptxGenJS.Slide, pageNum: number, totalPages: number, clientName: string) {
  // Left: client name
  slide.addText(clientName, {
    x: 0.4,
    y: SLIDE_H - 0.3,
    w: 4,
    h: 0.25,
    fontSize: 8,
    fontFace: "Arial",
    color: BRAND.muted,
  });

  // Right: page number
  slide.addText(`${pageNum} / ${totalPages}`, {
    x: SLIDE_W - 1.5,
    y: SLIDE_H - 0.3,
    w: 1.2,
    h: 0.25,
    fontSize: 8,
    fontFace: "Arial",
    color: BRAND.muted,
    align: "right",
  });

  // Brex wordmark bottom-center
  slide.addText("BREX CONSULTING", {
    x: (SLIDE_W - 2) / 2,
    y: SLIDE_H - 0.3,
    w: 2,
    h: 0.25,
    fontSize: 7,
    fontFace: "Arial",
    bold: true,
    color: BRAND.muted,
    align: "center",
    charSpacing: 2,
  });
}

// Standard header body starts at y=1.4. Long subtitles must be truncated so
// they don't overflow into the slide body. Roughly ~110 chars fits in the
// single-line subtitle band (0.85 to 1.15).
function truncateSubtitle(s: string, max = 110): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}

function addSectionHeader(slide: PptxGenJS.Slide, title: string, subtitle?: string) {
  // Amber accent bar
  slide.addShape("rect", {
    x: 0.4,
    y: 0.4,
    w: 0.06,
    h: 0.5,
    fill: { color: BRAND.accent },
    line: { color: BRAND.accent, width: 0 },
  });

  slide.addText(title, {
    x: 0.6,
    y: 0.35,
    w: SLIDE_W - 1.2,
    h: 0.55,
    fontSize: 24,
    fontFace: "Arial",
    bold: true,
    color: BRAND.navy,
  });

  if (subtitle) {
    slide.addText(truncateSubtitle(subtitle), {
      x: 0.6,
      y: 0.9,
      w: SLIDE_W - 1.2,
      h: 0.28,
      fontSize: 10.5,
      fontFace: "Arial",
      color: BRAND.muted,
      valign: "top",
    });
  }
}

async function buildCoverSlide(
  pptx: PptxGenJS,
  clientName: string,
  clientUrl: string,
  generatedAt: Date,
): Promise<void> {
  const slide = pptx.addSlide();
  slide.background = { color: BRAND.navy };

  // Amber slash at top
  slide.addShape("rect", {
    x: 0,
    y: 0,
    w: SLIDE_W,
    h: 0.06,
    fill: { color: BRAND.accent },
    line: { color: BRAND.accent, width: 0 },
  });

  // Brex wordmark top-left
  slide.addText("BREX CONSULTING", {
    x: 0.5,
    y: 0.4,
    w: 4,
    h: 0.3,
    fontSize: 11,
    fontFace: "Arial",
    bold: true,
    color: BRAND.white,
    charSpacing: 4,
  });

  slide.addText("BIG ROCK METHOD · FRACTIONAL CMO", {
    x: 0.5,
    y: 0.7,
    w: 6,
    h: 0.25,
    fontSize: 8,
    fontFace: "Arial",
    color: BRAND.accent,
    charSpacing: 3,
  });

  // Prospect logo — try fetching
  let logoY = 2.0;
  try {
    const logo = await fetchProspectLogo(clientUrl);
    if (logo) {
      slide.addImage({
        data: logo.dataUrl,
        x: 0.5,
        y: 2.0,
        w: 1.2,
        h: 1.2,
        sizing: { type: "contain", w: 1.2, h: 1.2 },
      });
      logoY = 3.35;
    }
  } catch (err) {
    console.error("[pptx-export] logo fetch failed", err);
  }

  // Client name — big serif
  slide.addText(safe(clientName), {
    x: 0.5,
    y: logoY,
    w: SLIDE_W - 1,
    h: 1,
    fontSize: 48,
    fontFace: "Georgia",
    bold: true,
    color: BRAND.white,
  });

  // Subtitle
  slide.addText("12-Week Content Strategy", {
    x: 0.5,
    y: logoY + 0.9,
    w: SLIDE_W - 1,
    h: 0.4,
    fontSize: 18,
    fontFace: "Arial",
    italic: true,
    color: BRAND.light,
  });

  // Domain
  slide.addText(safe(clientUrl), {
    x: 0.5,
    y: logoY + 1.3,
    w: SLIDE_W - 1,
    h: 0.3,
    fontSize: 11,
    fontFace: "Arial",
    color: BRAND.accent,
  });

  // Prepared on / prepared by (bottom row)
  const dateStr = generatedAt.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  slide.addText("PREPARED BY", {
    x: 0.5,
    y: SLIDE_H - 0.65,
    w: 3,
    h: 0.2,
    fontSize: 7,
    fontFace: "Arial",
    color: BRAND.muted,
    charSpacing: 2,
  });
  slide.addText("Brex Consulting", {
    x: 0.5,
    y: SLIDE_H - 0.45,
    w: 3,
    h: 0.25,
    fontSize: 11,
    fontFace: "Arial",
    bold: true,
    color: BRAND.white,
  });

  slide.addText("PREPARED ON", {
    x: SLIDE_W - 3.5,
    y: SLIDE_H - 0.65,
    w: 3,
    h: 0.2,
    fontSize: 7,
    fontFace: "Arial",
    color: BRAND.muted,
    align: "right",
    charSpacing: 2,
  });
  slide.addText(dateStr, {
    x: SLIDE_W - 3.5,
    y: SLIDE_H - 0.45,
    w: 3,
    h: 0.25,
    fontSize: 11,
    fontFace: "Arial",
    bold: true,
    color: BRAND.white,
    align: "right",
  });
}

function buildAtAGlanceSlide(pptx: PptxGenJS, payload: ContentPlanPayload) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, "At a Glance", "Program scope in four numbers");

  const totalPosts = (payload.blogCalendar ?? []).reduce(
    (sum, w) => sum + (w.posts?.length ?? 0),
    0,
  );
  const weekCount = payload.blogCalendar?.length ?? 0;
  const pillarCount = payload.contentPillars?.length ?? 0;
  const queries = new Set<string>();
  for (const w of payload.blogCalendar ?? []) {
    for (const post of w.posts ?? []) {
      if (post.targetQuery) queries.add(post.targetQuery);
    }
  }

  const stats = [
    { value: String(totalPosts), label: "TOTAL POSTS" },
    { value: String(weekCount), label: "WEEKS" },
    { value: String(pillarCount), label: "PILLARS" },
    { value: String(queries.size), label: "AEO QUERIES" },
  ];

  const cardW = 2;
  const cardH = 2.2;
  const gap = 0.15;
  const totalW = 4 * cardW + 3 * gap;
  const startX = (SLIDE_W - totalW) / 2;
  const startY = 1.8;

  stats.forEach((stat, idx) => {
    const x = startX + idx * (cardW + gap);

    // Card background
    slide.addShape("rect", {
      x,
      y: startY,
      w: cardW,
      h: cardH,
      fill: { color: BRAND.light },
      line: { color: BRAND.border, width: 1 },
    });

    // Big number
    slide.addText(stat.value, {
      x,
      y: startY + 0.35,
      w: cardW,
      h: 1.1,
      fontSize: 60,
      fontFace: "Georgia",
      bold: true,
      color: BRAND.accent,
      align: "center",
      valign: "middle",
    });

    // Label
    slide.addText(stat.label, {
      x,
      y: startY + 1.55,
      w: cardW,
      h: 0.4,
      fontSize: 10,
      fontFace: "Arial",
      bold: true,
      color: BRAND.muted,
      align: "center",
      charSpacing: 2,
    });
  });
}

function buildThesisSlide(pptx: PptxGenJS, payload: ContentPlanPayload) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, "12-Week Thesis", "The strategic position we're building");

  slide.addText(safe(payload.summary), {
    x: 0.6,
    y: 1.5,
    w: SLIDE_W - 1.2,
    h: SLIDE_H - 2.2,
    fontSize: 16,
    fontFace: "Georgia",
    color: BRAND.text,
    valign: "top",
    paraSpaceAfter: 8,
  });
}

function buildPillarSlide(
  pptx: PptxGenJS,
  pillar: { name: string; description: string },
  postCount: number,
  colorIdx: number,
  totalPillars: number,
) {
  const slide = pptx.addSlide();
  const color = PILLAR_COLORS[colorIdx % PILLAR_COLORS.length];

  addSectionHeader(slide, `Pillar ${colorIdx + 1} of ${totalPillars}`);

  // Colored side bar for pillar identity
  slide.addShape("rect", {
    x: 0.4,
    y: 1.4,
    w: 0.15,
    h: SLIDE_H - 2,
    fill: { color },
    line: { color, width: 0 },
  });

  // Pillar name — big serif
  slide.addText(safe(pillar.name), {
    x: 0.75,
    y: 1.4,
    w: SLIDE_W - 1.5,
    h: 0.9,
    fontSize: 32,
    fontFace: "Georgia",
    bold: true,
    color: BRAND.navy,
  });

  // Description
  slide.addText(safe(pillar.description), {
    x: 0.75,
    y: 2.4,
    w: SLIDE_W - 1.5,
    h: 1.5,
    fontSize: 14,
    fontFace: "Arial",
    color: BRAND.text,
    valign: "top",
  });

  // Post count callout (bottom-right)
  slide.addShape("rect", {
    x: SLIDE_W - 2.3,
    y: SLIDE_H - 1.5,
    w: 1.8,
    h: 0.9,
    fill: { color: BRAND.light },
    line: { color: BRAND.border, width: 1 },
  });

  slide.addText(String(postCount), {
    x: SLIDE_W - 2.3,
    y: SLIDE_H - 1.4,
    w: 1.8,
    h: 0.55,
    fontSize: 32,
    fontFace: "Georgia",
    bold: true,
    color: BRAND.accent,
    align: "center",
  });

  slide.addText("POSTS PLANNED", {
    x: SLIDE_W - 2.3,
    y: SLIDE_H - 0.85,
    w: 1.8,
    h: 0.25,
    fontSize: 8,
    fontFace: "Arial",
    bold: true,
    color: BRAND.muted,
    align: "center",
    charSpacing: 2,
  });
}

function buildPillarMixSlide(pptx: PptxGenJS, payload: ContentPlanPayload) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, "Pillar Mix", "How the 120 posts distribute across pillars");

  const pillarCounts = countPillarPosts(payload);
  const total = pillarCounts.reduce((s, p) => s + p.count, 0);

  if (total === 0) return;

  // Native pptxgenjs pie chart
  const chartData = [
    {
      name: "Pillar Distribution",
      labels: pillarCounts.map((p) => p.name),
      values: pillarCounts.map((p) => p.count),
    },
  ];

  slide.addChart(pptx.ChartType.doughnut, chartData, {
    x: 0.6,
    y: 1.4,
    w: 4.5,
    h: 3.8,
    chartColors: pillarCounts.map((_, i) => PILLAR_COLORS[i % PILLAR_COLORS.length]),
    dataLabelColor: BRAND.white,
    dataLabelFontFace: "Arial",
    dataLabelFontSize: 12,
    dataLabelFontBold: true,
    showLegend: false,
    showValue: true,
    holeSize: 55,
  });

  // Legend on the right (custom for better control)
  let legendY = 1.7;
  pillarCounts.forEach((slice, idx) => {
    const color = PILLAR_COLORS[idx % PILLAR_COLORS.length];
    const pct = total > 0 ? Math.round((slice.count / total) * 100) : 0;

    // Color swatch
    slide.addShape("rect", {
      x: 5.5,
      y: legendY,
      w: 0.2,
      h: 0.2,
      fill: { color },
      line: { color, width: 0 },
    });

    slide.addText(safe(slice.name), {
      x: 5.8,
      y: legendY - 0.04,
      w: 3.5,
      h: 0.3,
      fontSize: 12,
      fontFace: "Arial",
      bold: true,
      color: BRAND.navy,
    });

    slide.addText(`${slice.count} posts · ${pct}%`, {
      x: 5.8,
      y: legendY + 0.2,
      w: 3.5,
      h: 0.25,
      fontSize: 10,
      fontFace: "Arial",
      color: BRAND.muted,
    });

    legendY += 0.6;
  });
}

function buildTimelineSlide(pptx: PptxGenJS, payload: ContentPlanPayload) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, "12-Week Publishing Timeline", "Posts per pillar, week by week");

  const pillars = payload.contentPillars ?? [];
  const weeks = payload.blogCalendar ?? [];
  if (!pillars.length || !weeks.length) return;

  const startX = 2.0;
  const startY = 1.5;
  const rowH = 0.4;
  const chartW = SLIDE_W - startX - 0.6;
  const weekW = chartW / Math.max(weeks.length, 12);

  // Week header
  for (let i = 0; i < weeks.length; i++) {
    slide.addText(`W${i + 1}`, {
      x: startX + i * weekW,
      y: startY - 0.35,
      w: weekW,
      h: 0.25,
      fontSize: 8,
      fontFace: "Arial",
      bold: true,
      color: BRAND.muted,
      align: "center",
    });
  }

  pillars.forEach((pillar, idx) => {
    const color = PILLAR_COLORS[idx % PILLAR_COLORS.length];
    const rowY = startY + idx * (rowH + 0.05);

    // Pillar label (left)
    slide.addText(safe(pillar.name), {
      x: 0.4,
      y: rowY,
      w: startX - 0.5,
      h: rowH,
      fontSize: 9,
      fontFace: "Arial",
      bold: true,
      color: BRAND.text,
      valign: "middle",
    });

    // Background track
    slide.addShape("rect", {
      x: startX,
      y: rowY + 0.05,
      w: weekW * weeks.length,
      h: rowH - 0.1,
      fill: { color: BRAND.light },
      line: { color: BRAND.border, width: 0 },
    });

    // Per-week fill for this pillar
    weeks.forEach((week, wi) => {
      const matchCount = week.posts?.filter((p) => p.pillar === pillar.name).length ?? 0;
      if (matchCount > 0) {
        slide.addShape("rect", {
          x: startX + wi * weekW + 0.02,
          y: rowY + 0.07,
          w: weekW - 0.04,
          h: rowH - 0.14,
          fill: { color },
          line: { color, width: 0 },
        });

        slide.addText(String(matchCount), {
          x: startX + wi * weekW,
          y: rowY + 0.05,
          w: weekW,
          h: rowH - 0.1,
          fontSize: 9,
          fontFace: "Arial",
          bold: true,
          color: BRAND.white,
          align: "center",
          valign: "middle",
        });
      }
    });
  });
}

// =============================================================
// Brex vs. Market — Tier comparison slide
// =============================================================
function buildBrexTierMatrixSlide(pptx: PptxGenJS) {
  const slide = pptx.addSlide();
  addSectionHeader(
    slide,
    "Brex vs. Market Rate",
    "Bundled retainer tiers priced below the mid-market floor",
  );

  const startY = 1.4;
  const colTierX = 0.4;
  const colTierW = 2.2;
  const colBrexX = 2.7;
  const colBrexW = 1.4;
  const colIndX = 4.2;
  const colIndW = 2.2;
  const colSavX = 6.5;
  const colSavW = 1.4;
  const colBundX = 8.0;
  const colBundW = 1.6;

  // Header bar
  slide.addShape("rect", {
    x: colTierX,
    y: startY,
    w: SLIDE_W - 0.8,
    h: 0.35,
    fill: { color: BRAND.navy },
    line: { color: BRAND.navy, width: 0 },
  });
  const headerY = startY + 0.05;
  slide.addText("Brex Tier", { x: colTierX + 0.1, y: headerY, w: colTierW, h: 0.25, fontSize: 10, fontFace: "Arial", bold: true, color: BRAND.white, valign: "middle" });
  slide.addText("Brex Price", { x: colBrexX, y: headerY, w: colBrexW, h: 0.25, fontSize: 10, fontFace: "Arial", bold: true, color: BRAND.white, valign: "middle" });
  slide.addText("Industry Mid-Market", { x: colIndX, y: headerY, w: colIndW, h: 0.25, fontSize: 10, fontFace: "Arial", bold: true, color: BRAND.white, valign: "middle" });
  slide.addText("vs Mid", { x: colSavX, y: headerY, w: colSavW, h: 0.25, fontSize: 10, fontFace: "Arial", bold: true, color: BRAND.white, valign: "middle" });
  slide.addText("Bundle Savings", { x: colBundX, y: headerY, w: colBundW, h: 0.25, fontSize: 10, fontFace: "Arial", bold: true, color: BRAND.white, valign: "middle" });

  // Data rows
  const rowH = 0.95;
  BREX_TIERS.forEach((tier, idx) => {
    const y = startY + 0.4 + idx * rowH;
    const industryMid = (tier.industryLow + tier.industryHigh) / 2;
    const vsMid = computeSavings(tier.monthly, industryMid);

    // Alternating row bg
    slide.addShape("rect", {
      x: colTierX,
      y,
      w: SLIDE_W - 0.8,
      h: rowH - 0.05,
      fill: { color: idx % 2 === 0 ? "FFFFFF" : "F9FAFB" },
      line: { color: BRAND.border, width: 0.5 },
    });

    // Tier name + bestFor
    slide.addText(tier.name, {
      x: colTierX + 0.1,
      y: y + 0.08,
      w: colTierW - 0.2,
      h: 0.3,
      fontSize: 12,
      fontFace: "Arial",
      bold: true,
      color: BRAND.navy,
    });
    slide.addText(safe(tier.bestFor.slice(0, 90) + (tier.bestFor.length > 90 ? "…" : "")), {
      x: colTierX + 0.1,
      y: y + 0.38,
      w: colTierW - 0.2,
      h: 0.5,
      fontSize: 8,
      fontFace: "Arial",
      color: BRAND.muted,
      valign: "top",
    });

    // Brex price
    slide.addText(`$${tier.monthly.toLocaleString()}`, {
      x: colBrexX,
      y: y + 0.1,
      w: colBrexW,
      h: 0.35,
      fontSize: 18,
      fontFace: "Georgia",
      bold: true,
      color: BRAND.accent,
    });
    slide.addText("per month", {
      x: colBrexX,
      y: y + 0.5,
      w: colBrexW,
      h: 0.2,
      fontSize: 8,
      fontFace: "Arial",
      color: BRAND.muted,
    });

    // Industry range
    slide.addText(
      `$${(tier.industryLow / 1000).toFixed(0)}k – $${(tier.industryHigh / 1000).toFixed(0)}k`,
      {
        x: colIndX,
        y: y + 0.1,
        w: colIndW,
        h: 0.3,
        fontSize: 14,
        fontFace: "Arial",
        bold: true,
        color: BRAND.text,
      },
    );
    slide.addText(`Mid: $${(industryMid / 1000).toFixed(0)}k/mo`, {
      x: colIndX,
      y: y + 0.45,
      w: colIndW,
      h: 0.2,
      fontSize: 9,
      fontFace: "Arial",
      color: BRAND.muted,
    });

    // Savings vs mid (big green)
    const savColor = vsMid.deltaPct >= 0 ? "059669" : "DC2626";
    slide.addText(vsMid.label, {
      x: colSavX,
      y: y + 0.15,
      w: colSavW,
      h: 0.4,
      fontSize: 22,
      fontFace: "Georgia",
      bold: true,
      color: savColor,
    });
    slide.addText("vs industry mid", {
      x: colSavX,
      y: y + 0.6,
      w: colSavW,
      h: 0.2,
      fontSize: 7,
      fontFace: "Arial",
      color: BRAND.muted,
    });

    // Bundle savings
    slide.addText(`−${tier.discountPct}%`, {
      x: colBundX,
      y: y + 0.15,
      w: colBundW,
      h: 0.4,
      fontSize: 18,
      fontFace: "Arial",
      bold: true,
      color: "0F766E",
    });
    slide.addText(`vs $${tier.aLaCarteMonthly.toLocaleString()} à la carte`, {
      x: colBundX,
      y: y + 0.55,
      w: colBundW,
      h: 0.25,
      fontSize: 7,
      fontFace: "Arial",
      color: BRAND.muted,
    });
  });

  // Footnote
  slide.addText(
    `Bundle discounts (17% Advisor, 24% Strategist, 32% Fractional) reflect commitment and utilization efficiency. Industry ranges from Treetop 2026 Fractional Executive Pricing Report, MarkCMO 2026, and Pitchkitchen 2026.`,
    {
      x: 0.4,
      y: SLIDE_H - 0.6,
      w: SLIDE_W - 0.8,
      h: 0.35,
      fontSize: 8,
      fontFace: "Arial",
      italic: true,
      color: BRAND.muted,
    },
  );
}

// =============================================================
// Brex vs. Market — Per-service line-item slide
// =============================================================
function buildBrexLineItemMatrixSlide(pptx: PptxGenJS) {
  const slide = pptx.addSlide();
  addSectionHeader(
    slide,
    "Per-Service Comparison",
    `Tactical CMO line items at $${BREX_BLENDED_HOURLY}/hr blended senior rate`,
  );

  const startY = 1.3;
  const colSvcX = 0.4;
  const colSvcW = 3.5;
  const colBrexX = 4.0;
  const colBrexW = 1.1;
  const colIndX = 5.2;
  const colIndW = 1.8;
  const colSavX = 7.1;
  const colSavW = 1.0;
  const colPosX = 8.2;
  const colPosW = 1.5;

  // Header bar
  slide.addShape("rect", {
    x: colSvcX,
    y: startY,
    w: SLIDE_W - 0.8,
    h: 0.3,
    fill: { color: BRAND.navy },
    line: { color: BRAND.navy, width: 0 },
  });
  const hy = startY + 0.05;
  slide.addText("Service", { x: colSvcX + 0.1, y: hy, w: colSvcW, h: 0.2, fontSize: 9, fontFace: "Arial", bold: true, color: BRAND.white, valign: "middle" });
  slide.addText("Brex", { x: colBrexX, y: hy, w: colBrexW, h: 0.2, fontSize: 9, fontFace: "Arial", bold: true, color: BRAND.white, valign: "middle" });
  slide.addText("Industry Mid-Market", { x: colIndX, y: hy, w: colIndW, h: 0.2, fontSize: 9, fontFace: "Arial", bold: true, color: BRAND.white, valign: "middle" });
  slide.addText("vs Mid", { x: colSavX, y: hy, w: colSavW, h: 0.2, fontSize: 9, fontFace: "Arial", bold: true, color: BRAND.white, valign: "middle" });
  slide.addText("Position", { x: colPosX, y: hy, w: colPosW, h: 0.2, fontSize: 9, fontFace: "Arial", bold: true, color: BRAND.white, valign: "middle" });

  // Data rows — pack 14 line items into ~3.7in of space
  const rows = BREX_LINE_ITEMS;
  const rowH = Math.min(0.24, (SLIDE_H - startY - 0.9) / Math.max(rows.length, 1));

  rows.forEach((item, idx) => {
    const y = startY + 0.32 + idx * rowH;
    const vs = computeSavings(item.brexPrice, item.benchmarkMid);
    const posColor = positioningColor(item.positioning);

    // Row bg
    slide.addShape("rect", {
      x: colSvcX,
      y,
      w: SLIDE_W - 0.8,
      h: rowH,
      fill: { color: idx % 2 === 0 ? "FFFFFF" : "F9FAFB" },
      line: { color: BRAND.border, width: 0.4 },
    });

    slide.addText(item.service, {
      x: colSvcX + 0.1,
      y: y + 0.02,
      w: colSvcW,
      h: rowH - 0.04,
      fontSize: 8,
      fontFace: "Arial",
      bold: true,
      color: BRAND.text,
      valign: "middle",
    });

    slide.addText(formatBrexPrice(item.brexPrice, item.brexUnit), {
      x: colBrexX,
      y: y + 0.02,
      w: colBrexW,
      h: rowH - 0.04,
      fontSize: 10,
      fontFace: "Arial",
      bold: true,
      color: BRAND.accent,
      valign: "middle",
    });

    slide.addText(
      `${formatBrexPrice(item.benchmarkLow, item.benchmarkUnit)} – ${formatBrexPrice(item.benchmarkHigh, item.benchmarkUnit)}`,
      {
        x: colIndX,
        y: y + 0.02,
        w: colIndW,
        h: rowH - 0.04,
        fontSize: 9,
        fontFace: "Arial",
        color: BRAND.text,
        valign: "middle",
      },
    );

    const savColor = vs.deltaPct >= 0 ? "059669" : "DC2626";
    slide.addText(vs.label, {
      x: colSavX,
      y: y + 0.02,
      w: colSavW,
      h: rowH - 0.04,
      fontSize: 10,
      fontFace: "Arial",
      bold: true,
      color: savColor,
      valign: "middle",
    });

    slide.addText(posColor.label, {
      x: colPosX,
      y: y + 0.02,
      w: colPosW,
      h: rowH - 0.04,
      fontSize: 7,
      fontFace: "Arial",
      bold: true,
      color: posColor.hex.replace("#", ""),
      valign: "middle",
    });
  });

  // Footnote
  slide.addText(
    "Sources: 2026 pricing surveys — Treetop, MarkCMO, O-CMO, RankedCMO, Digital Applied, Windmill Growth, Remarkable Agency, Troo Inbound. Full citations in appendix.",
    {
      x: 0.4,
      y: SLIDE_H - 0.5,
      w: SLIDE_W - 0.8,
      h: 0.25,
      fontSize: 7,
      fontFace: "Arial",
      italic: true,
      color: BRAND.muted,
    },
  );
}

function buildBenchmarksSlide(pptx: PptxGenJS) {
  const slide = pptx.addSlide();
  addSectionHeader(
    slide,
    "Investment Benchmarks",
    "Industry pricing for the services in this plan (2026)",
  );

  // Filter to top 4 most relevant for exec view
  const priorityLabels = [
    "Blog content",
    "SEO/AEO",
    "Fractional CMO",
    "LinkedIn Ads management",
  ];
  const top = priorityLabels
    .map((label) =>
      PRICING_BENCHMARKS.find(
        (b) => b.service.startsWith(label) && !b.service.includes("%"),
      ),
    )
    .filter((b): b is typeof PRICING_BENCHMARKS[number] => Boolean(b))
    .slice(0, 4);

  const rowH = 0.75;
  const startY = 1.5;
  const barX = 3.5;
  const barW = 4.5;

  top.forEach((b, idx) => {
    const rowY = startY + idx * rowH;

    // Service label
    slide.addText(safe(b.service), {
      x: 0.5,
      y: rowY,
      w: 2.9,
      h: rowH,
      fontSize: 10,
      fontFace: "Arial",
      bold: true,
      color: BRAND.navy,
      valign: "middle",
    });

    // Bar track
    slide.addShape("rect", {
      x: barX,
      y: rowY + 0.2,
      w: barW,
      h: 0.15,
      fill: { color: BRAND.light },
      line: { color: BRAND.border, width: 0 },
    });

    // Mean band (amber)
    const range = b.high - b.low;
    if (range > 0) {
      const meanPos = ((b.mean - b.low) / range) * barW;
      const bandW = barW * 0.3;
      slide.addShape("rect", {
        x: Math.max(barX, barX + meanPos - bandW / 2),
        y: rowY + 0.2,
        w: bandW,
        h: 0.15,
        fill: { color: BRAND.accent },
        line: { color: BRAND.accent, width: 0 },
      });
    }

    // Low label
    slide.addText(formatMoney(b.low, b.unit), {
      x: barX - 0.1,
      y: rowY + 0.38,
      w: 0.8,
      h: 0.25,
      fontSize: 8,
      fontFace: "Arial",
      color: BRAND.muted,
    });

    // Mean label (bold, centered)
    slide.addText(formatMoney(b.mean, b.unit), {
      x: barX + barW / 2 - 0.6,
      y: rowY + 0.38,
      w: 1.2,
      h: 0.25,
      fontSize: 9,
      fontFace: "Arial",
      bold: true,
      color: BRAND.navy,
      align: "center",
    });

    // High label
    slide.addText(formatMoney(b.high, b.unit), {
      x: barX + barW - 0.7,
      y: rowY + 0.38,
      w: 0.8,
      h: 0.25,
      fontSize: 8,
      fontFace: "Arial",
      color: BRAND.muted,
      align: "right",
    });

    // Positioning badge (right side)
    const positioning =
      b.brexPositioning === "premium"
        ? "BREX · PREMIUM"
        : b.brexPositioning === "mid-market"
          ? "BREX · MID-MARKET"
          : "BREX · BOUTIQUE";
    slide.addText(positioning, {
      x: barX + barW + 0.1,
      y: rowY + 0.2,
      w: 1.7,
      h: 0.35,
      fontSize: 8,
      fontFace: "Arial",
      bold: true,
      color: BRAND.accent,
      charSpacing: 1,
      valign: "middle",
    });
  });

  // Footnote
  slide.addText(
    "Ranges drawn from 2026 agency pricing surveys (Clutch, Ahrefs, Digital Applied). Full source list in appendix.",
    {
      x: 0.5,
      y: SLIDE_H - 0.7,
      w: SLIDE_W - 1,
      h: 0.3,
      fontSize: 8,
      fontFace: "Arial",
      italic: true,
      color: BRAND.muted,
    },
  );
}

function buildNextStepsSlide(pptx: PptxGenJS) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, "Next Steps", "What we need to move from strategy to execution");

  const steps = [
    { n: "1", text: "Approve the strategy direction and pillar framing." },
    { n: "2", text: "Confirm publishing cadence — 10 posts per week baseline." },
    { n: "3", text: "Kick off week 1 briefs with the Brex team." },
    { n: "4", text: "Schedule biweekly review checkpoint." },
    { n: "5", text: "Green-light paid distribution budget for LinkedIn + Meta." },
  ];

  const rowH = 0.65;
  const startY = 1.6;

  steps.forEach((step, idx) => {
    const y = startY + idx * rowH;

    // Number circle
    slide.addShape("ellipse", {
      x: 0.6,
      y: y,
      w: 0.5,
      h: 0.5,
      fill: { color: BRAND.accent },
      line: { color: BRAND.accent, width: 0 },
    });

    slide.addText(step.n, {
      x: 0.6,
      y: y,
      w: 0.5,
      h: 0.5,
      fontSize: 20,
      fontFace: "Georgia",
      bold: true,
      color: BRAND.white,
      align: "center",
      valign: "middle",
    });

    // Step text
    slide.addText(step.text, {
      x: 1.3,
      y: y,
      w: SLIDE_W - 1.8,
      h: 0.5,
      fontSize: 14,
      fontFace: "Arial",
      color: BRAND.text,
      valign: "middle",
    });
  });
}

function buildSourcesSlide(pptx: PptxGenJS) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, "Sources & Citations", "Industry data behind the benchmarks");

  // Two-column layout for sources
  const midpoint = Math.ceil(BENCHMARK_SOURCES.length / 2);
  const col1 = BENCHMARK_SOURCES.slice(0, midpoint);
  const col2 = BENCHMARK_SOURCES.slice(midpoint);

  const renderColumn = (
    sources: typeof BENCHMARK_SOURCES,
    x: number,
  ) => {
    let y = 1.4;
    sources.forEach((s) => {
      slide.addText(s.publisher.toUpperCase(), {
        x,
        y,
        w: 4.3,
        h: 0.2,
        fontSize: 7,
        fontFace: "Arial",
        bold: true,
        color: BRAND.accent,
        charSpacing: 1,
      });

      slide.addText(safe(s.title), {
        x,
        y: y + 0.18,
        w: 4.3,
        h: 0.3,
        fontSize: 9,
        fontFace: "Arial",
        bold: true,
        color: BRAND.navy,
      });

      slide.addText(safe(s.url), {
        x,
        y: y + 0.42,
        w: 4.3,
        h: 0.2,
        fontSize: 7,
        fontFace: "Arial",
        color: BRAND.muted,
        hyperlink: { url: s.url },
      });

      y += 0.75;
    });
  };

  renderColumn(col1, 0.5);
  renderColumn(col2, SLIDE_W / 2 + 0.1);
}

// =============================================================
// Main export function
// =============================================================
export async function buildContentPlanPptx(args: PptxExportArgs): Promise<Buffer> {
  const { payload, clientName, clientUrl, generatedAt = new Date(), swot, pestel, porters, customerInsights } = args;

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9"; // 10 x 5.625 inches
  pptx.title = `${clientName} — 12-Week Content Strategy`;
  pptx.author = "Brex Consulting";
  pptx.company = "Brex Consulting";
  pptx.subject = "Content strategy briefing";

  // 1. Cover (with prospect logo fetch)
  await buildCoverSlide(pptx, clientName, clientUrl, generatedAt);

  // 2. At a Glance
  buildAtAGlanceSlide(pptx, payload);

  // 3. Thesis
  buildThesisSlide(pptx, payload);

  // 4. Pillar Mix chart
  buildPillarMixSlide(pptx, payload);

  // 5-8. One slide per pillar (up to 4)
  const pillarCounts = countPillarPosts(payload);
  const pillars = payload.contentPillars ?? [];
  const countMap = new Map(pillarCounts.map((p) => [p.name, p.count]));
  pillars.slice(0, 4).forEach((pillar, idx) => {
    buildPillarSlide(pptx, pillar, countMap.get(pillar.name) ?? 0, idx, pillars.length);
  });

  // 9. Publishing timeline
  buildTimelineSlide(pptx, payload);

  // 9a-c. Strategic frameworks (before pricing matrix)
  if (swot) buildSwotSlides(pptx, swot);
  if (pestel) buildPestelSlide(pptx, pestel);
  if (porters) buildPortersSlides(pptx, porters);

  // 9d. Customer Insights (opt-in — 4 panels across 6-10 slides)
  if (customerInsights) {
    try {
      buildCustomerInsightsSlides(pptx, customerInsights);
    } catch (err) {
      console.error("[pptx-export] customer insights slides failed:", err);
    }
  }

  // 10a. Brex vs. Market — Tier comparison
  buildBrexTierMatrixSlide(pptx);

  // 10b. Brex vs. Market — Per-service comparison
  buildBrexLineItemMatrixSlide(pptx);

  // 10c. Investment benchmarks (supporting industry detail)
  buildBenchmarksSlide(pptx);

  // 10d. SEO/GEO Site Architecture (sitemap section — overview + type mix + highlights + directory)
  buildSitemapSlides(pptx, payload);

  // 11-15. ROI projections (5 slides — headline + 4 charts)
  if (payload.roiProjections) {
    buildRoiHeadlineSlide(pptx, payload);
    buildRoiTrafficSlide(pptx, payload);
    buildRoiFunnelSlide(pptx, payload);
    buildRoiCostSlide(pptx, payload);
    buildRoiPaybackSlide(pptx, payload);
  }

  // 16. Next steps
  buildNextStepsSlide(pptx);

  // 12. Sources
  buildSourcesSlide(pptx);

  // Apply footers to every non-cover slide
  const slideCount = pillars.slice(0, 4).length + 8; // cover + 7 fixed + N pillars
  void slideCount; // pptxgenjs doesn't expose slides after add; footers already added inline where needed

  // Add footer to each slide except cover
  // Note: pptxgenjs Slides is public but iteration API changed;
  // easiest is to add footer inline. Skipping global re-iteration.

  // Return as Buffer
  const data = await pptx.write({ outputType: "nodebuffer" });
  return data as Buffer;
}

// =============================================================
// Strategic Frameworks slide builders
// =============================================================
// SWOT is rendered across 5 slides: 1 overview + 1 per quadrant.
// The 16:9 slide (10" × 5.625") cannot fit 4 quadrants × 3-5 items with
// full-sentence evidence without overlap. Splitting gives each item room
// to breathe and reads better in presentation mode.
function buildSwotSlides(pptx: PptxGenJS, swot: SwotAnalysis) {
  buildSwotOverviewSlide(pptx, swot);
  buildSwotQuadrantSlide(pptx, "Strengths", "059669", swot.strengths, swot.industry);
  buildSwotQuadrantSlide(pptx, "Weaknesses", "DC2626", swot.weaknesses, swot.industry);
  buildSwotQuadrantSlide(pptx, "Opportunities", "0284C7", swot.opportunities, swot.industry);
  buildSwotQuadrantSlide(pptx, "Threats", "B45309", swot.threats, swot.industry);
}

// Overview slide: 2×2 grid of quadrant summaries — just the label + one-line
// title per item. Full detail follows on dedicated slides.
function buildSwotOverviewSlide(pptx: PptxGenJS, swot: SwotAnalysis) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, "SWOT Analysis", `Industry: ${swot.industry}`);

  // Cell budget: startY=1.4, slide floor 5.625, 0.3 bottom pad, one row gap 0.15
  // → available = 5.625 - 1.4 - 0.3 = 3.925 for 2 rows + 1 gap → cellH = 1.89.
  // Bumped to 2.05 by tightening header to y=1.3 so 5 items fit without overflow.
  const startY = 1.3;
  const cellW = 4.5;
  const cellH = 2.0;
  const col1X = 0.4;
  const col2X = 5.1;
  const rowGap = 0.15;

  const cells = [
    { x: col1X, y: startY, label: "STRENGTHS", color: "059669", items: swot.strengths },
    { x: col2X, y: startY, label: "WEAKNESSES", color: "DC2626", items: swot.weaknesses },
    { x: col1X, y: startY + cellH + rowGap, label: "OPPORTUNITIES", color: "0284C7", items: swot.opportunities },
    { x: col2X, y: startY + cellH + rowGap, label: "THREATS", color: "B45309", items: swot.threats },
  ];

  cells.forEach((c) => {
    const items = c.items ?? [];
    // Cell border
    slide.addShape("rect", {
      x: c.x, y: c.y, w: cellW, h: cellH,
      fill: { color: "FFFFFF" }, line: { color: BRAND.border, width: 0.75 },
    });
    // Label bar
    slide.addShape("rect", {
      x: c.x, y: c.y, w: cellW, h: 0.32,
      fill: { color: c.color }, line: { color: c.color, width: 0 },
    });
    slide.addText(c.label, {
      x: c.x + 0.14, y: c.y + 0.03, w: cellW - 1.0, h: 0.26,
      fontSize: 10, fontFace: "Arial", bold: true, color: "FFFFFF", charSpacing: 2, valign: "middle",
    });
    slide.addText(`${items.length} • detail follows`, {
      x: c.x + cellW - 1.7, y: c.y + 0.03, w: 1.6, h: 0.26,
      fontSize: 8, fontFace: "Arial", bold: true, color: "FFFFFF", italic: true,
      align: "right", valign: "middle",
    });

    // Titles only in the overview — one line each. Cap at 5.
    // Budget: cellH - 0.32 label - 0.1 top pad - 0.05 bottom pad = usable.
    const maxTitles = Math.min(items.length, 5);
    const titleAreaTop = c.y + 0.42;
    const titleAreaH = cellH - 0.5;
    const titleH = titleAreaH / Math.max(maxTitles, 1);
    for (let i = 0; i < maxTitles; i++) {
      const it = items[i];
      // Truncate title to a single line at this cell width (~40 chars fits at 8.5pt)
      const label = safe(it.title);
      const oneLine = label.length > 60 ? label.slice(0, 59) + "…" : label;
      slide.addText(`${it.id}  ${oneLine}`, {
        x: c.x + 0.14, y: titleAreaTop + i * titleH, w: cellW - 0.28, h: titleH,
        fontSize: 8.5, fontFace: "Arial", color: BRAND.text, valign: "middle",
      });
    }
  });
}

// One quadrant detail slide: heading + all items with full evidence.
// Body height budget: startY=1.35 → slide floor 5.625 minus 0.3 bottom pad
// = 3.975". Items split evenly; 5 items × evidenceH still fits at fontSize 9.
// When items > 5 (rare), we split across multiple slides ("(cont.)").
function buildSwotQuadrantSlide(
  pptx: PptxGenJS,
  label: string,
  color: string,
  items: SwotItem[] | undefined,
  industry: string,
) {
  const src = items ?? [];
  if (src.length === 0) {
    const slide = pptx.addSlide();
    addSectionHeader(slide, `SWOT — ${label}`, `Industry: ${industry}`);
    slide.addText("No items in this quadrant.", {
      x: 0.6, y: 1.5, w: SLIDE_W - 1.2, h: 0.4,
      fontSize: 12, fontFace: "Arial", italic: true, color: BRAND.muted,
    });
    return;
  }

  // Split into pages of at most 5 items each.
  const perPage = 5;
  const pages: SwotItem[][] = [];
  for (let i = 0; i < src.length; i += perPage) {
    pages.push(src.slice(i, i + perPage));
  }

  pages.forEach((pageItems, pageIdx) => {
    const slide = pptx.addSlide();
    const suffix = pages.length > 1 ? ` (${pageIdx + 1} of ${pages.length})` : "";
    addSectionHeader(slide, `SWOT — ${label}${suffix}`, `Industry: ${industry}`);

    const startY = 1.35;
    const bodyW = SLIDE_W - 0.8;
    const itemGap = 0.1;
    const available = SLIDE_H - startY - 0.3;
    const n = pageItems.length;
    const itemH = (available - (n - 1) * itemGap) / n;
    const titleH = 0.3;
    const evidenceH = itemH - titleH - 0.06;

    for (let i = 0; i < n; i++) {
      const it = pageItems[i];
      const y = startY + i * (itemH + itemGap);

      slide.addShape("rect", {
        x: 0.4, y, w: bodyW, h: itemH,
        fill: { color: "FFFFFF" }, line: { color: BRAND.border, width: 0.75 },
      });
      slide.addShape("rect", {
        x: 0.4, y, w: 0.08, h: itemH,
        fill: { color }, line: { color, width: 0 },
      });
      slide.addText(it.id, {
        x: 0.55, y: y + 0.06, w: 0.55, h: 0.26,
        fontSize: 10, fontFace: "Arial", bold: true, color, valign: "middle",
      });
      slide.addText(safe(it.title), {
        x: 1.12, y: y + 0.06, w: bodyW - 0.82, h: titleH,
        fontSize: 11.5, fontFace: "Arial", bold: true, color: BRAND.navy, valign: "middle",
      });
      slide.addText(safe(it.evidence), {
        x: 0.55, y: y + titleH + 0.08, w: bodyW - 0.25, h: evidenceH,
        fontSize: 9.5, fontFace: "Arial", color: BRAND.text, valign: "top",
      });
    }
  });
}

function buildPestelSlide(pptx: PptxGenJS, pestel: PestelAnalysis) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, "PESTEL Analysis", `Industry: ${pestel.industry} · 2025–2026 sources`);

  const factors: Array<{ key: string; label: string }> = [
    { key: "political", label: "Political & Regulatory" },
    { key: "economic", label: "Economic" },
    { key: "social", label: "Social & Demographic" },
    { key: "technological", label: "Technological" },
    { key: "environmental", label: "Environmental & ESG" },
    { key: "legal", label: "Legal & Compliance" },
  ];

  const startY = 1.35;
  const cellW = 3.05;
  const cellH = 1.9;
  const gap = 0.12;
  const cols = 3;

  factors.forEach((f, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = 0.4 + col * (cellW + gap);
    const y = startY + row * (cellH + gap);

    const finding = (pestel.findings ?? []).find((fx) => fx.factor === (f.key as any));

    // Cell background
    slide.addShape("rect", {
      x, y, w: cellW, h: cellH,
      fill: { color: "F9FAFB" }, line: { color: BRAND.border, width: 0.75 },
    });

    // Label
    slide.addText(f.label, {
      x: x + 0.15, y: y + 0.1, w: cellW - 0.3, h: 0.25,
      fontSize: 9, fontFace: "Arial", bold: true, color: BRAND.accent, charSpacing: 1,
    });

    if (!finding) {
      slide.addText("No signal in current window.", {
        x: x + 0.15, y: y + 0.5, w: cellW - 0.3, h: 0.3,
        fontSize: 8, fontFace: "Arial", italic: true, color: BRAND.muted,
      });
      return;
    }

    // Impact + horizon strip
    const impactColor =
      finding.impact === "positive" ? "059669" : finding.impact === "negative" ? "DC2626" : "6B7280";
    slide.addText(
      `${finding.id} · ${finding.impact.toUpperCase()} · ${horizonLabelPptx(finding.timeHorizon)}`,
      {
        x: x + 0.15, y: y + 0.35, w: cellW - 0.3, h: 0.2,
        fontSize: 7, fontFace: "Arial", bold: true, color: impactColor, charSpacing: 1,
      },
    );

    // Insight (compressed)
    slide.addText(safe(finding.insight).slice(0, 250), {
      x: x + 0.15, y: y + 0.6, w: cellW - 0.3, h: 0.9,
      fontSize: 8.5, fontFace: "Arial", color: BRAND.text, valign: "top",
    });

    // First source
    if (finding.sources && finding.sources.length > 0) {
      const s = finding.sources[0];
      const label = s.publisher || domainFromPptxUrl(s.url);
      slide.addText(`› ${label}`, {
        x: x + 0.15, y: y + cellH - 0.3, w: cellW - 0.3, h: 0.2,
        fontSize: 7, fontFace: "Arial", bold: true, color: "0F766E",
        hyperlink: { url: s.url },
      });
    }
  });
}

// Porter's is rendered across 6 slides: 1 overview + 1 per force.
// The 16:9 slide (5.625" tall) can't fit 5 forces × rationale + drivers +
// sources without overlap; split gives each force room for the full read.
function buildPortersSlides(pptx: PptxGenJS, porters: PortersFiveForces) {
  buildPortersOverviewSlide(pptx, porters);
  const canonicalOrder: PortersForceName[] = [
    "rivalry", "newEntrants", "substitutes", "buyerPower", "supplierPower",
  ];
  const byName = new Map(porters.forces.map((f) => [f.force, f]));
  canonicalOrder.forEach((name) => {
    const f = byName.get(name);
    if (f) buildPortersForceSlide(pptx, f, porters.industry);
  });
}

const PORTERS_FORCE_LABELS: Record<PortersForceName, string> = {
  rivalry: "Competitive Rivalry",
  newEntrants: "Threat of New Entrants",
  substitutes: "Threat of Substitutes",
  buyerPower: "Buyer Power",
  supplierPower: "Supplier Power",
};

function portersIntensityColor(intensity: string): string {
  return intensity === "high" ? "DC2626" : intensity === "medium" ? "B45309" : "059669";
}

// Extract the first sentence of a paragraph, or the first ~N chars ending on
// a word boundary. Never cuts mid-word.
function firstSentenceOrClamp(text: string, maxChars = 200): string {
  const s = safe(text).trim();
  if (!s) return "";
  const firstSentence = s.split(/(?<=[.!?])\s+/)[0] ?? s;
  if (firstSentence.length <= maxChars) return firstSentence;
  return firstSentence.slice(0, maxChars - 1).replace(/\s+\S*$/, "") + "…";
}

// Overview: table of 5 forces with intensity + short takeaway. Body only.
function buildPortersOverviewSlide(pptx: PptxGenJS, porters: PortersFiveForces) {
  const slide = pptx.addSlide();
  addSectionHeader(
    slide,
    "Porter's Five Forces",
    porters.overallStructure || `${porters.industry} · 2025–2026 sources`,
  );

  const startY = 1.4;
  const rowH = 0.78;
  const rowGap = 0.06;
  const rowW = SLIDE_W - 0.8;

  porters.forces.forEach((f, idx) => {
    const y = startY + idx * (rowH + rowGap);
    const intensityColor = portersIntensityColor(f.intensity);

    // Row bg
    slide.addShape("rect", {
      x: 0.4, y, w: rowW, h: rowH,
      fill: { color: idx % 2 === 0 ? "FFFFFF" : "F9FAFB" },
      line: { color: BRAND.border, width: 0.5 },
    });
    // Left intensity bar
    slide.addShape("rect", {
      x: 0.4, y, w: 0.12, h: rowH,
      fill: { color: intensityColor }, line: { color: intensityColor, width: 0 },
    });
    // Force label
    slide.addText(PORTERS_FORCE_LABELS[f.force] ?? f.force, {
      x: 0.62, y: y + 0.06, w: 4.8, h: 0.3,
      fontSize: 12, fontFace: "Arial", bold: true, color: BRAND.navy, valign: "middle",
    });
    // Intensity badge (top-right)
    slide.addText(f.intensity.toUpperCase(), {
      x: SLIDE_W - 1.6, y: y + 0.06, w: 1.2, h: 0.3,
      fontSize: 11, fontFace: "Arial", bold: true, color: intensityColor,
      align: "right", charSpacing: 1.5, valign: "middle",
    });
    // Takeaway: first full sentence (or clamped at a word boundary).
    slide.addText(firstSentenceOrClamp(f.rationale, 200), {
      x: 0.62, y: y + 0.4, w: rowW - 0.3, h: 0.35,
      fontSize: 9, fontFace: "Arial", color: BRAND.muted, valign: "top",
    });
  });
}

// One force detail slide: full rationale + drivers list + first source.
function buildPortersForceSlide(pptx: PptxGenJS, f: PortersForce, industry: string) {
  const slide = pptx.addSlide();
  const forceLabel = PORTERS_FORCE_LABELS[f.force] ?? f.force;
  addSectionHeader(slide, `Porter's — ${forceLabel}`, `Industry: ${industry}`);

  const intensityColor = portersIntensityColor(f.intensity);

  // Intensity badge (top-right corner of header row)
  slide.addShape("rect", {
    x: SLIDE_W - 1.7, y: 0.45, w: 1.3, h: 0.4,
    fill: { color: intensityColor }, line: { color: intensityColor, width: 0 },
  });
  slide.addText(f.intensity.toUpperCase(), {
    x: SLIDE_W - 1.7, y: 0.45, w: 1.3, h: 0.4,
    fontSize: 12, fontFace: "Arial", bold: true, color: "FFFFFF",
    align: "center", charSpacing: 2, valign: "middle",
  });

  // Two-column layout: rationale on left, drivers list on right
  const bodyY = 1.4;
  const bodyH = SLIDE_H - bodyY - 0.5; // 3.725"
  const colGap = 0.3;
  const leftW = 5.2;
  const rightW = SLIDE_W - 0.8 - leftW - colGap;

  // Reserve the bottom source pill area so body content never overlaps it.
  const sourceReserve = f.sources && f.sources.length > 0 ? 0.32 : 0.0;
  const usableBodyH = bodyH - sourceReserve;

  // Left: RATIONALE
  slide.addText("RATIONALE", {
    x: 0.4, y: bodyY, w: leftW, h: 0.28,
    fontSize: 9.5, fontFace: "Arial", bold: true, color: BRAND.accent, charSpacing: 2,
  });
  slide.addText(safe(f.rationale), {
    x: 0.4, y: bodyY + 0.32, w: leftW, h: usableBodyH - 0.32,
    fontSize: 10.5, fontFace: "Arial", color: BRAND.text, valign: "top",
  });

  // Right: DRIVERS
  const rightX = 0.4 + leftW + colGap;
  slide.addText("KEY DRIVERS", {
    x: rightX, y: bodyY, w: rightW, h: 0.28,
    fontSize: 9.5, fontFace: "Arial", bold: true, color: BRAND.accent, charSpacing: 2,
  });
  const drivers = Array.isArray(f.drivers) ? f.drivers : [];
  if (drivers.length > 0) {
    const shown = drivers.slice(0, 4);
    const bulletItems = shown.map((d) => ({
      text: safe(d),
      options: { bullet: { indent: 15 } },
    }));
    if (drivers.length > 4) {
      bulletItems.push({
        text: `+ ${drivers.length - 4} more driver${drivers.length - 4 === 1 ? "" : "s"} in full report`,
        options: { bullet: { indent: 15 } },
      });
    }
    slide.addText(bulletItems, {
      x: rightX, y: bodyY + 0.32, w: rightW, h: usableBodyH - 0.32,
      fontSize: 9.5, fontFace: "Arial", color: BRAND.text, valign: "top",
      paraSpaceAfter: 4,
    });
  } else {
    slide.addText("No drivers listed.", {
      x: rightX, y: bodyY + 0.32, w: rightW, h: 0.4,
      fontSize: 10, fontFace: "Arial", italic: true, color: BRAND.muted,
    });
  }

  // Source pill (bottom-right, in the reserved band)
  if (f.sources && f.sources.length > 0) {
    const s = f.sources[0];
    const label = s.publisher || domainFromPptxUrl(s.url);
    slide.addText(`› Source: ${label}`, {
      x: SLIDE_W - 4.0, y: SLIDE_H - 0.36, w: 3.6, h: 0.24,
      fontSize: 9, fontFace: "Arial", bold: true, color: "0F766E",
      hyperlink: { url: s.url }, align: "right",
    });
  }
}

function horizonLabelPptx(h: string): string {
  if (h === "near") return "<12 MO";
  if (h === "long") return "3+ YR";
  return "12-36 MO";
}

function domainFromPptxUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// =============================================================
// Customer Insights slides — 4-panel deep buyer intelligence
// Added Sep 2026. Overview + one detail slide per panel + VoC + journey.
// =============================================================

function buildCustomerInsightsSlides(pptx: PptxGenJS, ci: CustomerInsights) {
  buildCIOverviewSlide(pptx, ci);
  buildCIPersonasSlide(pptx, ci);
  buildCIPainJTBDSlide(pptx, ci);
  buildCIVoCSlide(pptx, ci);
  buildCIValidationSlide(pptx, ci);
  buildCIBuyingSignalsSlide(pptx, ci);
  buildCICommitteeSlide(pptx, ci);
  buildCIObjectionsSlide(pptx, ci);
  buildCIJourneySlide(pptx, ci);
}

function buildCIOverviewSlide(pptx: PptxGenJS, ci: CustomerInsights) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, "Customer Insights", `Deep buyer intelligence · ${ci.industry}`);

  // Evidence-mode chip
  const modeColor = ci.vocEvidenceMode === "real" ? "437A22" : ci.vocEvidenceMode === "mixed" ? "F4BD11" : "607382";
  const modeLabel = ci.vocEvidenceMode === "real" ? "VoC: Real Research"
    : ci.vocEvidenceMode === "mixed" ? "VoC: Mixed"
    : "VoC: Representative Language";
  slide.addShape("rect", { x: 0.4, y: 1.25, w: 2.4, h: 0.28, fill: { color: modeColor }, line: { color: modeColor, width: 0 } });
  slide.addText(modeLabel, { x: 0.4, y: 1.25, w: 2.4, h: 0.28, fontSize: 9, bold: true, color: "FFFFFF", align: "center", valign: "middle", fontFace: "Arial" });

  // Executive read
  if (ci.summary) {
    slide.addText(ci.summary, {
      x: 0.4, y: 1.7, w: 9.2, h: 1.0,
      fontSize: 12, fontFace: "Arial", color: BRAND.text, valign: "top",
    });
  }

  // 4-panel grid summary
  const startY = 2.85;
  const cellW = 4.5;
  const cellH = 1.2;
  const rowGap = 0.15;
  const cells = [
    { x: 0.4, y: startY, label: "A · WHO THEY ARE", body: `${ci.personas?.length ?? 0} persona${(ci.personas?.length ?? 0) === 1 ? "" : "s"} · ${ci.psychographics?.decisionStyle ?? "—"} decisions · ${ci.psychographics?.riskTolerance ?? "—"} risk`, color: BRAND.navy },
    { x: 5.1, y: startY, label: "B · WHAT HURTS / HIRE", body: `${ci.painPoints?.length ?? 0} pain points · ${ci.jtbd?.length ?? 0} JTBD · ${ci.voiceOfCustomer?.length ?? 0} VoC quotes`, color: BRAND.accent },
    { x: 0.4, y: startY + cellH + rowGap, label: "C · WILL THEY BUY", body: `${ci.wouldTheyBuySignals?.length ?? 0} WTB signals · ${ci.momTestQuestions?.length ?? 0} Mom Test Qs · ${ci.buyingSignals?.length ?? 0} triggers`, color: "1B998B" },
    { x: 5.1, y: startY + cellH + rowGap, label: "D · HOW IT CLOSES", body: `${ci.decisionCommittee?.length ?? 0} committee roles · ${ci.objections?.length ?? 0} objections · ${ci.journeyStages?.length ?? 0} journey stages`, color: "F4BD11" },
  ];
  cells.forEach((c) => {
    slide.addShape("rect", { x: c.x, y: c.y, w: cellW, h: cellH, fill: { color: "FFFFFF" }, line: { color: BRAND.border, width: 0.75 } });
    slide.addShape("rect", { x: c.x, y: c.y, w: cellW, h: 0.32, fill: { color: c.color }, line: { color: c.color, width: 0 } });
    slide.addText(c.label, { x: c.x + 0.14, y: c.y + 0.03, w: cellW - 0.28, h: 0.26, fontSize: 10, bold: true, color: "FFFFFF", charSpacing: 2, fontFace: "Arial", valign: "middle" });
    slide.addText(c.body, { x: c.x + 0.14, y: c.y + 0.45, w: cellW - 0.28, h: cellH - 0.5, fontSize: 11, color: BRAND.text, fontFace: "Arial", valign: "top" });
  });
}

function buildCIPersonasSlide(pptx: PptxGenJS, ci: CustomerInsights) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, "Panel A — Who They Are", "Personas, psychographics, sociotype");

  const personas = ci.personas ?? [];
  const primaryX = 0.4;
  const secondX = personas.length > 1 ? 5.1 : 0.4;
  const cellW = personas.length > 1 ? 4.5 : 9.2;

  personas.slice(0, 2).forEach((p, i) => {
    const x = i === 0 ? primaryX : secondX;
    slide.addShape("rect", { x, y: 1.3, w: cellW, h: 1.5, fill: { color: BRAND.light }, line: { color: BRAND.border, width: 0.5 } });
    slide.addText(`${i === 0 ? "PRIMARY" : "SECONDARY"} · ${p.role}`, { x: x + 0.15, y: 1.4, w: cellW - 0.3, h: 0.25, fontSize: 9, bold: true, color: BRAND.muted, charSpacing: 2, fontFace: "Arial" });
    slide.addText(p.name, { x: x + 0.15, y: 1.65, w: cellW - 0.3, h: 0.4, fontSize: 18, bold: true, color: BRAND.navy, fontFace: "Arial" });
    slide.addText(`${p.orgSize} · ${p.industry}`, { x: x + 0.15, y: 2.1, w: cellW - 0.3, h: 0.25, fontSize: 10, color: BRAND.text, fontFace: "Arial" });
    slide.addText(`${p.seniority.toUpperCase()} · ${p.authority.toUpperCase()}`, { x: x + 0.15, y: 2.4, w: cellW - 0.3, h: 0.25, fontSize: 9, italic: true, color: BRAND.accent, fontFace: "Arial" });
  });

  // Psychographics + sociotype side-by-side
  const ps = ci.psychographics;
  const st = ci.sociotype;
  const bottomY = 3.0;
  const halfW = 4.5;

  slide.addText("PSYCHOGRAPHICS", { x: 0.4, y: bottomY, w: halfW, h: 0.25, fontSize: 9, bold: true, color: BRAND.muted, charSpacing: 2, fontFace: "Arial" });
  if (ps) {
    const psRows = [
      ["Personality", ps.personalityType],
      ["Buyer Type", `${ps.buyerType} · ${ps.buyerStage}`],
      ["Decision", `${ps.decisionStyle} · ${ps.riskTolerance} risk`],
      ["Diet", (ps.informationDiet ?? []).slice(0, 4).join(" · ") || "—"],
    ];
    psRows.forEach((r, i) => {
      slide.addText(r[0], { x: 0.4, y: bottomY + 0.3 + i * 0.4, w: 1.1, h: 0.35, fontSize: 9, bold: true, color: BRAND.muted, fontFace: "Arial" });
      slide.addText(r[1], { x: 1.55, y: bottomY + 0.3 + i * 0.4, w: 3.35, h: 0.35, fontSize: 10, color: BRAND.text, fontFace: "Arial", valign: "top" });
    });
  }

  slide.addText(`SOCIOTYPE · ${st?.archetype ?? ""}`, { x: 5.1, y: bottomY, w: halfW, h: 0.25, fontSize: 9, bold: true, color: BRAND.muted, charSpacing: 2, fontFace: "Arial" });
  if (st) {
    const stRows = [
      ["I am", st.iAm],
      ["I crave", st.iCrave],
      ["I struggle with", st.iStruggleWith],
      ["I consume", st.iConsume],
    ];
    stRows.forEach((r, i) => {
      slide.addText(r[0], { x: 5.1, y: bottomY + 0.3 + i * 0.4, w: 1.3, h: 0.35, fontSize: 9, bold: true, color: BRAND.muted, fontFace: "Arial" });
      slide.addText(r[1], { x: 6.45, y: bottomY + 0.3 + i * 0.4, w: 3.15, h: 0.35, fontSize: 9.5, color: BRAND.text, fontFace: "Arial", valign: "top" });
    });
  }
}

function buildCIPainJTBDSlide(pptx: PptxGenJS, ci: CustomerInsights) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, "Panel B — What Hurts, What They Hire Us For", "Ranked pain points + jobs-to-be-done");

  const pains = (ci.painPoints ?? []).slice(0, 4);
  const rowH = 0.7;
  pains.forEach((p, i) => {
    const y = 1.35 + i * (rowH + 0.1);
    slide.addShape("rect", { x: 0.4, y, w: 4.5, h: rowH, fill: { color: BRAND.light }, line: { color: BRAND.border, width: 0.5 } });
    slide.addShape("rect", { x: 0.4, y, w: 0.45, h: rowH, fill: { color: BRAND.accent }, line: { color: BRAND.accent, width: 0 } });
    slide.addText(String(p.rank), { x: 0.4, y, w: 0.45, h: rowH, fontSize: 18, bold: true, color: "FFFFFF", align: "center", valign: "middle", fontFace: "Arial" });
    slide.addText(p.label, { x: 1.0, y: y + 0.05, w: 3.85, h: 0.3, fontSize: 11, bold: true, color: BRAND.navy, fontFace: "Arial" });
    slide.addText(p.businessCost || p.symptom, { x: 1.0, y: y + 0.35, w: 3.85, h: rowH - 0.35, fontSize: 8.5, color: BRAND.text, fontFace: "Arial" });
  });

  const jtbd = (ci.jtbd ?? []).slice(0, 4);
  slide.addText("JOBS TO BE DONE", { x: 5.1, y: 1.35, w: 4.5, h: 0.25, fontSize: 9, bold: true, color: BRAND.muted, charSpacing: 2, fontFace: "Arial" });
  jtbd.forEach((j, i) => {
    const y = 1.65 + i * 0.85;
    slide.addText(`${i + 1}. When ${j.situation},`, { x: 5.1, y, w: 4.5, h: 0.25, fontSize: 10, bold: true, color: BRAND.navy, fontFace: "Arial" });
    slide.addText(`I want to ${j.motivation}, so I can ${j.outcome}.`, { x: 5.1, y: y + 0.25, w: 4.5, h: 0.35, fontSize: 9.5, color: BRAND.text, fontFace: "Arial", valign: "top" });
    slide.addText(`F: ${j.functionalJob} · E: ${j.emotionalJob}`, { x: 5.1, y: y + 0.6, w: 4.5, h: 0.2, fontSize: 8, italic: true, color: BRAND.muted, fontFace: "Arial" });
  });
}

function buildCIVoCSlide(pptx: PptxGenJS, ci: CustomerInsights) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, "Voice of Customer", ci.vocEvidenceMode === "real" ? "Real-world buyer quotes" : ci.vocEvidenceMode === "mixed" ? "Real + representative buyer language" : "Representative buyer language");

  const quotes = (ci.voiceOfCustomer ?? []).slice(0, 6);
  const quoteH = 0.65;
  quotes.forEach((q, i) => {
    const y = 1.3 + i * (quoteH + 0.05);
    slide.addShape("rect", { x: 0.4, y, w: 9.2, h: quoteH, fill: { color: q.isParaphrased ? BRAND.light : "F5FAFB" }, line: { color: BRAND.border, width: 0.5 } });
    slide.addShape("rect", { x: 0.4, y, w: 0.08, h: quoteH, fill: { color: q.isParaphrased ? BRAND.muted : "1B998B" }, line: { color: q.isParaphrased ? BRAND.muted : "1B998B", width: 0 } });
    slide.addText(`\u201c${q.quote}\u201d`, { x: 0.6, y: y + 0.05, w: 6.5, h: quoteH - 0.1, fontSize: 10, italic: true, color: BRAND.text, fontFace: "Arial", valign: "top" });
    slide.addText(`\u2014 ${q.speaker}`, { x: 7.2, y: y + 0.08, w: 2.35, h: 0.25, fontSize: 8.5, bold: true, color: BRAND.navy, fontFace: "Arial" });
    slide.addText(q.isParaphrased ? "Representative" : q.source, { x: 7.2, y: y + 0.33, w: 2.35, h: 0.25, fontSize: 7.5, color: BRAND.muted, fontFace: "Arial" });
  });
}

function buildCIValidationSlide(pptx: PptxGenJS, ci: CustomerInsights) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, "Panel C — Will They Buy?", "Would-they-buy signals · Mom Test questions");

  const wtb = (ci.wouldTheyBuySignals ?? []).slice(0, 5);
  slide.addText("WOULD-THEY-BUY SIGNALS", { x: 0.4, y: 1.3, w: 4.5, h: 0.25, fontSize: 9, bold: true, color: BRAND.muted, charSpacing: 2, fontFace: "Arial" });
  wtb.forEach((s, i) => {
    const y = 1.6 + i * 0.7;
    const strengthColor = s.strength === "strong" ? "437A22" : s.strength === "moderate" ? "F4BD11" : "607382";
    slide.addShape("rect", { x: 0.4, y, w: 0.7, h: 0.22, fill: { color: strengthColor }, line: { color: strengthColor, width: 0 } });
    slide.addText(s.strength.toUpperCase(), { x: 0.4, y, w: 0.7, h: 0.22, fontSize: 7.5, bold: true, color: "FFFFFF", align: "center", valign: "middle", fontFace: "Arial" });
    slide.addText(s.signal, { x: 1.2, y, w: 3.7, h: 0.25, fontSize: 10, bold: true, color: BRAND.navy, fontFace: "Arial" });
    slide.addText(s.whatItMeans, { x: 0.4, y: y + 0.27, w: 4.5, h: 0.4, fontSize: 8.5, color: BRAND.text, fontFace: "Arial", valign: "top" });
  });

  const mom = (ci.momTestQuestions ?? []).slice(0, 5);
  slide.addText("MOM TEST QUESTIONS", { x: 5.1, y: 1.3, w: 4.5, h: 0.25, fontSize: 9, bold: true, color: BRAND.muted, charSpacing: 2, fontFace: "Arial" });
  mom.forEach((q, i) => {
    const y = 1.6 + i * 0.7;
    slide.addText(`${i + 1}. ${q.question}`, { x: 5.1, y, w: 4.5, h: 0.28, fontSize: 10, bold: true, color: BRAND.navy, fontFace: "Arial" });
    slide.addText(`Avoid: \u201c${q.antipattern}\u201d`, { x: 5.1, y: y + 0.3, w: 4.5, h: 0.35, fontSize: 8, italic: true, color: "C02B0A", fontFace: "Arial", valign: "top" });
  });
}

function buildCIBuyingSignalsSlide(pptx: PptxGenJS, ci: CustomerInsights) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, "In-Market Buying Signals", "Triggers to watch + outreach plays");

  const signals = (ci.buyingSignals ?? []).slice(0, 8);
  signals.forEach((b, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = col === 0 ? 0.4 : 5.1;
    const y = 1.3 + row * 0.95;
    const urgencyColor = b.urgency === "in-market" ? "C02B0A" : b.urgency === "hot" ? "F4BD11" : b.urgency === "warming" ? "00A6FB" : "607382";

    slide.addShape("rect", { x, y, w: 4.5, h: 0.85, fill: { color: BRAND.light }, line: { color: BRAND.border, width: 0.5 } });
    slide.addShape("rect", { x, y, w: 4.5, h: 0.22, fill: { color: urgencyColor }, line: { color: urgencyColor, width: 0 } });
    slide.addText(`${b.category.toUpperCase()}  ·  ${b.urgency.toUpperCase()}`, { x: x + 0.1, y, w: 4.3, h: 0.22, fontSize: 8, bold: true, color: "FFFFFF", charSpacing: 1, valign: "middle", fontFace: "Arial" });
    slide.addText(b.trigger, { x: x + 0.1, y: y + 0.27, w: 4.3, h: 0.25, fontSize: 10, bold: true, color: BRAND.navy, fontFace: "Arial" });
    slide.addText(`Play: ${b.action}`, { x: x + 0.1, y: y + 0.53, w: 4.3, h: 0.3, fontSize: 8.5, color: BRAND.text, fontFace: "Arial", valign: "top" });
  });
}

function buildCICommitteeSlide(pptx: PptxGenJS, ci: CustomerInsights) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, "Panel D — Decision Committee", "Who has to say yes · Our play for each");

  const roles = (ci.decisionCommittee ?? []).slice(0, 5);
  roles.forEach((r, i) => {
    const y = 1.3 + i * 0.75;
    const playColor = r.ourPlay === "champion" ? "437A22" : r.ourPlay === "neutralize" ? "C02B0A" : r.ourPlay === "bypass" ? "607382" : "F4BD11";
    slide.addShape("rect", { x: 0.4, y, w: 9.2, h: 0.65, fill: { color: "FFFFFF" }, line: { color: BRAND.border, width: 0.5 } });
    slide.addText(r.role, { x: 0.55, y: y + 0.05, w: 2.5, h: 0.3, fontSize: 12, bold: true, color: BRAND.navy, fontFace: "Arial" });
    slide.addShape("rect", { x: 0.55, y: y + 0.35, w: 1.8, h: 0.22, fill: { color: playColor }, line: { color: playColor, width: 0 } });
    slide.addText(`PLAY: ${r.ourPlay.toUpperCase()}`, { x: 0.55, y: y + 0.35, w: 1.8, h: 0.22, fontSize: 8, bold: true, color: "FFFFFF", align: "center", valign: "middle", fontFace: "Arial" });
    slide.addText(`Motivation: ${r.motivation}`, { x: 3.2, y: y + 0.05, w: 6.3, h: 0.28, fontSize: 9, color: BRAND.text, fontFace: "Arial", valign: "top" });
    slide.addText(`Blocker: ${r.blocker}  ·  Objection: \u201c${r.primaryObjection}\u201d`, { x: 3.2, y: y + 0.35, w: 6.3, h: 0.28, fontSize: 8.5, italic: true, color: BRAND.muted, fontFace: "Arial", valign: "top" });
  });
}

function buildCIObjectionsSlide(pptx: PptxGenJS, ci: CustomerInsights) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, "Objection Handling", "Frame · Fear · Reframe · Proof");

  const objs = (ci.objections ?? []).slice(0, 5);
  objs.forEach((o, i) => {
    const y = 1.3 + i * 0.8;
    slide.addShape("rect", { x: 0.4, y, w: 9.2, h: 0.72, fill: { color: BRAND.light }, line: { color: BRAND.border, width: 0.5 } });
    slide.addText(`\u201c${o.objection}\u201d`, { x: 0.55, y: y + 0.05, w: 5.0, h: 0.3, fontSize: 10.5, bold: true, color: BRAND.navy, fontFace: "Arial" });
    slide.addShape("rect", { x: 5.65, y: y + 0.05, w: 1.4, h: 0.22, fill: { color: BRAND.navy }, line: { color: BRAND.navy, width: 0 } });
    slide.addText(o.frame.toUpperCase(), { x: 5.65, y: y + 0.05, w: 1.4, h: 0.22, fontSize: 8, bold: true, color: "FFFFFF", align: "center", valign: "middle", fontFace: "Arial" });
    slide.addText(`Fear: ${o.underlyingFear}`, { x: 0.55, y: y + 0.35, w: 4.5, h: 0.32, fontSize: 8.5, color: BRAND.text, fontFace: "Arial", valign: "top" });
    slide.addText(`Reframe: ${o.reframe}`, { x: 5.2, y: y + 0.35, w: 4.35, h: 0.32, fontSize: 8.5, bold: true, color: "1B998B", fontFace: "Arial", valign: "top" });
  });
}

function buildCIJourneySlide(pptx: PptxGenJS, ci: CustomerInsights) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, "Buyer Journey", "Five stages · Content asset per stage");

  const stages = ci.journeyStages ?? [];
  const cellW = 1.85;
  const cellH = 3.6;
  const stageColors = ["607382", "00A6FB", "1B998B", "F4BD11", "2A4365"];
  stages.slice(0, 5).forEach((s, i) => {
    const x = 0.4 + i * (cellW + 0.02);
    const color = stageColors[i] ?? BRAND.accent;
    slide.addShape("rect", { x, y: 1.3, w: cellW, h: cellH, fill: { color: "FFFFFF" }, line: { color: BRAND.border, width: 0.5 } });
    slide.addShape("rect", { x, y: 1.3, w: cellW, h: 0.4, fill: { color }, line: { color, width: 0 } });
    slide.addText(s.stage.toUpperCase().replace("-", " "), { x: x + 0.05, y: 1.3, w: cellW - 0.1, h: 0.4, fontSize: 9, bold: true, color: "FFFFFF", charSpacing: 1, align: "center", valign: "middle", fontFace: "Arial" });

    const rows = [
      ["Mindset", s.mindset],
      ["Asks", s.primaryQuestion],
      ["Where", s.channel],
      ["Asset", s.contentAsset],
      ["CTA", s.cta],
    ];
    rows.forEach((r, ri) => {
      const rowY = 1.8 + ri * 0.62;
      slide.addText(r[0].toUpperCase(), { x: x + 0.08, y: rowY, w: cellW - 0.16, h: 0.18, fontSize: 7, bold: true, color: BRAND.muted, charSpacing: 1, fontFace: "Arial" });
      slide.addText(r[1], { x: x + 0.08, y: rowY + 0.18, w: cellW - 0.16, h: 0.38, fontSize: 8, color: BRAND.text, fontFace: "Arial", valign: "top" });
    });
  });
}
