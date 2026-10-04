import test from "node:test";
import assert from "node:assert/strict";
import { normalizeExcerptSnapshot,researchSnapshot } from "./widget-snapshot-research";

const origin="https://example-company.com/";
const quotes=[
  "Example Company provides consulting services to business owners.",
  "Our services include marketing strategy and executive guidance.",
  "Start with a company snapshot, then explore your growth priorities.",
];
const sources=[{url:origin,title:"Example Company",text:quotes.join(" ")},
  {url:origin+"about",title:"About",text:"An unrelated page that does not contain the quoted passages."}];
const excerpts=()=>({
  entityConfirmed:true,companyName:"Example Company",
  introduction:quotes.slice(0,2).map(quote=>({quote,sourceIndex:0})),
  finding:{quote:quotes[2],sourceIndex:0},
  interpretation:"This invitation may give prospects a specific starting point for a conversation.",
  question:"Which growth priority would you most want that conversation to clarify?",
});
const ordinary=()=>({
  entityConfirmed:true,companyName:"Example Company",
  introduction:quotes.slice(0,2).map(text=>({text,sourceIndexes:[0]})),
  finding:{text:quotes[2],sourceIndexes:[0]},
  interpretation:excerpts().interpretation,question:excerpts().question,limitations:[],
});
test("verified excerpts retain exact page links and publicly disclose narrower scope",()=>{
  const result=normalizeExcerptSnapshot(excerpts(),sources,origin);
  assert.equal(result.introduction.length,2);
  assert.equal(result.finding.text,`Its public messaging includes: “${quotes[2]}”`);
  assert.equal(result.finding.sources[0].url,origin);
  assert.match(result.limitations[0],/shorter preview/);
  assert.match(result.limitations[1],/not independently verified/);
  const spaced=excerpts();spaced.finding.quote=quotes[2].replace("then ","then\n  ");
  assert.equal(normalizeExcerptSnapshot(spaced,sources,origin).finding.text,result.finding.text);
});
test("wrong citations, altered wording, fabricated fragments, duplicates and identity fail closed",()=>{
  for(const change of [
    (x:any)=>x.finding.sourceIndex=1,
    (x:any)=>x.finding.sourceIndex=99,
    (x:any)=>x.finding.quote="Start with a company snapshot, then purchase our guaranteed results.",
    (x:any)=>x.finding.quote="Start with a company snapshot, ... explore your growth priorities.",
    (x:any)=>x.finding=x.introduction[0],
    (x:any)=>x.entityConfirmed=false,
  ]){
    const x=excerpts();change(x);
    assert.throws(()=>normalizeExcerptSnapshot(x,sources,origin));
  }
});
test("two failed paraphrase audits can recover only via exact excerpts and a passing final audit",async()=>{
  let calls=0;
  const result=await researchSnapshot({companyName:"Example Company",url:origin},{
    research:async()=>({answer:"Discovery prose is not evidence",citations:[{url:origin,title:"Home"}]}),
    readPage:async()=>sources[0],
    structure:async(system,user,_max,schema:any)=>{
      calls++;
      if(calls===1||calls===3)return ordinary();
      if(calls===2||calls===4)return {supported:false,issues:["Wrongly combined offer descriptions."]};
      if(calls===5){
        assert.match(system,/contiguous, verbatim/);
        assert.equal(schema.properties.introduction.minItems,2);
        assert.equal(user.includes("Discovery prose is not evidence"),false);
        return excerpts();
      }
      assert.equal(calls,6);assert.match(system,/Cross-page support is not enough/);
      assert.match(user,/Its public messaging includes/);return {supported:true,issues:[]};
    },
  });
  assert.equal(calls,6);assert.match(result.finding.text,/public messaging includes/);
});
test("a rejected final excerpt audit has no fourth attempt or unaudited fallback",async()=>{
  let calls=0;
  await assert.rejects(()=>researchSnapshot({companyName:"Example Company",url:origin},{
    research:async()=>({answer:"Discovery",citations:[{url:origin,title:"Home"}]}),
    readPage:async()=>sources[0],
    structure:async()=>{
      calls++;
      if(calls===1||calls===3)return ordinary();
      if(calls===5)return excerpts();
      return {supported:false,issues:["Passage is taken out of context."]};
    },
  }),/EVIDENCE_AUDIT_FAILED/);
  assert.equal(calls,6);
});
test("non-verbatim excerpt stops before final audit; malformed audit never authorizes recovery",async()=>{
  let calls=0;
  await assert.rejects(()=>researchSnapshot({companyName:"Example Company",url:origin},{
    research:async()=>({answer:"Discovery",citations:[{url:origin,title:"Home"}]}),
    readPage:async()=>sources[0],
    structure:async()=>{
      calls++;
      if(calls===1||calls===3)return ordinary();
      if(calls===5){const x=excerpts();x.finding.quote="Invented excerpt that appears on no fetched page.";return x;}
      return {supported:false,issues:["Wrong citation."]};
    },
  }),/EVIDENCE_AUDIT_FAILED/);
  assert.equal(calls,5);calls=0;
  await assert.rejects(()=>researchSnapshot({companyName:"Example Company",url:origin},{
    research:async()=>({answer:"Discovery",citations:[{url:origin,title:"Home"}]}),
    readPage:async()=>sources[0],
    structure:async()=>++calls===1?ordinary():{},
  }),/EVIDENCE_AUDIT_FAILED/);
  assert.equal(calls,2);
});
