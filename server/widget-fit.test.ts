import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { applySmallBusinessFit, WIDGET_SMALL_BUSINESS_FIT } from "../shared/widget-fit";

test("under-$1M threshold is inclusive at 40 and overrides model tier", () => {
  for (const modelTier of ["advisor", "strategist", "full-fractional", "not-a-fit"] as const) {
    for (const score of [0, 39, 40, 44, 50, 74, 75, 100]) {
      assert.equal(applySmallBusinessFit("Under $1M", score, modelTier),
        score >= 40 ? "advisor" : "not-a-fit");
    }
  }
  assert.equal(applySmallBusinessFit("Under $1M", NaN, "advisor"), "not-a-fit");
});

test("higher-revenue tiers are untouched", () => {
  for (const band of ["$1M–$5M", "$5M–$25M", "$25M–$100M", "$100M+"]) {
    for (const tier of ["advisor", "strategist", "full-fractional", "not-a-fit"] as const) {
      for (const score of [0, 39, 40, 55, 60, 100]) {
        assert.equal(applySmallBusinessFit(band, score, tier), tier);
      }
    }
  }
});

test("new diagnostics persist and return the enforced tier for every goal", async () => {
  process.env.ANTHROPIC_API_KEY = "test-placeholder-not-a-secret";
  process.env.SUPABASE_URL = "https://fit-test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-placeholder-not-a-secret";
  delete process.env.HUBSPOT_ACCESS_TOKEN;
  const originalFetch = globalThis.fetch;
  const rows: any[] = [];
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = new URL(typeof input === "string" ? input : input.url ?? input.toString());
    if (url.hostname === "127.0.0.1") return originalFetch(input, init);
    assert.equal(url.hostname, "fit-test.supabase.co", "No live external services allowed");
    assert.equal(url.pathname, "/rest/v1/widget_diagnostics");
    assert.equal(init.method, "POST");
    rows.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: "10000000-0000-4000-8000-000000000001" }),
      { status: 201, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const { client } = await import("./llm");
  const originalCreate = client.messages.create;
  let score = 40;
  (client.messages as any).create = async () => ({
    content: [{ type: "tool_use", input: {
      overallScore: score, fitTier: "not-a-fit", headline: "Test preview", verdict: "developing",
      subScores: ["positioning", "offer", "buyer", "growth"].map(key => ({ key, label: key, score, finding: "Test" })),
      benchmark: { industryAverage: 58, topQuartile: 78 },
      swotTitles: { strengths: ["Test"], weaknesses: ["Test"], opportunities: ["Test"], threats: ["Test"] },
    } }],
  });
  const { registerWidgetRoutes } = await import("./widget");
  const app = express();
  app.use(express.json());
  registerWidgetRoutes(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const config = await (await originalFetch(base + "/api/widget/config")).json();
    assert.deepEqual(config.smallBusinessFit, WIDGET_SMALL_BUSINESS_FIT);
    for (const [i, goal] of config.goals.entries()) {
      score = [39, 40, 44, 75, 100][i];
      const response = await originalFetch(base + "/api/widget/diagnose", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://example.invalid", industry: config.industries[0],
          revenueBand: "Under $1M", goal }),
      });
      assert.equal(response.status, 200);
      const output = await response.json();
      const expected = score >= 40 ? "advisor" : "not-a-fit";
      assert.equal(output.fitTier, expected);
      assert.equal(output.overallScore, score, "Routing must not change the score");
      assert.equal(rows[i].fit_tier, expected);
      assert.equal(rows[i].raw_output.fitTier, expected);
    }
    assert.equal(rows.length, 5);
  } finally {
    client.messages.create = originalCreate;
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
});
