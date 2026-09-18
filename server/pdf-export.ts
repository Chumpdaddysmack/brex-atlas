import PDFDocument from "pdfkit";
import type {
  ContentPlanPayload,
  SwotAnalysis,
  PestelAnalysis,
  PortersFiveForces,
  CustomerInsights,
  SitemapPageBrief,
  SitemapPageType,
} from "@shared/schema";
import type { Response } from "express";
import {
  PRICING_BENCHMARKS,
  BENCHMARK_SOURCES,
  getSource,
  positioningLabel,
} from "./pricing-benchmarks";
import {
  BREX_LINE_ITEMS,
  BREX_TIERS,
  BREX_BLENDED_HOURLY,
  formatBrexPrice,
  computeSavings,
  positioningColor,
} from "@shared/brex-pricing";
import {
  drawPillarDonut,
  drawBenchmarkRow,
  drawGanttTimeline,
  drawStatBlock,
  drawCadenceBar,
  drawTwoSeriesLine,
  drawFunnelBars,
  drawCostCompareBars,
} from "./pdf-charts";

export type PdfScope = "full" | "strategy" | "summary";

// Brex Consulting brand colors
const BRAND = {
  // Brex brand palette (brexconsulting.com)
  navy: "#2A4365",       // Brex Primary Navy
  accent: "#00A6FB",     // Brex Sky Blue
  text: "#0F1824",       // Brex Deep Navy text
  muted: "#607382",      // Brex Muted
  light: "#EDF2F7",      // Brex Chip Surface
  border: "#DDE8EE",     // Brex Blue Light
};

const FONTS = {
  sansBold: "Helvetica-Bold",
  sans: "Helvetica",
  sansOblique: "Helvetica-Oblique",
  serif: "Times-Bold",
};

interface StreamPdfArgs {
  res: Response;
  payload: ContentPlanPayload;
  clientName: string;
  clientUrl?: string | null;
  scope: PdfScope;
  swot?: SwotAnalysis | null;
  pestel?: PestelAnalysis | null;
  porters?: PortersFiveForces | null;
  customerInsights?: CustomerInsights | null;
}

export function streamContentPlanPdf({
  res,
  payload,
  clientName,
  clientUrl,
  scope,
  swot,
  pestel,
  porters,
  customerInsights,
}: StreamPdfArgs) {
  const safeName = (clientName || "client").replace(/[^a-z0-9-_]/gi, "_");
  const scopeLabel =
    scope === "full" ? "full-plan" : scope === "strategy" ? "strategy" : "executive-summary";
  const filename = `${safeName}-${scopeLabel}.pdf`;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

  const doc = new PDFDocument({
    size: "LETTER",
    margins: { top: 72, bottom: 72, left: 72, right: 72 },
    bufferPages: true,
    info: {
      Title: `${clientName} — 12-week content strategy`,
      Author: "Brex Consulting",
      Subject: "Content strategy plan",
      Creator: "Brex Atlas",
    },
  });

  // Surface async pdfkit errors so the stream doesn't silently truncate
  doc.on("error", (err) => {
    console.error("[pdf-export] pdfkit stream error", err);
    try {
      res.end();
    } catch {}
  });

  doc.pipe(res);

  try {
    // -------- Cover page --------
    renderCover(doc, clientName, clientUrl ?? null, scope);

    // -------- Content by scope --------
    if (scope === "summary") {
      renderExecutiveSummary(doc, payload);
    } else if (scope === "strategy") {
      renderStrategyOnly(doc, payload);
    } else {
      renderFullPlan(doc, payload);
    }

    // -------- Strategic frameworks (before sources appendix) --------
    if (scope !== "summary" && (swot || pestel || porters)) {
      try {
        renderFrameworksSection(doc, { swot, pestel, porters });
      } catch (err) {
        console.error("[pdf-export] frameworks failed", err);
      }
    }

    // -------- Customer Insights (opt-in, before sources appendix) --------
    if (scope !== "summary" && customerInsights) {
      try {
        renderCustomerInsightsSection(doc, customerInsights);
      } catch (err) {
        console.error("[pdf-export] customer insights failed", err);
      }
    }

    // -------- Sources appendix (always, even if body errored partially) --------
    if (scope !== "strategy") {
      try {
        renderSourcesAppendix(doc);
      } catch (err) {
        console.error("[pdf-export] sources appendix failed", err);
      }
    }

    // -------- Footer on every page --------
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      try {
        doc.switchToPage(range.start + i);
        renderFooter(doc, clientName, i + 1, range.count);
      } catch (err) {
        console.error(`[pdf-export] footer failed on page ${i + 1}`, err);
      }
    }
  } catch (err) {
    console.error("[pdf-export] render failed, closing PDF gracefully", err);
    // Write an error page so the PDF at least closes cleanly
    try {
      doc.addPage();
      doc
        .fillColor(BRAND.navy)
        .font(FONTS.sansBold)
        .fontSize(14)
        .text("Report generation ended early", { align: "center" });
      doc
        .fillColor(BRAND.muted)
        .font(FONTS.sans)
        .fontSize(10)
        .text(
          "An unexpected data issue interrupted the export. Please try again or contact support if this repeats.",
          { align: "center" },
        );
    } catch {}
  }

  doc.end();
}

// =============================================================
// Cover page
// =============================================================
function renderCover(
  doc: PDFKit.PDFDocument,
  clientName: string,
  clientUrl: string | null,
  scope: PdfScope,
) {
  const { width, height } = doc.page;

  // Navy header band
  doc.rect(0, 0, width, 180).fill(BRAND.navy);

  // Accent slash
  doc.rect(0, 178, width, 3).fill(BRAND.accent);

  // Brex Consulting wordmark
  doc
    .fillColor("#FFFFFF")
    .font(FONTS.sansBold)
    .fontSize(11)
    .text("BREX CONSULTING", 72, 60, { characterSpacing: 2 });

  doc
    .fillColor(BRAND.accent)
    .font(FONTS.sans)
    .fontSize(9)
    .text("BIG ROCK METHOD · FRACTIONAL CMO", 72, 78, { characterSpacing: 1.5 });

  // Title block
  const scopeTitle =
    scope === "summary"
      ? "Executive Summary"
      : scope === "strategy"
        ? "Content Strategy"
        : "12-Week Content Plan";

  doc
    .fillColor(BRAND.text)
    .font(FONTS.serif)
    .fontSize(36)
    .text(clientName, 72, 240, { width: width - 144 });

  doc
    .fillColor(BRAND.muted)
    .font(FONTS.sansOblique)
    .fontSize(16)
    .text(scopeTitle, 72, doc.y + 4);

  if (clientUrl) {
    doc
      .fillColor(BRAND.muted)
      .font(FONTS.sans)
      .fontSize(11)
      .text(clientUrl.replace(/^https?:\/\//, ""), 72, doc.y + 8);
  }

  // Divider
  doc
    .moveTo(72, height - 180)
    .lineTo(width - 72, height - 180)
    .strokeColor(BRAND.border)
    .lineWidth(0.5)
    .stroke();

  // Prepared-by block
  doc
    .fillColor(BRAND.muted)
    .font(FONTS.sansBold)
    .fontSize(9)
    .text("PREPARED BY", 72, height - 160, { characterSpacing: 1.5 });

  doc
    .fillColor(BRAND.text)
    .font(FONTS.sansBold)
    .fontSize(14)
    .text("Brex Consulting", 72, height - 145);

  doc
    .fillColor(BRAND.muted)
    .font(FONTS.sans)
    .fontSize(10)
    .text("brexconsulting.com", 72, height - 128);

  // Date block on the right
  const dateStr = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  doc
    .fillColor(BRAND.muted)
    .font(FONTS.sansBold)
    .fontSize(9)
    .text("PREPARED ON", width - 200, height - 160, {
      width: 128,
      align: "right",
      characterSpacing: 1.5,
    });

  doc
    .fillColor(BRAND.text)
    .font(FONTS.sansBold)
    .fontSize(14)
    .text(dateStr, width - 200, height - 145, { width: 128, align: "right" });

  doc.addPage();
}

// =============================================================
// Executive Summary (infographic + thesis + charts + week-1 preview)
// =============================================================
function renderExecutiveSummary(doc: PDFKit.PDFDocument, p: ContentPlanPayload) {
  // ---- At-a-glance stat block ----
  try {
    renderAtAGlance(doc, p);
  } catch (err) {
    console.error("[pdf-export] at-a-glance failed", err);
  }

  sectionHeader(doc, "12-Week Thesis");
  bodyParagraph(doc, p.summary);

  sectionHeader(doc, "Content Pillars");
  for (const pillar of p.contentPillars ?? []) {
    pillarBlock(doc, pillar.name, pillar.description);
  }

  // ---- Pillar mix donut ----
  try {
    renderPillarMixChart(doc, p);
  } catch (err) {
    console.error("[pdf-export] pillar mix chart failed", err);
  }

  // ---- 12-week timeline ----
  try {
    renderTimelineChart(doc, p);
  } catch (err) {
    console.error("[pdf-export] timeline chart failed", err);
  }

  // ---- Brex vs. Market pricing matrix (compact tier table) ----
  try {
    renderBrexPricingMatrix(doc, { compact: true });
  } catch (err) {
    console.error("[pdf-export] brex pricing matrix (summary) failed", err);
  }

  // ---- Investment benchmarks (compact) ----
  try {
    renderInvestmentBenchmarks(doc, { compact: true });
  } catch (err) {
    console.error("[pdf-export] investment benchmarks failed", err);
  }

  if (p.blogCalendar?.[0]) {
    sectionHeader(doc, "Week 1 Preview");
    renderWeek(doc, p.blogCalendar[0], { compact: true });
  }

  // ---- ROI Projections (executive summary version) ----
  try {
    renderRoiSection(doc, p, { compact: true });
  } catch (err) {
    console.error("[pdf-export] ROI section (summary) failed", err);
  }

  // ---- SEO/GEO Site Architecture (compact list) ----
  try {
    renderSitemapSection(doc, p, { compact: true });
  } catch (err) {
    console.error("[pdf-export] sitemap section (summary) failed", err);
  }

  sectionHeader(doc, "Next Steps");
  bulletList(doc, [
    "Approve the strategy direction and pillar framing.",
    "Confirm publishing cadence — 10 posts / week baseline.",
    "Kick off week 1 briefs with Brex team.",
    "Schedule biweekly review checkpoint.",
  ]);

}

// =============================================================
// Strategy Only (thesis + pillars + blog calendar + organic social)
// =============================================================
// Shared strategy backbone: thesis, pillars, charts. Reused by both
// the standalone "strategy" scope and by full-plan (where the per-
// channel calendars are rendered as their own tab sections below).
function renderStrategyCore(doc: PDFKit.PDFDocument, p: ContentPlanPayload) {
  // ---- At-a-glance stat block ----
  try {
    renderAtAGlance(doc, p);
  } catch (err) {
    console.error("[pdf-export] at-a-glance failed", err);
  }

  sectionHeader(doc, "12-Week Thesis");
  bodyParagraph(doc, p.summary);

  sectionHeader(doc, "Content Pillars");
  for (const pillar of p.contentPillars ?? []) {
    pillarBlock(doc, pillar.name, pillar.description);
  }

  // ---- Pillar mix donut ----
  try {
    renderPillarMixChart(doc, p);
  } catch (err) {
    console.error("[pdf-export] pillar mix chart failed", err);
  }

  // ---- 12-week timeline ----
  try {
    renderTimelineChart(doc, p);
  } catch (err) {
    console.error("[pdf-export] timeline chart failed", err);
  }

  // ---- Weekly cadence bar ----
  try {
    renderCadenceChart(doc, p);
  } catch (err) {
    console.error("[pdf-export] cadence chart failed", err);
  }
}

// Standalone strategy-scope export: strategy backbone + inline blog
// calendar / social cadence / landing page briefs (no per-tab designed
// sections — that mode is for full-plan only).
function renderStrategyOnly(doc: PDFKit.PDFDocument, p: ContentPlanPayload) {
  renderStrategyCore(doc, p);

  sectionHeader(doc, "12-Week Blog Calendar");
  for (const week of p.blogCalendar ?? []) {
    try {
      renderWeek(doc, week);
    } catch (err) {
      console.error(`[pdf-export] week ${week?.weekNumber} render failed, skipping`, err);
    }
  }

  if (p.socialCadence?.length) {
    sectionHeader(doc, "Organic Social Cadence");
    for (const social of p.socialCadence) {
      try {
        renderSocial(doc, social);
      } catch (err) {
        console.error("[pdf-export] social render failed, skipping", err);
      }
    }
  }

  if (p.landingPages?.length) {
    sectionHeader(doc, "AEO Landing Pages");
    for (const lp of p.landingPages) {
      try {
        renderLandingPage(doc, lp);
      } catch (err) {
        console.error("[pdf-export] landing page render failed, skipping", err);
      }
    }
  }
}

// =============================================================
// Full Plan (everything)
// =============================================================
function renderFullPlan(doc: PDFKit.PDFDocument, p: ContentPlanPayload) {
  // ---- Overview + Strategy (Overview + Strategy tabs) ----
  renderStrategyCore(doc, p);

  // ---- ROI Projections tab ----
  try {
    renderRoiSection(doc, p, { compact: false });
  } catch (err) {
    console.error("[pdf-export] ROI section (full) failed", err);
  }

  // ---- Brex vs. Market pricing matrix (SOW context) ----
  try {
    renderBrexPricingMatrix(doc, { compact: false });
  } catch (err) {
    console.error("[pdf-export] brex pricing matrix (full) failed", err);
  }

  // ---- Investment benchmarks ----
  try {
    renderInvestmentBenchmarks(doc, { compact: false });
  } catch (err) {
    console.error("[pdf-export] investment benchmarks failed", err);
  }

  // ---- Site Architecture tab ----
  try {
    renderSitemapSection(doc, p, { compact: false });
  } catch (err) {
    console.error("[pdf-export] sitemap section (full) failed", err);
  }

  // ---- Content Studio channel tabs, one designed section each ----
  try { renderBlogCalendarTab(doc, p); } catch (err) {
    console.error("[pdf-export] blog calendar tab failed", err);
  }
  try { renderChannelCalendarTab(doc, p, "linkedin"); } catch (err) {
    console.error("[pdf-export] linkedin tab failed", err);
  }
  try { renderChannelCalendarTab(doc, p, "instagram"); } catch (err) {
    console.error("[pdf-export] instagram tab failed", err);
  }
  try { renderChannelCalendarTab(doc, p, "x"); } catch (err) {
    console.error("[pdf-export] x tab failed", err);
  }
  try { renderAdsGalleryTab(doc, p, "meta_ad"); } catch (err) {
    console.error("[pdf-export] meta ads tab failed", err);
  }
  try { renderAdsGalleryTab(doc, p, "linkedin_ad"); } catch (err) {
    console.error("[pdf-export] linkedin ads tab failed", err);
  }
  try { renderColdEmailTab(doc, p); } catch (err) {
    console.error("[pdf-export] cold email tab failed", err);
  }
  try { renderLandingPagesTab(doc, p); } catch (err) {
    console.error("[pdf-export] landing pages tab failed", err);
  }
}

// =============================================================
// Chart & benchmark render helpers
// =============================================================

function renderAtAGlance(doc: PDFKit.PDFDocument, p: ContentPlanPayload) {
  ensureSpace(doc, 90);
  const totalPosts = (p.blogCalendar ?? []).reduce(
    (sum, w) => sum + (w.posts?.length ?? 0),
    0,
  );
  const pillarCount = p.contentPillars?.length ?? 0;
  const weekCount = p.blogCalendar?.length ?? 0;
  const uniqueQueries = new Set<string>();
  for (const w of p.blogCalendar ?? []) {
    for (const post of w.posts ?? []) {
      if (post.targetQuery) uniqueQueries.add(post.targetQuery);
    }
  }

  sectionHeader(doc, "At a Glance");

  const y = doc.y;
  const nextY = drawStatBlock(
    doc,
    [
      { value: String(totalPosts), label: "Total posts" },
      { value: String(weekCount), label: "Weeks" },
      { value: String(pillarCount), label: "Pillars" },
      { value: String(uniqueQueries.size), label: "AEO queries" },
    ],
    72,
    y,
    doc.page.width - 144,
  );

  doc.y = nextY;
  doc.moveDown(0.5);
}

function renderPillarMixChart(doc: PDFKit.PDFDocument, p: ContentPlanPayload) {
  if (!p.contentPillars?.length || !p.blogCalendar?.length) return;

  ensureSpace(doc, 180);
  sectionHeader(doc, "Pillar Mix");

  // Count posts per pillar
  const counts = new Map<string, number>();
  for (const pillar of p.contentPillars) counts.set(pillar.name, 0);
  for (const week of p.blogCalendar) {
    for (const post of week.posts ?? []) {
      if (counts.has(post.pillar)) {
        counts.set(post.pillar, (counts.get(post.pillar) ?? 0) + 1);
      } else if (post.pillar) {
        counts.set(post.pillar, 1);
      }
    }
  }

  const pillarCounts = Array.from(counts.entries()).map(([name, count]) => ({
    name,
    count,
  }));

  const startY = doc.y;
  drawPillarDonut(doc, pillarCounts, 72, startY, 55);
  doc.y = startY + 130;
  doc.moveDown(0.3);
}

function renderTimelineChart(doc: PDFKit.PDFDocument, p: ContentPlanPayload) {
  if (!p.contentPillars?.length || !p.blogCalendar?.length) return;

  const pillarCount = p.contentPillars.length;
  const chartHeight = 40 + pillarCount * 18;
  ensureSpace(doc, chartHeight + 40);

  sectionHeader(doc, "12-Week Publishing Timeline");
  doc
    .fillColor(BRAND.muted)
    .font(FONTS.sans)
    .fontSize(9)
    .text(
      "Post counts per pillar across the 12-week calendar. Colored cells show weeks with active publishing.",
      { lineGap: 2 },
    );
  doc.moveDown(0.4);

  const startY = doc.y;
  const endY = drawGanttTimeline(
    doc,
    p.blogCalendar,
    p.contentPillars,
    72,
    startY,
    doc.page.width - 144,
  );
  doc.y = endY;
  doc.moveDown(0.4);
}

function renderCadenceChart(doc: PDFKit.PDFDocument, p: ContentPlanPayload) {
  if (!p.blogCalendar?.length) return;

  ensureSpace(doc, 150);
  sectionHeader(doc, "Weekly Cadence");
  doc
    .fillColor(BRAND.muted)
    .font(FONTS.sans)
    .fontSize(9)
    .text("Number of posts published each week.", { lineGap: 2 });
  doc.moveDown(0.3);

  const startY = doc.y;
  const endY = drawCadenceBar(doc, p.blogCalendar, 72, startY, doc.page.width - 144);
  doc.y = endY;
  doc.moveDown(0.4);
}

function renderInvestmentBenchmarks(
  doc: PDFKit.PDFDocument,
  opts: { compact?: boolean } = {},
) {
  ensureSpace(doc, 100);
  sectionHeader(doc, "Investment Benchmarks");

  doc
    .fillColor(BRAND.text)
    .font(FONTS.sans)
    .fontSize(10)
    .text(
      "Industry pricing benchmarks for the services Brex Consulting delivers. " +
        "Ranges are drawn from 2026 agency pricing surveys (Clutch, Ahrefs, Digital Applied, " +
        "and independent industry aggregators). Full source list appears in the appendix.",
      { lineGap: 3 },
    );
  doc.moveDown(0.6);

  const benchmarks = opts.compact
    ? PRICING_BENCHMARKS.filter(
        (b) =>
          b.service.includes("Blog content") ||
          b.service.includes("Fractional CMO") ||
          b.service.includes("SEO/AEO") ||
          b.service.includes("LinkedIn Ads management"),
      ).slice(0, 4)
    : PRICING_BENCHMARKS;

  for (const benchmark of benchmarks) {
    ensureSpace(doc, 56);
    const nextY = drawBenchmarkRow(
      doc,
      benchmark,
      72,
      doc.y,
      doc.page.width - 144,
    );
    doc.y = nextY + 6;
  }

  doc.moveDown(0.2);
  doc
    .fillColor(BRAND.muted)
    .font(FONTS.sansOblique)
    .fontSize(8)
    .text(
      'Ranges shown are typical retainer/project fees for mid-market agencies. ' +
        'The amber band indicates the market mean ± 15%. "BREX" tag indicates ' +
        'where Brex Consulting positions relative to the market band.',
      { lineGap: 2 },
    );
  doc.moveDown(0.5);
}

// =============================================================
// Brex vs. Market — Comparative Pricing Matrix
// =============================================================
function renderBrexPricingMatrix(
  doc: PDFKit.PDFDocument,
  opts: { compact?: boolean } = {},
) {
  const isCompact = opts.compact === true;

  // ---- Section: Bundled tier comparison ----
  ensureSpace(doc, 240);
  sectionHeader(doc, "Brex vs. Market Rate");

  doc
    .fillColor(BRAND.text)
    .font(FONTS.sans)
    .fontSize(10)
    .text(
      "Head-to-head comparison of Brex Consulting's bundled retainer tiers and per-service pricing against " +
        "mid-market industry benchmarks from 2026 fractional CMO and agency pricing surveys. Every Brex tier and " +
        "line item is set at or below the mid-market floor while maintaining senior owner-operator delivery.",
      { lineGap: 3 },
    );
  doc.moveDown(0.6);

  // Tier comparison table — 3 rows, one per tier
  const tableX = 72;
  const tableW = doc.page.width - 144;
  const rowH = 74;
  const tierColW = tableW * 0.24;
  const priceColW = tableW * 0.18;
  const industryColW = tableW * 0.28;
  const savingsColW = tableW * 0.15;
  const bundleColW = tableW * 0.15;

  // Header row
  doc
    .rect(tableX, doc.y, tableW, 22)
    .fillColor(BRAND.navy)
    .fill();
  doc
    .fillColor("#FFFFFF")
    .font(FONTS.sansBold)
    .fontSize(9);
  const hy = doc.y + 7;
  doc.text("Brex Tier", tableX + 8, hy, { width: tierColW - 16 });
  doc.text("Brex Price", tableX + tierColW, hy, { width: priceColW - 8 });
  doc.text("Industry Mid-Market", tableX + tierColW + priceColW, hy, {
    width: industryColW - 8,
  });
  doc.text("Savings vs Mid", tableX + tierColW + priceColW + industryColW, hy, {
    width: savingsColW - 8,
  });
  doc.text(
    "Bundle Savings",
    tableX + tierColW + priceColW + industryColW + savingsColW,
    hy,
    { width: bundleColW - 8 },
  );
  doc.y += 22;

  // Data rows
  for (const tier of BREX_TIERS) {
    ensureSpace(doc, rowH + 10);
    const y = doc.y;
    const industryMid = (tier.industryLow + tier.industryHigh) / 2;
    const vsMid = computeSavings(tier.monthly, industryMid);

    // Row background
    doc
      .rect(tableX, y, tableW, rowH)
      .fillColor("#FAFAFA")
      .fill();
    doc
      .rect(tableX, y, tableW, rowH)
      .strokeColor(BRAND.border)
      .lineWidth(0.5)
      .stroke();

    // Tier name + bestFor
    doc
      .fillColor(BRAND.navy)
      .font(FONTS.sansBold)
      .fontSize(11)
      .text(tier.name, tableX + 8, y + 8, { width: tierColW - 16 });
    doc
      .fillColor(BRAND.muted)
      .font(FONTS.sans)
      .fontSize(7.5)
      .text(tier.bestFor.slice(0, 100) + (tier.bestFor.length > 100 ? "…" : ""), tableX + 8, y + 24, {
        width: tierColW - 16,
        lineGap: 1,
      });

    // Brex price
    doc
      .fillColor(BRAND.accent)
      .font(FONTS.sansBold)
      .fontSize(14)
      .text(`$${tier.monthly.toLocaleString()}`, tableX + tierColW, y + 12, {
        width: priceColW - 8,
      });
    doc
      .fillColor(BRAND.muted)
      .font(FONTS.sans)
      .fontSize(8)
      .text("per month", tableX + tierColW, y + 30, { width: priceColW - 8 });

    // Industry range
    doc
      .fillColor(BRAND.text)
      .font(FONTS.sansBold)
      .fontSize(11)
      .text(
        `$${(tier.industryLow / 1000).toFixed(0)}k – $${(tier.industryHigh / 1000).toFixed(0)}k`,
        tableX + tierColW + priceColW,
        y + 12,
        { width: industryColW - 8 },
      );
    doc
      .fillColor(BRAND.muted)
      .font(FONTS.sans)
      .fontSize(8)
      .text(
        `Mid: $${(industryMid / 1000).toFixed(0)}k/mo`,
        tableX + tierColW + priceColW,
        y + 30,
        { width: industryColW - 8 },
      );

    // Savings vs mid (big green %)
    const savingsColor = vsMid.deltaPct >= 0 ? "#059669" : "#DC2626";
    doc
      .fillColor(savingsColor)
      .font(FONTS.sansBold)
      .fontSize(16)
      .text(vsMid.label, tableX + tierColW + priceColW + industryColW, y + 12, {
        width: savingsColW - 8,
      });
    doc
      .fillColor(BRAND.muted)
      .font(FONTS.sans)
      .fontSize(7.5)
      .text("vs industry mid", tableX + tierColW + priceColW + industryColW, y + 32, {
        width: savingsColW - 8,
      });

    // Bundle savings (à la carte vs bundle)
    doc
      .fillColor("#0F766E")
      .font(FONTS.sansBold)
      .fontSize(14)
      .text(
        `−${tier.discountPct}%`,
        tableX + tierColW + priceColW + industryColW + savingsColW,
        y + 14,
        { width: bundleColW - 8 },
      );
    doc
      .fillColor(BRAND.muted)
      .font(FONTS.sans)
      .fontSize(7)
      .text(
        `vs $${tier.aLaCarteMonthly.toLocaleString()} à la carte`,
        tableX + tierColW + priceColW + industryColW + savingsColW,
        y + 32,
        { width: bundleColW - 8, lineGap: 1 },
      );

    doc.y = y + rowH + 6;
  }

  doc.moveDown(0.4);

  // ---- Section 2: Line-item comparison (skip in compact) ----
  if (!isCompact) {
    ensureSpace(doc, 100);
    doc
      .fillColor(BRAND.navy)
      .font(FONTS.sansBold)
      .fontSize(13)
      .text("Per-Service Comparison", 72);
    doc.moveDown(0.3);
    doc
      .fillColor(BRAND.text)
      .font(FONTS.sans)
      .fontSize(10)
      .text(
        `Brex tactical CMO services priced at a $${BREX_BLENDED_HOURLY}/hr blended senior rate. Every line item ` +
          "below shows Brex's unbundled à la carte price against the industry mid-market benchmark for the same work.",
        { lineGap: 3 },
      );
    doc.moveDown(0.5);

    // Table header
    const lTableX = 72;
    const lTableW = doc.page.width - 144;
    const lServiceW = lTableW * 0.40;
    const lBrexW = lTableW * 0.16;
    const lIndW = lTableW * 0.22;
    const lSavW = lTableW * 0.13;
    const lPosW = lTableW * 0.09;

    doc
      .rect(lTableX, doc.y, lTableW, 20)
      .fillColor(BRAND.navy)
      .fill();
    doc
      .fillColor("#FFFFFF")
      .font(FONTS.sansBold)
      .fontSize(8.5);
    const lhy = doc.y + 6;
    doc.text("Service", lTableX + 8, lhy, { width: lServiceW - 16 });
    doc.text("Brex", lTableX + lServiceW, lhy, { width: lBrexW - 8 });
    doc.text("Industry Mid-Market", lTableX + lServiceW + lBrexW, lhy, { width: lIndW - 8 });
    doc.text("vs Mid", lTableX + lServiceW + lBrexW + lIndW, lhy, { width: lSavW - 8 });
    doc.text("Position", lTableX + lServiceW + lBrexW + lIndW + lSavW, lhy, { width: lPosW - 8 });
    doc.y += 20;

    for (let i = 0; i < BREX_LINE_ITEMS.length; i++) {
      const item = BREX_LINE_ITEMS[i];
      const lrowH = 30;
      ensureSpace(doc, lrowH + 4);
      const y = doc.y;
      const zebra = i % 2 === 0 ? "#FFFFFF" : "#F9FAFB";
      doc.rect(lTableX, y, lTableW, lrowH).fillColor(zebra).fill();
      doc
        .rect(lTableX, y, lTableW, lrowH)
        .strokeColor(BRAND.border)
        .lineWidth(0.4)
        .stroke();

      const vs = computeSavings(item.brexPrice, item.benchmarkMid);
      const posColor = positioningColor(item.positioning);

      // Service name
      doc
        .fillColor(BRAND.text)
        .font(FONTS.sansBold)
        .fontSize(8.5)
        .text(item.service, lTableX + 8, y + 6, { width: lServiceW - 16 });
      doc
        .fillColor(BRAND.muted)
        .font(FONTS.sans)
        .fontSize(7)
        .text(item.brexUnit, lTableX + 8, y + 18, { width: lServiceW - 16 });

      // Brex price
      doc
        .fillColor(BRAND.accent)
        .font(FONTS.sansBold)
        .fontSize(10)
        .text(formatBrexPrice(item.brexPrice, item.brexUnit), lTableX + lServiceW, y + 10, {
          width: lBrexW - 8,
        });

      // Industry range
      doc
        .fillColor(BRAND.text)
        .font(FONTS.sans)
        .fontSize(9)
        .text(
          `${formatBrexPrice(item.benchmarkLow, item.benchmarkUnit)} – ${formatBrexPrice(item.benchmarkHigh, item.benchmarkUnit)}`,
          lTableX + lServiceW + lBrexW,
          y + 6,
          { width: lIndW - 8 },
        );
      doc
        .fillColor(BRAND.muted)
        .font(FONTS.sans)
        .fontSize(7)
        .text(
          `Mid: ${formatBrexPrice(item.benchmarkMid, item.benchmarkUnit)}`,
          lTableX + lServiceW + lBrexW,
          y + 18,
          { width: lIndW - 8 },
        );

      // Savings %
      const savColor = vs.deltaPct >= 0 ? "#059669" : "#DC2626";
      doc
        .fillColor(savColor)
        .font(FONTS.sansBold)
        .fontSize(11)
        .text(vs.label, lTableX + lServiceW + lBrexW + lIndW, y + 10, {
          width: lSavW - 8,
        });

      // Position tag
      doc
        .fillColor(posColor.hex)
        .font(FONTS.sansBold)
        .fontSize(7)
        .text(posColor.label, lTableX + lServiceW + lBrexW + lIndW + lSavW, y + 10, {
          width: lPosW - 8,
        });

      doc.y = y + lrowH + 2;
    }

    doc.moveDown(0.4);
    doc
      .fillColor(BRAND.muted)
      .font(FONTS.sansOblique)
      .fontSize(8)
      .text(
        `Blended hourly rate: $${BREX_BLENDED_HOURLY}/hr (senior fractional CMO, mid-market band $200–$500/hr per 2026 pricing surveys). ` +
          "Bundle discounts (17% Advisor, 24% Strategist, 32% Fractional) reflect commitment and utilization efficiency.",
        { lineGap: 2 },
      );
  }

  doc.moveDown(0.5);
}

function renderSourcesAppendix(doc: PDFKit.PDFDocument) {
  doc.addPage();

  sectionHeader(doc, "Sources & Citations");

  doc
    .fillColor(BRAND.text)
    .font(FONTS.sans)
    .fontSize(10)
    .text(
      "Pricing benchmarks in this report are sourced from the following industry " +
        "surveys and pricing databases (all 2026 data unless noted).",
      { lineGap: 3 },
    );
  doc.moveDown(0.5);

  for (const source of BENCHMARK_SOURCES) {
    ensureSpace(doc, 44);

    // Publisher
    doc
      .fillColor(BRAND.accent)
      .font(FONTS.sansBold)
      .fontSize(9)
      .text(source.publisher.toUpperCase(), { characterSpacing: 1 });

    // Title
    doc
      .fillColor(BRAND.navy)
      .font(FONTS.sansBold)
      .fontSize(10)
      .text(source.title, { lineGap: 1 });

    // URL
    doc
      .fillColor(BRAND.muted)
      .font(FONTS.sans)
      .fontSize(8)
      .text(source.url, {
        link: source.url,
        underline: false,
        lineGap: 1,
      });

    doc.moveDown(0.5);
  }

  doc.moveDown(0.5);
  doc
    .fillColor(BRAND.muted)
    .font(FONTS.sansOblique)
    .fontSize(8)
    .text(
      "Benchmark data is refreshed quarterly. Contact Brex Consulting for the " +
        "latest figures on any specific service category.",
      { lineGap: 2 },
    );
}

// Note: getSource and positioningLabel are imported for future use in expanded reports.
void getSource;
void positioningLabel;

// =============================================================
// Section primitives
// =============================================================
function sectionHeader(doc: PDFKit.PDFDocument, title: string) {
  ensureSpace(doc, 60);
  doc.moveDown(0.5);

  const y = doc.y;
  doc
    .rect(72, y, 3, 20)
    .fill(BRAND.accent);

  doc
    .fillColor(BRAND.navy)
    .font(FONTS.sansBold)
    .fontSize(16)
    .text(title, 82, y + 2);

  doc.moveDown(0.5);
}

// -------- Tab-style section header (Content Studio parity) --------
// Renders a section header that visually mirrors a Content Studio tab:
// small uppercase "kind" chip on the left, big title next to it, and
// optional single-line subtitle below in muted color. Used for the
// per-tab sections (Blog / LinkedIn / Instagram / X / Meta ads / etc.)
// so the PDF reads like a tour of the on-screen tabs.
function tabHeader(
  doc: PDFKit.PDFDocument,
  title: string,
  opts: { kind?: string; subtitle?: string; newPage?: boolean } = {},
) {
  if (opts.newPage) doc.addPage();
  ensureSpace(doc, 110);
  doc.moveDown(0.5);

  const leftX = 72;
  const rightX = 540;
  const contentW = rightX - leftX;
  let cursorY = doc.y;

  // 1) Kind chip on its own line (uppercase label pill on the left, e.g. "CHANNEL", "CALENDAR", "ADS")
  if (opts.kind) {
    const kind = opts.kind.toUpperCase();
    doc.font(FONTS.sansBold).fontSize(8);
    const chipTextWidth = doc.widthOfString(kind, { characterSpacing: 1.5 });
    const chipWidth = chipTextWidth + 16;
    const chipHeight = 16;
    doc.roundedRect(leftX, cursorY, chipWidth, chipHeight, 3).fill(BRAND.accent);
    doc
      .fillColor("#FFFFFF")
      .font(FONTS.sansBold)
      .fontSize(8)
      .text(kind, leftX + 8, cursorY + 4, { characterSpacing: 1.5, lineBreak: false });
    cursorY += chipHeight + 6; // gap between chip and title
  }

  // 2) Big title on the next line (allow wrap, capture natural end)
  doc
    .fillColor(BRAND.navy)
    .font(FONTS.sansBold)
    .fontSize(22)
    .text(title, leftX, cursorY, { width: contentW, lineGap: 2 });
  cursorY = doc.y;

  // 3) Optional subtitle in muted body
  if (opts.subtitle) {
    cursorY += 2;
    doc
      .fillColor(BRAND.muted)
      .font(FONTS.sans)
      .fontSize(10.5)
      .text(opts.subtitle, leftX, cursorY, { width: contentW, lineGap: 2 });
    cursorY = doc.y;
  }

  // 4) Underline rule
  const ruleY = cursorY + 8;
  doc
    .moveTo(leftX, ruleY)
    .lineTo(rightX, ruleY)
    .lineWidth(0.75)
    .strokeColor(BRAND.border)
    .stroke();

  doc.y = ruleY + 14;
  doc.x = leftX;
}

// -------- Card box (bordered container for a piece of content) --------
// Draws a light-bordered card at the current cursor position. The caller
// passes a `body(y)` callback that renders inside the card; `cardBox`
// measures the final height by tracking doc.y and closes the border.
function cardBox(
  doc: PDFKit.PDFDocument,
  body: () => void,
  opts: { padTop?: number; padBottom?: number; minHeight?: number; ensure?: number } = {},
) {
  const padTop = opts.padTop ?? 10;
  const padBottom = opts.padBottom ?? 12;
  ensureSpace(doc, opts.ensure ?? 80);

  const leftX = 72;
  const rightX = 540;
  const width = rightX - leftX;
  const startY = doc.y;
  const innerX = leftX + 14;
  const innerWidth = width - 28;

  // Move cursor inside the card for the body
  doc.x = innerX;
  doc.y = startY + padTop;

  // Constrain wrap width for the body via a temporary text width closure
  const origWidth = (doc as any)._fontSize; // no-op sentinel
  void origWidth;

  // Render body
  body();

  const endY = Math.max(doc.y + padBottom, startY + (opts.minHeight ?? 40));

  // Draw the border around what we just wrote
  doc
    .roundedRect(leftX, startY, width, endY - startY, 6)
    .lineWidth(0.75)
    .strokeColor(BRAND.border)
    .stroke();

  // Reset cursor below the card
  doc.x = leftX;
  doc.y = endY + 8;

  return { innerX, innerWidth };
}

// -------- Small chip (inline label pill) --------
function chip(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  opts: { fill?: string; textColor?: string } = {},
): number {
  const fill = opts.fill ?? BRAND.light;
  const textColor = opts.textColor ?? BRAND.navy;
  doc.font(FONTS.sansBold).fontSize(8);
  const w = doc.widthOfString(text, { characterSpacing: 0.8 }) + 12;
  const h = 14;
  doc.roundedRect(x, y, w, h, 3).fill(fill);
  doc
    .fillColor(textColor)
    .font(FONTS.sansBold)
    .fontSize(8)
    .text(text, x + 6, y + 4, { characterSpacing: 0.8, lineBreak: false });
  return x + w + 6; // return next x cursor
}

function bodyParagraph(doc: PDFKit.PDFDocument, text: string) {
  ensureSpace(doc, 40);
  doc
    .fillColor(BRAND.text)
    .font(FONTS.sans)
    .fontSize(10.5)
    .text(text, { align: "left", lineGap: 3 });
  doc.moveDown(0.6);
}

function pillarBlock(doc: PDFKit.PDFDocument, name: string, description: string) {
  ensureSpace(doc, 60);
  doc
    .fillColor(BRAND.accent)
    .font(FONTS.sansBold)
    .fontSize(9)
    .text("PILLAR", { characterSpacing: 1.5 });

  doc
    .fillColor(BRAND.navy)
    .font(FONTS.sansBold)
    .fontSize(13)
    .text(name);

  doc
    .fillColor(BRAND.text)
    .font(FONTS.sans)
    .fontSize(10)
    .text(description, { lineGap: 2 });

  doc.moveDown(0.5);
}

function bulletList(doc: PDFKit.PDFDocument, items: string[]) {
  for (const item of items) {
    ensureSpace(doc, 20);
    doc
      .fillColor(BRAND.accent)
      .font(FONTS.sansBold)
      .fontSize(10)
      .text("•", 72, doc.y, { continued: true, indent: 0 })
      .fillColor(BRAND.text)
      .font(FONTS.sans)
      .fontSize(10)
      .text("  " + item, { lineGap: 2 });
  }
  doc.moveDown(0.5);
}

function labeled(doc: PDFKit.PDFDocument, label: string, value: string) {
  ensureSpace(doc, 30);
  doc
    .fillColor(BRAND.muted)
    .font(FONTS.sansBold)
    .fontSize(9)
    .text(label.toUpperCase(), { characterSpacing: 1.2 });

  doc
    .fillColor(BRAND.text)
    .font(FONTS.sans)
    .fontSize(10.5)
    .text(value, { lineGap: 2 });

  doc.moveDown(0.4);
}

function emailTouch(
  doc: PDFKit.PDFDocument,
  label: string,
  touch: { day: number; body: string },
) {
  ensureSpace(doc, 60);
  doc
    .fillColor(BRAND.accent)
    .font(FONTS.sansBold)
    .fontSize(10)
    .text(`${label} · Day ${touch.day}`);

  doc
    .fillColor(BRAND.text)
    .font(FONTS.sans)
    .fontSize(10)
    .text(touch.body, { lineGap: 2 });

  doc.moveDown(0.5);
}

function safe(v: unknown, fallback = ""): string {
  if (v === null || v === undefined) return fallback;
  const s = String(v);
  // Strip control chars that can trip pdfkit's PDF spec writer
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

function renderWeek(
  doc: PDFKit.PDFDocument,
  week: ContentPlanPayload["blogCalendar"][number],
  opts: { compact?: boolean } = {},
) {
  ensureSpace(doc, 80);

  doc
    .fillColor(BRAND.accent)
    .font(FONTS.sansBold)
    .fontSize(9)
    .text(`WEEK ${safe(week.weekNumber, "?")} · PUBLISHING ${safe(week.weekOf, "TBD")}`, {
      characterSpacing: 1.2,
    });

  doc.moveDown(0.2);

  for (const post of week.posts ?? []) {
    try {
      ensureSpace(doc, opts.compact ? 40 : 50);
      doc
        .fillColor(BRAND.navy)
        .font(FONTS.sansBold)
        .fontSize(10.5)
        .text(safe(post.title, "Untitled post"), { lineGap: 1 });

      doc
        .fillColor(BRAND.muted)
        .font(FONTS.sans)
        .fontSize(9)
        .text(`${safe(post.pillar, "General")}  ·  ${safe(post.scheduledDate, "TBD")}`);

      const query = safe(post.targetQuery);
      if (query) {
        doc
          .fillColor(BRAND.text)
          .font(FONTS.sansOblique)
          .fontSize(9)
          .text(`Answers: "${query}"`, { lineGap: 1 });
      }

      if (!opts.compact && post.angle) {
        doc
          .fillColor(BRAND.text)
          .font(FONTS.sans)
          .fontSize(9)
          .text(safe(post.angle), { lineGap: 1 });
      }

      doc.moveDown(0.35);
    } catch (err) {
      console.error("[pdf-export] post render failed, skipping", err);
    }
  }
  doc.moveDown(0.3);
}

function renderSocial(
  doc: PDFKit.PDFDocument,
  social: ContentPlanPayload["socialCadence"][number],
) {
  ensureSpace(doc, 60);
  doc
    .fillColor(BRAND.accent)
    .font(FONTS.sansBold)
    .fontSize(10)
    .text(`${social.channel.toUpperCase()} · ${social.postsPerWeek} posts/week`);

  for (const p of social.starterPosts ?? []) {
    ensureSpace(doc, 30);
    doc
      .fillColor(BRAND.navy)
      .font(FONTS.sansBold)
      .fontSize(10)
      .text(p.title);

    doc
      .fillColor(BRAND.text)
      .font(FONTS.sans)
      .fontSize(9.5)
      .text(p.hook, { lineGap: 1 });

    doc
      .fillColor(BRAND.muted)
      .font(FONTS.sansOblique)
      .fontSize(8.5)
      .text(`Answers: "${p.targetQuery}"`);

    doc.moveDown(0.3);
  }
  doc.moveDown(0.3);
}

function renderAdBrief(
  doc: PDFKit.PDFDocument,
  brief: ContentPlanPayload["adBrief"][number],
) {
  ensureSpace(doc, 60);
  doc
    .fillColor(BRAND.accent)
    .font(FONTS.sansBold)
    .fontSize(10)
    .text(brief.channel.replace("_", " ").toUpperCase());

  doc
    .fillColor(BRAND.text)
    .font(FONTS.sans)
    .fontSize(10)
    .text(`Audience: ${brief.audience}`, { lineGap: 1 });

  for (const c of brief.creatives ?? []) {
    ensureSpace(doc, 40);
    doc
      .fillColor(BRAND.navy)
      .font(FONTS.sansBold)
      .fontSize(10)
      .text(c.title);

    doc.fillColor(BRAND.text).font(FONTS.sans).fontSize(9.5);
    doc.text(`Angle: ${c.angle}`, { lineGap: 1 });
    doc.text(`Primary claim: ${c.primaryClaim}`, { lineGap: 1 });
    doc.text(`CTA: ${c.cta}`);
    doc.moveDown(0.3);
  }
  doc.moveDown(0.3);
}

function renderLandingPage(
  doc: PDFKit.PDFDocument,
  lp: ContentPlanPayload["landingPages"][number],
) {
  ensureSpace(doc, 60);
  doc
    .fillColor(BRAND.navy)
    .font(FONTS.sansBold)
    .fontSize(11)
    .text(lp.title);

  doc
    .fillColor(BRAND.muted)
    .font(FONTS.sans)
    .fontSize(9)
    .text(`/${lp.slug}  ·  ${lp.serviceOrProduct}`);

  doc
    .fillColor(BRAND.text)
    .font(FONTS.sansOblique)
    .fontSize(9)
    .text(`Target query: "${lp.targetQuery}"`, { lineGap: 1 });

  for (const item of lp.outline ?? []) {
    doc
      .fillColor(BRAND.text)
      .font(FONTS.sans)
      .fontSize(9.5)
      .text(`  • ${item}`, { lineGap: 1 });
  }
  doc.moveDown(0.4);
}

// ============================================================
// Tab-parity section renderers — one per Content Studio tab
// ============================================================

// -------- Blog calendar tab --------
function renderBlogCalendarTab(doc: PDFKit.PDFDocument, p: ContentPlanPayload) {
  const totalWeeks = p.blogCalendar?.length ?? 0;
  const totalPosts = (p.blogCalendar ?? []).reduce(
    (sum, w) => sum + (w.posts?.length ?? 0),
    0,
  );
  const pillars = new Set<string>();
  for (const w of p.blogCalendar ?? []) {
    for (const post of w.posts ?? []) if (post.pillar) pillars.add(post.pillar);
  }

  tabHeader(doc, "Blog calendar", {
    kind: "Calendar",
    subtitle: `${totalWeeks}-week publishing schedule · ${totalPosts} posts · ${pillars.size} content pillars`,
    newPage: true,
  });

  for (const week of p.blogCalendar ?? []) {
    try {
      renderWeek(doc, week);
    } catch (err) {
      console.error("[pdf-export] blog week render failed, skipping", err);
    }
  }
}

// -------- Channel calendar tab (LinkedIn / Instagram / X) --------
function renderChannelCalendarTab(
  doc: PDFKit.PDFDocument,
  p: ContentPlanPayload,
  channel: "linkedin" | "instagram" | "x",
) {
  const social = (p.socialCadence ?? []).find((s) => s.channel === channel);
  if (!social) return;

  const labelMap = {
    linkedin: { title: "LinkedIn", kind: "Channel" },
    instagram: { title: "Instagram", kind: "Channel" },
    x: { title: "X (Twitter)", kind: "Channel" },
  };
  const meta = labelMap[channel];
  const postCount = social.starterPosts?.length ?? 0;

  tabHeader(doc, meta.title, {
    kind: meta.kind,
    subtitle: `${social.postsPerWeek} posts/week cadence · ${postCount} starter posts ready to schedule`,
    newPage: true,
  });

  for (const post of social.starterPosts ?? []) {
    try {
      cardBox(doc, () => {
        const innerX = 86;
        const innerWidth = 440;

        // Meta row (chips)
        let chipX = innerX;
        const chipY = doc.y;
        if (post.targetPageTitle) {
          chipX = chip(doc, `› ${post.targetPageTitle}`, chipX, chipY, {
            fill: BRAND.light,
            textColor: BRAND.navy,
          });
        }
        chip(doc, meta.title.toUpperCase(), chipX, chipY, {
          fill: BRAND.accent,
          textColor: "#FFFFFF",
        });
        doc.x = innerX;
        doc.y = chipY + 22;

        // Title
        doc
          .fillColor(BRAND.navy)
          .font(FONTS.sansBold)
          .fontSize(12)
          .text(safe(post.title, "Untitled post"), innerX, doc.y, {
            width: innerWidth,
            lineGap: 1,
          });

        // Hook (main body copy)
        if (post.hook) {
          doc
            .fillColor(BRAND.text)
            .font(FONTS.sans)
            .fontSize(10)
            .text(safe(post.hook), innerX, doc.y + 2, {
              width: innerWidth,
              lineGap: 2,
            });
        }

        // Target query line
        if (post.targetQuery) {
          doc
            .fillColor(BRAND.muted)
            .font(FONTS.sansOblique)
            .fontSize(9)
            .text(`Answers: “${safe(post.targetQuery)}”`, innerX, doc.y + 4, {
              width: innerWidth,
              lineGap: 1,
            });
        }
      }, { ensure: 100 });
    } catch (err) {
      console.error(`[pdf-export] ${channel} card render failed, skipping`, err);
    }
  }
}

// -------- Ads gallery tab (Meta / LinkedIn) --------
function renderAdsGalleryTab(
  doc: PDFKit.PDFDocument,
  p: ContentPlanPayload,
  channel: "meta_ad" | "linkedin_ad",
) {
  const brief = (p.adBrief ?? []).find((b) => b.channel === channel);
  const heroAd = channel === "meta_ad" ? p.heroMetaAd : p.heroLinkedInAd;

  if (!brief && !heroAd) return;

  const meta =
    channel === "meta_ad"
      ? { title: "Meta ads", kind: "Paid", tag: "META" }
      : { title: "LinkedIn ads", kind: "Paid", tag: "LINKEDIN" };

  const creativeCount = brief?.creatives?.length ?? 0;
  const subtitle = brief?.audience
    ? `Audience: ${brief.audience} · ${creativeCount} creative concepts · 1 hero ad`
    : `${creativeCount} creative concepts`;

  tabHeader(doc, meta.title, { kind: meta.kind, subtitle, newPage: true });

  // ---- Hero ad card (full example) ----
  if (heroAd) {
    cardBox(doc, () => {
      const innerX = 86;
      const innerWidth = 440;

      // HERO badge
      const chipY = doc.y;
      let chipX = chip(doc, "HERO EXAMPLE", innerX, chipY, {
        fill: BRAND.navy,
        textColor: "#FFFFFF",
      });
      chip(doc, meta.tag, chipX, chipY, { fill: BRAND.accent, textColor: "#FFFFFF" });
      doc.x = innerX;
      doc.y = chipY + 22;

      const isMeta = channel === "meta_ad";
      const primaryLabel = isMeta ? "PRIMARY TEXT (125 CHAR)" : "INTRO TEXT (150 CHAR)";
      const primaryValue = isMeta
        ? (heroAd as any).primaryText
        : (heroAd as any).introText;

      // Headline
      doc
        .fillColor(BRAND.navy)
        .font(FONTS.sansBold)
        .fontSize(13)
        .text(safe((heroAd as any).headline), innerX, doc.y, {
          width: innerWidth,
          lineGap: 1,
        });

      // Primary/intro text
      doc
        .fillColor(BRAND.muted)
        .font(FONTS.sansBold)
        .fontSize(8)
        .text(primaryLabel, innerX, doc.y + 6, { characterSpacing: 1.2 });
      doc
        .fillColor(BRAND.text)
        .font(FONTS.sans)
        .fontSize(10)
        .text(safe(primaryValue), innerX, doc.y + 2, {
          width: innerWidth,
          lineGap: 2,
        });

      // Description
      doc
        .fillColor(BRAND.muted)
        .font(FONTS.sansBold)
        .fontSize(8)
        .text("DESCRIPTION", innerX, doc.y + 6, { characterSpacing: 1.2 });
      doc
        .fillColor(BRAND.text)
        .font(FONTS.sans)
        .fontSize(10)
        .text(safe((heroAd as any).description), innerX, doc.y + 2, {
          width: innerWidth,
          lineGap: 2,
        });

      // CTA + visual concept in one row
      const rowY = doc.y + 8;
      doc
        .fillColor(BRAND.muted)
        .font(FONTS.sansBold)
        .fontSize(8)
        .text("CTA", innerX, rowY, { characterSpacing: 1.2 });
      doc
        .fillColor(BRAND.accent)
        .font(FONTS.sansBold)
        .fontSize(11)
        .text(safe((heroAd as any).cta), innerX, doc.y + 1);

      // Visual concept
      doc
        .fillColor(BRAND.muted)
        .font(FONTS.sansBold)
        .fontSize(8)
        .text("VISUAL CONCEPT", innerX, doc.y + 6, { characterSpacing: 1.2 });
      doc
        .fillColor(BRAND.text)
        .font(FONTS.sansOblique)
        .fontSize(10)
        .text(safe((heroAd as any).visualConcept), innerX, doc.y + 2, {
          width: innerWidth,
          lineGap: 2,
        });
    }, { ensure: 260 });
  }

  // ---- Additional creatives (compact cards) ----
  if (brief?.creatives?.length) {
    doc.moveDown(0.4);
    doc
      .fillColor(BRAND.navy)
      .font(FONTS.sansBold)
      .fontSize(12)
      .text("Additional creative concepts", 72, doc.y);
    doc.moveDown(0.4);

    for (const c of brief.creatives) {
      try {
        cardBox(doc, () => {
          const innerX = 86;
          const innerWidth = 440;

          doc
            .fillColor(BRAND.navy)
            .font(FONTS.sansBold)
            .fontSize(11)
            .text(safe(c.title), innerX, doc.y, { width: innerWidth, lineGap: 1 });

          doc
            .fillColor(BRAND.muted)
            .font(FONTS.sansBold)
            .fontSize(8)
            .text("ANGLE", innerX, doc.y + 4, { characterSpacing: 1.2 });
          doc
            .fillColor(BRAND.text)
            .font(FONTS.sans)
            .fontSize(9.5)
            .text(safe(c.angle), innerX, doc.y + 1, { width: innerWidth, lineGap: 2 });

          doc
            .fillColor(BRAND.muted)
            .font(FONTS.sansBold)
            .fontSize(8)
            .text("PRIMARY CLAIM", innerX, doc.y + 4, { characterSpacing: 1.2 });
          doc
            .fillColor(BRAND.text)
            .font(FONTS.sans)
            .fontSize(9.5)
            .text(safe(c.primaryClaim), innerX, doc.y + 1, {
              width: innerWidth,
              lineGap: 2,
            });

          doc
            .fillColor(BRAND.accent)
            .font(FONTS.sansBold)
            .fontSize(10)
            .text(`CTA  ›  ${safe(c.cta)}`, innerX, doc.y + 4);
        }, { ensure: 120 });
      } catch (err) {
        console.error(`[pdf-export] ${channel} creative render failed, skipping`, err);
      }
    }
  }
}

// -------- Cold email tab --------
function renderColdEmailTab(doc: PDFKit.PDFDocument, p: ContentPlanPayload) {
  const email = p.heroColdEmail;
  if (!email) return;

  tabHeader(doc, "Cold email", {
    kind: "Sequence",
    subtitle: `3-touch sequence · ICP: ${safe(email.icpTarget)}`,
    newPage: true,
  });

  // ---- Subject line A/B test card ----
  cardBox(doc, () => {
    const innerX = 86;
    const innerWidth = 440;

    const chipY = doc.y;
    chip(doc, "SUBJECT LINE A/B TEST", innerX, chipY, {
      fill: BRAND.navy,
      textColor: "#FFFFFF",
    });
    doc.x = innerX;
    doc.y = chipY + 22;

    doc
      .fillColor(BRAND.muted)
      .font(FONTS.sansBold)
      .fontSize(8)
      .text("VARIANT A", innerX, doc.y, { characterSpacing: 1.2 });
    doc
      .fillColor(BRAND.navy)
      .font(FONTS.sansBold)
      .fontSize(12)
      .text(safe(email.subjectLineA), innerX, doc.y + 2, {
        width: innerWidth,
        lineGap: 1,
      });

    doc
      .fillColor(BRAND.muted)
      .font(FONTS.sansBold)
      .fontSize(8)
      .text("VARIANT B", innerX, doc.y + 8, { characterSpacing: 1.2 });
    doc
      .fillColor(BRAND.navy)
      .font(FONTS.sansBold)
      .fontSize(12)
      .text(safe(email.subjectLineB), innerX, doc.y + 2, {
        width: innerWidth,
        lineGap: 1,
      });
  }, { ensure: 140 });

  // ---- 3 touch cards ----
  const touches: Array<{ label: string; touch: { day: number; body: string } }> = [
    { label: "Touch 1 — opener", touch: email.touch1 },
    { label: "Touch 2 — value follow-up", touch: email.touch2 },
    { label: "Touch 3 — breakup", touch: email.touch3 },
  ];

  for (const { label, touch } of touches) {
    if (!touch) continue;
    try {
      cardBox(doc, () => {
        const innerX = 86;
        const innerWidth = 440;

        const chipY = doc.y;
        let chipX = chip(doc, `DAY ${touch.day}`, innerX, chipY, {
          fill: BRAND.accent,
          textColor: "#FFFFFF",
        });
        chip(doc, label.toUpperCase(), chipX, chipY, {
          fill: BRAND.light,
          textColor: BRAND.navy,
        });
        doc.x = innerX;
        doc.y = chipY + 22;

        doc
          .fillColor(BRAND.text)
          .font(FONTS.sans)
          .fontSize(10)
          .text(safe(touch.body), innerX, doc.y, {
            width: innerWidth,
            lineGap: 3,
          });
      }, { ensure: 140 });
    } catch (err) {
      console.error(`[pdf-export] cold email ${label} render failed`, err);
    }
  }
}

// -------- Landing pages tab --------
function renderLandingPagesTab(doc: PDFKit.PDFDocument, p: ContentPlanPayload) {
  const pages = p.landingPages ?? [];
  if (!pages.length) return;

  tabHeader(doc, "Landing pages", {
    kind: "AEO Pages",
    subtitle: `${pages.length} AEO-optimized landing page briefs — built to answer buyer questions and rank`,
    newPage: true,
  });

  for (const lp of pages) {
    try {
      cardBox(doc, () => {
        const innerX = 86;
        const innerWidth = 440;

        const chipY = doc.y;
        let chipX = chip(doc, `/${safe(lp.slug)}`, innerX, chipY, {
          fill: BRAND.navy,
          textColor: "#FFFFFF",
        });
        chip(doc, safe(lp.serviceOrProduct).toUpperCase(), chipX, chipY, {
          fill: BRAND.light,
          textColor: BRAND.navy,
        });
        doc.x = innerX;
        doc.y = chipY + 22;

        // Title
        doc
          .fillColor(BRAND.navy)
          .font(FONTS.sansBold)
          .fontSize(14)
          .text(safe(lp.title), innerX, doc.y, { width: innerWidth, lineGap: 1 });

        // Target query
        doc
          .fillColor(BRAND.muted)
          .font(FONTS.sansBold)
          .fontSize(8)
          .text("TARGET AEO QUERY", innerX, doc.y + 6, { characterSpacing: 1.2 });
        doc
          .fillColor(BRAND.text)
          .font(FONTS.sansOblique)
          .fontSize(10)
          .text(`“${safe(lp.targetQuery)}”`, innerX, doc.y + 1, {
            width: innerWidth,
            lineGap: 2,
          });

        // Outline
        doc
          .fillColor(BRAND.muted)
          .font(FONTS.sansBold)
          .fontSize(8)
          .text("PAGE OUTLINE", innerX, doc.y + 6, { characterSpacing: 1.2 });
        for (const item of lp.outline ?? []) {
          doc
            .fillColor(BRAND.text)
            .font(FONTS.sans)
            .fontSize(10)
            .text(`• ${safe(item)}`, innerX, doc.y + 1, {
              width: innerWidth,
              lineGap: 2,
            });
        }
      }, { ensure: 180 });
    } catch (err) {
      console.error("[pdf-export] landing page card render failed", err);
    }
  }
}

function renderFooter(
  doc: PDFKit.PDFDocument,
  clientName: string,
  pageNum: number,
  total: number,
) {
  const { width, height } = doc.page;
  const y = height - 40;

  // Save current auto-pagination behavior and disable it so footer text
  // written in the bottom margin doesn't accidentally trigger a new page.
  const originalBottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;

  // Divider
  doc
    .moveTo(72, y)
    .lineTo(width - 72, y)
    .strokeColor(BRAND.border)
    .lineWidth(0.5)
    .stroke();

  doc
    .fillColor(BRAND.muted)
    .font(FONTS.sans)
    .fontSize(8)
    .text(`Brex Consulting  ·  ${clientName} content plan`, 72, y + 8, {
      align: "left",
      lineBreak: false,
    });

  doc
    .fillColor(BRAND.muted)
    .font(FONTS.sans)
    .fontSize(8)
    .text(`${pageNum} / ${total}`, width - 172, y + 8, {
      width: 100,
      align: "right",
      lineBreak: false,
    });

  // Restore
  doc.page.margins.bottom = originalBottom;
}

// Add a new page if fewer than N points remain
function ensureSpace(doc: PDFKit.PDFDocument, needed: number) {
  const remaining = doc.page.height - doc.page.margins.bottom - doc.y;
  if (remaining < needed) {
    doc.addPage();
  }
}

// =============================================================
// ROI Projections section
// =============================================================
function renderRoiSection(
  doc: PDFKit.PDFDocument,
  p: ContentPlanPayload,
  opts: { compact: boolean },
) {
  const roi = p.roiProjections;
  if (!roi) return;

  const { assumptions, outcomes, monthlyProjection } = roi;

  // Always start ROI on a fresh page for a clean spread
  doc.addPage();

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const leftMargin = doc.page.margins.left;

  // Section header with amber slash
  const headerY = doc.y;
  doc.rect(leftMargin, headerY, 4, 22).fill(BRAND.accent);
  doc
    .fillColor(BRAND.navy)
    .font(FONTS.sansBold)
    .fontSize(18)
    .text("12-Month ROI Projections", leftMargin + 14, headerY, { characterSpacing: 0.5, lineBreak: false });
  doc.y = headerY + 28;
  doc
    .fillColor(BRAND.muted)
    .font(FONTS.sansOblique)
    .fontSize(9)
    .text(
      "Conservative projections modeled from client-specific assumptions inferred by our analysis.",
      leftMargin,
      doc.y,
      { width: pageWidth },
    );
  doc.moveDown(1.0);

  // ---- Headline stat cards (2x2 grid) ----
  const cardW = (pageWidth - 12) / 2;
  const cardH = 62;
  const rowTopY = doc.y;

  const cards = [
    {
      label: "Total Revenue (12mo)",
      value: formatUsdForPdf(outcomes.totalRevenue),
      sub: `${outcomes.totalClosedWon} closed-won deals`,
      color: BRAND.navy,
    },
    {
      label: "ROI Multiple",
      value: `${outcomes.roiMultiple}x`,
      sub: "Gross profit / program cost",
      color: BRAND.accent,
      highlight: true,
    },
    {
      label: "Cost per Lead",
      value: formatUsdForPdf(outcomes.brexCostPerLead),
      sub: `vs ${formatUsdForPdf(assumptions.paidCacBaseline)} paid`,
      color: BRAND.navy,
    },
    {
      label: "Payback",
      value: outcomes.paybackMonth ? `Month ${outcomes.paybackMonth}` : ">12 months",
      sub: "Cumulative profit meets cost",
      color: "#065F46",
    },
  ];

  cards.forEach((card, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cx = leftMargin + col * (cardW + 12);
    const cy = rowTopY + row * (cardH + 8);

    // Card background
    doc
      .rect(cx, cy, cardW, cardH)
      .fillColor(card.highlight ? "#FFFBEB" : "#FAFAFA")
      .fill();
    doc
      .rect(cx, cy, cardW, cardH)
      .strokeColor(card.highlight ? BRAND.accent : BRAND.border)
      .lineWidth(card.highlight ? 1.5 : 0.5)
      .stroke();

    // Label
    doc
      .fillColor(BRAND.muted)
      .font(FONTS.sansBold)
      .fontSize(8)
      .text(card.label.toUpperCase(), cx + 12, cy + 10, {
        width: cardW - 24,
        characterSpacing: 0.8,
        lineBreak: false,
      });

    // Value
    doc
      .fillColor(card.color)
      .font(FONTS.serif)
      .fontSize(22)
      .text(card.value, cx + 12, cy + 22, {
        width: cardW - 24,
        lineBreak: false,
      });

    // Sub
    doc
      .fillColor(BRAND.muted)
      .font(FONTS.sans)
      .fontSize(8)
      .text(card.sub, cx + 12, cy + 48, { width: cardW - 24, lineBreak: false });
  });

  doc.y = rowTopY + 2 * cardH + 8 + 20;

  // ---- Chart 1: Traffic curve ----
  ensureSpace(doc, 190);
  doc
    .fillColor(BRAND.text)
    .font(FONTS.sansBold)
    .fontSize(11)
    .text("Organic Traffic & Lead Growth", leftMargin, doc.y);
  doc
    .fillColor(BRAND.muted)
    .font(FONTS.sans)
    .fontSize(8)
    .text("Monthly visitors and leads as SEO/AEO posts mature", leftMargin, doc.y + 2);
  doc.moveDown(1.0);

  const xLabels = monthlyProjection.map((m) => `M${m.month}`);
  const visitorsSeries = {
    label: "Monthly visitors",
    color: BRAND.navy,
    values: monthlyProjection.map((m) => m.monthlyVisitors),
  };
  const leadsSeries = {
    label: "Monthly leads",
    color: BRAND.accent,
    values: monthlyProjection.map((m) => m.monthlyLeads),
  };
  drawTwoSeriesLine(
    doc,
    leftMargin,
    doc.y,
    pageWidth,
    140,
    visitorsSeries,
    leadsSeries,
    "num",
    xLabels,
  );
  doc.y += 155;

  // ---- Chart 2: Payback timeline ----
  ensureSpace(doc, 190);
  doc
    .fillColor(BRAND.text)
    .font(FONTS.sansBold)
    .fontSize(11)
    .text("Payback Timeline", leftMargin, doc.y);
  doc
    .fillColor(BRAND.muted)
    .font(FONTS.sans)
    .fontSize(8)
    .text("Cumulative gross profit vs cumulative program cost", leftMargin, doc.y + 2);
  doc.moveDown(1.0);

  const monthlyProgramCost = assumptions.programCost12Mo / 12;
  const profitSeries = {
    label: "Cumulative gross profit",
    color: BRAND.accent,
    values: monthlyProjection.map((m) => m.cumulativeGrossProfit),
  };
  const costSeries = {
    label: "Cumulative program cost",
    color: BRAND.navy,
    values: monthlyProjection.map((m) => monthlyProgramCost * m.month),
    dashed: true,
  };
  drawTwoSeriesLine(
    doc,
    leftMargin,
    doc.y,
    pageWidth,
    140,
    profitSeries,
    costSeries,
    "usd",
    xLabels,
    outcomes.paybackMonth ?? undefined,
  );
  doc.y += 155;

  // For compact (executive summary), stop here after headline + two charts
  if (opts.compact) {
    doc.moveDown(0.5);
    doc
      .fillColor(BRAND.muted)
      .font(FONTS.sansOblique)
      .fontSize(7.5)
      .text(roi.disclaimer, leftMargin, doc.y, { width: pageWidth, align: "left" });
    return;
  }

  // ---- Chart 3: Funnel ----
  doc.addPage();
  doc
    .fillColor(BRAND.text)
    .font(FONTS.sansBold)
    .fontSize(11)
    .text("12-Month Conversion Funnel", leftMargin, doc.y);
  doc
    .fillColor(BRAND.muted)
    .font(FONTS.sans)
    .fontSize(8)
    .text("Visitors to Leads to MQLs to SQLs to Closed Won", leftMargin, doc.y + 2);
  doc.moveDown(1.5);

  const funnelStages = [
    { label: "Visitors", value: outcomes.month12CumulativeVisitors, color: BRAND.navy },
    { label: "Leads", value: outcomes.totalLeads, color: "#1E3A5F" },
    { label: "MQLs", value: outcomes.totalMqls, color: "#2C5C8A" },
    { label: "SQLs", value: outcomes.totalSqls, color: BRAND.accent },
    { label: "Closed Won", value: outcomes.totalClosedWon, color: "#065F46" },
  ];
  const funnelEndY = drawFunnelBars(doc, leftMargin, doc.y, pageWidth, funnelStages);
  doc.y = funnelEndY + 12;

  // ---- Chart 4: Cost comparison ----
  ensureSpace(doc, 180);
  doc
    .fillColor(BRAND.text)
    .font(FONTS.sansBold)
    .fontSize(11)
    .text("Program Cost vs Paid Media Equivalent", leftMargin, doc.y);
  doc
    .fillColor(BRAND.muted)
    .font(FONTS.sans)
    .fontSize(8)
    .text(
      `What paid media would cost to generate ${outcomes.totalLeads.toLocaleString()} leads over 12 months`,
      leftMargin,
      doc.y + 2,
    );
  doc.moveDown(1.2);

  drawCostCompareBars(
    doc,
    leftMargin,
    doc.y,
    pageWidth,
    120,
    [
      { label: "Brex program", value: assumptions.programCost12Mo, color: BRAND.accent },
      { label: "Equivalent paid CPL", value: outcomes.paidEquivalentCost, color: BRAND.navy },
    ],
  );
  doc.y += 130;

  // Savings callout box
  doc
    .rect(leftMargin, doc.y, pageWidth, 30)
    .fillColor("#ECFDF5")
    .fill();
  doc
    .rect(leftMargin, doc.y, 4, 30)
    .fillColor("#065F46")
    .fill();
  doc
    .fillColor("#065F46")
    .font(FONTS.sansBold)
    .fontSize(10)
    .text(
      `Savings vs Paid: ${formatUsdForPdf(outcomes.savingsVsPaid)} over 12 months`,
      leftMargin + 12,
      doc.y + 6,
      { lineBreak: false },
    );
  doc
    .fillColor("#047857")
    .font(FONTS.sans)
    .fontSize(8)
    .text(
      "Content-generated leads compound; paid stops when spend stops.",
      leftMargin + 12,
      doc.y + 20,
      { lineBreak: false },
    );
  doc.y += 42;

  // ---- Assumptions & rationale block ----
  doc.addPage();
  doc
    .fillColor(BRAND.text)
    .font(FONTS.sansBold)
    .fontSize(11)
    .text("Underlying Assumptions", leftMargin, doc.y);
  doc.moveDown(0.6);

  const assumptionRows = [
    ["Avg deal size", `${formatUsdForPdf(assumptions.avgDealSize)} (${assumptions.dealType})`],
    ["Gross margin", `${(assumptions.grossMargin * 100).toFixed(0)}%`],
    ["Sales cycle", `${assumptions.salesCycleDays} days`],
    ["Visitor to Lead", `${(assumptions.visitorToLeadRate * 100).toFixed(2)}%`],
    ["Lead to MQL", `${(assumptions.leadToMqlRate * 100).toFixed(0)}%`],
    ["MQL to SQL", `${(assumptions.mqlToSqlRate * 100).toFixed(0)}%`],
    ["SQL to Won", `${(assumptions.sqlToWonRate * 100).toFixed(0)}%`],
    ["Visitors / post / mo", `${assumptions.monthlyVisitorsPerPost}`],
    ["Months to rank", `${assumptions.monthsToRank}`],
    ["Program cost (12mo)", `${formatUsdForPdf(assumptions.programCost12Mo)}`],
    ["Paid CPL benchmark", `${formatUsdForPdf(assumptions.paidCacBaseline)}`],
  ];

  const rowH = 18;
  const col1W = (pageWidth - 12) / 2;
  const gridBaseY = doc.y;
  assumptionRows.forEach((r, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cx = leftMargin + col * (col1W + 12);
    const cy = gridBaseY + row * rowH;
    // Row divider (thin)
    doc
      .strokeColor(BRAND.border)
      .lineWidth(0.4)
      .moveTo(cx, cy + rowH - 2)
      .lineTo(cx + col1W, cy + rowH - 2)
      .stroke();
    doc
      .fillColor(BRAND.muted)
      .font(FONTS.sans)
      .fontSize(9)
      .text(r[0], cx, cy + 4, { width: col1W * 0.6, lineBreak: false });
    doc
      .fillColor(BRAND.text)
      .font(FONTS.sansBold)
      .fontSize(9)
      .text(r[1], cx + col1W * 0.6, cy + 4, { width: col1W * 0.4, align: "right", lineBreak: false });
  });
  const rowsNeeded = Math.ceil(assumptionRows.length / 2);
  doc.y = gridBaseY + rowsNeeded * rowH + 14;

  // Rationale text
  doc
    .fillColor(BRAND.text)
    .font(FONTS.sansBold)
    .fontSize(10)
    .text("Why these numbers", leftMargin, doc.y);
  doc.moveDown(0.4);
  const rationale = [
    ["Deal size", assumptions.rationale.dealSize],
    ["Conversion rates", assumptions.rationale.conversionRates],
    ["Traffic ramp", assumptions.rationale.trafficRamp],
    ["Program cost", assumptions.rationale.programCost],
  ];
  rationale.forEach(([label, text]) => {
    doc
      .fillColor(BRAND.text)
      .font(FONTS.sansBold)
      .fontSize(8.5)
      .text(`${label}: `, leftMargin, doc.y, { continued: true });
    doc
      .fillColor(BRAND.muted)
      .font(FONTS.sans)
      .fontSize(8.5)
      .text(text, { width: pageWidth });
    doc.moveDown(0.25);
  });

  doc.moveDown(0.8);
  doc
    .fillColor(BRAND.muted)
    .font(FONTS.sansOblique)
    .fontSize(7.5)
    .text(roi.disclaimer, leftMargin, doc.y, { width: pageWidth, align: "left" });
}

function formatUsdForPdf(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

// =============================================================
// Strategic Frameworks — SWOT + PESTEL + Porter's Five Forces
// =============================================================
function renderFrameworksSection(
  doc: PDFKit.PDFDocument,
  ctx: {
    swot?: SwotAnalysis | null;
    pestel?: PestelAnalysis | null;
    porters?: PortersFiveForces | null;
  },
) {
  const { swot, pestel, porters } = ctx;

  // Section title page
  doc.addPage();
  doc.fillColor(BRAND.navy).font(FONTS.serif).fontSize(28)
    .text("Strategic Frameworks", 72, 100);
  doc.moveTo(72, doc.y + 8).lineTo(200, doc.y + 8).lineWidth(2).stroke(BRAND.accent);
  doc.moveDown(1);
  doc.fillColor(BRAND.muted).font(FONTS.sans).fontSize(11)
    .text(
      "The following frameworks ground every strategic recommendation in this report. SWOT is derived from the client's own site and competitive teardown. PESTEL and Porter's Five Forces cite external, industry-current sources.",
      72,
      doc.y,
      { width: 470, lineGap: 3 },
    );

  if (swot) renderSwotPdf(doc, swot);
  if (pestel) renderPestelPdf(doc, pestel);
  if (porters) renderPortersPdf(doc, porters);
}

function renderSwotPdf(doc: PDFKit.PDFDocument, swot: SwotAnalysis) {
  doc.addPage();
  doc.fillColor(BRAND.navy).font(FONTS.serif).fontSize(20).text("SWOT Analysis", 72, 72);
  doc.fillColor(BRAND.muted).font(FONTS.sansOblique).fontSize(9)
    .text(`Industry context: ${swot.industry}`, 72, doc.y + 2);

  if (swot.summary) {
    doc.moveDown(0.6);
    doc.fillColor("#0F766E").font(FONTS.sansBold).fontSize(8)
      .text("STRATEGIC READ", 72, doc.y);
    doc.moveDown(0.2);
    doc.fillColor(BRAND.text).font(FONTS.sans).fontSize(10)
      .text(swot.summary, 72, doc.y, { width: 468, lineGap: 2 });
  }

  // Four full-width stacked sections — no fixed cells, no clipping.
  // Reflows across pages naturally without abandoning columns mid-quadrant.
  doc.moveDown(1);
  renderSwotSection(doc, "STRENGTHS", "#059669", swot.strengths);
  renderSwotSection(doc, "WEAKNESSES", "#DC2626", swot.weaknesses);
  renderSwotSection(doc, "OPPORTUNITIES", "#0284C7", swot.opportunities);
  renderSwotSection(doc, "THREATS", "#B45309", swot.threats);
}

function renderSwotSection(
  doc: PDFKit.PDFDocument,
  label: string,
  color: string,
  items: { id: string; title: string; evidence: string }[],
) {
  if (!items || items.length === 0) return;

  // Section header — always fits, will page-break if needed
  if (doc.y > 700) doc.addPage();

  const headerY = doc.y;
  const headerW = 468;
  const headerH = 22;
  doc.rect(72, headerY, headerW, headerH).fill(color);
  doc.fillColor("#FFFFFF").font(FONTS.sansBold).fontSize(10)
    .text(label, 82, headerY + 6);
  doc.y = headerY + headerH + 8;

  items.forEach((item) => {
    if (doc.y > 720) doc.addPage();

    // ID chip + title on one line
    const itemY = doc.y;
    doc.fillColor(color).font(FONTS.sansBold).fontSize(9)
      .text(item.id, 72, itemY, { continued: false });
    doc.fillColor(BRAND.text).font(FONTS.sansBold).fontSize(10)
      .text(item.title, 100, itemY - 1, { width: 440, lineGap: 1 });

    // Evidence beneath
    if (item.evidence) {
      doc.moveDown(0.15);
      doc.fillColor(BRAND.muted).font(FONTS.sans).fontSize(9)
        .text(item.evidence, 100, doc.y, { width: 440, lineGap: 2 });
    }
    doc.moveDown(0.5);
  });

  doc.moveDown(0.5);
}

function renderPestelPdf(doc: PDFKit.PDFDocument, pestel: PestelAnalysis) {
  doc.addPage();
  doc.fillColor(BRAND.navy).font(FONTS.serif).fontSize(20).text("PESTEL Analysis", 72, 72);
  doc.fillColor(BRAND.muted).font(FONTS.sansOblique).fontSize(9)
    .text(`Industry context: ${pestel.industry} · 2025–2026 sources`, 72, doc.y + 2);

  if (pestel.summary) {
    doc.moveDown(0.6);
    doc.fillColor("#0F766E").font(FONTS.sansBold).fontSize(8).text("MACRO THEME", 72, doc.y);
    doc.moveDown(0.2);
    doc.fillColor(BRAND.text).font(FONTS.sans).fontSize(10)
      .text(pestel.summary, 72, doc.y, { width: 468, lineGap: 2 });
  }
  doc.moveDown(0.8);

  const factors: Array<{ key: string; label: string }> = [
    { key: "political", label: "Political & Regulatory" },
    { key: "economic", label: "Economic" },
    { key: "social", label: "Social & Demographic" },
    { key: "technological", label: "Technological" },
    { key: "environmental", label: "Environmental & ESG" },
    { key: "legal", label: "Legal & Compliance" },
  ];

  factors.forEach((f) => {
    const findings = pestel.findings.filter((x) => x.factor === (f.key as any));
    if (!findings.length) return;
    if (doc.y > 680) doc.addPage();

    doc.fillColor(BRAND.accent).font(FONTS.sansBold).fontSize(9).text(f.label.toUpperCase(), 72, doc.y);
    doc.moveDown(0.2);

    findings.forEach((finding) => {
      if (doc.y > 700) doc.addPage();
      const impactColor =
        finding.impact === "positive" ? "#059669" : finding.impact === "negative" ? "#DC2626" : "#6B7280";

      doc.fillColor(impactColor).font(FONTS.sansBold).fontSize(8)
        .text(`${finding.id} · ${finding.impact.toUpperCase()} · ${horizonLabel(finding.timeHorizon)}`, 72, doc.y);
      doc.moveDown(0.15);
      doc.fillColor(BRAND.text).font(FONTS.sans).fontSize(10)
        .text(finding.insight, 72, doc.y, { width: 468, lineGap: 2 });

      // Sources as small pill list
      if (finding.sources && finding.sources.length > 0) {
        doc.moveDown(0.2);
        finding.sources.forEach((s, i) => {
          const label = s.publisher || domainFromPdfUrl(s.url);
          const shortUrl = truncateUrl(s.url, 60);
          doc.fillColor("#0F766E").font(FONTS.sansBold).fontSize(7).text(`  › ${label}`, 72, doc.y, { continued: true });
          doc.fillColor(BRAND.muted).font(FONTS.sans).fontSize(7).text(` — ${shortUrl}`, {
            link: s.url,
            underline: false,
          });
        });
      }
      doc.moveDown(0.4);
    });
    doc.moveDown(0.3);
  });
}

function renderPortersPdf(doc: PDFKit.PDFDocument, porters: PortersFiveForces) {
  doc.addPage();
  doc.fillColor(BRAND.navy).font(FONTS.serif).fontSize(20).text("Porter's Five Forces", 72, 72);
  doc.fillColor(BRAND.muted).font(FONTS.sansOblique).fontSize(9)
    .text(`Industry context: ${porters.industry} · 2025–2026 sources`, 72, doc.y + 2);

  if (porters.overallStructure) {
    doc.moveDown(0.6);
    doc.fillColor("#0F766E").font(FONTS.sansBold).fontSize(8).text("INDUSTRY STRUCTURE", 72, doc.y);
    doc.moveDown(0.15);
    doc.fillColor(BRAND.text).font(FONTS.sans).fontSize(10)
      .text(porters.overallStructure, 72, doc.y, { width: 468, lineGap: 2 });
  }
  if (porters.summary) {
    doc.moveDown(0.4);
    doc.fillColor("#0F766E").font(FONTS.sansBold).fontSize(8).text("DECISIVE FORCE", 72, doc.y);
    doc.moveDown(0.15);
    doc.fillColor(BRAND.text).font(FONTS.sans).fontSize(10)
      .text(porters.summary, 72, doc.y, { width: 468, lineGap: 2 });
  }
  doc.moveDown(0.8);

  const forceLabels: Record<string, string> = {
    rivalry: "Competitive Rivalry",
    newEntrants: "Threat of New Entrants",
    substitutes: "Threat of Substitutes",
    buyerPower: "Buyer Power",
    supplierPower: "Supplier Power",
  };

  porters.forces.forEach((f) => {
    if (doc.y > 640) doc.addPage();

    const intensityColor =
      f.intensity === "high" ? "#DC2626" : f.intensity === "medium" ? "#B45309" : "#059669";

    // Header row — capture Y BEFORE any drawing (PDFKit's .fill() does not
    // advance the text cursor, and doc.y after chained rect/fill/stroke is
    // unreliable). Pin everything with explicit coordinates, then advance
    // the text cursor past the header rectangle when we're done.
    const headerY = doc.y;
    const headerH = 22;
    doc.rect(72, headerY, 468, headerH).fillColor("#F9FAFB").fill();
    doc.rect(72, headerY, 468, headerH).strokeColor(BRAND.border).lineWidth(0.5).stroke();
    doc.fillColor(BRAND.navy).font(FONTS.sansBold).fontSize(11)
      .text(`${f.id}  ·  ${forceLabels[f.force] ?? f.force}`, 82, headerY + 6, { lineBreak: false });
    doc.fillColor(intensityColor).font(FONTS.sansBold).fontSize(9)
      .text(f.intensity.toUpperCase(), 460, headerY + 7, { width: 70, align: "right", lineBreak: false });

    // Move cursor below header rectangle before drawing body text.
    doc.y = headerY + headerH + 6;
    doc.fillColor(BRAND.text).font(FONTS.sans).fontSize(10)
      .text(f.rationale, 82, doc.y, { width: 458, lineGap: 2 });

    if (f.drivers && f.drivers.length) {
      doc.moveDown(0.3);
      doc.fillColor(BRAND.accent).font(FONTS.sansBold).fontSize(8).text("KEY DRIVERS", 82, doc.y);
      doc.moveDown(0.1);
      f.drivers.forEach((d) => {
        doc.fillColor(BRAND.text).font(FONTS.sans).fontSize(9)
          .text(`  › ${d}`, 82, doc.y, { width: 458, lineGap: 1.5 });
      });
    }

    if (f.sources && f.sources.length) {
      doc.moveDown(0.3);
      doc.fillColor("#0F766E").font(FONTS.sansBold).fontSize(8).text("SOURCES", 82, doc.y);
      doc.moveDown(0.1);
      f.sources.forEach((s) => {
        const label = s.publisher || domainFromPdfUrl(s.url);
        const shortUrl = truncateUrl(s.url, 70);
        doc.fillColor("#0F766E").font(FONTS.sansBold).fontSize(7).text(`  › ${label}`, 82, doc.y, { continued: true });
        doc.fillColor(BRAND.muted).font(FONTS.sans).fontSize(7).text(` — ${shortUrl}`, {
          link: s.url,
          underline: false,
        });
      });
    }
    doc.moveDown(0.7);
  });
}

function horizonLabel(h: string): string {
  if (h === "near") return "<12 MO";
  if (h === "long") return "3+ YR";
  return "12-36 MO";
}

function domainFromPdfUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function truncateUrl(url: string, max: number): string {
  return url.length > max ? url.slice(0, max - 1) + "…" : url;
}

// =============================================================
// Site Architecture (SEO/GEO) section
// =============================================================

const SITEMAP_TYPE_ORDER: SitemapPageType[] = [
  "home",
  "about",
  "service",
  "solution",
  "why-us",
  "pricing",
  "comparison",
  "case-study",
  "resources",
  "faq",
  "blog-hub",
  "contact",
  "local-hub",
  "local-location",
];

const SITEMAP_TYPE_LABELS: Record<SitemapPageType, string> = {
  home: "Home",
  about: "About",
  service: "Services",
  solution: "Solutions & Industries",
  "why-us": "Why Us",
  pricing: "Pricing",
  comparison: "Comparison pages",
  "case-study": "Case studies",
  resources: "Resources",
  faq: "FAQ",
  "blog-hub": "Blog",
  contact: "Contact",
  "local-hub": "City hub (Local SEO)",
  "local-location": "Location pages (Local SEO)",
};

// Amber-family intent chips consistent with the app UI
const SITEMAP_INTENT_COLOR: Record<string, { fill: string; text: string; border: string }> = {
  informational: { fill: "#DBEAFE", text: "#1E3A8A", border: "#BFDBFE" },
  navigational: { fill: "#F1F5F9", text: "#0F172A", border: "#E2E8F0" },
  commercial: { fill: "#FEF3C7", text: "#78350F", border: "#FDE68A" },
  transactional: { fill: "#D1FAE5", text: "#064E3B", border: "#A7F3D0" },
};

function renderSitemapSection(
  doc: PDFKit.PDFDocument,
  p: ContentPlanPayload,
  opts: { compact: boolean },
) {
  const sitemap = p.sitemap;
  if (!sitemap || !Array.isArray(sitemap.pages) || sitemap.pages.length === 0) return;

  // Always start on a fresh page for a clean spread
  doc.addPage();

  const leftMargin = doc.page.margins.left;
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  // ---- Section header (matches ROI section styling) ----
  const headerY = doc.y;
  doc.rect(leftMargin, headerY, 4, 22).fill(BRAND.accent);
  doc
    .fillColor(BRAND.navy)
    .font(FONTS.sansBold)
    .fontSize(18)
    .text("SEO / GEO Site Architecture", leftMargin + 14, headerY, {
      characterSpacing: 0.5,
      lineBreak: false,
    });
  doc.y = headerY + 28;

  doc
    .fillColor(BRAND.muted)
    .font(FONTS.sansOblique)
    .fontSize(9)
    .text(
      "Pillar + spoke architecture with per-page briefs, GEO answer blocks, and bidirectional linking to the blog and social calendar.",
      leftMargin,
      doc.y,
      { width: pageWidth },
    );
  doc.moveDown(0.6);

  // ---- Overview paragraph ----
  if (sitemap.overview) {
    bodyParagraph(doc, safe(sitemap.overview));
  }

  // ---- Stat block ----
  {
    const y = doc.y;
    const nextY = drawStatBlock(
      doc,
      [
        { value: String(sitemap.totalPages ?? sitemap.pages.length), label: "Total pages" },
        {
          value: String(sitemap.linkingSummary?.totalInternalLinks ?? 0),
          label: "Internal links",
        },
        {
          value: String(sitemap.linkingSummary?.blogsLinked ?? 0),
          label: "Blogs linked",
        },
        {
          value: String(sitemap.linkingSummary?.socialsLinked ?? 0),
          label: "Socials linked",
        },
      ],
      leftMargin,
      y,
      pageWidth,
    );
    doc.y = nextY;
    doc.moveDown(0.5);
  }

  // ---- Orphan warning ----
  const orphans = sitemap.linkingSummary?.orphanPages ?? [];
  if (orphans.length > 0) {
    ensureSpace(doc, 60);
    const y = doc.y;
    doc
      .rect(leftMargin, y, pageWidth, 44)
      .fillOpacity(1)
      .fillAndStroke("#FEF3C7", "#FDE68A");
    doc
      .fillColor("#78350F")
      .font(FONTS.sansBold)
      .fontSize(9)
      .text(`${orphans.length} ORPHAN PAGE${orphans.length === 1 ? "" : "S"}`, leftMargin + 10, y + 8, {
        characterSpacing: 1.2,
      });
    doc
      .fillColor("#78350F")
      .font(FONTS.sans)
      .fontSize(9)
      .text(
        "These pages have no inbound blog or social links. Rerun Refresh links to reassign content.",
        leftMargin + 10,
        y + 22,
        { width: pageWidth - 20 },
      );
    doc.y = y + 52;
    doc.moveDown(0.3);
  }

  // ---- Local SEO card ----
  if (sitemap.local?.guidance) {
    ensureSpace(doc, 80);
    const y = doc.y;
    const barColor = sitemap.local.included ? BRAND.accent : BRAND.border;
    doc.rect(leftMargin, y, 3, 60).fill(barColor);
    doc
      .fillColor(BRAND.muted)
      .font(FONTS.sansBold)
      .fontSize(9)
      .text("LOCAL SEO", leftMargin + 12, y + 2, { characterSpacing: 1.2 });
    doc
      .fillColor(BRAND.navy)
      .font(FONTS.sansBold)
      .fontSize(12)
      .text(
        sitemap.local.included ? "Included in this build" : "Not applicable",
        leftMargin + 12,
        y + 16,
      );
    doc
      .fillColor(BRAND.text)
      .font(FONTS.sans)
      .fontSize(9.5)
      .text(safe(sitemap.local.guidance), leftMargin + 12, y + 32, {
        width: pageWidth - 20,
        lineGap: 2,
      });
    doc.y = Math.max(doc.y, y + 68);
    doc.moveDown(0.4);
    if (sitemap.local.included && sitemap.local.serviceAreas?.length) {
      labeled(doc, "Service areas", sitemap.local.serviceAreas.join(" · "));
    }
  }

  // ---- Group + render pages ----
  const byType: Partial<Record<SitemapPageType, SitemapPageBrief[]>> = {};
  for (const pg of sitemap.pages) {
    const t = (pg.pageType ?? "service") as SitemapPageType;
    if (!byType[t]) byType[t] = [];
    byType[t]!.push(pg);
  }
  const orphanSet = new Set(orphans);

  for (const type of SITEMAP_TYPE_ORDER) {
    const pages = byType[type];
    if (!pages || pages.length === 0) continue;

    // Group header
    ensureSpace(doc, 40);
    doc.moveDown(0.4);
    const gY = doc.y;
    doc
      .fillColor(BRAND.navy)
      .font(FONTS.sansBold)
      .fontSize(12)
      .text(SITEMAP_TYPE_LABELS[type], leftMargin, gY, { continued: true });
    doc
      .fillColor(BRAND.muted)
      .font(FONTS.sans)
      .fontSize(10)
      .text(`  ·  ${pages.length} page${pages.length === 1 ? "" : "s"}`);
    // Underline the group
    doc
      .strokeColor(BRAND.border)
      .lineWidth(0.5)
      .moveTo(leftMargin, doc.y + 2)
      .lineTo(leftMargin + pageWidth, doc.y + 2)
      .stroke();
    doc.moveDown(0.5);

    for (const page of pages) {
      if (opts.compact) {
        renderSitemapPageCompact(doc, page, orphanSet.has(page.id), leftMargin, pageWidth);
      } else {
        renderSitemapPageFull(doc, page, orphanSet.has(page.id), leftMargin, pageWidth);
      }
    }
  }
}

function renderSitemapPageCompact(
  doc: PDFKit.PDFDocument,
  page: SitemapPageBrief,
  isOrphan: boolean,
  leftMargin: number,
  pageWidth: number,
) {
  ensureSpace(doc, 34);
  const y = doc.y;

  // Reserve right rail for the intent chip; wrap title in the remainder.
  const intentColor =
    SITEMAP_INTENT_COLOR[page.keywordIntent] ?? SITEMAP_INTENT_COLOR.navigational;
  const chipText = String(page.keywordIntent ?? "").toUpperCase();
  let chipW = 0;
  if (chipText) {
    doc.font(FONTS.sansBold).fontSize(8);
    chipW = doc.widthOfString(chipText) + 12;
  }
  const titleWidth = pageWidth - chipW - 12;

  // Title
  doc.fillColor(BRAND.text).font(FONTS.sansBold).fontSize(10.5);
  const titleHeight = doc.heightOfString(safe(page.title), {
    width: titleWidth,
    lineGap: 1,
  });
  doc.text(safe(page.title), leftMargin, y, { width: titleWidth, lineGap: 1 });

  // Intent chip aligned to first line
  if (chipText) {
    const chipX = leftMargin + pageWidth - chipW;
    doc
      .roundedRect(chipX, y + 1, chipW, 13, 3)
      .fillAndStroke(intentColor.fill, intentColor.border);
    doc
      .fillColor(intentColor.text)
      .font(FONTS.sansBold)
      .fontSize(8)
      .text(chipText, chipX, y + 4, { width: chipW, align: "center", lineBreak: false });
  }

  const afterTitleY = y + Math.max(titleHeight, 14) + 2;
  doc
    .fillColor(BRAND.muted)
    .font(FONTS.sans)
    .fontSize(8.5)
    .text(
      safe(page.slug) + (isOrphan ? "  ·  orphan" : ""),
      leftMargin,
      afterTitleY,
      { width: pageWidth, lineBreak: false, ellipsis: true },
    );
  doc.y = afterTitleY + 12;
  doc.moveDown(0.35);
}

function renderSitemapPageFull(
  doc: PDFKit.PDFDocument,
  page: SitemapPageBrief,
  isOrphan: boolean,
  leftMargin: number,
  pageWidth: number,
) {
  ensureSpace(doc, 140);

  const topY = doc.y;

  // Reserve the right rail for the intent chip so the wrapped title doesn't
  // collide with it. Compute chip width first, then wrap the title in the
  // remaining left column with ellipsis on a hard 2-line cap.
  const intentColor =
    SITEMAP_INTENT_COLOR[page.keywordIntent] ?? SITEMAP_INTENT_COLOR.navigational;
  const chipText = String(page.keywordIntent ?? "").toUpperCase();
  let chipW = 0;
  if (chipText) {
    doc.font(FONTS.sansBold).fontSize(8);
    chipW = doc.widthOfString(chipText) + 12;
  }
  const titleWidth = pageWidth - 10 - chipW - 12; // 10px indent + 12px gutter before chip

  // Amber tick
  doc.rect(leftMargin, topY, 2, 18).fill(BRAND.accent);

  // Title (may wrap; measure its height so subsequent lines don't collide)
  doc
    .fillColor(BRAND.navy)
    .font(FONTS.sansBold)
    .fontSize(11.5);
  const titleHeight = doc.heightOfString(safe(page.title), {
    width: titleWidth,
    lineGap: 1,
  });
  doc.text(safe(page.title), leftMargin + 10, topY + 1, {
    width: titleWidth,
    lineGap: 1,
  });

  // Intent chip aligned to the title's first line
  if (chipText) {
    const chipX = leftMargin + pageWidth - chipW;
    doc
      .roundedRect(chipX, topY + 2, chipW, 13, 3)
      .fillAndStroke(intentColor.fill, intentColor.border);
    doc
      .fillColor(intentColor.text)
      .font(FONTS.sansBold)
      .fontSize(8)
      .text(chipText, chipX, topY + 5, { width: chipW, align: "center", lineBreak: false });
  }

  // Slug + orphan marker (position BELOW the wrapped title)
  const afterTitleY = topY + Math.max(titleHeight, 16) + 4;
  doc
    .fillColor(BRAND.muted)
    .font(FONTS.sans)
    .fontSize(9)
    .text(safe(page.slug) + (isOrphan ? "   ·   orphan" : ""), leftMargin + 10, afterTitleY, {
      width: pageWidth - 10,
      lineBreak: false,
      ellipsis: true,
    });
  doc.y = afterTitleY + 12;
  doc.moveDown(0.25);

  // Primary keyword + secondary keywords
  if (page.primaryKeyword) {
    labeled(doc, "Primary keyword", safe(page.primaryKeyword));
  }
  if (page.secondaryKeywords?.length) {
    labeled(doc, "Secondary keywords", page.secondaryKeywords.join(" · "));
  }

  // SEO meta
  if (page.metaTitle) {
    labeled(doc, `Meta title (${page.metaTitle.length} chars)`, safe(page.metaTitle));
  }
  if (page.metaDescription) {
    labeled(
      doc,
      `Meta description (${page.metaDescription.length} chars)`,
      safe(page.metaDescription),
    );
  }

  // H1
  if (page.h1) {
    labeled(doc, "H1", safe(page.h1));
  }

  // Page outline
  if (page.h2Outline?.length) {
    doc
      .fillColor(BRAND.muted)
      .font(FONTS.sansBold)
      .fontSize(9)
      .text("PAGE OUTLINE", leftMargin, doc.y, { characterSpacing: 1.2 });
    doc.moveDown(0.15);
    for (const section of page.h2Outline) {
      ensureSpace(doc, 24);
      doc
        .fillColor(BRAND.text)
        .font(FONTS.sansBold)
        .fontSize(10)
        .text(`H2  —  ${safe(section.h2)}`, leftMargin, doc.y, {
          width: pageWidth,
          lineGap: 2,
        });
      for (const h3 of section.h3s ?? []) {
        ensureSpace(doc, 16);
        doc
          .fillColor(BRAND.muted)
          .font(FONTS.sans)
          .fontSize(9.5)
          .text(`H3  —  ${safe(h3)}`, leftMargin + 18, doc.y, {
            width: pageWidth - 18,
            lineGap: 2,
          });
      }
    }
    doc.moveDown(0.3);
  }

  // GEO answer blocks
  if (page.geoAnswerBlocks?.length) {
    doc
      .fillColor(BRAND.muted)
      .font(FONTS.sansBold)
      .fontSize(9)
      .text(`GEO / AEO ANSWER BLOCKS (${page.geoAnswerBlocks.length})`, leftMargin, doc.y, {
        characterSpacing: 1.2,
      });
    doc.moveDown(0.15);
    for (const qa of page.geoAnswerBlocks) {
      ensureSpace(doc, 40);
      doc
        .fillColor(BRAND.text)
        .font(FONTS.sansBold)
        .fontSize(9.5)
        .text(`Q: ${safe(qa.question)}`, leftMargin, doc.y, { width: pageWidth, lineGap: 2 });
      doc
        .fillColor(BRAND.text)
        .font(FONTS.sans)
        .fontSize(9.5)
        .text(safe(qa.answer), leftMargin, doc.y, { width: pageWidth, lineGap: 2 });
      doc.moveDown(0.2);
    }
    doc.moveDown(0.2);
  }

  // Primary CTA
  if (page.primaryCta?.label) {
    const ctaTarget = page.primaryCta.targetSlug || page.primaryCta.targetUrl || "";
    labeled(
      doc,
      "Primary CTA",
      ctaTarget ? `${safe(page.primaryCta.label)}  ›  ${safe(ctaTarget)}` : safe(page.primaryCta.label),
    );
  }

  // Strategy alignment
  if (page.uspAlignment) {
    labeled(doc, "USP", safe(page.uspAlignment));
  }
  if (page.compellingOfferTieIn) {
    labeled(doc, "Offer tie-in", safe(page.compellingOfferTieIn));
  }
  if (page.whyUsDifferentiators?.length) {
    labeled(doc, "Differentiators", page.whyUsDifferentiators.join(" · "));
  }
  if (page.icpTargets?.length) {
    labeled(doc, "ICP targets", page.icpTargets.join(" · "));
  }
  if (page.salesRouteMapping) {
    labeled(doc, "Sales route", safe(page.salesRouteMapping));
  }

  // Linking
  const inboundBlogs = page.inboundBlogTitles?.length ?? 0;
  const inboundSocials = page.inboundSocialTitles?.length ?? 0;
  const outbound = page.internalLinksOut?.length ?? 0;
  if (inboundBlogs + inboundSocials + outbound > 0) {
    labeled(
      doc,
      "Internal linking",
      `${inboundBlogs} inbound blog${inboundBlogs === 1 ? "" : "s"}  ·  ${inboundSocials} inbound social${inboundSocials === 1 ? "" : "s"}  ·  ${outbound} outbound`,
    );
  }

  // Divider
  doc.moveDown(0.3);
  doc
    .strokeColor(BRAND.border)
    .lineWidth(0.5)
    .moveTo(leftMargin, doc.y)
    .lineTo(leftMargin + pageWidth, doc.y)
    .stroke();
  doc.moveDown(0.5);
}

// =============================================================
// Customer Insights section — deep buyer intelligence pack
// Added Sep 2026. 12 sub-analyses across 4 panels. Roughly 6-8 pages.
// =============================================================

function ciSectionHeader(doc: PDFKit.PDFDocument, title: string, subtitle?: string) {
  if (doc.y > 650) doc.addPage();
  doc.moveDown(1);
  doc.fillColor(BRAND.navy).font(FONTS.serif).fontSize(18).text(title, 72, doc.y);
  doc.moveTo(72, doc.y + 4).lineTo(150, doc.y + 4).lineWidth(2).strokeColor(BRAND.accent).stroke();
  doc.moveDown(0.5);
  if (subtitle) {
    doc.fillColor(BRAND.muted).font(FONTS.sansOblique).fontSize(10).text(subtitle, 72, doc.y, { width: 470 });
    doc.moveDown(0.5);
  }
}

function ciKeyValueRow(doc: PDFKit.PDFDocument, label: string, value: string, width = 470) {
  if (!value) return;
  const startY = doc.y;
  doc.fillColor(BRAND.muted).font(FONTS.sansBold).fontSize(9).text(label.toUpperCase(), 72, startY, { continued: false });
  doc.fillColor(BRAND.text).font(FONTS.sans).fontSize(11).text(value, 72, doc.y, { width, lineGap: 2 });
  doc.moveDown(0.3);
}

function ciChip(doc: PDFKit.PDFDocument, label: string, x: number, y: number, color = BRAND.accent): number {
  const padding = 6;
  doc.font(FONTS.sansBold).fontSize(8);
  const w = doc.widthOfString(label) + padding * 2;
  doc.roundedRect(x, y - 2, w, 14, 3).fill(color);
  doc.fillColor("#FFFFFF").text(label, x + padding, y);
  return x + w + 6;
}

function renderCustomerInsightsSection(doc: PDFKit.PDFDocument, ci: CustomerInsights) {
  // Cover page for the section
  doc.addPage();
  doc.fillColor(BRAND.navy).font(FONTS.serif).fontSize(28).text("Customer Insights", 72, 100);
  doc.moveTo(72, doc.y + 8).lineTo(240, doc.y + 8).lineWidth(2).strokeColor(BRAND.accent).stroke();
  doc.moveDown(1);
  doc.fillColor(BRAND.muted).font(FONTS.sans).fontSize(11).text(
    "Deep buyer intelligence — 12 sub-analyses across four panels. This section is the authoritative source for how we understand, qualify, and close this buyer.",
    72,
    doc.y,
    { width: 470, lineGap: 3 },
  );
  doc.moveDown(1);

  // Evidence mode badge
  const mode = ci.vocEvidenceMode ?? "paraphrased";
  const modeColor = mode === "real" ? "#437A22" : mode === "mixed" ? "#F4BD11" : "#607382";
  const modeLabel = mode === "real" ? "VoC: Real Research" : mode === "mixed" ? "VoC: Mixed" : "VoC: Representative Language";
  ciChip(doc, modeLabel, 72, doc.y, modeColor);
  doc.moveDown(1.5);

  if (ci.summary) {
    doc.fillColor(BRAND.text).font(FONTS.sansBold).fontSize(11).text("Executive Read", 72, doc.y);
    doc.moveDown(0.3);
    doc.fillColor(BRAND.text).font(FONTS.sans).fontSize(11).text(ci.summary, 72, doc.y, { width: 470, lineGap: 3 });
    doc.moveDown(1);
  }

  // ===== Panel A: Persona core =====
  ciSectionHeader(doc, "Panel A — Who they are", "Persona, psychographics, sociotype");
  (ci.personas ?? []).forEach((p, i) => {
    doc.fillColor(BRAND.navy).font(FONTS.sansBold).fontSize(13).text(
      `${i === 0 ? "Primary" : "Secondary"} — ${p.name}`,
      72,
      doc.y,
    );
    doc.moveDown(0.2);
    let x = 72;
    x = ciChip(doc, p.role, x, doc.y, BRAND.navy);
    x = ciChip(doc, p.seniority.toUpperCase(), x, doc.y, BRAND.accent);
    x = ciChip(doc, p.authority.toUpperCase(), x, doc.y, "#1B998B");
    doc.moveDown(1);
    ciKeyValueRow(doc, "Org", `${p.orgSize} · ${p.industry}`);
  });

  const ps = ci.psychographics;
  if (ps) {
    doc.moveDown(0.5);
    doc.fillColor(BRAND.navy).font(FONTS.sansBold).fontSize(12).text("Psychographics", 72, doc.y);
    doc.moveDown(0.3);
    ciKeyValueRow(doc, "Personality", ps.personalityType);
    ciKeyValueRow(doc, "Buyer Type", `${ps.buyerType} · ${ps.buyerStage} · ${ps.userType}`);
    ciKeyValueRow(doc, "Decision Style", `${ps.decisionStyle} · ${ps.riskTolerance} risk tolerance · ${ps.brandRelationship}`);
    if (ps.informationDiet?.length) {
      ciKeyValueRow(doc, "Information Diet", ps.informationDiet.join(" · "));
    }
  }

  const st = ci.sociotype;
  if (st?.archetype) {
    if (doc.y > 620) doc.addPage();
    doc.moveDown(0.5);
    doc.fillColor(BRAND.navy).font(FONTS.sansBold).fontSize(12).text(`Sociotype — ${st.archetype}`, 72, doc.y);
    doc.moveDown(0.3);
    ciKeyValueRow(doc, "I am", st.iAm);
    ciKeyValueRow(doc, "I crave", st.iCrave);
    ciKeyValueRow(doc, "But also", st.butAlso);
    ciKeyValueRow(doc, "I struggle with", st.iStruggleWith);
    ciKeyValueRow(doc, "I consume", st.iConsume);
  }

  // ===== Panel B: Pain + JTBD + VoC =====
  doc.addPage();
  ciSectionHeader(doc, "Panel B — What hurts, what they hire us for", "Pain points, jobs-to-be-done, voice of customer");

  (ci.painPoints ?? []).forEach((p) => {
    if (doc.y > 640) doc.addPage();
    doc.fillColor(BRAND.navy).font(FONTS.sansBold).fontSize(12).text(`${p.rank}. ${p.label}`, 72, doc.y);
    doc.moveDown(0.3);
    ciKeyValueRow(doc, "Symptom", p.symptom);
    ciKeyValueRow(doc, "Business Cost", p.businessCost);
    ciKeyValueRow(doc, "Current Workaround", p.currentWorkaround);
    ciKeyValueRow(doc, "Our Leverage", p.ourLeverage);
    doc.moveDown(0.3);
  });

  if (ci.jtbd?.length) {
    if (doc.y > 550) doc.addPage();
    doc.moveDown(0.5);
    doc.fillColor(BRAND.navy).font(FONTS.sansBold).fontSize(13).text("Jobs-to-be-Done", 72, doc.y);
    doc.moveDown(0.5);
    ci.jtbd.forEach((j, i) => {
      if (doc.y > 650) doc.addPage();
      doc.fillColor(BRAND.text).font(FONTS.sans).fontSize(11).text(
        `${i + 1}. When ${j.situation}, I want to ${j.motivation}, so I can ${j.outcome}.`,
        72,
        doc.y,
        { width: 470, lineGap: 2 },
      );
      doc.moveDown(0.3);
      doc.fillColor(BRAND.muted).font(FONTS.sansOblique).fontSize(9).text(
        `Functional: ${j.functionalJob} · Emotional: ${j.emotionalJob} · Social: ${j.socialJob}`,
        72,
        doc.y,
        { width: 470, lineGap: 2 },
      );
      doc.moveDown(0.5);
    });
  }

  if (ci.voiceOfCustomer?.length) {
    if (doc.y > 550) doc.addPage();
    doc.moveDown(0.5);
    doc.fillColor(BRAND.navy).font(FONTS.sansBold).fontSize(13).text("Voice of Customer", 72, doc.y);
    doc.moveDown(0.5);
    ci.voiceOfCustomer.forEach((q) => {
      if (doc.y > 650) doc.addPage();
      doc.fillColor(BRAND.text).font(FONTS.sansOblique).fontSize(11).text(`\u201c${q.quote}\u201d`, 82, doc.y, {
        width: 460,
        lineGap: 2,
      });
      doc.moveDown(0.2);
      const label = q.isParaphrased ? "Representative language" : q.source;
      doc.fillColor(BRAND.muted).font(FONTS.sans).fontSize(9).text(
        `\u2014 ${q.speaker} · ${label}${q.theme ? ` · ${q.theme}` : ""}`,
        82,
        doc.y,
        { width: 460 },
      );
      if (q.sourceUrl) {
        doc.fillColor(BRAND.accent).font(FONTS.sans).fontSize(8).text(q.sourceUrl, 82, doc.y, {
          width: 460,
          link: q.sourceUrl,
          underline: true,
        });
        doc.fillColor(BRAND.text);
      }
      doc.moveDown(0.5);
    });
  }

  // ===== Panel C: Validation =====
  doc.addPage();
  ciSectionHeader(doc, "Panel C — Will they buy?", "Would-they-buy signals, Mom Test questions, buying triggers");

  (ci.wouldTheyBuySignals ?? []).forEach((s, i) => {
    if (doc.y > 660) doc.addPage();
    const strengthColor = s.strength === "strong" ? "#437A22" : s.strength === "moderate" ? "#F4BD11" : "#607382";
    doc.fillColor(BRAND.navy).font(FONTS.sansBold).fontSize(11).text(`${i + 1}. ${s.signal}`, 72, doc.y);
    doc.moveDown(0.2);
    ciChip(doc, s.strength.toUpperCase(), 72, doc.y, strengthColor);
    doc.moveDown(0.6);
    doc.fillColor(BRAND.text).font(FONTS.sans).fontSize(10).text(s.whatItMeans, 72, doc.y, { width: 470, lineGap: 2 });
    doc.moveDown(0.4);
  });

  if (ci.momTestQuestions?.length) {
    if (doc.y > 550) doc.addPage();
    doc.moveDown(0.5);
    doc.fillColor(BRAND.navy).font(FONTS.sansBold).fontSize(13).text("Mom Test Questions", 72, doc.y);
    doc.moveDown(0.5);
    ci.momTestQuestions.forEach((q, i) => {
      if (doc.y > 630) doc.addPage();
      doc.fillColor(BRAND.text).font(FONTS.sansBold).fontSize(11).text(`${i + 1}. ${q.question}`, 72, doc.y, { width: 470 });
      doc.moveDown(0.2);
      doc.fillColor(BRAND.muted).font(FONTS.sansOblique).fontSize(9).text(`Why it works: ${q.whyItWorks}`, 72, doc.y, { width: 470, lineGap: 2 });
      doc.moveDown(0.1);
      doc.fillColor("#C02B0A").font(FONTS.sansOblique).fontSize(9).text(`Avoid: "${q.antipattern}"`, 72, doc.y, { width: 470, lineGap: 2 });
      doc.moveDown(0.5);
    });
  }

  if (ci.buyingSignals?.length) {
    if (doc.y > 550) doc.addPage();
    doc.moveDown(0.5);
    doc.fillColor(BRAND.navy).font(FONTS.sansBold).fontSize(13).text("In-Market Buying Signals", 72, doc.y);
    doc.moveDown(0.5);
    ci.buyingSignals.forEach((b) => {
      if (doc.y > 660) doc.addPage();
      const urgencyColor = b.urgency === "in-market" ? "#C02B0A" : b.urgency === "hot" ? "#F4BD11" : b.urgency === "warming" ? "#00A6FB" : "#607382";
      doc.fillColor(BRAND.text).font(FONTS.sansBold).fontSize(11).text(b.trigger, 72, doc.y, { width: 470 });
      doc.moveDown(0.2);
      let x = 72;
      x = ciChip(doc, b.category.toUpperCase(), x, doc.y, BRAND.navy);
      x = ciChip(doc, b.urgency.toUpperCase(), x, doc.y, urgencyColor);
      doc.moveDown(0.8);
      doc.fillColor(BRAND.text).font(FONTS.sans).fontSize(10).text(`Play: ${b.action}`, 72, doc.y, { width: 470, lineGap: 2 });
      doc.moveDown(0.4);
    });
  }

  // ===== Panel D: Deal mechanics =====
  doc.addPage();
  ciSectionHeader(doc, "Panel D — How the deal closes", "Decision committee, objections, journey stages");

  (ci.decisionCommittee ?? []).forEach((r) => {
    if (doc.y > 640) doc.addPage();
    const playColor = r.ourPlay === "champion" ? "#437A22" : r.ourPlay === "neutralize" ? "#C02B0A" : r.ourPlay === "bypass" ? "#607382" : "#F4BD11";
    doc.fillColor(BRAND.navy).font(FONTS.sansBold).fontSize(12).text(r.role, 72, doc.y);
    doc.moveDown(0.2);
    ciChip(doc, `PLAY: ${r.ourPlay.toUpperCase()}`, 72, doc.y, playColor);
    doc.moveDown(0.8);
    ciKeyValueRow(doc, "Motivation", r.motivation);
    ciKeyValueRow(doc, "Blocker", r.blocker);
    ciKeyValueRow(doc, "Primary Objection", r.primaryObjection);
    doc.moveDown(0.3);
  });

  if (ci.objections?.length) {
    if (doc.y > 550) doc.addPage();
    doc.moveDown(0.5);
    doc.fillColor(BRAND.navy).font(FONTS.sansBold).fontSize(13).text("Objection Handling", 72, doc.y);
    doc.moveDown(0.5);
    ci.objections.forEach((o) => {
      if (doc.y > 620) doc.addPage();
      doc.fillColor(BRAND.text).font(FONTS.sansBold).fontSize(11).text(`\u201c${o.objection}\u201d`, 72, doc.y, { width: 470 });
      doc.moveDown(0.2);
      ciChip(doc, o.frame.toUpperCase(), 72, doc.y, BRAND.navy);
      doc.moveDown(0.8);
      ciKeyValueRow(doc, "Underlying Fear", o.underlyingFear);
      ciKeyValueRow(doc, "Reframe", o.reframe);
      ciKeyValueRow(doc, "Proof Asset", o.proofAsset);
      doc.moveDown(0.3);
    });
  }

  if (ci.journeyStages?.length) {
    if (doc.y > 500) doc.addPage();
    doc.moveDown(0.5);
    doc.fillColor(BRAND.navy).font(FONTS.sansBold).fontSize(13).text("Buyer Journey", 72, doc.y);
    doc.moveDown(0.5);
    ci.journeyStages.forEach((j, i) => {
      if (doc.y > 620) doc.addPage();
      doc.fillColor(BRAND.navy).font(FONTS.sansBold).fontSize(11).text(`${i + 1}. ${j.stage.toUpperCase().replace("-", " ")}`, 72, doc.y);
      doc.moveDown(0.3);
      ciKeyValueRow(doc, "Mindset", j.mindset);
      ciKeyValueRow(doc, "Question in their head", j.primaryQuestion);
      ciKeyValueRow(doc, "Where they are", j.channel);
      ciKeyValueRow(doc, "Content asset", j.contentAsset);
      ciKeyValueRow(doc, "CTA", j.cta);
      ciKeyValueRow(doc, "Exit criterion", j.exitCriterion);
      doc.moveDown(0.4);
    });
  }

  // VoC sources appendix at the end
  if (ci.vocSources?.length) {
    if (doc.y > 500) doc.addPage();
    doc.moveDown(0.5);
    doc.fillColor(BRAND.navy).font(FONTS.sansBold).fontSize(12).text("Voice-of-Customer Sources", 72, doc.y);
    doc.moveDown(0.3);
    ci.vocSources.forEach((src, i) => {
      if (doc.y > 700) doc.addPage();
      doc.fillColor(BRAND.text).font(FONTS.sans).fontSize(9).text(
        `${i + 1}. ${src.title}${src.publisher ? ` — ${src.publisher}` : ""}${src.date ? ` (${src.date})` : ""}`,
        72,
        doc.y,
        { width: 470, lineGap: 2 },
      );
      doc.fillColor(BRAND.accent).font(FONTS.sans).fontSize(8).text(src.url, 72, doc.y, {
        width: 470,
        link: src.url,
        underline: true,
      });
      doc.moveDown(0.3);
    });
  }
}
