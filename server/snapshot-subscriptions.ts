import {
  SNAPSHOT_EMAIL_PERMISSION, snapshotPermissionProperties,
  type SnapshotPermissionTracking,
} from "../shared/snapshot-delivery";

// Preparation only: not imported by routes and no environment-triggered writes.
// v4 distinguishes NOT_SPECIFIED from SUBSCRIBED. The v3 subscribe endpoint
// intentionally cannot override an existing unsubscribe.
export const SNAPSHOT_PILOT_EMAIL = "kenny@brexconsulting.com";
export type SubscriptionState = "SUBSCRIBED" | "UNSUBSCRIBED" | "NOT_SPECIFIED";
export interface SnapshotReceipt extends SnapshotPermissionTracking {
  email: string;
  requestedAt: string;
  snapshotId: string;
  snapshotUrl: string;
}
export interface PreferenceRead {
  email: string;
  snapshot: SubscriptionState;
  globallyBlocked: boolean;
  checkedAt: number;
}
export interface SubscriptionClient {
  read(email: string): Promise<PreferenceRead>;
  subscribe(body: {
    emailAddress: string; subscriptionId: string; legalBasis: "CONSENT_WITH_NOTICE";
    legalBasisExplanation: string;
  }): Promise<void>;
}

export function validateSnapshotReceipt(receipt: SnapshotReceipt, now = Date.now()) {
  snapshotPermissionProperties(receipt, now);
  const requested = Date.parse(receipt.requestedAt);
  const url = new URL(receipt.snapshotUrl);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(receipt.email) || receipt.email.length > 254
      || receipt.email !== receipt.email.trim().toLowerCase() || !receipt.snapshotId
      || !Number.isFinite(requested) || requested > now
      || Date.parse(receipt.expiresAt) <= requested
      || url.origin !== "https://atlas.brexconsulting.com" || url.pathname !== "/widget.html"
      || url.username || url.password || url.search || !/^#snapshot=[a-f0-9]{64}$/.test(url.hash)) {
    throw new Error("Invalid snapshot receipt.");
  }
}

function assertFreshPreference(value: PreferenceRead, email: string, now: number) {
  if (value.email !== email || !["SUBSCRIBED", "UNSUBSCRIBED", "NOT_SPECIFIED"].includes(value.snapshot)
      || typeof value.globallyBlocked !== "boolean" || !Number.isFinite(value.checkedAt)
      || value.checkedAt > now || now - value.checkedAt > 60_000) {
    throw new Error("Unknown or stale subscription status.");
  }
}

export interface SubscriptionPreparation {
  state: "pending" | "blocked" | "subscription_verified";
  reason: string;
  wouldSubscribe: boolean;
  mutation: "not_attempted" | "attempted";
  // This is never proof of send eligibility or delivery.
}

export async function prepareSnapshotSubscription(
  receipt: SnapshotReceipt,
  client: SubscriptionClient,
  options: {
    mode?: "dry-run" | "controlled-pilot";
    pilotEnabled?: boolean;
    approvedRequestsAfter?: string;
    now?: () => number;
  } = {},
): Promise<SubscriptionPreparation> {
  const now = options.now || Date.now;
  let mutation: SubscriptionPreparation["mutation"] = "not_attempted";
  const result = (state: SubscriptionPreparation["state"], reason: string, wouldSubscribe = false) =>
    ({state, reason, wouldSubscribe, mutation});
  try {
    validateSnapshotReceipt(receipt, now());
    // No broad opt-in facility: an executed pilot can only touch Kenny and
    // fresh, explicitly approved requests. Dry-run can inspect other receipts.
    if (options.mode === "controlled-pilot"
        && (!options.pilotEnabled || receipt.email !== SNAPSHOT_PILOT_EMAIL
          || !Number.isFinite(Date.parse(options.approvedRequestsAfter || ""))
          || Date.parse(options.approvedRequestsAfter!) > now()
          || Date.parse(receipt.requestedAt) <= Date.parse(options.approvedRequestsAfter!))) {
      return result("blocked", "pilot_not_authorized");
    }
    const status = await client.read(receipt.email);
    assertFreshPreference(status, receipt.email, now());
    if (status.globallyBlocked) return result("blocked", "global_or_brand_opt_out");
    if (status.snapshot === "UNSUBSCRIBED") return result("blocked", "snapshot_opt_out");
    if (status.snapshot === "SUBSCRIBED") return result("subscription_verified", "already_subscribed");
    if (options.mode !== "controlled-pilot") return result("pending", "dry_run_would_subscribe", true);
    // Read again immediately before mutation; never rely on a cached plan.
    const latest = await client.read(receipt.email);
    assertFreshPreference(latest, receipt.email, now());
    validateSnapshotReceipt(receipt, now());
    if (latest.globallyBlocked || latest.snapshot === "UNSUBSCRIBED")
      return result("blocked", "opt_out_before_write");
    if (latest.snapshot === "SUBSCRIBED") return result("subscription_verified", "already_subscribed");
    mutation = "attempted"; // A timeout might have applied the write; never claim otherwise.
    await client.subscribe({
      emailAddress: receipt.email,
      subscriptionId: SNAPSHOT_EMAIL_PERMISSION.subscriptionTypeId,
      legalBasis: "CONSENT_WITH_NOTICE",
      legalBasisExplanation: [
        SNAPSHOT_EMAIL_PERMISSION.text,
        `Source: atlas-widget; request: ${receipt.requestId}; requested: ${receipt.requestedAt};`,
        `permission version: ${receipt.permission.policyVersion}.`,
      ].join(" "),
    });
    const confirmed = await client.read(receipt.email);
    assertFreshPreference(confirmed, receipt.email, now());
    validateSnapshotReceipt(receipt, now());
    if (confirmed.globallyBlocked || confirmed.snapshot === "UNSUBSCRIBED")
      return result("blocked", "opt_out_on_readback");
    return confirmed.snapshot === "SUBSCRIBED"
      ? result("subscription_verified", "opt_in_readback_verified")
      : result("pending", "opt_in_not_confirmed");
  } catch {
    // No raw email, access token, snapshot bearer link, or provider body in logs.
    return result("pending", mutation === "attempted" ? "mutation_outcome_unconfirmed" : "validation_or_read_failed");
  }
}

type RequestJson = (method: "GET" | "POST", path: string, body?: unknown) => Promise<any>;

/** Inject authenticated transport; constructor performs no I/O. No marketing API. */
export function createSnapshotSubscriptionClient(
  request: RequestJson, now: () => number = Date.now,
): SubscriptionClient {
  const envelope = (data: any): any[] => {
    if (!data || !["COMPLETE", "SUCCESS"].includes(data.status) || !Array.isArray(data.results)
        || data.errors?.length || data.numErrors || data.paging?.next) {
      throw new Error("Incomplete preference response.");
    }
    return data.results;
  };
  return {
    async read(email) {
      const id = encodeURIComponent(email);
      const rows = envelope(await request("GET", `/communication-preferences/v4/statuses/${id}?channel=EMAIL`));
      const statuses = rows.filter(r => String(r.subscriptionId) === SNAPSHOT_EMAIL_PERMISSION.subscriptionTypeId);
      if (statuses.length !== 1) throw new Error("Missing or ambiguous snapshot subscription.");
      const target = statuses[0];
      if (target.channel !== "EMAIL" || target.subscriberIdString !== email || target.businessUnitId !== 0
          || !["SUBSCRIBED", "UNSUBSCRIBED", "NOT_SPECIFIED"].includes(target.status))
        throw new Error("Invalid subscription response.");
      const wide = envelope(await request("GET",
        `/communication-preferences/v4/statuses/${id}/unsubscribe-all?channel=EMAIL`));
      // A successful empty result was observed in this portal: no recorded
      // global status. The category must still be explicitly subscribed.
      let globallyBlocked = false;
      for (const row of wide) {
        if (row.subscriberIdString !== email || row.channel !== "EMAIL"
            || !["PORTAL_WIDE", "BUSINESS_UNIT_WIDE"].includes(row.wideStatusType)
            || !["SUBSCRIBED", "UNSUBSCRIBED", "NOT_SPECIFIED"].includes(row.status)
            || !Number.isInteger(row.businessUnitId)) throw new Error("Unknown global preference.");
        if ((row.wideStatusType === "PORTAL_WIDE" || row.businessUnitId === 0) && row.status === "UNSUBSCRIBED")
          globallyBlocked = true;
      }
      return {email, snapshot: target.status, globallyBlocked, checkedAt: now()};
    },
    async subscribe(body) {
      if (body.subscriptionId !== SNAPSHOT_EMAIL_PERMISSION.subscriptionTypeId
          || body.legalBasis !== "CONSENT_WITH_NOTICE" || !body.legalBasisExplanation
          || body.emailAddress !== SNAPSHOT_PILOT_EMAIL) throw new Error("Subscription write outside pilot scope.");
      await request("POST", "/communication-preferences/v3/subscribe", body);
    },
  };
}
