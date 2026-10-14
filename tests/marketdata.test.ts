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
test('alpaca fallback serves charts and movers when Yahoo rate-limits', async(t)=>{
 const {resetYahooCooldown}=await import('../lib/marketdata');
 const {fetchMovers,fetchDailyBars}=await import('../lib/marketdata');
 const iso=(u:number)=>new Date(u*1000).toISOString();
 const urls:string[]=[];
 const respond=(url:string)=>{
  urls.push(url);
  if (url.includes('yahoo.com')) return new Response('',{status:429});
  if (url.includes('/screener/stocks/movers')) return Response.json({gainers:[{symbol:'ABC',price:5,percent_change:12.345}],losers:[]});
  const u=new URL(url);
  if (u.searchParams.get('timeframe')==='1Day') {
   const adj=u.searchParams.get('adjustment')==='all';
   return Response.json({bars:[{t:'2026-09-23T04:00:00Z',o:1,h:2,l:1,c:2,v:9},{t:'2026-09-24T04:00:00Z',o:2,h:3,l:2,c:adj?2.5:3,v:9}],next_page_token:null});
  }
  // 9:25 premarket bar (dropped), then the five opening bars, split across two pages.
  const all=[-5,0,1,2,3,4].map(i=>({t:iso(start+i*60),o:10,h:12,l:9,c:11,v:100}));
  return u.searchParams.get('page_token') ? Response.json({bars:all.slice(3)}) : Response.json({bars:all.slice(0,3),next_page_token:'p2'});
 };
 process.env.ALPACA_KEY_ID='k'; process.env.ALPACA_SECRET_KEY='s';
 try {
  resetYahooCooldown();
  t.mock.method(globalThis,'fetch',async(url:string)=>respond(String(url)));
  const data=await fetchOpeningCandle('BRK-B',date);
  assert.equal(data.first_five_minute_candle.volume,500);
  assert.ok(urls.some(u=>u.includes('/v2/stocks/BRK.B/bars')));
  // Yahoo is now cooling down: the next request goes straight to Alpaca.
  urls.length=0;
  const daily=await fetchDailyBars('SPY','1y',0);
  assert.deepEqual(daily.closes,[2,3]);
  assert.deepEqual(daily.adjCloses,[2,2.5]);
  assert.ok(!urls.some(u=>u.includes('yahoo.com')));
  const movers=await fetchMovers(5);
  assert.equal(movers.gainers[0].change_pct,12.35);
  assert.match(movers.note,/Alpaca/);
 } finally {
  delete process.env.ALPACA_KEY_ID; delete process.env.ALPACA_SECRET_KEY; resetYahooCooldown();
 }
});
test('without Alpaca keys a Yahoo 429 still surfaces as before', async(t)=>{
 const {resetYahooCooldown}=await import('../lib/marketdata');
 resetYahooCooldown();
 t.mock.method(globalThis,'fetch',async()=>new Response('',{status:429}));
 await assert.rejects(fetchHistory('TEST','5m','5d'),/Yahoo chart API returned 429/);
 resetYahooCooldown();
});
