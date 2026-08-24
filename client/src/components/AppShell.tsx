import { Link, useLocation } from "wouter";
import { Logo } from "./Logo";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { LogOut } from "lucide-react";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const isHome = location === "/" || location === "";

  const logoutMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/logout", {});
      return res.json();
    },
    onSuccess: () => {
      // Clear all cached data and reload the page so the auth gate re-runs
      // and any stale in-memory state is wiped. Reliable across all cache configs.
      queryClient.clear();
      window.location.href = "/";
      window.location.reload();
    },
    onError: () => {
      // Even on error, force reload — server cookie is likely already cleared
      window.location.href = "/";
      window.location.reload();
    },
  });

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-40">
        <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between">
          <Link href="/" data-testid="link-home">
            <a className="flex items-center">
              <Logo className="h-6" />
            </a>
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <Link href="/">
              <a
                data-testid="link-nav-new"
                className={`px-3 py-1.5 rounded-md hover-elevate ${isHome ? "text-foreground" : "text-muted-foreground"}`}
              >
                New Analysis
              </a>
            </Link>
            <Link href="/history">
              <a
                data-testid="link-nav-history"
                className={`px-3 py-1.5 rounded-md hover-elevate ${location.startsWith("/history") ? "text-foreground" : "text-muted-foreground"}`}
              >
                History
              </a>
            </Link>
            <button
              type="button"
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
              data-testid="button-logout"
              className="px-3 py-1.5 rounded-md hover-elevate text-muted-foreground flex items-center gap-1.5"
              title="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-6 text-xs text-muted-foreground flex flex-wrap items-center justify-between gap-2">
          <div>
            Built by <span className="text-foreground">Brex Consulting</span> — Big Rock Method for fractional CMO engagements.
          </div>
          <div className="font-mono">v0.1 · Phase 1 MVP</div>
        </div>
      </footer>
    </div>
  );
}
