import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import AnalysisPage from "@/pages/analysis";
import History from "@/pages/history";
import ContentStudio from "@/pages/content-studio";
import Login from "@/pages/login";

type AuthStatus = { authenticated: boolean };

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/analysis/:id" component={AnalysisPage} />
      <Route path="/analysis/:id/content" component={ContentStudio} />
      <Route path="/history" component={History} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthGate() {
  // Poll /api/auth/status — if 401 the app will just show login
  const { data, isLoading } = useQuery<AuthStatus>({
    queryKey: ["/api/auth/status"],
    // If server returns 401 (shouldn't for this endpoint but just in case),
    // treat as unauthenticated.
    retry: false,
    staleTime: 0,
    refetchOnMount: true,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  if (!data?.authenticated) {
    return <Login />;
  }

  return (
    <Router hook={useHashLocation}>
      <AppRouter />
    </Router>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <AuthGate />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
