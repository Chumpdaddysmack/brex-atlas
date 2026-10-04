# Public snapshot delivery

## Scope and authorization

On October 3, 2026 at 6:47 PM Pacific, Kenny requested actual results delivery to anyone filling out the widget, superseding the proposed Kenny-only no-send website deployment. This release uses existing production tables and credentials. It does not apply the proposed no-send migration.

## Delivery contract

- Fresh server-stored requests only, tagged `public-results-2026-10-04`, after the approval cutoff.
- Explicit snapshot checkbox required; optional promotional permission remains separate and is recorded without changing promotional subscriptions.
- Exact snapshot token checked against the stored hash.
- A durable per-request claim and per-recipient active lock precede every CRM effect.
- Existing category/global opt-outs and suppression are respected.
- A new subscriber's explicit v4 `OBJECT_NOT_FOUND` is treated as unspecified, not subscribed. The dedicated v3 category subscribe endpoint is used only after a fresh consent receipt and global checks.
- Original Lead Source is preserved; new values are Website and Atlas Excavator Widget.
- Public marketing-eligibility workflow: 5051848423. Uses native marketing status action, respecting the user's saved 2,000-contact maximum.
- Public results workflow: 5051859668. Enrollment requires actual marketing status true, explicit permission, reviewed permission version, and ready state. Sends published email 405101719239 only.
- Workflow and email contracts are checked before arming. Old snapshot senders remain off.
- No score or Kenny-only recipient restriction.
- No new secrets, billing upgrade, backfill, automatic send retries, or automatic promotional opt-ins.

## Honest state and conservative repeat handling

The form says queued, not delivered. Provider delivery is recorded only with an authenticated exact message binding. A CLICK containing the exact snapshot token can establish that binding; CLICK is never delivery proof. Its matching SENT/DELIVERED lineage is required for ledger confirmation.

Unopened or ambiguous requests retain their active recipient lock for manual review. Thus a second request can be held even if a previous message was delivered but has not been opened/correlated. Users can always view and save their on-screen snapshot. This is a deliberate limitation, not a promise of unrestricted repeat sends.

The per-request Supabase ledger is authoritative. The CRM ready field is the native dispatch trigger, not delivery proof. The reconciler does not asynchronously overwrite mutable contact state, avoiding cross-instance races with a newer request. A new accepted request changes pending to ready.

## QA inventory

- Non-Kenny requester: HTTP fixture and public delivery unit test.
- Explicit permission required: HTTP rejected unchecked checkbox.
- Prior test cohort and old receipt refused: boundary unit and HTTP tests.
- Opt-out/global suppression/no permission: no dispatch or subscription write.
- Native marketing eligibility: workflow readback has false status for eligibility and true for sender.
- Timeout/duplicate: one durable claim, no retry of ready mutation.
- Public UI: desktop 1280 and mobile 375; consent text, blue CTA, transparent surround, white footer, queued result, and no horizontal overflow.
- Exploratory: submit without permission, then complete; restart and repeat form.
- Production verification: read config and workflow contracts; do not create a prospect or manufacture consent for a live test.

## Operational switch

`SNAPSHOT_PUBLIC_DELIVERY_ENABLED=false` disables this public route. The package start command defaults it to true for the authorized release but permits an explicit Railway false override. Pausing the two public HubSpot workflows also causes the application preflight to hold rather than send.
