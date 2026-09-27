import { test } from "node:test";
import assert from "node:assert/strict";
import { reportCtaLabel, BOOKING_URL } from "./client-report";

test("full reports invite a live presentation",()=>{
  assert.equal(reportCtaLabel("full"),"Schedule your report presentation");
});
test("demos retain a discussion call invitation",()=>{
  assert.equal(reportCtaLabel("demo"),"Discuss your report");
});
test("both modes retain the approved booking destination",()=>{
  assert.equal(BOOKING_URL,"https://meetings-na2.hubspot.com/kenny-peavy");
});
