import { createContext, useContext, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

const DemoContext = createContext({ demo: false, setDemo: (_value: boolean) => {} });
export function DemoModeProvider({ children }: { children: ReactNode }) {
  const [demo, update] = useState(() => new URLSearchParams(window.location.search).get("demo") === "1");
  function setDemo(value: boolean) {
    const url = new URL(window.location.href);
    if (value) url.searchParams.set("demo", "1");
    else url.searchParams.delete("demo");
    // Keep presentation mode through reloads without storing any report data.
    window.history.replaceState(window.history.state, "", url);
    update(value);
  }
  return <DemoContext.Provider value={{ demo, setDemo }}>{children}</DemoContext.Provider>;
}
export const useDemoMode = () => useContext(DemoContext);
export function DemoModeSwitch() {
  const { demo, setDemo } = useDemoMode();
  return <div className="inline-flex rounded-lg border border-border p-1 gap-1 bg-background" role="group" aria-label="Report display mode" data-testid="report-mode-switch">
    <Button size="sm" variant={demo ? "ghost" : "default"} aria-pressed={!demo} onClick={() => setDemo(false)} data-testid="mode-full">Full report</Button>
    <Button size="sm" variant={demo ? "default" : "ghost"} aria-pressed={demo} onClick={() => setDemo(true)} data-testid="mode-demo">Demo mode</Button>
  </div>;
}
