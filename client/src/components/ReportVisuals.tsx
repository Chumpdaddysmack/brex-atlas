import { useState, type ReactNode } from "react";
import { ArrowRight, ChevronDown, LockKeyhole, Route, Target, Users, Layers, GitCompareArrows } from "lucide-react";
import type { ReportVisuals as VisualData } from "@shared/report-visuals";
import "./report-visuals.css";

type VisualKind = "positioning" | "competitors" | "swot" | "journey" | "roadmap";
const titles = {
  positioning: ["POSITIONING", "Connect the buyer to the promise", Target],
  competitors: ["COMPETITIVE COMPARISON", "See your business beside the alternatives", GitCompareArrows],
  swot: ["SWOT", "Four lenses. A clearer set of choices.", Layers],
  journey: ["BUYER JOURNEY", "Follow the questions behind the purchase", Users],
  roadmap: ["90-DAY ROADMAP", "Turn the strategy into a sequence", Route],
} as const;
const captions = {
  positioning: "Follow the connected steps. Select one to explore the saved finding.",
  competitors: "A qualitative comparison of the saved analysis, not a score or market ranking.",
  swot: "Internal factors above. External factors below. Open a finding to see its evidence.",
  journey: "A proposed buyer journey, not observed customer behavior. Select a stage to explore it.",
  roadmap: "A proposed sequence, not measured progress. Select a phase to see its focus.",
};
function Values({ values }: { values: string[] }) {
  return values.length ? <ul className="rv-values">{values.map((v, i) => <li key={i}>{v}</li>)}</ul>
    : <p className="rv-muted">Not available in this saved analysis.</p>;
}
function Locked({ label }: { label: string }) {
  return <div className="rv-locked"><LockKeyhole size={18} aria-hidden="true" /><div><strong>{label}</strong><p>Reserved for Full report</p></div></div>;
}
function Empty({ label }: { label: string }) {
  return <div className="rv-empty"><Layers size={24} aria-hidden="true" /><div><strong>{label} isn’t available yet.</strong><p>This saved report does not contain enough structured data to draw it. No findings have been invented.</p></div></div>;
}
export function ReportDetails({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return <details className="rv-original" data-testid={`details-${id}`}>
    <summary data-testid={`toggle-details-${id}`}><span>{label}</span><ChevronDown size={16} aria-hidden="true" /></summary>
    <div className="pt-5">{children}</div>
  </details>;
}
export function ReportVisual({ kind, data }: { kind: VisualKind; data: VisualData }) {
  const [eyebrow, title, Icon] = titles[kind];
  return <section className="rv-shell" data-testid={`visual-${kind}`} aria-label={eyebrow}>
    <header className="rv-heading">
      <div><p className="rv-eyebrow"><Icon size={15} aria-hidden="true" />{eyebrow}</p><h2>{title}</h2></div>
      <span className="rv-mode">{data.preview ? "Selected preview" : "Visual overview"}</span>
    </header>
    <p className="rv-caption">{captions[kind]}</p>
    {kind === "positioning" && <Positioning data={data} />}
    {kind === "competitors" && <Comparison data={data} />}
    {kind === "swot" && <Swot data={data} />}
    {kind === "journey" && <Journey data={data} />}
    {kind === "roadmap" && <Roadmap data={data} />}
    <footer className="rv-footer">
      <span>{data.preview ? "Only selected examples are shown. This is not the complete analysis." : "Drawn from the saved report. Original findings and caveats remain in the supporting analysis."}</span>
    </footer>
  </section>;
}
function Positioning({ data }: { data: VisualData }) {
  const [selected, setSelected] = useState(2);
  const active = data.positioning[selected] ?? data.positioning[0];
  if (!data.positioning.some(n => n.values.length)) return <Empty label="The positioning map" />;
  return <>
    <ol className="rv-flow rv-flow-four">
      {data.positioning.map((n, i) => <li key={n.label}>
        <button className="rv-node" aria-pressed={selected === i} onClick={() => setSelected(i)} data-testid={`positioning-node-${i}`}>
          <span className="rv-node-top"><span className="rv-number">{String(i + 1).padStart(2, "0")}</span><ArrowRight size={17} aria-hidden="true" /></span>
          <strong>{n.label}</strong><span className="rv-excerpt">{n.values[0] || "Not available in this report"}</span>
          <span className="rv-explore">Explore {n.label.toLowerCase()}</span>
        </button>
      </li>)}
    </ol>
    <div className="rv-detail" data-testid="positioning-detail" aria-live="polite">
      <div className="rv-detail-label">{active?.label}<span>{data.preview ? "Opening example" : "Saved findings"}</span></div>
      <Values values={active?.values ?? []} />
    </div>
  </>;
}
function Comparison({ data }: { data: VisualData }) {
  const [dimension, setDimension] = useState<"positioning" | "signals" | "gaps">("positioning");
  const rows = data.competitors;
  if (rows.length < 2) return <Empty label="The competitive comparison" />;
  return <>
    {!data.preview && <div className="rv-controls" role="group" aria-label="Comparison lens">
      {([["positioning", "Positioning"], ["signals", "Evidence & strengths"], ["gaps", "Gaps"]] as const).map(([key, label]) =>
        <button key={key} aria-pressed={dimension === key} onClick={() => setDimension(key)} data-testid={`comparison-${key}`}>{label}</button>)}
    </div>}
    <div className="rv-comparison">
      {rows.map((c, i) => <article key={i} className={`rv-company ${c.client ? "rv-company-client" : ""}`} data-testid={`comparison-company-${i}`}>
        <header><span className="rv-eyebrow">{c.client ? "YOUR BUSINESS" : "ALTERNATIVE"}</span><h3>{c.name}</h3></header>
        <div className="rv-company-body">
          <p className="rv-small-label">{dimension === "positioning" ? "Positioning in saved analysis" : dimension === "signals" ? c.client ? "Website proof signals" : "Reported strengths" : c.client ? "Positioning gaps" : "Reported weaknesses"}</p>
          <Values values={c[dimension].slice(0, 1)} />
          {c[dimension].length > 1 && <details className="rv-more"><summary data-testid={`comparison-more-${i}`}>Explore {c[dimension].length - 1} more</summary><Values values={c[dimension].slice(1)} /></details>}
        </div>
      </article>)}
    </div>
    {data.preview && <Locked label="Additional competitors and comparison lenses" />}
  </>;
}
function Swot({ data }: { data: VisualData }) {
  if (!data.swot.some(q => q.findings.length)) return <Empty label="The SWOT board" />;
  return <>
    <div className="rv-swot-axis" aria-hidden="true"><span>Helpful to growth</span><span>Challenges to address</span></div>
    <div className="rv-swot">
      {data.swot.map(q => <article key={q.key} className="rv-quadrant" data-tone={q.key === "weaknesses" || q.key === "threats" ? "challenge" : "helpful"}>
        <header><span className="rv-letter" aria-hidden="true">{q.label[0]}</span><div><p className="rv-small-label">{q.origin} · {q.action}</p><h3>{q.label}</h3></div></header>
        {q.findings.length ? q.findings.map((f, i) => <details className="rv-finding" key={i}>
          <summary data-testid={`swot-finding-${q.key}-${i}`}><span>{f.title}</span><ChevronDown size={16} aria-hidden="true" /></summary>
          <p>{f.evidence}</p>
        </details>) : <p className="rv-muted">No finding available in this saved section.</p>}
      </article>)}
    </div>
    {data.preview && <Locked label="Remaining findings and strategic implications" />}
  </>;
}
function Journey({ data }: { data: VisualData }) {
  const [selected, setSelected] = useState(0);
  const stage = data.journey[selected] ?? data.journey[0];
  if (!stage) return <Empty label="The buyer journey" />;
  return <>
    <ol className={`rv-flow rv-flow-journey ${data.preview ? "rv-flow-preview" : ""}`}>
      {data.journey.map((s, i) => <li key={i}><button className="rv-node" aria-pressed={selected === i} onClick={() => setSelected(i)} data-testid={`journey-stage-${i}`}>
        <span className="rv-node-top"><span className="rv-number">{String(i + 1).padStart(2, "0")}</span><ArrowRight size={17} aria-hidden="true" /></span>
        <strong className="capitalize">{s.label}</strong><span className="rv-excerpt">{s.question || s.mindset}</span><span className="rv-explore">Explore stage</span>
      </button></li>)}
      {data.preview && <li><Locked label="Later buying stages" /></li>}
    </ol>
    <div className="rv-journey-detail" data-testid="journey-detail" aria-live="polite">
      <div className="rv-question"><p className="rv-small-label">THE BUYER’S QUESTION</p><p>{stage.question || "No question recorded."}</p></div>
      <div className="rv-detail-grid">
        {([["Mindset", stage.mindset], ["Channel", stage.channel], ["Content to support the decision", stage.asset], ["Next action", stage.cta], ["Evidence of moving forward", stage.exit]]).filter(([, v]) => v).map(([label, val]) =>
          <div key={label}><p className="rv-small-label">{label}</p><p>{val}</p></div>)}
      </div>
    </div>
  </>;
}
function Roadmap({ data }: { data: VisualData }) {
  const [selected, setSelected] = useState(0);
  const phase = data.roadmap[selected] ?? data.roadmap[0];
  if (!phase) return <Empty label="The 90-day roadmap" />;
  return <>
    <ol className={`rv-flow rv-flow-roadmap ${data.preview ? "rv-flow-preview" : ""}`}>
      {data.roadmap.map((p, i) => <li key={i}><button className="rv-node" aria-pressed={selected === i} onClick={() => setSelected(i)} data-testid={`roadmap-phase-${i}`}>
        <span className="rv-node-top"><span className="rv-number">{String(i + 1).padStart(2, "0")}</span><span className="rv-period">{p.weeks || "Proposed phase"}</span></span>
        <strong>{p.label}</strong><span className="rv-excerpt">{p.focus}</span><span className="rv-explore">Explore phase <ArrowRight size={14} aria-hidden="true" /></span>
      </button></li>)}
      {data.preview && <li><Locked label="Later phases and implementation detail" /></li>}
    </ol>
    <div className="rv-detail" data-testid="roadmap-detail" aria-live="polite">
      <div className="rv-detail-label">{phase.label}<span>{data.preview ? "Opening focus" : phase.weeks || "Timing not recorded"}</span></div>
      <div><p>{phase.focus}</p>{!!phase.outcomes.length && <div className="rv-outcomes"><p className="rv-small-label">INTENDED OUTCOMES</p><Values values={phase.outcomes} /></div>}</div>
    </div>
  </>;
}
