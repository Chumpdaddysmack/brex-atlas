import test from "node:test";
import assert from "node:assert/strict";
import { recommendGrowthOffer, quoteReportUpgrade, reportCreditExpiry } from "./growth-offers";

test("offer recommendation uses needs and readiness, never diagnostic score", () => {
  assert.equal(recommendGrowthOffer("first-priority", "owner"), "foundations");
  assert.equal(recommendGrowthOffer("one-problem", "team-partner"), "focus");
  assert.equal(recommendGrowthOffer("comprehensive", "owner"), "full-report");
  for (const need of ["first-priority", "one-problem", "comprehensive"] as const) {
    assert.equal(recommendGrowthOffer(need, "not-ready"), "free-resources");
  }
});
test("upgrades use cumulative net cash without double credit", () => {
  const base = { firstDeliveryDate: "2026-09-22", asOfDate: "2026-10-01", sameScope: true };
  assert.equal(quoteReportUpgrade({ ...base, currentOffer: "foundations", targetOffer: "focus", netPaidUsd: 495 }).amountDueUsd, 1000);
  assert.equal(quoteReportUpgrade({ ...base, currentOffer: "focus", targetOffer: "full-report", netPaidUsd: 1495 }).amountDueUsd, 3500);
  assert.equal(quoteReportUpgrade({ ...base, currentOffer: "foundations", targetOffer: "full-report", netPaidUsd: 495 }).amountDueUsd, 4500);
  assert.equal(quoteReportUpgrade({ ...base, currentOffer: "foundations", targetOffer: "focus", netPaidUsd: 395 }).amountDueUsd, 1100);
});
test("credit expiry is a single 60-day window and refunds reduce the credit", () => {
  assert.equal(reportCreditExpiry("2026-09-22"), "2026-11-21");
  const base = { currentOffer: "focus", targetOffer: "full-report", netPaidUsd: 1295,
    firstDeliveryDate: "2026-09-22", asOfDate: "2026-11-21", sameScope: true } as const;
  assert.equal(quoteReportUpgrade(base).creditUsd, 1295);
  assert.equal(quoteReportUpgrade({ ...base, asOfDate: "2026-11-22" }).creditUsd, 0);
  assert.equal(quoteReportUpgrade({ ...base, asOfDate: "2026-09-21" }).creditUsd, 0);
  assert.equal(quoteReportUpgrade({ ...base, sameScope: false }).creditUsd, 0);
  assert.throws(() => reportCreditExpiry("2026-02-30"));
  assert.throws(() => quoteReportUpgrade({ ...base, netPaidUsd: -1 }));
});
