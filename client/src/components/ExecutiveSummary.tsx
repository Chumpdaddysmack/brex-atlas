import { useEffect, useId, useState } from "react";
import { Card } from "@/components/ui/card";
import { EXECUTIVE_ROLES, executiveRole, buildExecutiveSummary, buildDemoExecutiveSummary,
  type ExecutiveSummaryInput } from "@shared/executive-summary";
import type { DemoReport } from "@shared/demo-report";

export function ExecutiveSummary(props: { input: ExecutiveSummaryInput; demo?: never } | { demo: DemoReport; input?: never }) {
  const id = useId();
  const [role, setRole] = useState(() => executiveRole(new URLSearchParams(window.location.search).get("pov")));
  useEffect(() => {
    const sync = () => setRole(executiveRole(new URLSearchParams(window.location.search).get("pov")));
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  const summary = props.demo ? buildDemoExecutiveSummary(props.demo, role) : buildExecutiveSummary(props.input!, role);
  return <Card className="p-5 sm:p-6 space-y-5 min-w-0" data-testid="executive-summary">
    <div className="flex flex-wrap items-start justify-between gap-5">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">Executive perspective</p>
        <h2 className="text-xl font-semibold mt-2">Executive summary</h2>
        <p className="text-sm text-muted-foreground mt-1">One report. Four decision-making viewpoints.</p>
      </div>
      <div className="w-full sm:w-48 shrink-0">
        <label htmlFor={id} className="block text-xs font-semibold mb-2">Read from the point of view of</label>
        <select id={id} value={role} data-testid="executive-pov-select"
          className="w-full h-11 rounded-md border border-input bg-background text-foreground px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          onChange={e => {
            const next = executiveRole(e.target.value);
            const url = new URL(window.location.href);
            url.searchParams.set("pov", next);
            window.history.replaceState(window.history.state, "", url);
            setRole(next);
          }}>
          {EXECUTIVE_ROLES.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </div>
    </div>
    <div aria-live="polite" aria-atomic="true" data-testid="executive-pov-status" className="text-sm font-semibold text-primary">
      {role} perspective · {summary.focus}
    </div>
    <p className="text-sm leading-relaxed max-w-prose" data-testid="executive-pov-opening">{summary.opening}</p>
    <div className="grid lg:grid-cols-3 gap-4" data-testid="executive-pov-sections">
      {summary.sections.map((section, index) => <section key={`${role}-${index}`}
        className="rounded-lg border bg-muted/20 p-4 min-w-0 space-y-3" data-testid={`executive-priority-${index}`}>
        <h3 className="text-base font-semibold">{section.title}</h3>
        <p className="text-sm leading-relaxed">{section.framing}</p>
        {section.evidence ? <details className="border-t pt-3" data-testid={`executive-evidence-${index}`} open>
          <summary className="text-xs font-semibold cursor-pointer py-1">Report basis · {section.evidence.origin}</summary>
          <p className="text-xs text-muted-foreground mt-2">{section.evidence.status}</p>
          <p className="text-sm leading-relaxed whitespace-pre-line break-words mt-2">{section.evidence.text}</p>
          {!!section.evidence.sources.length && <ul className="mt-2 space-y-1">
            {section.evidence.sources.map((source, n) => <li key={n} className="text-xs">
              <a href={source.url} target="_blank" rel="noopener noreferrer" className="underline break-words">{source.title}</a>
              {source.date && <span className="text-muted-foreground"> · {source.date}</span>}
            </li>)}
          </ul>}
        </details> : <p className="text-sm text-muted-foreground border-t pt-3" data-testid={`executive-missing-${index}`}>
          {summary.demo ? "Not included in the selected demo excerpts. Review this with Brex before making a decision."
            : "Not established in this saved report. Confirm this information before making a decision."}
        </p>}
        <div className="border-t pt-3">
          <p className="text-xs font-semibold text-muted-foreground">Decision to discuss</p>
          <p className="text-sm leading-relaxed mt-1">{section.question}</p>
        </div>
      </section>)}
    </div>
    <p className="text-xs text-muted-foreground leading-relaxed border-t pt-4" data-testid="executive-pov-disclosure">
      {summary.demo ? "Demo: only selected excerpts are used. " : ""}
      Role-specific framing uses saved report findings, not new research or additional verification.
      Source passages and available citations are preserved. Questions are prompts for discussion, not established facts.
      Switching viewpoints does not change the report, service recommendation, or PDF and slide exports.
    </p>
  </Card>;
}
