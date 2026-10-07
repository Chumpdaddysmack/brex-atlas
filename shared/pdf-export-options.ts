import { type ExecutiveRole } from "./executive-summary";

export type PdfScope = "full" | "strategy" | "summary";
export const PDF_EXECUTIVE_ROLES = ["CEO", "COO", "CMO", "CFO"] as const;

// Export requests must never silently turn an unsupported role into CEO.
export function parsePdfPov(value: unknown): ExecutiveRole | undefined {
  if (value === undefined) return undefined;
  if (PDF_EXECUTIVE_ROLES.includes(value as ExecutiveRole)) return value as ExecutiveRole;
  throw new Error("POV must be CEO, COO, CMO, or CFO");
}

export function pdfFilename(clientName: string, scope: PdfScope, pov?: ExecutiveRole): string {
  const safeName = (clientName || "client").replace(/[^a-z0-9-_]/gi, "_");
  const scopeLabel = scope === "full" ? "full-plan" : scope === "strategy" ? "strategy" : "executive-summary";
  return `${safeName}-${scopeLabel}${pov ? `-${pov.toLowerCase()}-perspective` : ""}.pdf`;
}
