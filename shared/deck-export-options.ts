export type DeckScope = "summary" | "full";

export function parseDeckScope(value: unknown): DeckScope {
  if (value === undefined || value === "summary") return "summary";
  if (value === "full") return "full";
  throw new Error("Deck scope must be summary or full");
}

export function deckFilename(clientName: string, scope: DeckScope): string {
  const safeName = (clientName || "client").replace(/[^a-z0-9-_]/gi, "_");
  return `${safeName}-${scope === "summary" ? "executive-summary-deck" : "content-strategy-deck"}.pptx`;
}
