import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchOpeningCandle, fetchHistory, mapLimit, exchangeTime } from "../lib/marketdata";
import { waitWithinBudget } from "../lib/deadline";
const date='2026-09-24';
const start=exchangeTime(date,9,30,'America/New_York');
function fixture(offsets:number[],current=start) {
 const n=offsets.length;
 return { chart: { result: [{ meta: { exchangeTimezoneName:'America/New_York',currentTradingPeriod:{regular:{start:current}} },
 timestamp:offsets.map(i=>start+i*60),indicators:{quote:[{open:Array(n).fill(10),high:Array(n).fill(12),low:Array(n).fill(9),close:Array(n).fill(11),volume:Array(n).fill(100)}]} }] } };
}
test('opening range needs all five completed bars at the actual opening time', async(t)=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json(fixture([0,1])));
 await assert.rejects(fetchOpeningCandle('TEST',date),/Incomplete opening range/);
 t.mock.restoreAll();
 t.mock.method(globalThis,'fetch',async()=>Response.json(fixture([30,31,32,33,34])));
 await assert.rejects(fetchOpeningCandle('TEST',date),/Incomplete opening range/);
 t.mock.restoreAll();
 t.mock.method(globalThis,'fetch',async()=>Response.json(fixture([0,1,2,3,4])));
 const data=await fetchOpeningCandle('TEST',date);
 assert.equal(data.first_five_minute_candle.volume,500);
 assert.equal(data.session_date,date);
 t.mock.method(Date,'now',()=> (start+120)*1000);
 await assert.rejects(fetchOpeningCandle('TEST',date),/Incomplete opening range/);
});
test('historical session uses its date and DST, even with current trading metadata',async(t)=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json(fixture([0,1,2,3,4],start+86400)));
 assert.equal((await fetchOpeningCandle('TEST',date)).first_five_minute_candle.volume,500);
 assert.equal(new Date(exchangeTime('2026-01-15',9,30,'America/New_York')*1000).toISOString(),'2026-01-15T14:30:00.000Z');
 assert.equal(new Date(start*1000).toISOString(),'2026-09-24T13:30:00.000Z');
 await assert.rejects(fetchOpeningCandle('TEST','2026-02-30'),/Invalid session date/);
});
test('slow requests and retries respect the invocation deadline',async(t)=>{
 let requests=0;
 // A referenced timer keeps the test alive while AbortSignal.timeout runs.
 const keepAlive=setInterval(()=>{},1000);
 try {
  t.mock.method(globalThis,'fetch',async(_url: Parameters<typeof fetch>[0],opts?: RequestInit)=>{
   requests++;
   return await new Promise<Response>((_resolve,reject)=>opts?.signal?.addEventListener('abort',()=>reject(opts.signal!.reason),{once:true}));
  });
  await assert.rejects(fetchHistory('TEST','5m','5d',Date.now()+40));
  assert.equal(requests,1);
  t.mock.restoreAll();
  t.mock.method(globalThis,'fetch',async()=>{requests++;return new Response('',{status:429});});
  const before=Date.now();
  await assert.rejects(fetchHistory('TEST','5m','5d',Date.now()+40));
  assert.ok(Date.now()-before<500);
  assert.equal(requests,2); // no retry started after deadline
  let scheduled=0;
  await assert.rejects(mapLimit(Array(100).fill(0),8,async()=>{scheduled++;await waitWithinBudget(100,Date.now()+20);return 1;},Date.now()+20));
  assert.equal(scheduled,8);
 } finally {clearInterval(keepAlive);}
});
