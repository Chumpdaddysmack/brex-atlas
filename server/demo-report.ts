import type { Analysis, ContentPlan } from "@shared/schema";
import type { DemoGroup, DemoItem, DemoReport, DemoSection } from "@shared/demo-report";

// Explicit allowlist: never return the original JSON blobs, internal notes,
// full calendars, draft copy, price tiers, or modelled financial outcomes.
// Projection only: no mutation, persistence, regeneration, or paid service calls.
function parse(raw: unknown): any {
  if (typeof raw !== "string") return null;
  try { return JSON.parse(raw); } catch { return null; }
}
const list = (value: any): any[] => Array.isArray(value) ? value : [];
const first = (value: any): any => list(value)[0] ?? {};
const text = (value: any): string => typeof value === "string" ? value.trim() : "";
function item(label: string, value: any): DemoItem | null {
  const content = text(value);
  // Don't silently cut a long finding, its caveats, or a sentence in half.
  return content && content.length <= 2400 ? { label: text(label) || "Selected finding", text: content } : null;
}
function sourced(label: string, value: any, sources: any): DemoItem | null {
  const result = item(label, value);
  if (!result) return null;
  result.sources = list(sources).flatMap(s => {
    try {
      const url = new URL(s.url);
      return ["https:", "http:"].includes(url.protocol)
        ? [{ title: text(s.title) || url.hostname, url: url.href }] : [];
    } catch { return []; }
  });
  return result;
}
export function buildDemoReport(analysis: Analysis, plan: ContentPlan | null): DemoReport {
  const e = parse(analysis.extraction), competitors = parse(analysis.competitors);
  const s = parse(analysis.strategy), sow = parse(analysis.sow), swot = parse(analysis.swot);
  const pestel = parse(analysis.pestel), porters = parse(analysis.porters), ci = parse(analysis.customerInsights);
  const p = parse(plan?.planJson);
  const sections: DemoSection[] = [];
  function add(id: string, group: DemoGroup, title: string, items: (DemoItem | null)[], fullReport: string) {
    sections.push({ id, group, title, items: items.filter((i): i is DemoItem => i !== null), fullReport });
  }
  add("positioning", "overview", "Website positioning", [item("Current positioning", e?.positioningStatement)],
    "Complete website findings, value propositions, offerings, and supporting evidence.");
  add("conversion", "overview", "Conversion opportunities", [item("CTA review", e?.ctaAudit)],
    "The broader conversion review and prioritized responses.");
  add("seo", "overview", "SEO and answer-engine readiness", [item("Readiness notes", e?.aeoReadinessNotes || e?.seoNotes)],
    "The full SEO/AEO assessment and recommendations.");
  const competitor = first(competitors);
  add("competitor", "overview", "Competitive intelligence", [item(text(competitor.name) || "One competitor", competitor.positioning)],
    "The remaining competitors, strengths, weaknesses, and differentiated campaign angles.");
  add("icp", "strategy", "Ideal customer profile", [item("Customer profile", s?.icp?.summary)],
    "Firmographics, pain points, buying triggers, and the complete targeting rationale.");
  add("gap", "strategy", "Positioning gaps", [item("One gap", first(s?.positioningGaps))],
    "All identified gaps and their strategic implications.");
  add("messaging", "strategy", "Messaging direction", [item("One recommendation", first(s?.messagingRecommendations))],
    "The full set of messaging recommendations.");
  add("aeo", "strategy", "AEO recommendations", [item("One recommendation", first(s?.aeoRecommendations))],
    "The remaining answer-engine recommendations and priorities.");
  const pillar = first(s?.contentPillars);
  add("pillar", "strategy", "Content pillars", [item(text(pillar.name), pillar.description)],
    "The complete pillar system and proposed titles.");
  const channel = first(s?.channelMix);
  add("channel", "strategy", "Channel strategy", [item(text(channel.channel), channel.role)],
    "The full channel mix and prioritization.");
  add("quick-win", "strategy", "First practical move", [item("One quick win", first(s?.quickWins))],
    "The remaining quick wins and detailed implementation sequence.");
  const phase = first(s?.ninetyDayPlan);
  add("roadmap", "strategy", "90-day roadmap", [item(text(phase.phase) || "Opening priority", phase.focus)],
    "The complete phased roadmap, outcomes, and strategic rationale.");
  add("scope", "strategy", "Scope of work", [item("Engagement overview", sow?.engagementSummary)],
    "Detailed phases, team, deliverables, pricing, and terms.");
  add("swot", "frameworks", "SWOT", ["strengths", "weaknesses", "opportunities", "threats"].map(key => {
    const value = first(swot?.[key]);
    return item(`${key[0].toUpperCase() + key.slice(1)}: ${text(value.title)}`, value.evidence);
  }), "The remaining SWOT findings and connected recommendations.");
  const factor = first(pestel?.findings);
  add("pestel", "frameworks", "PESTEL", [sourced(text(factor.factor), factor.insight, factor.sources)],
    "All available macro-environment findings, impacts, horizons, and citations.");
  const force = first(porters?.forces);
  add("porters", "frameworks", "Porter's Five Forces", [sourced(text(force.force), force.rationale, force.sources)],
    "The other forces, intensity ratings, drivers, and structural assessment.");
  add("buyer-summary", "buyer", "Buyer intelligence", [item("Buyer overview", ci?.summary)],
    "The complete buyer profile and behavioral hypotheses.");
  const pain = first(ci?.painPoints);
  add("buyer-pain", "buyer", "Buyer pain points", [item(text(pain.label), pain.symptom)],
    "Ranked pains, business costs, workarounds, and response strategies.");
  const signal = first(ci?.wouldTheyBuySignals);
  add("buyer-signal", "buyer", "Buying signals", [item(text(signal.signal), signal.whatItMeans)],
    "The remaining signals, discovery questions, and outreach triggers.");
  const objection = first(ci?.objections);
  add("buyer-objection", "buyer", "Objections and the buying journey", [item(text(objection.objection), objection.underlyingFear)],
    "Reframes, proof assets, decision roles, and the full buyer journey.");
  add("thesis", "content", "12-week content strategy", [item("Strategic thesis", p?.summary)],
    "The complete content-pillar system and cross-channel plan.");
  const post = first(first(p?.blogCalendar).posts);
  add("blog", "content", "Publishing calendar", [item(text(post.title), post.angle || post.targetQuery)],
    "The full 12-week calendar, keywords, editorial briefs, and schedule.");
  for (const [key, name] of [["linkedin", "LinkedIn"], ["instagram", "Instagram"], ["x", "X"]]) {
    const social = list(p?.socialCadence).find(v => v?.channel === key);
    const starter = first(social?.starterPosts);
    add(key, "content", name, [item(text(starter.title), starter.hook || starter.angle)],
      "The remaining social starters, cadence, and execution direction.");
  }
  for (const [key, name] of [["meta_ad", "Meta ads"], ["linkedin_ad", "LinkedIn ads"]]) {
    const ad = list(p?.adBrief).find(v => v?.channel === key);
    const creative = first(ad?.creatives);
    add(key, "content", name, [item(text(creative.title), creative.angle)],
      "The full audience brief, creative variations, claims, and sample copy.");
  }
  add("email", "content", "Cold email", [item("One subject-line direction", p?.heroColdEmail?.subjectLineA)],
    "The complete sequence, targeting, body copy, and follow-up touches.");
  const landing = first(p?.landingPages);
  add("landing", "content", "Landing pages", [item(text(landing.title), landing.targetQuery)],
    "The remaining landing pages, outlines, and conversion direction.");
  const page = first(p?.sitemap?.pages);
  add("architecture", "content", "Site architecture", [item(text(page.title), page.uspAlignment || page.metaDescription)],
    "The complete sitemap, page briefs, SEO metadata, linking plan, and draft copy.");
  add("roi", "content", "ROI assumptions", [item("Deal-size rationale", p?.roiProjections?.assumptions?.rationale?.dealSize)],
    "The full assumptions, scenario model, sensitivity analysis, and financial projections. Estimates are not guaranteed results.");
  return { mode: "demo", version: 1, id: analysis.id, clientName: analysis.clientName,
    clientUrl: analysis.clientUrl, status: analysis.status, sections };
}
