import PDFDocument from "pdfkit";
import type {
  ContentPlanPayload,
  SwotAnalysis,
  PestelAnalysis,
  PortersFiveForces,
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
  navy: "#0B1929",
  accent: "#D97706", // warm amber accent
  text: "#1F2937",
  muted: "#6B7280",
  light: "#F3F4F6",
  border: "#E5E7EB",
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
function renderStrategyOnly(doc: PDFKit.PDFDocument, p: ContentPlanPayload) {
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
  renderStrategyOnly(doc, p);

  // ---- ROI Projections (full version with all four charts) ----
  try {
    renderRoiSection(doc, p, { compact: false });
  } catch (err) {
    console.error("[pdf-export] ROI section (full) failed", err);
  }

  // ---- Brex vs. Market pricing matrix (full tier + line-item) ----
  try {
    renderBrexPricingMatrix(doc, { compact: false });
  } catch (err) {
    console.error("[pdf-export] brex pricing matrix (full) failed", err);
  }

  // ---- Investment benchmarks (full) ----
  try {
    renderInvestmentBenchmarks(doc, { compact: false });
  } catch (err) {
    console.error("[pdf-export] investment benchmarks failed", err);
  }

  if (p.heroMetaAd) {
    sectionHeader(doc, "Hero Meta Ad");
    labeled(doc, "Headline", p.heroMetaAd.headline);
    labeled(doc, "Primary Text", p.heroMetaAd.primaryText);
    labeled(doc, "Description", p.heroMetaAd.description);
    labeled(doc, "CTA", p.heroMetaAd.cta);
    labeled(doc, "Visual Concept", p.heroMetaAd.visualConcept);
  }

  if (p.heroLinkedInAd) {
    sectionHeader(doc, "Hero LinkedIn Ad");
    labeled(doc, "Intro Text", p.heroLinkedInAd.introText);
    labeled(doc, "Headline", p.heroLinkedInAd.headline);
    labeled(doc, "Description", p.heroLinkedInAd.description);
    labeled(doc, "CTA", p.heroLinkedInAd.cta);
    labeled(doc, "Visual Concept", p.heroLinkedInAd.visualConcept);
  }

  if (p.heroColdEmail) {
    sectionHeader(doc, "Hero Cold Email Sequence");
    labeled(doc, "ICP Target", p.heroColdEmail.icpTarget);
    labeled(doc, "Subject Line (A)", p.heroColdEmail.subjectLineA);
    labeled(doc, "Subject Line (B)", p.heroColdEmail.subjectLineB);

    emailTouch(doc, "Touch 1", p.heroColdEmail.touch1);
    emailTouch(doc, "Touch 2", p.heroColdEmail.touch2);
    emailTouch(doc, "Touch 3 (Breakup)", p.heroColdEmail.touch3);
  }

  if (p.adBrief?.length) {
    sectionHeader(doc, "Paid Ad Briefs");
    for (const brief of p.adBrief) {
      renderAdBrief(doc, brief);
    }
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

    // Header row
    doc.rect(72, doc.y, 468, 22).fillColor("#F9FAFB").fill().strokeColor(BRAND.border).lineWidth(0.5).rect(72, doc.y - 22, 468, 22).stroke();
    const rowY = doc.y - 22;
    doc.fillColor(BRAND.navy).font(FONTS.sansBold).fontSize(11)
      .text(`${f.id}  ·  ${forceLabels[f.force] ?? f.force}`, 82, rowY + 6);
    doc.fillColor(intensityColor).font(FONTS.sansBold).fontSize(9)
      .text(f.intensity.toUpperCase(), 460, rowY + 7, { width: 70, align: "right" });

    doc.moveDown(0.3);
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
