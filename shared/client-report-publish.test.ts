import { test } from "node:test";
import assert from "node:assert/strict";
import { reportPublishRequirements } from "./client-report";
test("publication explains every missing requirement",()=>{
  assert.equal(reportPublishRequirements({hasPreview:false,reviewed:false,protect:true,code:""}).length,3);
});
test("review alone cannot silently drop code protection",()=>{
  const result=reportPublishRequirements({hasPreview:true,reviewed:true,protect:true,code:"short"});
  assert.equal(result.length,1);assert.match(result[0],/8 characters/);
});
test("valid protected and intentionally unprotected reports can publish",()=>{
  assert.deepEqual(reportPublishRequirements({hasPreview:true,reviewed:true,protect:true,code:"abcdefgh"}),[]);
  assert.deepEqual(reportPublishRequirements({hasPreview:true,reviewed:true,protect:false,code:""}),[]);
});
test("oversized codes and unapproved previews remain blocked",()=>{
  assert.equal(reportPublishRequirements({hasPreview:true,reviewed:true,protect:true,code:"x".repeat(81)}).length,1);
  assert.equal(reportPublishRequirements({hasPreview:true,reviewed:false,protect:false,code:""}).length,1);
});
