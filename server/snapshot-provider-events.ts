/**
 * Staging only. No network, database, enrollment, or send capability.
 * Consumes a COMPLETE authenticated provider read and an ALREADY BOUND message.
 * Never discovers a request/message binding from recipient or timestamp.
 */
export interface BoundSnapshotMessage {
  requestId: string;
  attemptId: string;
  receiptDigest: string;
  providerMessageId: string;
  portalId: number;
  campaignId: number;
  email: string;
  sentEvent: { id: string; created: number };
}
type EventType = "SENT" | "DELIVERED" | "BOUNCE" | "DROPPED";
export interface SnapshotLedgerEvent {
  eventId: string;
  providerMessageId: string;
  eventType: EventType;
  occurredAt: string;
}
export function hubspotSnapshotMessageId(
  portalId: number, campaignId: number, sent: { id: string; created: number },
) {
  return `hubspot:${portalId}:${campaignId}:${sent.created}:${sent.id}`;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const eventTypes = new Set(["SENT", "DELIVERED", "BOUNCE", "DROPPED"]);
function timestamp(n: unknown, now: number): n is number {
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 && n <= now;
}

export function planBoundSnapshotEvents(
  binding: BoundSnapshotMessage, response: unknown, now = Date.now(),
): { status: "verified"; events: SnapshotLedgerEvent[] }
  | { status: "hold"; reason: string; events: [] } {
  const hold = (reason: string) => ({status: "hold" as const, reason, events: [] as []});
  if (!uuid.test(binding.requestId) || !uuid.test(binding.attemptId)
      || !/^[a-f0-9]{64}$/.test(binding.receiptDigest)
      || !Number.isSafeInteger(binding.portalId) || binding.portalId <= 0
      || !Number.isSafeInteger(binding.campaignId) || binding.campaignId <= 0
      || !uuid.test(binding.sentEvent.id) || !timestamp(binding.sentEvent.created, now)
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(binding.email)
      || binding.email !== binding.email.trim().toLowerCase()
      || binding.providerMessageId !== hubspotSnapshotMessageId(binding.portalId, binding.campaignId, binding.sentEvent))
    return hold("invalid_stored_message_binding");
  const page = response as {events?: unknown; hasMore?: unknown} | null;
  if (!page || page.hasMore !== false || !Array.isArray(page.events))
    return hold("incomplete_provider_read");
  const result: SnapshotLedgerEvent[] = [];
  const seen = new Map<string, string>();
  let sentFound = false;
  for (const raw of page.events) {
    if (!raw || typeof raw !== "object") return hold("malformed_provider_event");
    const e = raw as Record<string, any>;
    // Provider reads must be filtered to the exact bound campaign and recipient.
    if (e.portalId !== binding.portalId || e.emailCampaignId !== binding.campaignId
        || e.recipient !== binding.email) return hold("provider_scope_mismatch");
    if (typeof e.type !== "string") return hold("malformed_provider_event");
    if (!eventTypes.has(e.type)) continue; // CLICK/OPEN/PROCESSED are NOT delivery.
    if (!uuid.test(e.id || "") || !timestamp(e.created, now)) return hold("invalid_event_identity");
    const parent = e.type === "SENT" ? e : e.sentBy;
    if (!parent || parent.id !== binding.sentEvent.id || parent.created !== binding.sentEvent.created)
      return hold("different_or_unbound_message");
    if (e.created < binding.sentEvent.created) return hold("event_precedes_send");
    if (e.type === "SENT") sentFound = true;
    const eventId = `hubspot:${binding.portalId}:${e.created}:${e.id}`;
    const fingerprint = JSON.stringify([e.type, binding.providerMessageId]);
    if (seen.has(eventId)) {
      if (seen.get(eventId) !== fingerprint) return hold("conflicting_event_identity");
      continue;
    }
    seen.set(eventId, fingerprint);
    result.push({
      eventId, providerMessageId: binding.providerMessageId,
      eventType: e.type as EventType, occurredAt: new Date(e.created).toISOString(),
    });
  }
  if (!sentFound) return hold("bound_sent_event_missing");
  const delivered = result.some(e => e.eventType === "DELIVERED");
  const failed = result.some(e => ["BOUNCE", "DROPPED"].includes(e.eventType));
  if (delivered && failed) return hold("conflicting_terminal_events");
  result.sort((a,b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt)
    || (a.eventType === "SENT" ? -1 : b.eventType === "SENT" ? 1 : a.eventId.localeCompare(b.eventId)));
  return {status: "verified", events: result};
}
