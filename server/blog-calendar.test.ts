import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBlogCalendar, generateValidatedBlogBatch } from "./blog-calendar";

const makeWeek = (weekNumber: number, count = 10) => ({
  weekNumber, weekOf: "2026-09-21",
  posts: Array.from({ length: count }, (_, i) => ({
    title: `Week ${weekNumber} post ${i}`, pillar: "Positioning", targetQuery: "What next?",
    angle: "Answer the buyer's question.", keywords: ["positioning"], scheduledDate: "2026-09-21",
    editorialBrief: { readerQuestion: "What next?", angleSummary: "Explain the evidence.",
      primaryKeyword: "positioning", aeoQuery: "What next?" },
  })),
});
const batch = [makeWeek(4), makeWeek(5), makeWeek(6)];
test("valid calendar and encoded JSON preserve every post", () => {
  assert.deepEqual(normalizeBlogCalendar(batch), batch);
  assert.deepEqual(normalizeBlogCalendar(JSON.stringify(batch)), batch);
  assert.deepEqual(normalizeBlogCalendar("```json\n" + JSON.stringify(batch) + "\n```"), batch);
});
test("legacy spread characters are reconstructed between real week objects", () => {
  const original = [makeWeek(1), makeWeek(2), makeWeek(3), ...batch,
    ...Array.from({ length: 6 }, (_, i) => makeWeek(i + 7))];
  const corrupted = [...original.slice(0, 3), ...JSON.stringify(batch), ...original.slice(6)];
  assert.ok(corrupted.length > 100);
  assert.deepEqual(normalizeBlogCalendar(corrupted), original);
});
test("rejects malformed data instead of replacing it with an empty calendar", () => {
  for (const value of [null, {}, [], "garbage", [null], ["a", "b"], [{ weekNumber: 1, posts: [] }]]) {
    assert.throws(() => normalizeBlogCalendar(value));
  }
  assert.throws(() => normalizeBlogCalendar([makeWeek(1), makeWeek(1)]));
  assert.throws(() => normalizeBlogCalendar([makeWeek(1, 21)]));
  assert.throws(() => normalizeBlogCalendar(Array.from({ length: 101 }, (_, i) => makeWeek(i + 1))));
  assert.throws(() => normalizeBlogCalendar([{ ...makeWeek(1), weekOf: "2026-02-31" }]));
  assert.throws(() => normalizeBlogCalendar([makeWeek(1)], { expectedWeeks: [1, 2, 3] }));
  assert.throws(() => normalizeBlogCalendar([makeWeek(1, 9)], { postsPerWeek: 10 }));
});
test("does not invent a missing required brief sentence", () => {
  const value = makeWeek(1);
  value.posts[0].editorialBrief.angleSummary = "";
  assert.throws(() => normalizeBlogCalendar([value], { requireCompleteBrief: true }));
});
test("malformed batch is retried once, only validated data is returned", async () => {
  let calls = 0;
  const weeks = await generateValidatedBlogBatch(async (error) => {
    calls++;
    if (calls === 1) return { blogCalendar: "bad" };
    assert.ok(error);
    return { blogCalendar: JSON.stringify(batch) };
  }, [4, 5, 6]);
  assert.equal(calls, 2);
  assert.deepEqual(weeks, batch);
});
test("two invalid batches fail closed and cannot be marked ready", async () => {
  let calls = 0;
  await assert.rejects(generateValidatedBlogBatch(async () => {
    calls++;
    return { blogCalendar: [makeWeek(4)] };
  }, [4, 5, 6]), /after two attempts/);
  assert.equal(calls, 2);
});
