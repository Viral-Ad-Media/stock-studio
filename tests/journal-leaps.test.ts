import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile,readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { validateTrade,realizedPnl,journalStats,readJsonLimited,type TradeInput } from "../lib/journal";
import { parseTradeCsv,exportTradeCsv } from "../lib/journal-csv";
import { JournalStore,importKey } from "../lib/journal-store";
import { validateLeaps,optionModel,leapsAnalysis,DEFAULT_LEAPS } from "../lib/leaps";
import { parseLeapsChain,getLeapsChain } from "../lib/leaps-chain";

const raw={ticker:"TEST",asset:"stock",side:"long",quantity:10,entry_price:100,opened_on:"2026-09-01",closed_on:"2026-09-20",exit_price:110,fees:2,strategy:"Breakout"};
const trade=(overrides:Record<string,unknown>={})=>validateTrade({...raw,...overrides},"2026-10-13");
test("journal validates lots and computes realized results after fees",()=>{
 assert.equal(realizedPnl(trade()),98);
 assert.equal(realizedPnl(trade({side:"short",exit_price:90})),98);
 assert.equal(realizedPnl(trade({asset:"call",quantity:2,entry_price:5,exit_price:7,strike:100,expiration:"2027-01-15"})),398);
 assert.equal(realizedPnl(trade({asset:"put",quantity:1,entry_price:5,exit_price:0,strike:100,expiration:"2027-01-15"})),-502);
 assert.equal(realizedPnl(trade({exit_price:null,closed_on:null})),null);
 assert.equal(realizedPnl(trade({quantity:.5})),3);
 const stats=journalStats([trade(),trade({exit_price:90}),trade({exit_price:null,closed_on:null})]);
 assert.equal(stats.net,-4);assert.equal(stats.closed,2);assert.equal(stats.open,1);assert.equal(stats.profitFactor,null);
 assert.equal(stats.strategies[0].pnl,-4);assert.equal(stats.curve.at(-1)?.pnl,-4);
 const valid=journalStats([trade({fees:0}),trade({exit_price:90,fees:0,closed_on:"2026-09-21"})]);
 assert.equal(valid.drawdown,100);
 for(const bad of [{quantity:0},{quantity:true},{entry_price:" "},{opened_on:"2026-02-30"},{closed_on:"2026-08-31"},{exit_price:null},
  {asset:"call",quantity:.5,strike:100,expiration:"2027-01-15"},{asset:"call",side:"short",strike:100,expiration:"2027-01-15"},
  {asset:"call",quantity:10001,strike:100,expiration:"2027-01-15"},{strike:1},{case_study_id:"1 OR 1=1"}])assert.throws(()=>trade(bad));
});
test("CSV handles BOM, quoted commas/newlines and rejects partial/oversized files",()=>{
 const csv='\uFEFFticker,quantity,entry_price,opened_on,strategy,review\r\nTEST,2,100,2026-09-01,"One, two","line one\nline ""two"""\r\n';
 const parsed=parseTradeCsv(csv);assert.equal(parsed.errors.length,0);assert.equal(parsed.trades[0].review,'line one\nline "two"');
 assert.equal(parseTradeCsv('ticker,quantity,entry_price,opened_on\nTEST,2,100,2026-02-30').errors.length,1);
 assert.throws(()=>parseTradeCsv('ticker,ticker\nA,B'),/duplicate/);
 assert.throws(()=>parseTradeCsv('ticker,quantity,entry_price,opened_on\n"TEST,2,100,2026-09-01'),/Unclosed/);
 assert.throws(()=>parseTradeCsv('ticker,quantity,entry_price,opened_on\n"TEST"abc,2,100,2026-09-01'),/Unexpected text/);
 assert.throws(()=>parseTradeCsv('ticker,quantity,entry_price,opened_on\n'+Array(501).fill('TEST,2,100,2026-09-01').join('\n')),/500/);
 const malicious=trade({strategy:'=HYPERLINK("evil")',review:'\t@evil'});
 const exported=exportTradeCsv([malicious]);assert.match(exported,/'=HYPERLINK/);assert.match(exported,/'@evil/);
 assert.deepEqual(parseTradeCsv(exportTradeCsv([trade()])).trades[0],trade());
 assert.equal(importKey(trade()),importKey(trade({review:"Edited note"})));
 assert.equal(importKey(trade({source_ref:"broker-123"})),importKey(trade({source_ref:"broker-123",fees:3})));
});
test("JSON request limit cancels oversized streams",async()=>{
 await assert.rejects(readJsonLimited(new Request('https://example.test',{method:'POST',body:'x'.repeat(1100000)})),/1 MB/);
 await assert.rejects(readJsonLimited(new Request('https://example.test',{method:'POST',body:'{bad'})),/Invalid JSON/);
 assert.deepEqual(await readJsonLimited(new Request('https://example.test',{method:'POST',body:'{"a":1}'})),{a:1});
});
const near=(a:number|null,b:number,tolerance=.0001)=>assert.ok(a!=null&&Math.abs(a-b)<tolerance,`${a} != ${b}`);
test("Black-Scholes matches reference prices, parity and numerical Greek derivatives",()=>{
 const call=optionModel("call",100,100,365,20,5,0),put=optionModel("put",100,100,365,20,5,0);
 near(call.price,10.4505836);near(put.price,5.573526);
 near(call.price-put.price,100-100*Math.exp(-.05));
 const q=.02,r=.05,T=2;
 const c=optionModel("call",110,100,730,30,5,2),p=optionModel("put",110,100,730,30,5,2);
 near(c.price-p.price,110*Math.exp(-q*T)-100*Math.exp(-r*T));
 const price=(spot:number,days=365,iv=20)=>optionModel("call",spot,100,days,iv,5,0).price;
 near(call.delta,(price(100.01)-price(99.99))/.02,.0001);
 near(call.gamma,(price(100.1)-2*price(100)+price(99.9))/.01,.0001);
 near(call.vega,(price(100,365,20.01)-price(100,365,19.99))/.02,.0001);
 near(call.theta,(price(100,364.9)-price(100,365.1))/.2,.0001);
 const exp=optionModel("put",80,100,0,20,5,0);assert.equal(exp.price,20);assert.equal(exp.delta,null);
 assert.throws(()=>optionModel("call",100,100,365,0,5,0));
});
test("early-exit scenarios use actual entered premium, fees and remaining time",()=>{
 const input=validateLeaps({...DEFAULT_LEAPS,ticker:"TEST",as_of:"2026-01-01",expiration:"2028-01-01",premium:12,contracts:2,fees:10});
 const result=leapsAnalysis(input);assert.equal(result.cost,2410);assert.equal(result.expiryBreakeven,112.05);
 near(result.scenarioPnl,result.scenario.price*200-2410);
 const expiry=leapsAnalysis({...input,exit_days:730,scenario_move:20});near(expiry.scenario.price,20);near(expiry.scenarioPnl,1590);
 assert.ok(result.comparison[2].price>result.comparison[0].price);
 assert.ok(result.current.vega!>0);
 for(const bad of [{iv:0},{scenario_iv:NaN},{contracts:1.5},{exit_days:731},{as_of:"2026-02-30"},{spot:true}])assert.throws(()=>validateLeaps({...input,...bad}));
});
test("chain parsing preserves null/missing fields and never substitutes fake quotes",async(t)=>{
 const now=Date.parse("2026-10-13T14:00:00Z");
 const body={timestamp:"2026-10-13T13:45:00Z",data:{current_price:100,options:[
  {option:"TEST281020C00100000",bid:10,ask:12,iv:.3,volume:0,open_interest:20},
  {option:"TEST281020P00100000",bid:12,ask:10,iv:null},
  {option:"TEST270115C00100000",bid:10,ask:12,iv:.3},
  {option:"TEST1281020C00100000",bid:10,ask:12,iv:.3},
  {option:"TEST280230C00100000",bid:10,ask:12,iv:.3},
 ]}};
 const chain=parseLeapsChain("TEST",body,now)!;assert.equal(chain.options.length,2);assert.equal(chain.options[0].iv,30);assert.equal(chain.options[1].ask,null);assert.equal(chain.options[1].volume,null);
 assert.equal(chain.sourceAt,"2026-10-13T13:45:00.000Z");
 assert.equal(parseLeapsChain("TEST",{...body,timestamp:"2026-10-13 09:45:00"},now)?.sourceAt,null);
 assert.equal(parseLeapsChain("TEST",{data:{options:body.data.options}},now),null);
 const crowded={data:{current_price:100,options:[...Array.from({length:600},(_,i)=>({option:`TEST281020C${String(50000+(i%100)*1000).padStart(8,'0')}`,bid:10,ask:12,iv:.3})),
  {option:"TEST290119C00100000",bid:10,ask:12,iv:.3}]}};
 const sampled=parseLeapsChain("TEST",crowded,now)!;assert.ok(sampled.options.some((o)=>o.expiration==="2029-01-19"));assert.ok(sampled.options.length<=500);assert.equal(sampled.totalMatches,601);
 let calls=0;t.mock.method(Date,"now",()=>now);t.mock.method(globalThis,"fetch",async()=>{calls++;return Response.json(body);});
 const [a,b]=await Promise.all([getLeapsChain("TEST"),getLeapsChain("TEST")]);assert.equal(a,b);assert.equal(calls,1);
 assert.equal(await getLeapsChain("TEST"),a);assert.equal(calls,1);
});

test("journal storage enforces tenancy, deduplication, optimistic edits and archive restore",async()=>{
 const db=new PGlite();
 try {
  await db.exec(`CREATE SCHEMA auth;CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
   CREATE TABLE auth.users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),email text,raw_user_meta_data jsonb,raw_app_meta_data jsonb,created_at timestamptz DEFAULT now(),last_sign_in_at timestamptz);
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT null::uuid $$;`);
  for(const file of (await readdir('supabase/migrations')).filter((f)=>f.endsWith('.sql')).sort())await db.exec(await readFile(`supabase/migrations/${file}`,'utf8'));
  for(const id of ['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002'])await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)",[id,`${id}@example.test`]);
  const ws=(await db.query<{active_workspace_id:string}>("SELECT active_workspace_id FROM stocks.profiles ORDER BY id")).rows.map((r)=>r.active_workspace_id);
  const journal=new JournalStore(async(q,p)=>(await db.query(q,p)).rows);
  const [s1,s2]=(await db.query<{id:number}>("INSERT INTO stocks.case_studies(workspace_id,ticker,variant,status) VALUES($1,'TEST','full','ready'),($2,'PRIVATE','full','ready') RETURNING id",ws)).rows;
  await assert.rejects(journal.insert(ws[0],trade({case_study_id:s2.id})),/workspace/);
  const first=await journal.insert(ws[0],trade({case_study_id:s1.id}),importKey(trade()));assert.ok(first);
  assert.equal(await journal.insert(ws[0],trade(),importKey(trade())),null);
  await journal.insert(ws[1],trade(),importKey(trade()));
  assert.equal((await journal.list(ws[0])).length,1);assert.equal((await journal.list(ws[1])).length,1);
  assert.equal(await journal.update(ws[1],first.id,first.revision,trade()),null);
  const updated=await journal.update(ws[0],first.id,first.revision,trade({exit_price:120}));assert.ok(updated);
  assert.equal(await journal.update(ws[0],first.id,first.revision,trade()),null);
  assert.equal(await journal.archive(ws[1],first.id,updated.revision,true),false);
  assert.equal(await journal.archive(ws[0],first.id,updated.revision,true),true);
  assert.equal((await journal.list(ws[0])).length,0);
  const archived=(await journal.list(ws[0],true))[0];assert.equal(await journal.archive(ws[0],first.id,archived.revision,false),true);
  assert.equal((await journal.list(ws[0])).length,1);
  // Imports are all-or-nothing even if a later row fails a DB constraint.
  await assert.rejects(db.transaction(async(tx)=>{
   const store=new JournalStore(async(q,p)=>(await tx.query(q,p)).rows);
   await store.insert(ws[0],trade({ticker:"NEW"}));
   await store.insert(ws[0],{...trade(),quantity:-1});
  }));
  assert.equal((await journal.list(ws[0])).length,1);
  for(const table of ['journal_trades','leaps_plans']){
   for(const role of ['anon','authenticated'])assert.equal((await db.query<{allowed:boolean}>("SELECT has_table_privilege($1,$2,'SELECT') AS allowed",[role,`stocks.${table}`])).rows[0].allowed,false);
   assert.equal((await db.query<{allowed:boolean}>("SELECT has_table_privilege('stocks_app',$1,'DELETE') AS allowed",[`stocks.${table}`])).rows[0].allowed,false);
   assert.equal((await db.query<{enabled:boolean}>("SELECT relrowsecurity AS enabled FROM pg_class WHERE oid=$1::regclass",[`stocks.${table}`])).rows[0].enabled,true);
  }
  for(const workspace of ws)await db.query("INSERT INTO stocks.leaps_plans(workspace_id,name,ticker,inputs) VALUES($1,'Manual scenario','TEST',$2::jsonb)",
   [workspace,JSON.stringify(validateLeaps({...DEFAULT_LEAPS,ticker:"TEST",as_of:"2026-01-01",expiration:"2028-01-01"}))]);
  // Exercise RLS as authenticated after granting temporary SELECT for this test only.
  await db.exec(`CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT current_setting('test.user_id',true)::uuid $$;
   GRANT USAGE ON SCHEMA stocks,auth TO authenticated;GRANT SELECT ON stocks.journal_trades,stocks.leaps_plans TO authenticated;
   SET test.user_id='00000000-0000-0000-0000-000000000001';SET ROLE authenticated;`);
  assert.equal((await db.query("SELECT * FROM stocks.journal_trades")).rows.length,1);
  assert.equal((await db.query<{workspace_id:string}>("SELECT workspace_id FROM stocks.leaps_plans")).rows[0].workspace_id,ws[0]);
  await db.exec("SET test.user_id='00000000-0000-0000-0000-000000000002'");
  assert.equal((await db.query("SELECT * FROM stocks.journal_trades")).rows.length,1);
  assert.equal((await db.query<{workspace_id:string}>("SELECT workspace_id FROM stocks.journal_trades")).rows[0].workspace_id,ws[1]);
  assert.equal((await db.query<{workspace_id:string}>("SELECT workspace_id FROM stocks.leaps_plans")).rows[0].workspace_id,ws[1]);
 } finally {await db.close();}
});
