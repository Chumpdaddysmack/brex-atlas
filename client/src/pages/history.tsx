import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, Plus } from "lucide-react";
import type { Analysis } from "@shared/schema";

export default function History() {
  const q = useQuery<Analysis[]>({
    queryKey: ["/api/analyses"],
    queryFn: async () => {
      const r = await apiRequest("GET", "/api/analyses");
      return r.json();
    },
  });

  const rows = q.data ?? [];

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex items-baseline justify-between mb-6">
          <div>
            <h1 className="font-serif text-3xl tracking-tight">History</h1>
            <p className="text-sm text-muted-foreground mt-1">
              All analyses run in this workspace.
            </p>
          </div>
          <Link href="/">
            <a>
              <Button data-testid="button-new">
                <Plus className="h-4 w-4 mr-2" /> New analysis
              </Button>
            </a>
          </Link>
        </div>

        {q.isLoading && (
          <Card className="p-6 text-sm text-muted-foreground">Loading…</Card>
        )}
        {!q.isLoading && rows.length === 0 && (
          <Card className="p-10 text-center">
            <div className="text-sm text-muted-foreground mb-4">
              No analyses yet. Run your first one.
            </div>
            <Link href="/">
              <a>
                <Button>Get started</Button>
              </a>
            </Link>
          </Card>
        )}

        <div className="grid gap-3">
          {rows.map((r) => (
            <Link key={r.id} href={`/analysis/${r.id}`}>
              <a>
                <Card
                  className="p-5 hover-elevate flex items-center justify-between gap-4"
                  data-testid={`row-analysis-${r.id}`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="font-semibold truncate">{r.clientName}</div>
                      <Badge
                        variant={
                          r.status === "done"
                            ? "default"
                            : r.status === "error"
                            ? "destructive"
                            : "secondary"
                        }
                      >
                        {r.status}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 truncate">
                      {r.clientUrl}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground flex-shrink-0">
                    <span className="font-mono hidden sm:inline">
                      {new Date(r.createdAt).toLocaleDateString()}
                    </span>
                    <ArrowRight className="h-4 w-4" />
                  </div>
                </Card>
              </a>
            </Link>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
