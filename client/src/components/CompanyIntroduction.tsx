import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";
import { COMPANY_FACT_KEYS, COMPANY_FACT_LABELS, readCompanyProfile } from "@shared/company-profile";

export function CompanyIntroduction({ profile: raw, analysisId, canResearch = false }: {
  profile?: unknown; analysisId?: string; canResearch?: boolean;
}) {
  const profile = readCompanyProfile(raw);
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/analyses/${analysisId}/company-profile`)).json(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/analyses", analysisId] });
    },
  });
  const unknown = COMPANY_FACT_KEYS.filter(key => !profile?.facts.some(f => f.key === key));
  return <Card className="p-5 sm:p-6" data-testid="company-introduction">
    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div>
        <p className="text-xs uppercase tracking-widest text-accent font-semibold">Company background</p>
        <h2 className="text-xl font-semibold mt-1">Introduction</h2>
      </div>
      {canResearch && analysisId && <Button variant="outline" size="sm" disabled={mutation.isPending}
        onClick={() => mutation.mutate()} data-testid="research-introduction">
        {mutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
        {mutation.isPending ? "Researching…" : profile?.facts.length ? "Refresh introduction" : "Research introduction"}
      </Button>}
    </div>
    {profile?.facts.length ? <>
      <p className="text-base leading-8 break-words" data-testid="introduction-paragraph">
        {profile.facts.map(f => <span key={f.key}>
          {f.status !== "reported" && <span className="text-xs font-semibold text-muted-foreground">{f.status === "estimate" ? "Estimate: " : "Observed: "}</span>}
          {f.sentence}{" "}
          <span className="inline-flex gap-1 mr-1 align-baseline">
            {f.sources.map((s, i) => <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
              className="text-xs text-primary underline underline-offset-2" title={`${COMPANY_FACT_LABELS[f.key]}: ${s.title}`}
              aria-label={`${COMPANY_FACT_LABELS[f.key]} source ${i + 1}: ${s.title}`}
              data-testid={`introduction-source-${f.key}-${i}`}>[{profile.facts.indexOf(f) + 1}{f.sources.length > 1 ? String.fromCharCode(97 + i) : ""}]</a>)}
          </span>{" "}
        </span>)}
      </p>
      <p className="text-xs text-muted-foreground mt-4">Researched {new Date(profile.researchedAt).toLocaleDateString()}. Source-reported facts are not independently audited. Estimates and observed activity are labeled.</p>
    </> : <p className="text-sm text-muted-foreground" data-testid="introduction-empty">
      This saved report does not yet have a researched company introduction. {canResearch
        ? "Research it without changing the strategy, full report findings, or content plan."
        : "Company background will appear here once researched in the full view."}
    </p>}
    {profile && unknown.length > 0 && <p className="text-sm text-muted-foreground mt-3" data-testid="introduction-unknown">
      <span className="font-medium">Not verified in this research: </span>{unknown.map(key => COMPANY_FACT_LABELS[key]).join("; ")}.
    </p>}
    {mutation.isPending && <p className="text-xs text-muted-foreground mt-3" role="status">Checking public company sources. This may take a minute or two; your existing report remains unchanged.</p>}
    {mutation.isError && <p className="text-sm text-destructive mt-3" role="alert">{mutation.error.message}</p>}
  </Card>;
}
