// =============================================================
// PPTX Sitemap Slides — Called from pptx-export.ts
// Mirrors the SEO/GEO Site Architecture PDF section
// Slides: overview, type mix chart, per-page highlights, full directory
// =============================================================
import PptxGenJS from "pptxgenjs";
import type {
  ContentPlanPayload,
  SitemapPageBrief,
  SitemapPageType,
  SitemapKeywordIntent,
} from "@shared/schema";

const BRAND = {
  navy: "0B1929",
  accent: "D97706", // amber
  text: "1F2937",
  muted: "6B7280",
  light: "F3F4F6",
  border: "E5E7EB",
  white: "FFFFFF",
};

const SLIDE_W = 10;
const SLIDE_H = 5.625;

// Type grouping and labels (matches PDF)
const TYPE_ORDER: SitemapPageType[] = [
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

const TYPE_LABELS: Record<SitemapPageType, string> = {
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

// Intent chip colors (fill / text)
const INTENT_COLOR: Record<SitemapKeywordIntent, { fill: string; text: string }> = {
  informational: { fill: "DBEAFE", text: "1E3A8A" },
  navigational: { fill: "E5E7EB", text: "374151" },
  commercial: { fill: "FEF3C7", text: "78350F" },
  transactional: { fill: "D1FAE5", text: "065F46" },
};

function safe(v: unknown, fallback = ""): string {
  if (v === null || v === undefined) return fallback;
  const s = String(v);
  return s.replace(/[\u0000-\u001F\u007F]/g, "");
}

function addHeader(slide: PptxGenJS.Slide, title: string, subtitle?: string) {
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
    slide.addText(subtitle, {
      x: 0.6,
      y: 0.85,
      w: SLIDE_W - 1.2,
      h: 0.3,
      fontSize: 11,
      fontFace: "Arial",
      italic: true,
      color: BRAND.muted,
    });
  }
}

// =============================================================
// Overview slide — stats block + orphans + Local SEO card
// =============================================================
function buildSitemapOverviewSlide(pptx: PptxGenJS, payload: ContentPlanPayload) {
  const sm = payload.sitemap;
  if (!sm) return;

  const slide = pptx.addSlide();
  addHeader(
    slide,
    "SEO / GEO Site Architecture",
    "Pillar + spoke architecture with per-page briefs, GEO answer blocks, and bidirectional linking",
  );

  // Compute stats
  const pages = sm.pages ?? [];
  const totalPages = pages.length;
  const internalLinks = pages.reduce(
    (sum, p) => sum + (p.internalLinksOut?.length ?? 0),
    0,
  );
  const blogsLinked = new Set<string>();
  const socialsLinked = new Set<string>();
  for (const p of pages) {
    for (const t of p.inboundBlogTitles ?? []) blogsLinked.add(t);
    for (const t of p.inboundSocialTitles ?? []) socialsLinked.add(t);
  }
  const orphanCount = pages.filter(
    (p) =>
      (p.inboundBlogTitles?.length ?? 0) === 0 &&
      (p.inboundSocialTitles?.length ?? 0) === 0,
  ).length;

  // Overview paragraph
  slide.addText(safe(sm.overview), {
    x: 0.6,
    y: 1.3,
    w: SLIDE_W - 1.2,
    h: 1.0,
    fontSize: 11,
    fontFace: "Arial",
    color: BRAND.text,
    valign: "top",
    paraSpaceAfter: 4,
  });

  // 4-stat block
  const stats = [
    { value: String(totalPages), label: "TOTAL PAGES" },
    { value: String(internalLinks), label: "INTERNAL LINKS" },
    { value: String(blogsLinked.size), label: "BLOGS LINKED" },
    { value: String(socialsLinked.size), label: "SOCIALS LINKED" },
  ];

  const cardW = 1.9;
  const cardH = 1.1;
  const gap = 0.12;
  const totalW = 4 * cardW + 3 * gap;
  const startX = (SLIDE_W - totalW) / 2;
  const startY = 2.5;

  stats.forEach((stat, idx) => {
    const x = startX + idx * (cardW + gap);
    slide.addShape("rect", {
      x,
      y: startY,
      w: cardW,
      h: cardH,
      fill: { color: BRAND.light },
      line: { color: BRAND.border, width: 1 },
    });
    slide.addText(stat.value, {
      x,
      y: startY + 0.1,
      w: cardW,
      h: 0.6,
      fontSize: 32,
      fontFace: "Georgia",
      bold: true,
      color: BRAND.accent,
      align: "center",
      valign: "middle",
    });
    slide.addText(stat.label, {
      x,
      y: startY + 0.75,
      w: cardW,
      h: 0.25,
      fontSize: 8,
      fontFace: "Arial",
      bold: true,
      color: BRAND.muted,
      align: "center",
      charSpacing: 2,
    });
  });

  // Orphan warning banner (if any)
  let nextY = startY + cardH + 0.2;
  if (orphanCount > 0) {
    slide.addShape("rect", {
      x: 0.6,
      y: nextY,
      w: SLIDE_W - 1.2,
      h: 0.5,
      fill: { color: "FEF3C7" },
      line: { color: "FCD34D", width: 1 },
    });
    slide.addText(
      [
        {
          text: `${orphanCount} ORPHAN PAGE${orphanCount === 1 ? "" : "S"}  `,
          options: { bold: true, color: "78350F", fontSize: 10, charSpacing: 1 },
        },
        {
          text: "— no inbound blog or social links. Rerun Refresh links to reassign content.",
          options: { color: "78350F", fontSize: 10 },
        },
      ],
      {
        x: 0.75,
        y: nextY + 0.13,
        w: SLIDE_W - 1.5,
        h: 0.3,
        fontFace: "Arial",
        valign: "middle",
      },
    );
    nextY += 0.65;
  }

  // Local SEO indicator (small)
  const localIncluded = sm.local?.included ?? false;
  const localLabel = localIncluded ? "Local SEO: Included" : "Local SEO: Not applicable";
  const localColor = localIncluded ? BRAND.accent : BRAND.muted;
  slide.addShape("rect", {
    x: 0.6,
    y: nextY,
    w: 0.04,
    h: 0.3,
    fill: { color: localColor },
    line: { color: localColor, width: 0 },
  });
  slide.addText(localLabel, {
    x: 0.72,
    y: nextY,
    w: SLIDE_W - 1.4,
    h: 0.3,
    fontSize: 10,
    fontFace: "Arial",
    bold: true,
    color: BRAND.text,
    charSpacing: 1,
    valign: "middle",
  });
}

// =============================================================
// Type-mix slide — horizontal bar chart of pages per type
// =============================================================
function buildSitemapTypeMixSlide(pptx: PptxGenJS, payload: ContentPlanPayload) {
  const sm = payload.sitemap;
  if (!sm || (sm.pages?.length ?? 0) === 0) return;

  const slide = pptx.addSlide();
  addHeader(
    slide,
    "Page Type Mix",
    "How the site is structured across pillars, spokes, and answer surfaces",
  );

  // Count by type
  const counts = new Map<SitemapPageType, number>();
  for (const p of sm.pages) {
    counts.set(p.pageType, (counts.get(p.pageType) ?? 0) + 1);
  }

  // Ordered rows, filtered to non-zero
  const rows = TYPE_ORDER.filter((t) => (counts.get(t) ?? 0) > 0).map((t) => ({
    label: TYPE_LABELS[t],
    count: counts.get(t) ?? 0,
  }));

  const chartData = [
    {
      name: "Pages",
      labels: rows.map((r) => r.label),
      values: rows.map((r) => r.count),
    },
  ];

  slide.addChart(pptx.ChartType.bar, chartData, {
    x: 0.6,
    y: 1.4,
    w: SLIDE_W - 1.2,
    h: SLIDE_H - 1.8,
    barDir: "bar",
    barGrouping: "clustered",
    chartColors: [BRAND.accent],
    showValue: true,
    dataLabelColor: BRAND.text,
    dataLabelFontFace: "Arial",
    dataLabelFontSize: 9,
    dataLabelPosition: "outEnd",
    catAxisLabelFontFace: "Arial",
    catAxisLabelFontSize: 9,
    catAxisLabelColor: BRAND.text,
    valAxisLabelFontFace: "Arial",
    valAxisLabelFontSize: 8,
    valAxisLabelColor: BRAND.muted,
    valGridLine: { style: "solid", size: 0.5, color: BRAND.border },
    showLegend: false,
    plotArea: { fill: { color: BRAND.white } },
  });
}

// =============================================================
// Per-page highlight slide — one slide per key page
// =============================================================
function buildSitemapPageHighlightSlide(
  pptx: PptxGenJS,
  page: SitemapPageBrief,
  idx: number,
  total: number,
) {
  const slide = pptx.addSlide();
  const intent = INTENT_COLOR[page.keywordIntent];

  // Compact header
  addHeader(slide, `Page ${idx + 1} of ${total}`, TYPE_LABELS[page.pageType]);

  // Title — big, wrapped
  slide.addText(safe(page.title), {
    x: 0.6,
    y: 1.35,
    w: SLIDE_W - 3.0, // reserve chip space right
    h: 0.9,
    fontSize: 22,
    fontFace: "Georgia",
    bold: true,
    color: BRAND.navy,
    valign: "top",
  });

  // Intent chip — top right
  slide.addShape("rect", {
    x: SLIDE_W - 2.3,
    y: 1.4,
    w: 1.8,
    h: 0.35,
    fill: { color: intent.fill },
    line: { color: intent.fill, width: 0 },
  });
  slide.addText(page.keywordIntent.toUpperCase(), {
    x: SLIDE_W - 2.3,
    y: 1.4,
    w: 1.8,
    h: 0.35,
    fontSize: 9,
    fontFace: "Arial",
    bold: true,
    color: intent.text,
    align: "center",
    valign: "middle",
    charSpacing: 2,
  });

  // Slug + orphan flag under title
  const isOrphan =
    (page.inboundBlogTitles?.length ?? 0) === 0 &&
    (page.inboundSocialTitles?.length ?? 0) === 0;
  slide.addText(
    [
      { text: safe(page.slug), options: { fontFace: "Courier New", color: BRAND.muted, fontSize: 10 } },
      ...(isOrphan
        ? [
            { text: "  ·  ", options: { color: BRAND.muted, fontSize: 10 } },
            { text: "ORPHAN", options: { color: "78350F", bold: true, fontSize: 9, charSpacing: 1 } },
          ]
        : []),
    ],
    {
      x: 0.6,
      y: 2.25,
      w: SLIDE_W - 1.2,
      h: 0.3,
    },
  );

  // Two-column body
  const colY = 2.75;
  const colH = SLIDE_H - colY - 0.5;
  const leftX = 0.6;
  const leftW = 4.4;
  const rightX = 5.2;
  const rightW = 4.2;

  // LEFT COLUMN — Keywords + Meta
  const leftBlocks: PptxGenJS.TextProps[] = [];
  leftBlocks.push({ text: "PRIMARY KEYWORD", options: { bold: true, fontSize: 8, color: BRAND.muted, charSpacing: 1, breakLine: true } });
  leftBlocks.push({ text: safe(page.primaryKeyword) || "—", options: { fontSize: 11, color: BRAND.text, breakLine: true } });
  leftBlocks.push({ text: " ", options: { fontSize: 4, breakLine: true } });

  if (page.secondaryKeywords?.length) {
    leftBlocks.push({ text: "SECONDARY KEYWORDS", options: { bold: true, fontSize: 8, color: BRAND.muted, charSpacing: 1, breakLine: true } });
    leftBlocks.push({
      text: page.secondaryKeywords.map((k) => safe(k)).join(" · "),
      options: { fontSize: 10, color: BRAND.text, breakLine: true },
    });
    leftBlocks.push({ text: " ", options: { fontSize: 4, breakLine: true } });
  }

  const metaTitleLen = safe(page.metaTitle).length;
  leftBlocks.push({
    text: `META TITLE (${metaTitleLen} chars)`,
    options: { bold: true, fontSize: 8, color: BRAND.muted, charSpacing: 1, breakLine: true },
  });
  leftBlocks.push({ text: safe(page.metaTitle) || "—", options: { fontSize: 10, color: BRAND.text, breakLine: true } });
  leftBlocks.push({ text: " ", options: { fontSize: 4, breakLine: true } });

  const metaDescLen = safe(page.metaDescription).length;
  leftBlocks.push({
    text: `META DESCRIPTION (${metaDescLen} chars)`,
    options: { bold: true, fontSize: 8, color: BRAND.muted, charSpacing: 1, breakLine: true },
  });
  leftBlocks.push({ text: safe(page.metaDescription) || "—", options: { fontSize: 10, color: BRAND.text } });

  slide.addText(leftBlocks, {
    x: leftX,
    y: colY,
    w: leftW,
    h: colH,
    valign: "top",
    fontFace: "Arial",
  });

  // RIGHT COLUMN — H1, GEO Q&A count, CTA, USP
  const rightBlocks: PptxGenJS.TextProps[] = [];
  rightBlocks.push({ text: "H1", options: { bold: true, fontSize: 8, color: BRAND.muted, charSpacing: 1, breakLine: true } });
  rightBlocks.push({ text: safe(page.h1) || "—", options: { fontSize: 11, color: BRAND.text, breakLine: true } });
  rightBlocks.push({ text: " ", options: { fontSize: 4, breakLine: true } });

  const geoCount = page.geoAnswerBlocks?.length ?? 0;
  const outlineCount = page.h2Outline?.length ?? 0;
  rightBlocks.push({ text: "STRUCTURE", options: { bold: true, fontSize: 8, color: BRAND.muted, charSpacing: 1, breakLine: true } });
  rightBlocks.push({
    text: `${outlineCount} H2 section${outlineCount === 1 ? "" : "s"}  ·  ${geoCount} GEO/AEO answer block${geoCount === 1 ? "" : "s"}`,
    options: { fontSize: 10, color: BRAND.text, breakLine: true },
  });
  rightBlocks.push({ text: " ", options: { fontSize: 4, breakLine: true } });

  if (page.primaryCta?.label) {
    rightBlocks.push({ text: "PRIMARY CTA", options: { bold: true, fontSize: 8, color: BRAND.muted, charSpacing: 1, breakLine: true } });
    const target = page.primaryCta.targetSlug || page.primaryCta.targetUrl || "";
    rightBlocks.push({
      text: `${safe(page.primaryCta.label)}${target ? `  ›  ${safe(target)}` : ""}`,
      options: { fontSize: 10, color: BRAND.text, breakLine: true },
    });
    rightBlocks.push({ text: " ", options: { fontSize: 4, breakLine: true } });
  }

  if (page.uspAlignment) {
    rightBlocks.push({ text: "USP ALIGNMENT", options: { bold: true, fontSize: 8, color: BRAND.muted, charSpacing: 1, breakLine: true } });
    rightBlocks.push({ text: safe(page.uspAlignment), options: { fontSize: 10, italic: true, color: BRAND.text, breakLine: true } });
    rightBlocks.push({ text: " ", options: { fontSize: 4, breakLine: true } });
  }

  const inboundBlogs = page.inboundBlogTitles?.length ?? 0;
  const inboundSocials = page.inboundSocialTitles?.length ?? 0;
  const outboundLinks = page.internalLinksOut?.length ?? 0;
  rightBlocks.push({ text: "LINKING", options: { bold: true, fontSize: 8, color: BRAND.muted, charSpacing: 1, breakLine: true } });
  rightBlocks.push({
    text: `${inboundBlogs} blog${inboundBlogs === 1 ? "" : "s"} in  ·  ${inboundSocials} social${inboundSocials === 1 ? "" : "s"} in  ·  ${outboundLinks} internal link${outboundLinks === 1 ? "" : "s"} out`,
    options: { fontSize: 10, color: BRAND.text },
  });

  slide.addText(rightBlocks, {
    x: rightX,
    y: colY,
    w: rightW,
    h: colH,
    valign: "top",
    fontFace: "Arial",
  });
}

// =============================================================
// Full directory slide(s) — compact list of ALL pages by type
// Auto-paginates when too many pages fit
// =============================================================
function buildSitemapDirectorySlides(pptx: PptxGenJS, payload: ContentPlanPayload) {
  const sm = payload.sitemap;
  if (!sm || (sm.pages?.length ?? 0) === 0) return;

  // Group pages by type (in TYPE_ORDER)
  type Row = { type: "group" | "page"; label: string; slug?: string; intent?: SitemapKeywordIntent; orphan?: boolean };
  const rows: Row[] = [];
  for (const t of TYPE_ORDER) {
    const grouped = sm.pages.filter((p) => p.pageType === t);
    if (grouped.length === 0) continue;
    rows.push({ type: "group", label: `${TYPE_LABELS[t]}  ·  ${grouped.length} page${grouped.length === 1 ? "" : "s"}` });
    for (const p of grouped) {
      const orphan =
        (p.inboundBlogTitles?.length ?? 0) === 0 &&
        (p.inboundSocialTitles?.length ?? 0) === 0;
      rows.push({
        type: "page",
        label: safe(p.title),
        slug: safe(p.slug),
        intent: p.keywordIntent,
        orphan,
      });
    }
  }

  // Layout constants
  const startY = 1.3;
  const usableH = SLIDE_H - startY - 0.5;
  const groupRowH = 0.35;
  const pageRowH = 0.42;

  // Paginate: compute rows per slide
  const pages: Row[][] = [];
  let current: Row[] = [];
  let currentH = 0;
  for (const r of rows) {
    const h = r.type === "group" ? groupRowH : pageRowH;
    if (currentH + h > usableH && current.length > 0) {
      pages.push(current);
      current = [];
      currentH = 0;
    }
    current.push(r);
    currentH += h;
  }
  if (current.length > 0) pages.push(current);

  // Render each page
  pages.forEach((pageRows, pageIdx) => {
    const slide = pptx.addSlide();
    const title = pages.length === 1 ? "Full Site Directory" : `Full Site Directory (${pageIdx + 1} / ${pages.length})`;
    addHeader(slide, title, "Every page in the architecture, grouped by type");

    let y = startY;
    const leftX = 0.6;
    const totalW = SLIDE_W - 1.2;
    const chipW = 1.2;
    const titleW = totalW - chipW - 0.15;

    for (const r of pageRows) {
      if (r.type === "group") {
        // Group header with underline
        slide.addText(r.label, {
          x: leftX,
          y,
          w: totalW,
          h: groupRowH - 0.05,
          fontSize: 11,
          fontFace: "Arial",
          bold: true,
          color: BRAND.navy,
          valign: "middle",
        });
        // Underline
        slide.addShape("line", {
          x: leftX,
          y: y + groupRowH - 0.08,
          w: totalW,
          h: 0,
          line: { color: BRAND.border, width: 0.5 },
        });
        y += groupRowH;
      } else {
        // Page row: title on top, slug below, intent chip on right
        slide.addText(r.label, {
          x: leftX,
          y,
          w: titleW,
          h: 0.22,
          fontSize: 10,
          fontFace: "Arial",
          bold: true,
          color: BRAND.text,
          valign: "middle",
        });
        // Intent chip
        if (r.intent) {
          const intent = INTENT_COLOR[r.intent];
          const chipX = leftX + titleW + 0.15;
          slide.addShape("rect", {
            x: chipX,
            y: y + 0.02,
            w: chipW,
            h: 0.22,
            fill: { color: intent.fill },
            line: { color: intent.fill, width: 0 },
          });
          slide.addText(r.intent.toUpperCase(), {
            x: chipX,
            y: y + 0.02,
            w: chipW,
            h: 0.22,
            fontSize: 7,
            fontFace: "Arial",
            bold: true,
            color: intent.text,
            align: "center",
            valign: "middle",
            charSpacing: 1,
          });
        }
        // Slug + orphan
        slide.addText(
          [
            { text: r.slug ?? "", options: { fontFace: "Courier New", color: BRAND.muted, fontSize: 8 } },
            ...(r.orphan
              ? [
                  { text: "  ·  ", options: { color: BRAND.muted, fontSize: 8 } },
                  { text: "orphan", options: { color: "78350F", italic: true, fontSize: 8 } },
                ]
              : []),
          ],
          {
            x: leftX,
            y: y + 0.22,
            w: totalW,
            h: 0.18,
            valign: "middle",
          },
        );
        y += pageRowH;
      }
    }
  });
}

// =============================================================
// PUBLIC — build all sitemap slides
// =============================================================
export function buildSitemapSlides(pptx: PptxGenJS, payload: ContentPlanPayload): void {
  if (!payload.sitemap || (payload.sitemap.pages?.length ?? 0) === 0) return;

  // 1. Overview + stats
  buildSitemapOverviewSlide(pptx, payload);

  // 2. Type mix chart
  buildSitemapTypeMixSlide(pptx, payload);

  // 3. Per-page highlight slides — top pages only (Home + top 3-4 commercial pages)
  const pages = payload.sitemap.pages;
  const highlightTypes: SitemapPageType[] = ["home", "solution", "service", "comparison", "case-study"];
  const highlights: SitemapPageBrief[] = [];
  const seen = new Set<string>();
  for (const t of highlightTypes) {
    for (const p of pages) {
      if (p.pageType === t && !seen.has(p.id)) {
        highlights.push(p);
        seen.add(p.id);
        if (highlights.length >= 4) break;
      }
    }
    if (highlights.length >= 4) break;
  }
  highlights.forEach((p, idx) => {
    buildSitemapPageHighlightSlide(pptx, p, idx, highlights.length);
  });

  // 4. Full directory (auto-paginated)
  buildSitemapDirectorySlides(pptx, payload);
}
