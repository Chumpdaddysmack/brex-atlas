// =============================================================
// PDF Chart primitives — drawn with pdfkit vector API
// (no image files, no external chart libs)
// =============================================================
import type { ContentPlanPayload } from "@shared/schema";
import type { Benchmark } from "./pricing-benchmarks";
import { formatMoney } from "./pricing-benchmarks";

const CHART_COLORS = {
  navy: "#0B1929",
  accent: "#D97706",
  text: "#1F2937",
  muted: "#6B7280",
  light: "#F3F4F6",
  border: "#E5E7EB",
  // Pillar palette (cycled)
  pillar: ["#0B1929", "#D97706", "#065F46", "#7C3AED", "#DC2626", "#0891B2"],
};

// =============================================================
// Donut chart — pillar distribution
// =============================================================
export function drawPillarDonut(
  doc: PDFKit.PDFDocument,
  pillarCounts: { name: string; count: number }[],
  x: number,
  y: number,
  radius: number = 60,
) {
  const total = pillarCounts.reduce((sum, p) => sum + p.count, 0);
  if (total === 0) return;

  const centerX = x + radius;
  const centerY = y + radius;
  const innerRadius = radius * 0.55;

  let currentAngle = -Math.PI / 2; // start at top

  pillarCounts.forEach((slice, idx) => {
    const sliceAngle = (slice.count / total) * Math.PI * 2;
    const color = CHART_COLORS.pillar[idx % CHART_COLORS.pillar.length];

    // Approximate the arc with a polyline (pdfkit has no native arc)
    const steps = Math.max(6, Math.ceil((sliceAngle / (Math.PI * 2)) * 64));
    doc.save();
    doc.moveTo(centerX, centerY);
    for (let i = 0; i <= steps; i++) {
      const angle = currentAngle + (sliceAngle * i) / steps;
      doc.lineTo(
        centerX + Math.cos(angle) * radius,
        centerY + Math.sin(angle) * radius,
      );
    }
    doc.lineTo(centerX, centerY).fill(color);
    doc.restore();

    currentAngle += sliceAngle;
  });

  // Punch out center for donut
  doc.circle(centerX, centerY, innerRadius).fill("#FFFFFF");

  // Center label — total posts
  doc
    .fillColor(CHART_COLORS.navy)
    .font("Helvetica-Bold")
    .fontSize(18)
    .text(String(total), centerX - radius, centerY - 12, {
      width: radius * 2,
      align: "center",
      lineBreak: false,
    });

  doc
    .fillColor(CHART_COLORS.muted)
    .font("Helvetica")
    .fontSize(8)
    .text("total posts", centerX - radius, centerY + 6, {
      width: radius * 2,
      align: "center",
      lineBreak: false,
    });

  // Legend to the right
  const legendX = centerX + radius + 20;
  let legendY = y + 10;
  pillarCounts.forEach((slice, idx) => {
    const color = CHART_COLORS.pillar[idx % CHART_COLORS.pillar.length];
    const pct = Math.round((slice.count / total) * 100);

    doc.rect(legendX, legendY, 10, 10).fill(color);
    doc
      .fillColor(CHART_COLORS.text)
      .font("Helvetica")
      .fontSize(9)
      .text(`${slice.name} — ${slice.count} (${pct}%)`, legendX + 16, legendY + 1, {
        width: 260,
        lineBreak: false,
        ellipsis: true,
      });

    legendY += 18;
  });
}

// =============================================================
// Horizontal benchmark bar — one row = one service
// Shows low → mean → high band with Brex position marker
// =============================================================
export function drawBenchmarkRow(
  doc: PDFKit.PDFDocument,
  benchmark: Benchmark,
  x: number,
  y: number,
  width: number,
): number {
  const rowHeight = 44;

  // Service label
  doc
    .fillColor(CHART_COLORS.navy)
    .font("Helvetica-Bold")
    .fontSize(9)
    .text(benchmark.service, x, y, {
      width: width,
      lineBreak: false,
      ellipsis: true,
    });

  const barY = y + 14;
  const barHeight = 8;
  const barWidth = width - 140;
  const barX = x;

  // Background track
  doc.rect(barX, barY, barWidth, barHeight).fill(CHART_COLORS.light);

  // Compute positions on the low-high scale
  const range = benchmark.high - benchmark.low;
  if (range > 0) {
    // Mean-position band (middle ~30% around mean)
    const meanPos = ((benchmark.mean - benchmark.low) / range) * barWidth;
    const bandWidth = barWidth * 0.3;
    const bandX = Math.max(barX, barX + meanPos - bandWidth / 2);
    const bandEnd = Math.min(barX + barWidth, barX + meanPos + bandWidth / 2);
    doc.rect(bandX, barY, bandEnd - bandX, barHeight).fill(CHART_COLORS.accent);
  }

  // Range labels (low - high)
  doc
    .fillColor(CHART_COLORS.muted)
    .font("Helvetica")
    .fontSize(8)
    .text(formatMoney(benchmark.low, benchmark.unit), barX, barY + barHeight + 3, {
      width: 60,
      lineBreak: false,
    });

  doc
    .fillColor(CHART_COLORS.navy)
    .font("Helvetica-Bold")
    .fontSize(8)
    .text(
      formatMoney(benchmark.mean, benchmark.unit),
      barX + barWidth / 2 - 30,
      barY + barHeight + 3,
      { width: 60, align: "center", lineBreak: false },
    );

  doc
    .fillColor(CHART_COLORS.muted)
    .font("Helvetica")
    .fontSize(8)
    .text(
      formatMoney(benchmark.high, benchmark.unit),
      barX + barWidth - 60,
      barY + barHeight + 3,
      { width: 60, align: "right", lineBreak: false },
    );

  // Unit + Brex positioning tag on the right
  doc
    .fillColor(CHART_COLORS.muted)
    .font("Helvetica")
    .fontSize(8)
    .text(benchmark.unit, barX + barWidth + 10, barY - 2, {
      width: 130,
      lineBreak: false,
    });

  doc
    .fillColor(CHART_COLORS.accent)
    .font("Helvetica-Bold")
    .fontSize(8)
    .text(
      benchmark.brexPositioning === "premium"
        ? "BREX: PREMIUM"
        : benchmark.brexPositioning === "mid-market"
          ? "BREX: MID-MARKET"
          : "BREX: BOUTIQUE",
      barX + barWidth + 10,
      barY + 10,
      { width: 130, lineBreak: false, characterSpacing: 0.5 },
    );

  return y + rowHeight;
}

// =============================================================
// 12-week Gantt-style timeline — pillars across weeks
// =============================================================
export function drawGanttTimeline(
  doc: PDFKit.PDFDocument,
  calendar: ContentPlanPayload["blogCalendar"],
  pillars: { name: string; description: string }[],
  x: number,
  y: number,
  width: number,
): number {
  const weekCount = Math.max(calendar.length, 12);
  const weekWidth = (width - 100) / weekCount;
  const rowHeight = 18;
  const startX = x + 100;

  // Header — week numbers
  doc
    .fillColor(CHART_COLORS.muted)
    .font("Helvetica-Bold")
    .fontSize(7)
    .text("PILLAR", x, y, { width: 95, lineBreak: false, characterSpacing: 0.5 });

  for (let w = 1; w <= weekCount; w++) {
    doc
      .fillColor(CHART_COLORS.muted)
      .font("Helvetica")
      .fontSize(7)
      .text(`W${w}`, startX + (w - 1) * weekWidth, y, {
        width: weekWidth,
        align: "center",
        lineBreak: false,
      });
  }

  let currentY = y + 14;

  pillars.forEach((pillar, idx) => {
    const color = CHART_COLORS.pillar[idx % CHART_COLORS.pillar.length];

    // Pillar label
    doc
      .fillColor(CHART_COLORS.text)
      .font("Helvetica-Bold")
      .fontSize(8)
      .text(pillar.name, x, currentY + 4, {
        width: 95,
        lineBreak: false,
        ellipsis: true,
      });

    // Background row
    doc
      .rect(startX, currentY, weekWidth * weekCount, rowHeight - 4)
      .fill(CHART_COLORS.light);

    // For each week, count posts matching this pillar and draw a colored square
    for (let w = 0; w < weekCount; w++) {
      const week = calendar[w];
      if (!week?.posts) continue;
      const matchCount = week.posts.filter((p) => p.pillar === pillar.name).length;
      if (matchCount > 0) {
        // Opacity relative to post count in this week for this pillar
        doc
          .rect(startX + w * weekWidth + 1, currentY + 1, weekWidth - 2, rowHeight - 6)
          .fill(color);

        // Count label
        doc
          .fillColor("#FFFFFF")
          .font("Helvetica-Bold")
          .fontSize(7)
          .text(String(matchCount), startX + w * weekWidth, currentY + 3, {
            width: weekWidth,
            align: "center",
            lineBreak: false,
          });
      }
    }

    currentY += rowHeight;
  });

  return currentY + 4;
}

// =============================================================
// Stat block — "at a glance" numbers with big colored numbers
// =============================================================
export function drawStatBlock(
  doc: PDFKit.PDFDocument,
  stats: { value: string; label: string }[],
  x: number,
  y: number,
  width: number,
): number {
  const cols = Math.min(stats.length, 4);
  const cellWidth = width / cols;

  stats.slice(0, cols).forEach((stat, idx) => {
    const cellX = x + idx * cellWidth;
    const isLast = idx === cols - 1;

    // Big number
    doc
      .fillColor(CHART_COLORS.accent)
      .font("Times-Bold")
      .fontSize(28)
      .text(stat.value, cellX, y, {
        width: cellWidth - (isLast ? 0 : 10),
        align: "center",
        lineBreak: false,
      });

    // Label
    doc
      .fillColor(CHART_COLORS.muted)
      .font("Helvetica-Bold")
      .fontSize(7)
      .text(stat.label.toUpperCase(), cellX, y + 34, {
        width: cellWidth - (isLast ? 0 : 10),
        align: "center",
        characterSpacing: 0.8,
        lineBreak: false,
      });

    // Divider
    if (!isLast) {
      doc
        .moveTo(cellX + cellWidth - 5, y + 5)
        .lineTo(cellX + cellWidth - 5, y + 45)
        .strokeColor(CHART_COLORS.border)
        .lineWidth(0.5)
        .stroke();
    }
  });

  return y + 60;
}

// =============================================================
// Weekly cadence bar chart — posts per week (horizontal bars)
// =============================================================
export function drawCadenceBar(
  doc: PDFKit.PDFDocument,
  calendar: ContentPlanPayload["blogCalendar"],
  x: number,
  y: number,
  width: number,
): number {
  const maxPosts = Math.max(...calendar.map((w) => w.posts?.length ?? 0), 1);
  const barSpacing = 4;
  const availableWidth = width - 60;
  const barWidth = (availableWidth - barSpacing * (calendar.length - 1)) / calendar.length;
  const chartHeight = 60;
  const topPadding = 14; // room for count labels above bars

  calendar.forEach((week, idx) => {
    const barX = x + 40 + idx * (barWidth + barSpacing);
    const postCount = week.posts?.length ?? 0;
    const barH = (postCount / maxPosts) * chartHeight;
    const barY = y + topPadding + chartHeight - barH;

    // Bar
    doc
      .rect(barX, barY, barWidth, barH)
      .fill(CHART_COLORS.accent);

    // Count label above bar
    doc
      .fillColor(CHART_COLORS.text)
      .font("Helvetica-Bold")
      .fontSize(7)
      .text(String(postCount), barX, barY - 10, {
        width: barWidth,
        align: "center",
        lineBreak: false,
      });

    // Week number below
    doc
      .fillColor(CHART_COLORS.muted)
      .font("Helvetica")
      .fontSize(7)
      .text(`W${week.weekNumber}`, barX, y + topPadding + chartHeight + 3, {
        width: barWidth,
        align: "center",
        lineBreak: false,
      });
  });

  // Y-axis line
  doc
    .moveTo(x + 38, y + topPadding)
    .lineTo(x + 38, y + topPadding + chartHeight)
    .strokeColor(CHART_COLORS.border)
    .lineWidth(0.5)
    .stroke();

  // Y-axis label
  doc
    .fillColor(CHART_COLORS.muted)
    .font("Helvetica")
    .fontSize(7)
    .text("posts", x, y + topPadding + chartHeight / 2 - 4, {
      width: 35,
      align: "right",
      lineBreak: false,
    });

  return y + topPadding + chartHeight + 18;
}
