// Editable, evidence-bound summary visuals. Values come from the saved payload
// or approved catalog; qualitative diagrams describe the stated program only.
import { DeckLayout, C, scaled, textHeight } from "./pptx-layout";
import type { ContentPlanPayload } from "@shared/schema";
import { BREX_TIERS } from "@shared/brex-pricing";
import { packageRange } from "@shared/service-packages";
import { ENGAGEMENT } from "@shared/engagement-terms";
import { formatMoney, type Benchmark } from "./pricing-benchmarks";

const rect = (s: any, x: number, y: number, w: number, h: number, color = C.light) =>
  s.addShape("roundRect", { ...scaled({ x, y, w, h }), fill: { color }, line: { color: C.border, width: .5 } });
const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export function engagementTimeline(d: DeckLayout) {
  const s = d.slide("12-Month Growth Engagement", "Months 1–3: on-ramp quarter  |  Initial commitment: six months");
  for (let m = 0; m < 12; m++) {
    const x = .68 + m * .72;
    rect(s, x, 1.58, .65, .48, m < 3 ? C.blue : m < 6 ? C.navy : "EAF1F8");
    d.text(s, `M${m + 1}`, x + .09, 1.7, .5, 12, true, m < 3 ? C.text : m < 6 ? C.white : C.navy);
  }
  rect(s, .68, 2.2, 4.25, .35, C.navy);
  d.text(s, "INITIAL SIX-MONTH COMMITMENT", .82, 2.28, 4, 11, true, C.white);
  rect(s, 5, 2.2, 4.25, .35, "EAF1F8");
  d.text(s, "CONTINUED EXECUTION & OPTIMIZATION", 5.14, 2.28, 4, 11, true, C.navy);
  const phases = [
    ["Months 1–3", "Establish foundations, launch the initial work, and build the operating rhythm."],
    ["Months 4–6", "Continue implementation, testing, and optimization through the initial commitment."],
    ["Months 7–12", "Continue execution, measurement, optimization, and quarterly planning."],
  ];
  phases.forEach(([title, body], i) => {
    const x = .68 + i * 2.89;
    rect(s, x, 2.82, 2.78, 1.4, i === 0 ? "E8F5FE" : "F2F6FB");
    d.text(s, title, x + .16, 2.99, 2.46, 17, true, C.navy);
    d.text(s, body, x + .16, 3.4, 2.46, 14, false, C.text);
  });
  d.text(s, ENGAGEMENT.caveat, .7, 4.47, 8.6, 11, false, C.muted);
  s.addNotes(Object.values(ENGAGEMENT).join("\n"));
}

export function thesisVisual(d: DeckLayout, p: ContentPlanPayload) {
  if (textHeight(p.summary, 5.6, 15) > 2.95) {
    d.section("Strategic Thesis", [{ label: "12-week direction", text: p.summary }]);
    return;
  }
  const s = d.slide("Strategic Thesis", "Strategic direction connected to the proposed publishing program");
  d.text(s, p.summary, .72, 1.7, 5.6, 15, false, C.text);
  const posts = p.blogCalendar.flatMap(w => w.posts);
  [[p.blogCalendar.length, "Publishing weeks"], [posts.length, "Planned posts"], [p.contentPillars.length, "Content pillars"]]
    .forEach(([value, label], i) => {
      rect(s, 6.7, 1.6 + i * 1.05, 2.48, .9, i === 0 ? "E8F5FE" : "F2F6FB");
      d.text(s, value, 6.9, 1.72 + i * 1.05, 2.08, 27, true, C.navy);
      d.text(s, label, 6.9, 2.22 + i * 1.05, 2.08, 11, false, C.muted);
    });
}

export function pillarCards(d: DeckLayout, p: ContentPlanPayload) {
  const posts = p.blogCalendar.flatMap(w => w.posts);
  for (let i = 0; i < p.contentPillars.length; i += 2) {
    const pair = p.contentPillars.slice(i, i + 2);
    if (pair.some(p => textHeight(p.name, 3.72, 18, true) + textHeight(p.description, 3.72, 15) > 2.18)) {
      pair.forEach(p => d.section("Content Pillars", [{ label: p.name, text: p.description },
        { label: "Planned output", text: `${posts.filter(post => post.pillar === p.name).length} posts` }]));
      continue;
    }
    const s = d.slide("Content Pillars", `Strategic themes ${i + 1}–${i + pair.length} of ${p.contentPillars.length}`);
    pair.forEach((pillar, n) => {
      const x = .68 + n * 4.4;
      rect(s, x, 1.58, 4.24, 3.13, n === 0 ? "E8F5FE" : "F2F6FB");
      const titleH = d.text(s, pillar.name, x + .23, 1.83, 3.72, 18, true, C.navy);
      d.text(s, pillar.description, x + .23, 1.98 + titleH, 3.72, 15, false, C.text);
      const count = posts.filter(post => post.pillar === pillar.name).length;
      d.text(s, `${count} planned posts`, x + .23, 4.25, 3.72, 16, true, C.navy);
    });
  }
}

export function publishingHeatmap(d: DeckLayout, p: ContentPlanPayload) {
  const weeks = p.blogCalendar;
  if (!weeks.length) return;
  if (weeks.length > 12 || p.contentPillars.some(pillar => textHeight(pillar.name, 2.5, 12, true) > .52)) {
    for (let start = 0; start < weeks.length; start += 6) {
      const batch = weeks.slice(start, start + 6);
      d.table("Publishing Timeline", ["Content pillar", ...batch.map(w => `W${w.weekNumber}`)],
        [3.4, ...batch.map(() => 5.4 / batch.length)],
        p.contentPillars.map(pillar => [pillar.name, ...batch.map(w => String(w.posts.filter(post => post.pillar === pillar.name).length))]),
        "Actual post counts by pillar; long labels continue without clipping");
    }
    return;
  }
  const max = Math.max(1, ...p.contentPillars.flatMap(pillar => weeks.map(w => w.posts.filter(v => v.pillar === pillar.name).length)));
  for (let start = 0; start < p.contentPillars.length; start += 4) {
    const s = d.slide("Publishing Timeline", "Darker cells indicate more planned posts; every cell shows its actual count");
    const col = 5.75 / weeks.length;
    weeks.forEach((w, j) => d.text(s, `W${w.weekNumber}`, 3.48 + j * col, 1.65, col - .02, 10, true, C.navy));
    p.contentPillars.slice(start, start + 4).forEach((pillar, i) => {
      const y = 2.13 + i * .65;
      d.text(s, pillar.name, .72, y + .07, 2.5, 12, true, C.navy);
      weeks.forEach((w, j) => {
        const count = w.posts.filter(v => v.pillar === pillar.name).length;
        const x = 3.4 + j * col;
        s.addShape("rect", { ...scaled({ x, y, w: col - .035, h: .5 }),
          fill: { color: count ? C.blue : "EDF2F7", transparency: count ? 65 * (1 - count / max) : 0 },
          line: { color: C.white, width: .7 } });
        d.text(s, count, x + .13, y + .13, col - .16, 12, true, C.text);
      });
    });
  }
}

export function retainerRangeCards(d: DeckLayout) {
  const s = d.slide("Brex vs. Market | Retainers", "Monthly ranges, not fixed quotes. Final fees depend on agreed scope.");
  const max = Math.max(...BREX_TIERS.map(t => Math.max(t.monthlyMax, t.industryHigh)));
  BREX_TIERS.forEach((t, i) => {
    const x = .65 + i * 2.94, w = 2.82;
    rect(s, x, 1.55, w, 3.25, i === 1 ? "E8F5FE" : "F2F6FB");
    d.text(s, t.name, x + .18, 1.76, w - .36, 18, true, C.navy);
    d.text(s, packageRange(t), x + .18, 2.58, w - .36, 18, true, C.navy);
    d.text(s, "per month · scope-based", x + .18, 2.98, w - .36, 11, false, C.muted);
    for (const [label, low, high, y, color] of [
      ["Brex range", t.monthly, t.monthlyMax, 3.36, C.blue],
      [`Market: ${usd(t.industryLow)}–${usd(t.industryHigh)}`, t.industryLow, t.industryHigh, 3.96, "8799AF"],
    ] as const) {
      d.text(s, label, x + .18, y, w - .36, 10, true, C.navy);
      const left = x + .18, trackW = w - .36;
      s.addShape("line", { ...scaled({ x: left, y: y + .32, w: trackW, h: 0 }),
        line: { color: C.border, width: 3 } });
      s.addShape("line", { ...scaled({ x: left + trackW * low / max, y: y + .32, w: trackW * (high - low) / max, h: 0 }),
        line: { color, width: 8, beginArrowType: "none", endArrowType: "none" } });
    }
    d.text(s, "$0", x + .18, 4.49, .8, 10, false, C.muted);
    d.text(s, usd(max), x + 1.72, 4.49, .85, 10, false, C.muted);
  });
}

export function benchmarkRanges(d: DeckLayout, benchmarks: Benchmark[]) {
  const s = d.slide("Investment Benchmarks", "Low-to-high ranges with a mean marker. Scales and billing units vary by service.");
  benchmarks.forEach((b, i) => {
    const y = 1.55 + i * .81;
    d.text(s, `${b.service}\n${b.unit}`, .7, y + .03, 3.15, 12, true, C.navy);
    const left = 4.25, width = 4.75, max = Math.max(b.high, 1);
    s.addShape("line", { ...scaled({ x: left, y: y + .25, w: width, h: 0 }), line: { color: C.border, width: 3 } });
    s.addShape("line", { ...scaled({ x: left + width * b.low / max, y: y + .25, w: width * (b.high - b.low) / max, h: 0 }),
      line: { color: C.blue, width: 8 } });
    s.addShape("ellipse", { ...scaled({ x: left + width * b.mean / max - .055, y: y + .195, w: .11, h: .11 }),
      fill: { color: C.navy }, line: { color: C.white, width: 1 } });
    d.text(s, `Low ${formatMoney(b.low, b.unit)}  ·  Mean ${formatMoney(b.mean, b.unit)}  ·  High ${formatMoney(b.high, b.unit)}`,
      left, y + .43, width, 11, false, C.muted);
  });
}

export function roiMetricCards(d: DeckLayout, p: ContentPlanPayload, subtitle: string) {
  const r = p.roiProjections!;
  const o = r.outcomes;
  const s = d.slide("12-Month ROI Projections", subtitle);
  [[usd(o.totalRevenue), "Modeled revenue", `${o.totalClosedWon} closed-won deals`],
    [`${o.roiMultiple.toFixed(2)}x`, "ROI multiple", "Gross profit / program cost"],
    [usd(o.brexCostPerLead), "Cost per lead", "Modeled, not a realized cost"],
    [o.paybackMonth ? `Month ${o.paybackMonth}` : "Beyond 12 months", "Payback", "Modeled breakeven"]]
    .forEach(([value, label, note], i) => {
      const x = .68 + i % 2 * 4.4, y = 1.56 + Math.floor(i / 2) * 1.66;
      rect(s, x, y, 4.24, 1.48, i === 0 ? "E8F5FE" : "F2F6FB");
      d.text(s, label, x + .2, y + .13, 3.84, 13, true, C.navy);
      d.text(s, value, x + .2, y + .48, 3.84, 27, true, C.navy);
      d.text(s, note, x + .2, y + 1.17, 3.84, 11, false, C.muted);
    });
}

export function weekOneCards(d: DeckLayout, week: ContentPlanPayload["blogCalendar"][number]) {
  for (let start = 0; start < week.posts.length; start += 2) {
    const pair = week.posts.slice(start, start + 2);
    const blocks = pair.map(post => [
      { text: post.scheduledDate || "Date not specified", size: 12, bold: true, color: C.navy },
      { text: post.title, size: 17, bold: true, color: C.navy },
      { text: `Pillar: ${post.pillar}`, size: 12, bold: false, color: C.muted },
      { text: `Answers: ${post.targetQuery}`, size: 14, bold: false, color: C.text },
    ]);
    if (blocks.some(set => set.reduce((h, b) => h + textHeight(b.text, 3.78, b.size, b.bold) + .16, 0) > 2.78)) {
      pair.forEach(post => d.section("Week 1 Preview", [
        { label: post.title, text: `Pillar: ${post.pillar}\nScheduled: ${post.scheduledDate}\nAnswers: ${post.targetQuery}` },
      ]));
      continue;
    }
    const s = d.slide("Week 1 Preview", `Week ${week.weekNumber} · ${week.weekOf} · planned posts ${start + 1}–${start + pair.length}`);
    blocks.forEach((set, i) => {
      const x = .68 + i * 4.4;
      rect(s, x, 1.58, 4.24, 3.15, i === 0 ? "E8F5FE" : "F2F6FB");
      let y = 1.8;
      for (const b of set) y += d.text(s, b.text, x + .23, y, 3.78, b.size, b.bold, b.color) + .16;
    });
  }
}

export function modelLimitations(d: DeckLayout, disclaimer: string) {
  if (textHeight(disclaimer, 5.45, 15) > 2.8) {
    d.section("ROI | Assumptions & Limitations", [{ label: "Read before using these projections", text: disclaimer }]);
    return;
  }
  const s = d.slide("ROI | Assumptions & Limitations", "A planning model, not a guarantee");
  d.text(s, disclaimer, .72, 1.72, 5.45, 15, false, C.text);
  ["Saved assumptions", "Modeled projections", "Review before decisions"].forEach((label, i) => {
    const y = 1.6 + i * 1.05;
    rect(s, 6.62, y, 2.58, .72, i === 1 ? "E8F5FE" : "F2F6FB");
    d.text(s, label, 6.82, y + .2, 2.18, 13, true, C.navy);
    if (i < 2) s.addShape("line", { ...scaled({ x: 7.91, y: y + .76, w: 0, h: .25 }),
      line: { color: C.blue, width: 2, endArrowType: "triangle" } });
  });
}

export function nextStepsFlow(d: DeckLayout) {
  const s = d.slide("Next Steps", "Turn the approved direction into an owned delivery sequence");
  const steps = [
    ["Approve", "Confirm strategy direction and content-pillar framing."],
    ["Plan", "Confirm publishing cadence: 10 posts per week baseline."],
    ["Launch", "Kick off week-one briefs with the Brex team."],
    ["Review", "Schedule the biweekly review checkpoint."],
  ];
  steps.forEach(([title, body], i) => {
    const x = .68 + i * 2.2;
    if (i < 3) s.addShape("line", { ...scaled({ x: x + .6, y: 1.92, w: 1.8, h: 0 }),
      line: { color: C.blue, width: 2, endArrowType: "triangle" } });
    rect(s, x, 2.4, 2.04, 2.14, i === 0 ? "E8F5FE" : "F2F6FB");
    s.addShape("ellipse", { ...scaled({ x: x + .04, y: 1.64, w: .54, h: .54 }),
      fill: { color: C.navy }, line: { color: C.navy } });
    d.text(s, i + 1, x + .21, 1.77, .28, 15, true, C.white);
    d.text(s, title, x + .14, 2.62, 1.76, 18, true, C.navy);
    d.text(s, body, x + .14, 3.18, 1.76, 14, false, C.text);
  });
}
