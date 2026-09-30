import test from "node:test";
import assert from "node:assert/strict";
import { EXECUTIVE_ROLES, executiveRole, buildExecutiveSummary, buildDemoExecutiveSummary } from "./executive-summary";
import type { DemoReport } from "./demo-report";

const input = {
  clientName: "QA Example",
  extraction: {
    positioningStatement: "Positioning passage without additional claims.",
    targetAudience: "Operations leaders at regional service companies.",
    ctaAudit: "A consultation CTA appears on the services page.",
    companyProfile: { version: 1, researchedAt: "2026-09-30T12:00:00Z", facts: [
      { key: "annualRevenue", sentence: "2025 revenue was estimated at $8 million by Example Research.",
        status: "estimate", sources: [{ title: "Financial reference", url: "https://example.com/revenue", date: "2025" }] },
      { key: "employees", sentence: "The company reported 30 employees in 2025.",
        status: "reported", sources: [{ title: "Company information", url: "https://example.com/about" }] },
    ] },
  },
  strategy: {
    icp: { summary: "Prioritize regional operators researching a new service partner." },
    positioningGaps: ["The report identifies a need for clearer vertical-specific proof."],
    messagingRecommendations: ["Test proof-led messages with the selected buyer group."],
    channelMix: [{channel:"Search",role:"Support active solution research.",priority:"High"}],
    ninetyDayPlan: [{phase:"Establish the baseline",focus:"Validate positioning and buyer needs.",
      outcomes:["A proposed measurement baseline, subject to access and validation."]}],
  },
  porters: {forces:[{force:"buyerPower",rationale:"The report assesses buyer power as high; this is not a measured margin effect.",
    sources:[{title:"Market reference",url:"https://example.com/market",date:"2026"}]}]},
};
test("four distinct perspectives change framing and evidence without mutating the report", () => {
  const before = JSON.stringify(input);
  const summaries = EXECUTIVE_ROLES.map(role => buildExecutiveSummary(input, role));
  assert.deepEqual(summaries.map(s=>s.role), ["CEO","CFO","COO","CMO"]);
  assert.equal(new Set(summaries.map(s=>s.opening)).size, 4);
  assert.equal(new Set(summaries.map(s=>s.sections[0].title)).size, 4);
  assert.equal(summaries[0].sections[0].evidence?.text, input.strategy.icp.summary);
  assert.equal(summaries[3].sections[0].evidence?.text, input.strategy.messagingRecommendations[0]);
  assert.equal(JSON.stringify(input), before);
});
test("financial estimates, dates, source URLs and outcome caveats remain intact", () => {
  const cfo = buildExecutiveSummary(input, "CFO");
  assert.match(cfo.sections[0].evidence!.status, /estimate/);
  assert.equal(cfo.sections[0].evidence!.text, input.extraction.companyProfile.facts[0].sentence);
  assert.equal(cfo.sections[0].evidence!.sources[0].url, "https://example.com/revenue");
  assert.equal(cfo.sections[0].evidence!.sources[0].date, "2025");
  const coo = buildExecutiveSummary(input, "COO");
  assert.equal(coo.sections[2].evidence?.text, input.strategy.ninetyDayPlan[0].outcomes[0]);
  assert.match(coo.sections[2].evidence!.status, /not guaranteed/);
});
test("legacy JSON strings, partial reports and malformed fields are handled without invented evidence", () => {
  assert.deepEqual(buildExecutiveSummary({...input,extraction:JSON.stringify(input.extraction)}, "CFO"),
    buildExecutiveSummary(input, "CFO"));
  for (const role of EXECUTIVE_ROLES) {
    const empty = buildExecutiveSummary({clientName:"Empty",extraction:"broken",strategy:{channelMix:[null],ninetyDayPlan:null}}, role);
    assert.ok(empty.sections.every(s=>s.evidence === null));
  }
  assert.equal(executiveRole("invalid"), "CEO");
  assert.equal(executiveRole(null), "CEO");
  assert.equal(executiveRole("CFO"), "CFO");
});
test("demo summaries cannot use hidden full-report fields, profile financials or visuals", () => {
  const demo: DemoReport = {mode:"demo",version:1,id:"",clientName:"Demo QA",clientUrl:"https://example.com",
    status:"done",companyProfile:input.extraction.companyProfile as any,sections:[
      {id:"gap",group:"strategy",title:"Positioning gaps",items:[{label:"Selected",text:"An approved demo-only gap."}],fullReport:"SECRET full gap"},
      {id:"roadmap",group:"strategy",title:"Opening phase",items:[{label:"Selected",text:"An approved opening priority."}],fullReport:"SECRET full plan"},
    ],
    // Unexpected/legacy fields must not become a back door into full content.
    ...({strategy:input.strategy,extraction:input.extraction,visuals:{secret:"SECRET VISUAL"}} as any)};
  for (const role of EXECUTIVE_ROLES) {
    const summary = buildDemoExecutiveSummary(demo, role);
    assert.equal(summary.demo, true);
    assert.doesNotMatch(JSON.stringify(summary), /SECRET|8 million|30 employees|regional operators|proof-led/);
  }
  assert.equal(buildDemoExecutiveSummary(demo,"CFO").sections[0].evidence,null);
  assert.equal(buildDemoExecutiveSummary(demo,"CEO").sections[1].evidence?.text,"An approved demo-only gap.");
});
test("unsafe citation URLs are excluded, and unsupported citations are not synthesized", () => {
  const unsafe = structuredClone(input);
  unsafe.porters.forces[0].sources = [{title:"Unsafe",url:"javascript:alert(1)",date:"2026"}];
  assert.deepEqual(buildExecutiveSummary(unsafe,"CFO").sections[2].evidence?.sources,[]);
  assert.deepEqual(buildExecutiveSummary(input,"CEO").sections[0].evidence?.sources,[]);
});
