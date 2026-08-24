import PDFDocument from "pdfkit";
import type { ContentPlanPayload } from "@shared/schema";
import type { Response } from "express";

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
}

export function streamContentPlanPdf({
  res,
  payload,
  clientName,
  clientUrl,
  scope,
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

  doc.pipe(res);

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

  // -------- Footer on every page --------
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    renderFooter(doc, clientName, i + 1, range.count);
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
// Executive Summary (thesis + pillars + week-1 preview)
// =============================================================
function renderExecutiveSummary(doc: PDFKit.PDFDocument, p: ContentPlanPayload) {
  sectionHeader(doc, "12-Week Thesis");
  bodyParagraph(doc, p.summary);

  sectionHeader(doc, "Content Pillars");
  for (const pillar of p.contentPillars ?? []) {
    pillarBlock(doc, pillar.name, pillar.description);
  }

  if (p.blogCalendar?.[0]) {
    sectionHeader(doc, "Week 1 Preview");
    renderWeek(doc, p.blogCalendar[0], { compact: true });
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
  sectionHeader(doc, "12-Week Thesis");
  bodyParagraph(doc, p.summary);

  sectionHeader(doc, "Content Pillars");
  for (const pillar of p.contentPillars ?? []) {
    pillarBlock(doc, pillar.name, pillar.description);
  }

  sectionHeader(doc, "12-Week Blog Calendar");
  for (const week of p.blogCalendar ?? []) {
    renderWeek(doc, week);
  }

  if (p.socialCadence?.length) {
    sectionHeader(doc, "Organic Social Cadence");
    for (const social of p.socialCadence) {
      renderSocial(doc, social);
    }
  }

  if (p.landingPages?.length) {
    sectionHeader(doc, "AEO Landing Pages");
    for (const lp of p.landingPages) {
      renderLandingPage(doc, lp);
    }
  }
}

// =============================================================
// Full Plan (everything)
// =============================================================
function renderFullPlan(doc: PDFKit.PDFDocument, p: ContentPlanPayload) {
  renderStrategyOnly(doc, p);

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
    .text(`WEEK ${week.weekNumber} · PUBLISHING ${week.weekOf}`, {
      characterSpacing: 1.2,
    });

  doc.moveDown(0.2);

  for (const post of week.posts ?? []) {
    ensureSpace(doc, opts.compact ? 40 : 50);
    doc
      .fillColor(BRAND.navy)
      .font(FONTS.sansBold)
      .fontSize(10.5)
      .text(post.title, { lineGap: 1 });

    doc
      .fillColor(BRAND.muted)
      .font(FONTS.sans)
      .fontSize(9)
      .text(`${post.pillar}  ·  ${post.scheduledDate}`);

    doc
      .fillColor(BRAND.text)
      .font(FONTS.sansOblique)
      .fontSize(9)
      .text(`Answers: "${post.targetQuery}"`, { lineGap: 1 });

    if (!opts.compact && post.angle) {
      doc
        .fillColor(BRAND.text)
        .font(FONTS.sans)
        .fontSize(9)
        .text(post.angle, { lineGap: 1 });
    }

    doc.moveDown(0.35);
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
