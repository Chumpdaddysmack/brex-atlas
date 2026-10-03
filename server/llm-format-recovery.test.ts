import test from "node:test";
import assert from "node:assert/strict";
import { client, llmJson } from "./llm";

test("explicit JSON-text recovery bypasses tools while retaining schema and original evidence",async()=>{
  const original=client.messages.create;
  const calls:any[]=[];
  (client.messages as any).create=async(body:any)=>{
    calls.push(body);
    return {stop_reason:"end_turn",usage:{},content:[{type:"text",text:'{"companyName":"Acme Corp"}'}]};
  };
  const schema={type:"object",required:["companyName"],properties:{companyName:{type:"string"}}};
  try{
    const response=await llmJson("Use only supplied evidence","Fetched official page text",2200,schema,{forceText:true});
    assert.deepEqual(response,{companyName:"Acme Corp"});
    assert.equal(calls.length,1);
    assert.equal(calls[0].tools,undefined);
    assert.equal(calls[0].tool_choice,undefined);
    assert.match(calls[0].system,/The JSON must match this JSON Schema/);
    assert.ok(calls[0].system.includes(JSON.stringify(schema)));
    assert.equal(calls[0].messages[0].content,"Fetched official page text");
    assert.equal(calls[0].max_tokens,2200);
    calls.length=0;
    (client.messages as any).create=async(body:any)=>{
      calls.push(body);
      return {stop_reason:"tool_use",usage:{},content:[{type:"tool_use",name:"return_result",input:{companyName:"Acme Corp"}}]};
    };
    await llmJson("Normal caller","Evidence",2200,schema);
    assert.equal(calls.length,1);
    assert.equal(calls[0].tools[0].input_schema,schema);
    assert.equal(calls[0].tool_choice.type,"any","Other report generators keep their existing path");
  }finally{client.messages.create=original;}
});
