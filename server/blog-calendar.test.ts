import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBlogCalendar, generateValidatedBlogBatch } from "./blog-calendar";
import {blogBatchSchemaForWeekCount,SCHEMA_BLOG_BATCH} from "./llm";

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
test("MG Financial failure: recover week 7 only and retain validated weeks 8 and 9", async () => {
  const good=[makeWeek(8),makeWeek(9)];
  let batchCalls=0;const repaired:number[]=[];
  const result=await generateValidatedBlogBatch(async()=>{
    batchCalls++;return {blogCalendar:[makeWeek(7,9),...good]};
  },[7,8,9],async(week,error,titles)=>{
    repaired.push(week);assert.match(error,/Week 7 must contain 10 posts/);
    assert.equal(titles.length,20);return {blogCalendar:[makeWeek(week)]};
  });
  assert.equal(batchCalls,2);assert.deepEqual(repaired,[7]);
  assert.deepEqual(result.slice(1),good);
  assert.equal(result.reduce((n,w)=>n+w.posts.length,0),30);
});
test("bounded individual repair still fails closed on a short week",async()=>{
  let calls=0;
  await assert.rejects(generateValidatedBlogBatch(async()=>({blogCalendar:[makeWeek(7,8),makeWeek(8),makeWeek(9)]}),
    [7,8,9],async week=>{calls++;return {blogCalendar:[makeWeek(week,9)]};}),/Week 7 recovery failed/);
  assert.equal(calls,2);
});
test("single-week recovery rejects the wrong week and repairs a missing week",async()=>{
  let repairs=0;
  const out=await generateValidatedBlogBatch(async()=>({blogCalendar:[makeWeek(8),makeWeek(9)]}),[7,8,9],
    async week=>{repairs++;return {blogCalendar:[makeWeek(repairs===1?6:week)]};});
  assert.equal(repairs,2);assert.deepEqual(out.map(w=>w.weekNumber),[7,8,9]);
});
test("complete weeks from both attempts are retained without repair or invented content",async()=>{
  let calls=0;
  const first=makeWeek(7);first.posts[0].title="Retain first accepted title";
  const out=await generateValidatedBlogBatch(async()=>++calls===1
    ?{blogCalendar:[first,makeWeek(8,9),makeWeek(9)]}
    :{blogCalendar:[makeWeek(7,9),makeWeek(8),makeWeek(9,9)]},[7,8,9],
    async()=>{throw Error("No recovery needed");});
  assert.equal(out[0].posts[0].title,first.posts[0].title);
});
test("service outages do not fan out into single-week generation",async()=>{
  let repairs=0;
  await assert.rejects(generateValidatedBlogBatch(async()=>{throw Error("Provider unavailable");},[7,8,9],
    async()=>{repairs++;return {}; }),/after two attempts/);
  assert.equal(repairs,0);
});
test("single-week schema requires one week and ten posts without mutating batch schema",()=>{
  const s=blogBatchSchemaForWeekCount(1);
  assert.equal(s.properties.blogCalendar.minItems,1);assert.equal(s.properties.blogCalendar.maxItems,1);
  assert.equal(s.properties.blogCalendar.items.properties.posts.minItems,10);
  assert.equal(s.properties.blogCalendar.items.properties.posts.maxItems,10);
  assert.equal(SCHEMA_BLOG_BATCH.properties.blogCalendar.minItems,3);
  assert.throws(()=>blogBatchSchemaForWeekCount(0));
});
