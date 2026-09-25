// Editable, content-aware PowerPoint export. Dense content continues on a new
// slide instead of shrinking type, truncating findings, or overlapping boxes.
import type { ContentPlanPayload, SwotAnalysis, PestelAnalysis, PortersFiveForces, CustomerInsights, FrameworkSource } from "@shared/schema";
import { DeckLayout, C, clean, textHeight, scaled, type Block } from "./pptx-layout";
import { fetchProspectLogo } from "./logo-fetch";
import { BREX_TIERS, BREX_LINE_ITEMS, BREX_BLENDED_HOURLY, computeSavings } from "@shared/brex-pricing";
import { PRICING_BENCHMARKS, BENCHMARK_SOURCES, formatMoney } from "./pricing-benchmarks";
import { compatiblePptx } from "./pptx-package";
import { ENGAGEMENT } from "@shared/engagement-terms";

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
const money = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const field = (label: string, text: unknown): Block => ({ label, text: clean(text) });
const sources = (items: FrameworkSource[] = []): Block[] => items.map(s => ({
  label: "Source", text: [s.publisher, s.title].filter(Boolean).join(" | ") || s.url,
  url: s.url,
}));
const labelize = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ").replace(/^./, c => c.toUpperCase());
// Enumerate selected structured fields without dropping longer values or array entries.
const details = (obj: Record<string, unknown>): Block[] => Object.entries(obj)
  .filter(([, v]) => v !== undefined && v !== null && v !== "")
  .map(([k, v]) => field(labelize(k), Array.isArray(v) ? v.join(" · ") : v));

async function cover(d: DeckLayout, args: PptxExportArgs) {
  const s = d.pptx.addSlide(); d.slides.push(s); s.background = { color: C.navy };
  d.text(s, "BREX CONSULTING", .6, .55, 6.8, 15, true, C.white);
  d.text(s, "ATLAS / CONTENT STRATEGY BRIEFING", .6, 1.05, 7, 11, true, C.white);
  // Logo has its own reserved band and never shifts the title into the footer.
  try {
    const logo = await fetchProspectLogo(args.clientUrl);
    if (logo) s.addImage({
      data: logo.dataUrl, ...scaled({ x: 8.5, y: .5, w: .9, h: .9 }),
      sizing: { type: "contain", w: 1.2, h: 1.2 },
    });
  } catch { /* A failed logo lookup must not block the report. */ }
  const size = textHeight(args.clientName, 8.8, 34, true) <= 1.9 ? 34 : 25;
  if (textHeight(args.clientName, 8.8, size, true) <= 1.9) {
    d.text(s, args.clientName, .6, 2, 8.8, size, true, C.white);
  } else {
    d.text(s, "Client strategy briefing", .6, 2, 8.8, 34, true, C.white);
  }
  d.text(s, "On-ramp quarter | 12-week content strategy", .6, 4.02, 8.8, 18, false, C.white);
  if (textHeight(args.clientUrl, 8.8, 11) <= .34) d.text(s, args.clientUrl, .6, 4.37, 8.8, 11, false, C.white, args.clientUrl);
  d.text(s, `Prepared by Brex Consulting · ${(args.generatedAt ?? new Date()).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`, .6, 4.8, 8.8, 11, false, C.white);
  if (textHeight(args.clientName, 8.8, size, true) > 1.9) d.section("Prepared for", [field("Client", args.clientName)]);
  if (textHeight(args.clientUrl, 8.8, 11) > .34) d.section("Client Details", [field("Website", args.clientUrl)]);
}

function program(d: DeckLayout, p: ContentPlanPayload) {
  const weeks = p.blogCalendar ?? [], pillars = p.contentPillars ?? [];
  const posts = weeks.flatMap(w => w.posts ?? []);
  const counts = new Map<string, number>(pillars.map(p => [p.name, 0]));
  posts.forEach(p => { if (p.pillar) counts.set(p.pillar, (counts.get(p.pillar) ?? 0) + 1); });
  const s = d.slide("At a Glance", "Program scope");
  const stats = [[posts.length, "Planned posts"], [weeks.length, "Publishing weeks"], [pillars.length, "Content pillars"], [new Set(posts.map(p => p.targetQuery).filter(Boolean)).size, "AEO queries"]];
  stats.forEach(([value, label], i) => {
    const x = .6 + (i % 2) * 4.55, y = 1.6 + Math.floor(i / 2) * 1.65;
    s.addShape("rect", { ...scaled({ x, y, w: 4.25, h: 1.4 }), fill: { color: C.light }, line: { color: C.light } });
    d.text(s, value, x + .2, y + .15, 3.85, 32, true, C.navy);
    d.text(s, label, x + .2, y + .93, 3.85, 13, false, C.muted);
  });
  d.section("Strategic Thesis", [field("12-week direction", p.summary)]);
  d.bars("Pillar Mix", Array.from(counts).map(([name, n]) => ({
    label: name, value: n, detail: `${n} posts\n${posts.length ? Math.round(n / posts.length * 100) : 0}%`,
  })), "Planned posts by content pillar");
  pillars.forEach((pillar, i) => d.section(`Content Pillar ${i + 1}`, [
    field(pillar.name, pillar.description), field("Planned output", `${counts.get(pillar.name) ?? 0} posts`),
  ]));
  // Six weeks per panel: readable labels, repeated headings, no 12-column squeeze.
  for (let start = 0; start < weeks.length; start += 6) {
    const batch = weeks.slice(start, start + 6);
    d.table("Publishing Timeline", ["Content pillar", ...batch.map((_, i) => `W${start + i + 1}`)],
      [3.4, ...batch.map(() => 5.4 / batch.length)],
      pillars.map(pillar => [pillar.name, ...batch.map(w => String((w.posts ?? []).filter(p => p.pillar === pillar.name).length))]),
      `Weeks ${start + 1}–${start + batch.length} · posts by pillar`);
  }
}

function frameworks(d: DeckLayout, args: PptxExportArgs) {
  if (args.swot) {
    d.section("SWOT Analysis", [field("Strategic read", args.swot.summary), field("Industry", args.swot.industry)]);
    (["strengths", "weaknesses", "opportunities", "threats"] as const).forEach(q =>
      d.section(`SWOT | ${labelize(q)}`, args.swot![q].map(v => field(`${v.id} · ${v.title}`, v.evidence))));
  }
  if (args.pestel) {
    d.section("PESTEL Analysis", [field("Macro environment", args.pestel.summary)]);
    for (const factor of ["political", "economic", "social", "technological", "environmental", "legal"]) {
      d.section(`PESTEL | ${labelize(factor)}`, args.pestel.findings.filter(f => f.factor === factor).flatMap(f => [
        field(`${f.id} · ${f.impact} impact · ${f.timeHorizon} term`, f.insight), ...sources(f.sources),
      ]));
    }
  }
  if (args.porters) {
    d.section("Porter’s Five Forces", [field("Industry structure", args.porters.overallStructure), field("Strategic read", args.porters.summary)]);
    args.porters.forces.forEach(f => d.section(`Five Forces | ${labelize(f.force)}`, [
      field(`Intensity: ${f.intensity}`, f.rationale), ...f.drivers.map((v, i) => field(`Driver ${i + 1}`, v)), ...sources(f.sources),
    ]));
  }
}

function customers(d: DeckLayout, c?: CustomerInsights | null) {
  if (!c) return;
  d.section("Customer Insights", [field("Executive read", c.summary), field("Voice-of-customer evidence", c.vocEvidenceMode)]);
  c.personas.forEach((p, i) => d.section(`Buyer Persona ${i + 1}`, details(p)));
  d.section("Buyer Psychographics", details(c.psychographics));
  d.section("Buyer Sociotype", details(c.sociotype));
  c.painPoints.forEach((p, i) => d.section(`Buyer Pain ${i + 1}`, [field(p.label, p.symptom), ...details({
    businessCost: p.businessCost, currentWorkaround: p.currentWorkaround, ourLeverage: p.ourLeverage,
  })]));
  c.jtbd.forEach((j, i) => d.section(`Jobs to Be Done ${i + 1}`, details(j)));
  d.section("Voice of Customer", c.voiceOfCustomer.flatMap(v => [
    { label: `${v.speaker} | ${v.isParaphrased ? "Paraphrased / representative" : "Quoted"} | ${v.source}`, text: v.quote, url: v.sourceUrl },
    field("Theme", v.theme),
  ]));
  d.section("Would They Buy?", c.wouldTheyBuySignals.map(v => field(`${v.strength} signal · ${v.signal}`, v.whatItMeans)));
  d.section("Buyer Validation Questions", c.momTestQuestions.flatMap(v => [
    field(v.question, v.whyItWorks), field("Avoid asking", v.antipattern),
  ]));
  d.section("Buying Signals", c.buyingSignals.map(v => field(`${v.urgency} · ${v.category} · ${v.trigger}`, v.action)));
  c.decisionCommittee.forEach((v, i) => d.section(`Decision Committee ${i + 1}`, details(v)));
  c.objections.forEach((v, i) => d.section(`Objection Handling ${i + 1}`, details(v)));
  // One stage at a time replaces the original five narrow, overflowing columns.
  c.journeyStages.forEach((v, i) => d.section(`Buyer Journey | Stage ${i + 1}`, details(v)));
  d.section("Customer Evidence Sources", sources(c.vocSources));
}

function pricing(d: DeckLayout) {
  d.table("Brex vs. Market | Retainers", ["Engagement", "Brex / mo", "Market low–high / mo"], [3.2, 2.1, 3.5],
    BREX_TIERS.map(t => [t.name, money(t.monthly), `${money(t.industryLow)}–${money(t.industryHigh)}`]),
    "Existing catalog prices; market benchmarks are indicative");
  BREX_TIERS.forEach(t => d.section(t.name, [
    field("Best for", t.bestFor),
    field("Monthly investment", `${money(t.monthly)} · à la carte equivalent ${money(t.aLaCarteMonthly)} · bundle discount ${t.discountPct}%`),
    ...t.includes.map((v, i) => field(`Included ${i + 1}`, v)),
    ...t.industrySourceUrls.map(url => ({ label: "Source", text: new URL(url).hostname, url })),
  ]));
  d.table("Brex vs. Market | Services", ["Service", "Brex", "Market midpoint", "Vs. midpoint"], [3.2, 1.9, 2.2, 1.5],
    BREX_LINE_ITEMS.map(v => [v.service, `${v.brexUnit === "% of spend" ? `${v.brexPrice}%` : money(v.brexPrice)}\n${v.brexUnit}`,
      `${v.benchmarkUnit === "% of spend" ? `${v.benchmarkMid}%` : money(v.benchmarkMid)}\n${v.benchmarkUnit}`, computeSavings(v.brexPrice, v.benchmarkMid).label]),
    `Blended delivery rate: ${money(BREX_BLENDED_HOURLY)}/hour · catalog unchanged`);
  const labels = ["Blog content", "SEO/AEO", "Fractional CMO", "LinkedIn Ads management"];
  const top = labels.map(label => PRICING_BENCHMARKS.find(b => b.service.startsWith(label) && !b.service.includes("%"))).filter(Boolean);
  d.table("Investment Benchmarks", ["Service", "Low", "Mean", "High"], [4, 1.6, 1.6, 1.6],
    top.map(b => [b!.service, formatMoney(b!.low, b!.unit), formatMoney(b!.mean, b!.unit), formatMoney(b!.high, b!.unit)]),
    "Reference ranges from the existing pricing dataset");
}

function sitemap(d: DeckLayout, p: ContentPlanPayload) {
  const sm = p.sitemap; if (!sm) return;
  const pages = sm.pages ?? [];
  d.section("SEO / GEO Site Architecture", [field("Architecture", sm.overview),
    field("Scope", `${pages.length} pages · ${pages.reduce((n, p) => n + (p.internalLinksOut?.length ?? 0), 0)} internal links`),
    field("Local SEO", sm.local?.included ? `Included. ${sm.local.guidance}` : sm.local?.guidance || "Not applicable"),
    field("Linking coverage", `${sm.linkingSummary?.blogsLinked ?? 0} blogs linked · ${sm.linkingSummary?.socialsLinked ?? 0} social posts linked · ${sm.linkingSummary?.orphanPages?.length ?? 0} orphan pages`),
  ]);
  const types = new Map<string, number>(); pages.forEach(p => types.set(p.pageType, (types.get(p.pageType) ?? 0) + 1));
  d.bars("Page Type Mix", Array.from(types).map(([t, n]) => ({ label: labelize(t), value: n })), "Pages by architectural role");
  // Match prior highlight scope: key pages first, with the complete directory following.
  const keyTypes = ["home", "solution", "service", "comparison", "case-study"];
  const highlights = [...pages].filter(p => keyTypes.includes(p.pageType)).sort((a, b) => {
    const rank = (t: string) => keyTypes.includes(t) ? keyTypes.indexOf(t) : 99;
    return rank(a.pageType) - rank(b.pageType);
  }).slice(0, 4);
  highlights.forEach((p, i) => d.section(`Site Page Brief ${i + 1}`, [
    field(p.title, `${p.slug} · ${p.keywordIntent}`), field("Primary keyword", p.primaryKeyword),
    field("Secondary keywords", (p.secondaryKeywords ?? []).join(" · ")), field("Meta title", p.metaTitle),
    field("Meta description", p.metaDescription), field("H1", p.h1),
    field("Structure", `${p.h2Outline?.length ?? 0} H2 sections · ${p.geoAnswerBlocks?.length ?? 0} GEO/AEO answer blocks`),
    field("Primary CTA", `${p.primaryCta?.label ?? ""} ${p.primaryCta?.targetSlug || p.primaryCta?.targetUrl || ""}`),
    field("USP alignment", p.uspAlignment),
    field("Linking", `${p.inboundBlogTitles?.length ?? 0} blogs in · ${p.inboundSocialTitles?.length ?? 0} socials in · ${p.internalLinksOut?.length ?? 0} internal links out`),
  ]));
  d.table("Full Site Directory", ["Page", "Path", "Intent"], [3.3, 3.5, 2],
    pages.map(p => [p.title, p.slug, p.keywordIntent]));
}

function roi(d: DeckLayout, p: ContentPlanPayload) {
  const r = p.roiProjections; if (!r) return;
  const { outcomes: o, assumptions: a, monthlyProjection: months } = r;
  d.table("12-Month ROI Projections", ["Metric", "Modeled result"], [5.8, 3], [
    ["Total revenue", money(o.totalRevenue)], ["Closed-won deals", String(o.totalClosedWon)],
    ["Gross profit / program cost", `${o.roiMultiple.toFixed(2)}x`],
    ["Cost per lead", money(o.brexCostPerLead)], ["Payback", o.paybackMonth ? `Month ${o.paybackMonth}` : "Beyond 12 months"],
  ], "Modeled projections, not guaranteed outcomes");
  d.section("ROI | Assumptions & Limitations", [field("Read before using these projections", r.disclaimer || "Projections depend on the report assumptions, execution quality, and market conditions. Actual results may differ.")]);
  const chart = (title: string, subtitle: string, data: { name: string; labels: string[]; values: number[] }[], currency = false, bar = false) => {
    const s = d.slide(title, subtitle);
    const peak = Math.max(1, ...data.flatMap(series => series.values));
    const magnitude = Math.pow(10, Math.floor(Math.log10(peak)));
    const axisMax = Math.ceil(peak * 1.3 / magnitude) * magnitude;
    s.addChart(bar ? d.pptx.ChartType.bar : d.pptx.ChartType.line, data, {
      ...scaled({ x: .6, y: 1.55, w: 8.8, h: 2.9 }), showLegend: !bar, legendPos: "t", legendFontSize: 11,
      chartColors: [C.navy, C.blue], catAxisLabelFontSize: 11, valAxisLabelFontSize: 10,
      valAxisLabelFormatCode: currency ? "$#,##0" : "#,##0", lineSize: 2.5, lineDataSymbolSize: 4,
      showValue: bar, dataLabelFontSize: 12, dataLabelFormatCode: currency ? "$#,##0" : "#,##0",
      barDir: "col",
      ...(bar ? {
        valAxisMinVal: 0, valAxisMaxVal: axisMax, valAxisMajorUnit: axisMax / 5,
        valGridLine: { color: C.border, size: .5 },
      } : {}),
    });
    d.text(s, "Modeled projection. See the report’s assumptions and limitations.", .6, 4.62, 8.8, 11, false, C.muted);
  };
  const labels = months.map(m => `M${m.month}`);
  chart("Organic Traffic Growth", "Monthly visitors as published content matures", [{ name: "Visitors", labels, values: months.map(m => m.monthlyVisitors) }]);
  chart("Lead Growth", "Monthly leads shown separately to preserve a readable scale", [{ name: "Leads", labels, values: months.map(m => m.monthlyLeads) }]);
  const stages: [string, number][] = [["Visitors", o.month12CumulativeVisitors], ["Leads", o.totalLeads], ["MQLs", o.totalMqls], ["SQLs", o.totalSqls], ["Closed won", o.totalClosedWon]];
  d.table("12-Month Conversion Funnel", ["Stage", "Volume", "From prior stage"], [3.8, 2.5, 2.5],
    stages.map(([label, value], i) => [label, value.toLocaleString(), i ? (stages[i - 1][1] > 0 ? `${(value / stages[i - 1][1] * 100).toFixed(1)}%` : "N/A") : "Baseline"]));
  chart("Program Cost vs. Paid Media", "12-month cost to generate the modeled lead volume", [{ name: "Cost", labels: ["Brex program", "Paid CPL equivalent"], values: [a.programCost12Mo, o.paidEquivalentCost] }], true, true);
  d.section("Cost Comparison | Readout", [field("Savings vs. paid equivalent", `${money(o.savingsVsPaid)} over 12 months`),
    field("Basis", "Paid-equivalent cost uses the report’s paid CPL benchmark; this is a modeled comparison, not a guarantee.")]);
  chart("Payback Timeline", o.paybackMonth ? `Modeled breakeven at month ${o.paybackMonth}` : "Payback extends beyond the modeled period", [
    { name: "Cumulative gross profit", labels, values: months.map(m => m.cumulativeGrossProfit) },
    { name: "Cumulative program cost", labels, values: months.map(m => a.programCost12Mo / 12 * m.month) },
  ], true);
}

/** Exposed for deterministic geometry regression tests; no analysis or CRM writes. */
export async function createContentPlanDeck(args: PptxExportArgs): Promise<DeckLayout> {
  const d = new DeckLayout(args.clientName);
  await cover(d, args);
  d.section("12-Month Growth Engagement", [
    field("Engagement structure", ENGAGEMENT.term),
    field("Why six months", `${ENGAGEMENT.commitment} ${ENGAGEMENT.caveat}`),
    field("The on-ramp quarter", ENGAGEMENT.onRamp),
    field("Beyond the on-ramp", ENGAGEMENT.continuation),
  ]);
  program(d, args.payload);
  frameworks(d, args);
  customers(d, args.customerInsights);
  pricing(d);
  sitemap(d, args.payload);
  roi(d, args.payload);
  d.section("Next Steps", [
    field("Approve", "Confirm strategy direction and content-pillar framing."),
    field("Plan", "Confirm the publishing cadence and distribution budget."),
    field("Launch", "Kick off week-one briefs with the Brex team."),
    field("Review", "Schedule the biweekly review checkpoint."),
  ]);
  const urls = new Map(BENCHMARK_SOURCES.map(s => [s.url, `${s.publisher} | ${s.title}`]));
  BREX_LINE_ITEMS.forEach(v => v.sourceUrls.forEach(url => { if (!urls.has(url)) urls.set(url, new URL(url).hostname); }));
  d.section("Sources & Citations", Array.from(urls).map(([url, text]) => ({ label: "Source", text, url })));
  d.finish();
  return d;
}
export async function buildContentPlanPptx(args: PptxExportArgs): Promise<Buffer> {
  const d = await createContentPlanDeck(args);
  return compatiblePptx(await d.pptx.write({ outputType: "nodebuffer" }) as Buffer);
}
