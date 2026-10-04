import assert from "node:assert/strict";
import { test } from "node:test";
import { researchWithWebSearch } from "../lib/engine/anthropic";
import { UsageMeter } from "../lib/engine/usage";
test('continuations use the remaining allowance, then synthesize without tools',async(t)=>{
 process.env.ANTHROPIC_API_KEY='test-key-not-a-secret';
 const calls:any[]=[];
 let omitUsage=false;
 t.mock.method(globalThis,'fetch',async(input: Parameters<typeof fetch>[0],init?: RequestInit)=>{
  const body=JSON.parse(await new Request(input,init).text());calls.push(body);
  const final=!body.tools;
  return Response.json({id:`msg_${calls.length}`,type:'message',role:'assistant',model:body.model,
   content:omitUsage&&!final
    ? [{type:'server_tool_use',id:'search_1',name:'web_search',input:{query:'source'}}]
    : [{type:'text',text:final?'Finished report.':'Research notes.'}],
   stop_reason:final?'end_turn':'pause_turn',stop_sequence:null,
   usage:{input_tokens:10,output_tokens:5,...(omitUsage?{}:{server_tool_use:{web_search_requests:final?0:1}})}});
 });
 const meter=new UsageMeter('claude-sonnet-5');
 const result=await researchWithWebSearch({system:'methodology',prompt:'report',deadline:Date.now()+120000,maxSearches:2,meter});
 assert.deepEqual(calls.map(c=>c.tools?.[0].max_uses),[2,1,undefined]);
 assert.equal(result.text,'Finished report.');assert.equal(result.usage.input_tokens,30);
 assert.equal(meter.totals.web_search_requests,2);assert.equal(meter.totals.calls,3);
 await assert.rejects(researchWithWebSearch({system:'',prompt:'',deadline:Date.now()+120000,maxSearches:0}),/positive integer/);
 // The SDK caches its fetch transport. Exercise missing usage on that same transport.
 calls.length=0;omitUsage=true;
 await researchWithWebSearch({system:'methodology',prompt:'report',deadline:Date.now()+120000,maxSearches:1});
 assert.deepEqual(calls.map(c=>c.tools?.[0].max_uses),[1,undefined]);
});
