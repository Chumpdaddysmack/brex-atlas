import test from "node:test";
import assert from "node:assert/strict";
import { parseWidgetConsent, WIDGET_MARKETING_CONSENT as policy } from "./widget-consent";

test("explicit checked consent records canonical wording, never client-supplied text", () => {
  const evidence = parseWidgetConsent({ marketingConsent: true, marketingConsentVersion: policy.version,
    consentText: "forged", consentAt: "1999-01-01" });
  assert.equal(evidence.decision, "accepted");
  assert.equal(evidence.consentText, policy.text);
  assert.equal(evidence.policyVersion, policy.version);
  assert.equal(evidence.subscriptionTypeId, "711496982");
  assert.ok(!("consentAt" in evidence));
});
test("unchecked consent is not a subscription or an unsubscribe instruction", () => {
  const evidence = parseWidgetConsent({ marketingConsent: false, marketingConsentVersion: policy.version });
  assert.equal(evidence.decision, "not_selected");
  assert.equal(evidence.consentText, policy.text);
});
test("old clients without the checkbox never grant consent", () => {
  const evidence = parseWidgetConsent({});
  assert.equal(evidence.decision, "not_presented");
  assert.equal(evidence.consentText, "");
});
test("truthy strings, numbers and null are rejected rather than converted to consent", () => {
  for (const marketingConsent of ["true", "false", 1, 0, null, [], {}]) {
    assert.throws(() => parseWidgetConsent({ marketingConsent, marketingConsentVersion: policy.version }));
  }
});
test("missing, stale and orphaned policy versions fail validation", () => {
  for (const marketingConsent of [true, false]) {
    assert.throws(() => parseWidgetConsent({ marketingConsent }));
    assert.throws(() => parseWidgetConsent({ marketingConsent, marketingConsentVersion: "old" }));
  }
  assert.throws(() => parseWidgetConsent({ marketingConsentVersion: policy.version }));
});
