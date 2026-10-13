import assert from "node:assert/strict";
import { test } from "node:test";
import { researchWithWebSearch } from "../lib/engine/anthropic";
import { UsageMeter } from "../lib/engine/usage";
test('search exhaustion retains evidence and disables additional tool selection',async(t)=>{
 process.env.ANTHROPIC_API_KEY='test-key-not-a-secret';
 const calls:any[]=[];
 let omitUsage=false;
 let pending=false;
 const encrypted='encrypted-primary-source-evidence';
 t.mock.method(globalThis,'fetch',async(input: Parameters<typeof fetch>[0],init?: RequestInit)=>{
  const body=JSON.parse(await new Request(input,init).text());calls.push(body);
  const final=body.tool_choice?.type==='none';
  const id=`srvtoolu_${calls.length}`;
  if (pending) {
   const step=calls.length;
   return Response.json({id:`msg_pending_${step}`,type:'message',role:'assistant',model:body.model,
    content:step===1 ? [{type:'server_tool_use',id:'srvtoolu_pending',name:'web_search',input:{query:'source'}}]
     : step===2 ? [{type:'web_search_tool_result',tool_use_id:'srvtoolu_pending',content:[{type:'web_search_result',url:'https://example.test/pending',title:'Pending source',encrypted_content:encrypted}]}]
     : [{type:'text',text:'Finished from the preserved evidence.'}],
    stop_reason:step<3?'pause_turn':'end_turn',stop_sequence:null,
    usage:{input_tokens:10,output_tokens:5,server_tool_use:{web_search_requests:step===2?1:0}}});
  }
  return Response.json({id:`msg_${calls.length}`,type:'message',role:'assistant',model:body.model,
   content:final ? [{type:'text',text:'Finished report.'}] : [
    {type:'text',text:'Looking up a primary source.'},
    {type:'server_tool_use',id,name:'web_search',input:{query:'primary source'}},
    {type:'web_search_tool_result',tool_use_id:id,content:[{type:'web_search_result',url:'https://example.test/report',title:'Primary report',encrypted_content:encrypted}]},
   ],stop_reason:final?'end_turn':'pause_turn',stop_sequence:null,
   usage:{input_tokens:10,output_tokens:5,...(omitUsage?{}:{server_tool_use:{web_search_requests:final?0:1}})}});
 });
 const meter=new UsageMeter('claude-sonnet-5');
 const result=await researchWithWebSearch({system:'methodology',prompt:'report',deadline:Date.now()+120000,maxSearches:2,meter});
 assert.deepEqual(calls.map(c=>c.tools?.[0].max_uses),[2,1,undefined]);
 assert.equal(calls[2].tool_choice.type,'none');
 assert.equal(calls[2].tools[0].name,'web_search');
 const evidence=calls[2].messages.filter((m:any)=>m.role==='assistant');
 assert.equal(evidence.length,2);
 for(const m of evidence) assert.equal(m.content[2].content[0].encrypted_content,encrypted);
 assert.equal(result.text,'Finished report.');assert.equal(result.usage.input_tokens,30);
 assert.deepEqual(result.sources,[{title:'Primary report',url:'https://example.test/report'}]);
 assert.equal(meter.totals.web_search_requests,2);assert.equal(meter.totals.calls,3);
 await assert.rejects(researchWithWebSearch({system:'',prompt:'',deadline:Date.now()+120000,maxSearches:0}),/positive integer/);
 calls.length=0;omitUsage=true;
 await researchWithWebSearch({system:'methodology',prompt:'report',deadline:Date.now()+120000,maxSearches:1});
 assert.deepEqual(calls.map(c=>c.tools?.[0].max_uses),[1,undefined]);
 assert.equal(calls[1].tool_choice.type,'none');
 assert.equal(calls[1].messages[1].content[2].content[0].encrypted_content,encrypted);
 // Pending server calls remain resumable without reserving/billing them twice.
 calls.length=0;pending=true;
 const pendingMeter=new UsageMeter('claude-sonnet-5');
 const resumed=await researchWithWebSearch({system:'methodology',prompt:'report',deadline:Date.now()+120000,maxSearches:1,meter:pendingMeter});
 assert.deepEqual(calls.map(c=>c.tools?.[0].max_uses),[1,undefined,undefined]);
 assert.ok(calls.slice(1).every(c=>c.tool_choice.type==='none'));
 assert.equal(calls[2].messages[2].content[0].content[0].encrypted_content,encrypted);
 assert.equal(pendingMeter.totals.web_search_requests,1);
 assert.equal(resumed.text,'Finished from the preserved evidence.');

});
