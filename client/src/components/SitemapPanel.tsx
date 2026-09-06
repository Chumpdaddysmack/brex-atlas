// =============================================================
// Sitemap Panel — SEO/GEO Site Architecture viewer + regenerator
// =============================================================
// Renders the sitemap payload from a content plan:
//   - Overview + summary stats
//   - Grouped page list (by pageType) with expandable detail per page
//   - Local SEO section (always shown; either included=true with pages or
//     included=false with guidance)
//   - Linking summary + orphan page warnings
//   - Full-regenerate button (async, polls plan status)
//   - Crosslink-only refresh button (~30s, refreshes blog/social assignments)
// =============================================================
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Loader2,
  RefreshCw,
  Sparkles,
  ChevronRight,
  Link2,
  MapPin,
  AlertTriangle,
  Search,
  FileText,
  Copy,
  Check,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type {
  ContentPlan,
  ContentPlanPayload,
  SitemapPageBrief,
  SitemapPageType,
} from "@shared/schema";

// ---------- Page-type grouping order and labels ----------
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

const INTENT_COLOR: Record<string, string> = {
  informational: "bg-blue-100 text-blue-900 border-blue-200",
  navigational: "bg-slate-100 text-slate-900 border-slate-200",
  commercial: "bg-amber-100 text-amber-900 border-amber-200",
  transactional: "bg-emerald-100 text-emerald-900 border-emerald-200",
};

export interface SitemapPanelProps {
  planId: string;
  planPayload: ContentPlanPayload;
  planStatus: string; // ContentPlan['status']
}

export function SitemapPanel({ planId, planPayload, planStatus }: SitemapPanelProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const sitemap = planPayload.sitemap;

  // ----- Mutations -----
  const regenMut = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", `/api/content-plans/${planId}/sitemap/regenerate`);
      return r.json();
    },
    onSuccess: () => {
      toast({
        title: "Regenerating site architecture",
        description: "This takes about 10 minutes. This page will refresh automatically.",
      });
      // Invalidate the plan query so its refetchInterval kicks back in
      // (Content Studio polls while status !== 'ready')
      qc.invalidateQueries({ queryKey: ["/api/analyses"] });
    },
    onError: (e: any) =>
      toast({ title: "Regenerate failed", description: e?.message ?? "Unknown error", variant: "destructive" }),
  });

  const crosslinkMut = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", `/api/content-plans/${planId}/sitemap/crosslink`);
      return r.json();
    },
    onSuccess: (data) => {
      const s = data?.linkingSummary;
      toast({
        title: "Cross-links refreshed",
        description: s ? `${s.blogsLinked} blogs · ${s.socialsLinked} socials · ${s.orphanPages?.length ?? 0} orphans` : "Done",
      });
      qc.invalidateQueries({ queryKey: ["/api/analyses"] });
    },
    onError: (e: any) =>
      toast({ title: "Cross-link failed", description: e?.message ?? "Unknown error", variant: "destructive" }),
  });

  // Hooks must run in a stable order regardless of whether sitemap exists,
  // so compute grouping/orphan-set unconditionally and only branch on render.
  const groups = useMemo(() => {
    if (!sitemap) return [] as { type: SitemapPageType; label: string; pages: SitemapPageBrief[] }[];
    const byType: Partial<Record<SitemapPageType, SitemapPageBrief[]>> = {};
    for (const page of sitemap.pages) {
      const t = (page.pageType ?? "service") as SitemapPageType;
      if (!byType[t]) byType[t] = [];
      byType[t]!.push(page);
    }
    return TYPE_ORDER.filter((t) => byType[t] && byType[t]!.length > 0).map((t) => ({
      type: t,
      label: TYPE_LABELS[t],
      pages: byType[t]!,
    }));
  }, [sitemap]);

  const orphanSet = useMemo(
    () => new Set(sitemap?.linkingSummary?.orphanPages ?? []),
    [sitemap],
  );
  const isGenerating = planStatus === "generating";

  // ----- Empty state: no sitemap yet -----
  if (!sitemap) {
    return (
      <Card className="p-8">
        <div className="flex flex-col items-center text-center gap-4">
          <div className="rounded-full bg-primary/10 p-4">
            <Search className="h-8 w-8 text-primary" />
          </div>
          <div>
            <h3 className="text-lg font-semibold">No site architecture yet</h3>
            <p className="text-sm text-muted-foreground max-w-md mt-2">
              Generate a 15-25 page SEO/GEO sitemap with meta tags, H1/H2 outlines, 300-500 word
              draft copy, and FAQ blocks optimized for AI search engines. Runs in about 10 minutes.
            </p>
          </div>
          <Button
            onClick={() => regenMut.mutate()}
            disabled={regenMut.isPending || isGenerating}
            data-testid="btn-generate-sitemap"
          >
            {regenMut.isPending || isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {isGenerating ? "Generating..." : "Starting..."}
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Generate Site Architecture
              </>
            )}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* ----- Overview + stats + actions ----- */}
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
          <div className="flex-1 min-w-[280px]">
            <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-2">
              SEO / GEO site architecture
            </div>
            <p className="text-base leading-relaxed">{sitemap.overview}</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => crosslinkMut.mutate()}
              disabled={crosslinkMut.isPending || isGenerating}
              data-testid="btn-refresh-crosslinks"
              title="Refresh blog/social internal-link assignments (~30 seconds)"
            >
              {crosslinkMut.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Link2 className="h-4 w-4 mr-2" />
              )}
              Refresh links
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => regenMut.mutate()}
              disabled={regenMut.isPending || isGenerating}
              data-testid="btn-regenerate-sitemap"
              title="Regenerate the full sitemap from analysis (~10 minutes)"
            >
              {regenMut.isPending || isGenerating ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              {isGenerating ? "Regenerating..." : "Regenerate"}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Total pages" value={sitemap.totalPages} icon={FileText} />
          <StatCard
            label="Internal links"
            value={sitemap.linkingSummary?.totalInternalLinks ?? 0}
            icon={Link2}
          />
          <StatCard label="Blogs linked" value={sitemap.linkingSummary?.blogsLinked ?? 0} />
          <StatCard label="Socials linked" value={sitemap.linkingSummary?.socialsLinked ?? 0} />
        </div>

        {sitemap.linkingSummary?.orphanPages?.length ? (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div>
              <strong>{sitemap.linkingSummary.orphanPages.length} orphan pages</strong> have no inbound
              blog or social links yet. Aggregator pages (hubs, home, blog index) are expected —
              service/solution pages are not. Try &ldquo;Refresh links&rdquo; if this looks wrong.
            </div>
          </div>
        ) : null}
      </Card>

      {/* ----- Local SEO section ----- */}
      <LocalSection local={sitemap.local} hasLocalSection={sitemap.hasLocalSection} />

      {/* ----- Grouped page list ----- */}
      {groups.map((group) => (
        <Card key={group.type} className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">{group.label}</h3>
            <Badge variant="secondary">{group.pages.length}</Badge>
          </div>
          <div className="space-y-3">
            {group.pages.map((page) => (
              <PageRow key={page.id} page={page} isOrphan={orphanSet.has(page.id)} />
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

// ---------- Sub-components ----------

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon?: any;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {label}
      </div>
      <div className="text-2xl font-semibold">{value.toLocaleString()}</div>
    </div>
  );
}

function LocalSection({
  local,
  hasLocalSection,
}: {
  local?: import("@shared/schema").SitemapPayload["local"];
  hasLocalSection: boolean;
}) {
  if (!local) return null;
  const included = local.included && hasLocalSection;
  return (
    <Card className={`p-6 ${included ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200 bg-slate-50/40"}`}>
      <div className="flex items-start gap-3">
        <MapPin className={`h-5 w-5 mt-0.5 ${included ? "text-emerald-700" : "text-slate-500"}`} />
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-base font-semibold">Local SEO</h3>
            <Badge variant={included ? "default" : "secondary"}>
              {included ? "Included" : "Not applicable"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">{local.guidance}</p>
          {included && local.serviceAreas?.length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2">
                Service areas
              </div>
              <div className="flex flex-wrap gap-1.5">
                {local.serviceAreas.map((area) => (
                  <Badge key={area} variant="outline">
                    {area}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {included && local.locationPageSlugs?.length > 0 && (
            <div className="mt-3 text-xs text-muted-foreground">
              {local.locationPageSlugs.length} location page{local.locationPageSlugs.length === 1 ? "" : "s"}
              {local.cityHubSlug ? ` + 1 city hub` : ""}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function PageRow({ page, isOrphan }: { page: SitemapPageBrief; isOrphan: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-lg border border-border">
        <CollapsibleTrigger asChild>
          <button
            className="w-full text-left p-4 hover:bg-muted/40 transition-colors"
            data-testid={`row-page-${page.id}`}
          >
            <div className="flex items-start gap-3">
              <ChevronRight
                className={`h-4 w-4 mt-1 flex-shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
              />
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="font-semibold">{page.title}</span>
                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{page.slug}</code>
                  <Badge
                    variant="outline"
                    className={`text-xs ${INTENT_COLOR[page.keywordIntent] ?? ""}`}
                  >
                    {page.keywordIntent}
                  </Badge>
                  {isOrphan && (
                    <Badge variant="outline" className="text-xs border-amber-300 text-amber-800 bg-amber-50">
                      Orphan
                    </Badge>
                  )}
                </div>
                <div className="text-sm text-muted-foreground">
                  <strong>{page.primaryKeyword}</strong>
                  {page.secondaryKeywords?.length > 0 && (
                    <span> · {page.secondaryKeywords.slice(0, 3).join(" · ")}</span>
                  )}
                </div>
              </div>
              <div className="text-xs text-muted-foreground text-right flex-shrink-0">
                <div>{page.inboundBlogTitles?.length ?? 0} blogs</div>
                <div>{page.inboundSocialTitles?.length ?? 0} socials</div>
              </div>
            </div>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <PageDetail page={page} />
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function PageDetail({ page }: { page: SitemapPageBrief }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  function copyMarkdown() {
    const md = pageToMarkdown(page);
    navigator.clipboard.writeText(md).then(
      () => {
        setCopied(true);
        toast({ title: "Copied to clipboard" });
        setTimeout(() => setCopied(false), 1800);
      },
      () => toast({ title: "Copy failed", variant: "destructive" }),
    );
  }

  return (
    <div className="border-t border-border p-4 space-y-4 bg-muted/20">
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={copyMarkdown}>
          {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
          Copy page brief
        </Button>
      </div>

      {/* Meta */}
      <Section title="SEO Meta">
        <MetaField label="H1" value={page.h1} />
        <MetaField label="Meta title" value={page.metaTitle} note={`${page.metaTitle?.length ?? 0} chars`} />
        <MetaField
          label="Meta description"
          value={page.metaDescription}
          note={`${page.metaDescription?.length ?? 0} chars`}
        />
      </Section>

      {/* Outline */}
      {page.h2Outline?.length > 0 && (
        <Section title="Page outline">
          <ul className="space-y-2 text-sm">
            {page.h2Outline.map((h2, i) => (
              <li key={i}>
                <div className="font-medium">{h2.h2}</div>
                {h2.h3s?.length > 0 && (
                  <ul className="ml-4 mt-1 space-y-0.5 text-muted-foreground">
                    {h2.h3s.map((h3, j) => (
                      <li key={j}>— {h3}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* GEO answer blocks */}
      {page.geoAnswerBlocks?.length > 0 && (
        <Section title={`GEO / AEO answer blocks (${page.geoAnswerBlocks.length})`}>
          <div className="space-y-3">
            {page.geoAnswerBlocks.map((qa, i) => (
              <div key={i} className="rounded-md border border-border bg-background p-3">
                <div className="font-medium text-sm mb-1">Q: {qa.question}</div>
                <div className="text-sm text-muted-foreground leading-relaxed">A: {qa.answer}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Draft copy */}
      {page.draftBody && (
        <Section title="Draft copy">
          <div className="rounded-md border border-border bg-background p-4 text-sm whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">
            {page.draftBody}
          </div>
        </Section>
      )}

      {/* Primary CTA */}
      {page.primaryCta && (
        <Section title="Primary CTA">
          <div className="text-sm">
            <div>
              <strong>Label:</strong> {page.primaryCta.label}
            </div>
            {page.primaryCta.targetSlug && (
              <div>
                <strong>Target:</strong>{" "}
                <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{page.primaryCta.targetSlug}</code>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Strategy alignment */}
      <Section title="Strategy alignment">
        <div className="space-y-2 text-sm">
          {page.uspAlignment && page.uspAlignment.trim() && (
            <div>
              <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground mr-2">USP:</span>
              {page.uspAlignment}
            </div>
          )}
          {page.compellingOfferTieIn && (
            <div>
              <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground mr-2">
                Offer tie-in:
              </span>
              {page.compellingOfferTieIn}
            </div>
          )}
          {page.whyUsDifferentiators?.length > 0 && (
            <div>
              <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-1">
                Why-us differentiators
              </div>
              <ul className="ml-4 space-y-0.5 list-disc">
                {page.whyUsDifferentiators.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>
          )}
          {page.icpTargets?.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">ICP:</span>
              {page.icpTargets.map((icp) => (
                <Badge key={icp} variant="outline" className="text-xs">
                  {icp}
                </Badge>
              ))}
            </div>
          )}
          {page.salesRouteMapping && (
            <div>
              <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground mr-2">
                Sales route:
              </span>
              {page.salesRouteMapping}
            </div>
          )}
        </div>
      </Section>

      {/* Linking */}
      <Section title="Internal linking">
        <div className="grid md:grid-cols-3 gap-4 text-sm">
          <LinkList
            title={`Inbound blogs (${page.inboundBlogTitles?.length ?? 0})`}
            items={page.inboundBlogTitles ?? []}
          />
          <LinkList
            title={`Inbound socials (${page.inboundSocialTitles?.length ?? 0})`}
            items={page.inboundSocialTitles ?? []}
          />
          <LinkList
            title={`Outbound links (${page.internalLinksOut?.length ?? 0})`}
            items={(page.internalLinksOut ?? []).map((l) => `${l.anchorText} → ${l.targetSlug}`)}
          />
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-2">{title}</div>
      {children}
    </div>
  );
}

function MetaField({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="text-sm mb-2 last:mb-0">
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">{label}</span>
        {note && <span className="text-xs text-muted-foreground">({note})</span>}
      </div>
      <div>{value}</div>
    </div>
  );
}

function LinkList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="font-medium text-xs mb-1">{title}</div>
      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground italic">None</div>
      ) : (
        <ul className="space-y-0.5 text-xs text-muted-foreground max-h-40 overflow-y-auto">
          {items.map((item, i) => (
            <li key={i} className="truncate" title={item}>
              — {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- Copy-to-clipboard formatter ----------

function pageToMarkdown(page: SitemapPageBrief): string {
  const lines: string[] = [];
  lines.push(`# ${page.title}`);
  lines.push(`**Slug:** \`${page.slug}\`  |  **Type:** ${page.pageType}  |  **Intent:** ${page.keywordIntent}`);
  lines.push("");
  lines.push(`## SEO Meta`);
  lines.push(`- **H1:** ${page.h1}`);
  lines.push(`- **Meta title** (${page.metaTitle?.length ?? 0} chars): ${page.metaTitle}`);
  lines.push(`- **Meta description** (${page.metaDescription?.length ?? 0} chars): ${page.metaDescription}`);
  lines.push(`- **Primary keyword:** ${page.primaryKeyword}`);
  if (page.secondaryKeywords?.length) {
    lines.push(`- **Secondary keywords:** ${page.secondaryKeywords.join(", ")}`);
  }
  lines.push("");

  if (page.h2Outline?.length) {
    lines.push(`## Page outline`);
    for (const h2 of page.h2Outline) {
      lines.push(`- ${h2.h2}`);
      for (const h3 of h2.h3s ?? []) {
        lines.push(`  - ${h3}`);
      }
    }
    lines.push("");
  }

  if (page.geoAnswerBlocks?.length) {
    lines.push(`## GEO / AEO Answer Blocks`);
    for (const qa of page.geoAnswerBlocks) {
      lines.push(`**Q: ${qa.question}**`);
      lines.push(`A: ${qa.answer}`);
      lines.push("");
    }
  }

  if (page.draftBody) {
    lines.push(`## Draft Copy`);
    lines.push(page.draftBody);
    lines.push("");
  }

  if (page.primaryCta) {
    lines.push(`## Primary CTA`);
    lines.push(`- **Label:** ${page.primaryCta.label}`);
    if (page.primaryCta.targetSlug) lines.push(`- **Target:** ${page.primaryCta.targetSlug}`);
    lines.push("");
  }

  lines.push(`## Strategy Alignment`);
  lines.push(`- **USP:** ${page.uspAlignment}`);
  if (page.compellingOfferTieIn) lines.push(`- **Offer tie-in:** ${page.compellingOfferTieIn}`);
  if (page.whyUsDifferentiators?.length) {
    lines.push(`- **Why-us differentiators:**`);
    for (const d of page.whyUsDifferentiators) lines.push(`  - ${d}`);
  }
  if (page.icpTargets?.length) lines.push(`- **ICP targets:** ${page.icpTargets.join(", ")}`);
  if (page.salesRouteMapping) lines.push(`- **Sales route:** ${page.salesRouteMapping}`);

  return lines.join("\n");
}
