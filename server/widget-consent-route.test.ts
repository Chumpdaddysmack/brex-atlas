import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { WIDGET_MARKETING_CONSENT as policy } from "../shared/widget-consent";

test("lead route records evidence before success; unchecked works; storage failure stops side effects", async () => {
  process.env.SUPABASE_URL = "https://consent-test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-placeholder-not-a-secret";
  process.env.ANTHROPIC_API_KEY = "test-placeholder-not-a-secret";
  delete process.env.HUBSPOT_ACCESS_TOKEN;
  const originalFetch = globalThis.fetch;
  const events: any[] = [];
  let failStorage = false;
  let sideEffects = 0;
  const diagnosticId = "10000000-0000-4000-8000-000000000001";
  const output = { overallScore: 44, fitTier: "not-a-fit", verdict: "developing",
    subScores: [], swotTitles: { strengths: ["Test strength"], weaknesses: ["Test constraint"] } };
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = new URL(typeof input === "string" ? input : input.url ?? input.toString());
    if (url.hostname === "127.0.0.1") return originalFetch(input, init);
    assert.equal(url.hostname, "consent-test.supabase.co", "Unexpected external request");
    const method = init?.method ?? "GET";
    if (url.pathname.endsWith("/widget_diagnostics") && method === "GET") {
      return json({ id: diagnosticId, created_at: "2026-09-22T00:00:00Z",
        url: "https://example.invalid", industry: "Test", revenue_band: "Under $1M",
        primary_goal: "Test", raw_output: output });
    }
    if (url.pathname.endsWith("/widget_consent_events")) {
      if (failStorage) return json({ message: "Simulated unavailable storage" }, 503);
      if (method === "POST") {
        const row = JSON.parse(init.body);
        if (!events.some(e => e.decision === row.decision)) {
          events.push({ ...row, id: `receipt-${events.length + 1}`, created_at: new Date().toISOString() });
        }
        return new Response(null, { status: 201 });
      }
      return json(events.find(e => "eq." + e.decision === url.searchParams.get("decision")));
    }
    sideEffects++;
    return method === "POST" ? json({ id: "test-lead" }) : json({});
  }) as typeof fetch;
  const { registerWidgetRoutes } = await import("./widget");
  const app = express();
  app.use(express.json());
  registerWidgetRoutes(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const send = (extra: any) => originalFetch(base + "/api/widget/lead", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ diagnosticId, email: " QA@example.invalid ", ...extra }),
  });
  try {
    for (const choice of [false, true]) {
      const res = await send({ marketingConsent: choice, marketingConsentVersion: policy.version });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.consent.decision, choice ? "accepted" : "not_selected");
      const event = events.find(e => e.id === body.consent.receiptId);
      assert.ok(event, "Evidence exists before browser receives success");
      assert.equal(event.email, "qa@example.invalid");
      assert.equal(event.consent_text, policy.text);
    }
    const accepted = events.find(e => e.decision === "accepted");
    const retry = await (await send({ marketingConsent: true, marketingConsentVersion: policy.version })).json();
    assert.equal(retry.consent.recordedAt, accepted.created_at);
    assert.equal(events.length, 2);
    const legacy = await (await send({})).json();
    assert.equal(legacy.consent.decision, "not_presented");
    assert.equal((await send({ marketingConsent: "true", marketingConsentVersion: policy.version })).status, 400);
    assert.equal((await send({ marketingConsent: true, marketingConsentVersion: "old" })).status, 400);
    // Allow earlier asynchronous CRM/storage work to complete before failure test.
    await new Promise(resolve => setTimeout(resolve, 40));
    const before = sideEffects;
    failStorage = true;
    const failure = await send({ marketingConsent: true, marketingConsentVersion: policy.version });
    assert.equal(failure.status, 503);
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(sideEffects, before, "No CRM or lead side effect after evidence-write failure");
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    globalThis.fetch = originalFetch;
  }
});
