import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { test } from "node:test";
const wsQuery = "SELECT active_workspace_id AS ws FROM stocks.profiles LIMIT 1";
test("fresh migration replay, refunds, dead letters, immutable chain, durable delivery and ACLs", async () => {
 const db = new PGlite();
 try {
  await db.exec(`CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
   CREATE TABLE auth.users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),email text,raw_user_meta_data jsonb,raw_app_meta_data jsonb,created_at timestamptz DEFAULT now(),last_sign_in_at timestamptz);
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT null::uuid $$;`);
  const migrations = (await readdir("supabase/migrations")).filter(n=>n.endsWith(".sql")).sort();
  for (const name of migrations) await db.exec(await readFile(`supabase/migrations/${name}`,"utf8"));
  // Existing full schemas are left untouched by the fresh-install baseline.
  await db.exec(await readFile(`supabase/migrations/${migrations[0]}`,"utf8"));
  const user="00000000-0000-0000-0000-000000000001";
  await db.query("INSERT INTO auth.users(id,email) VALUES($1,'regression@example.test')",[user]);
  const ws=(await db.query<{ws:string}>(wsQuery)).rows[0].ws;
  const balance=async()=>Number((await db.query<{balance:number}>("SELECT sum(delta) AS balance FROM stocks.credits_ledger WHERE workspace_id=$1",[ws])).rows[0].balance);
  assert.equal(await balance(),5);
  for (const kind of ['access','credits']) {
   for (const refundFirst of [true,false]) {
    const ref=`${kind}_${refundFirst}`;
    const fulfill=()=>db.query("SELECT stocks.fulfill_checkout($1,$2,$3,$4,$5,100,10)",[`cs_${ref}`,`pi_${ref}`,ws,user,kind]);
    const refund=()=>db.query("SELECT stocks.refund_payment($1)",[`pi_${ref}`]);
    if (refundFirst) {await refund();await fulfill();} else {await fulfill();await refund();}
    await fulfill();await refund();
    assert.equal(await balance(),5,ref);
    assert.equal((await db.query<{access_granted:boolean}>("SELECT access_granted FROM stocks.profiles")).rows[0].access_granted,false);
    assert.equal((await db.query<{status:string}>("SELECT status FROM stocks.payments WHERE stripe_session_id=$1",[`cs_${ref}`])).rows[0].status,'refunded');
   }
  }
  // Refunding one of several access payments must keep the remaining grant.
  for (const ref of ['a','b']) await db.query("SELECT stocks.fulfill_checkout($1,$2,$3,$4,'access',100,0)",[`access_${ref}`,`access_pi_${ref}`,ws,user]);
  await db.exec("SELECT stocks.refund_payment('access_pi_a')");
  assert.equal((await db.query<{access_granted:boolean}>("SELECT access_granted FROM stocks.profiles")).rows[0].access_granted,true);
  await db.exec("SELECT stocks.refund_payment('access_pi_b')");
  assert.equal((await db.query<{access_granted:boolean}>("SELECT access_granted FROM stocks.profiles")).rows[0].access_granted,false);
  await db.query("INSERT INTO stocks.case_studies(workspace_id,ticker,variant) VALUES($1,'TEST','one_candle')",[ws]);
  await db.query(`INSERT INTO stocks.jobs(workspace_id,type,payload,status,attempts,locked_at) VALUES($1,'build_case_study','{"case_study_id":1}','running',3,now()-interval '20 minutes')`,[ws]);
  await db.exec(`SELECT stocks.charge_job_credits(1,2); SELECT stocks.claim_job(); SELECT stocks.claim_job();`);
  assert.equal(await balance(),5);
  assert.equal((await db.query<{n:number}>("SELECT count(*)::int AS n FROM stocks.credits_ledger WHERE reason='job_refund'")).rows[0].n,1);
  // Simulate out-of-order IDs assigned before trigger execution.
  for (const id of [100,10]) await db.exec(`INSERT INTO stocks.signals(id,action,ticker,author_discord_id,source_message_id) OVERRIDING SYSTEM VALUE VALUES(${id},'BUY','TEST','123456','12345${id}')`);
  assert.equal((await db.query<{broken_at:null}>("SELECT * FROM stocks.verify_signal_chain()")).rows[0].broken_at,null);
  await assert.rejects(db.exec("UPDATE stocks.signals SET detail='forged'"),/append-only/);
  await assert.rejects(db.exec("TRUNCATE stocks.signals CASCADE"),/append-only/);
  const sig=JSON.stringify({action:'BUY',ticker:'TEST',detail:'durable'});
  await db.query("SELECT stocks.record_signal($1::jsonb,'123456','tester','987654','654321')",[sig]);
  await db.query("SELECT stocks.record_signal($1::jsonb,'123456','tester','987654','654321')",[sig]);
  let item=(await db.query<any>("SELECT * FROM stocks.claim_signal_delivery('654321')")).rows[0];
  assert.equal(item.attempts,1);
  assert.equal((await db.query("SELECT * FROM stocks.claim_signal_delivery('654321')")).rows.length,0);
  // Crash: an abandoned lease is reclaimed, with a new fencing token.
  await db.exec("UPDATE stocks.signal_outbox SET locked_at=now()-interval '2 minutes'");
  const retry=(await db.query<any>("SELECT * FROM stocks.claim_signal_delivery('654321')")).rows[0];
  assert.notEqual(retry.lease_token,item.lease_token);
  assert.equal((await db.query<any>("SELECT stocks.finish_signal_delivery($1,$2,'message') AS done",[item.signal.id,item.lease_token])).rows[0].done,false);
  await db.query("SELECT stocks.retry_signal_delivery($1,$2,'send failed')",[retry.signal.id,retry.lease_token]);
  assert.equal((await db.query("SELECT * FROM stocks.claim_signal_delivery('654321')")).rows.length,0);
  await db.exec("UPDATE stocks.signal_outbox SET next_attempt_at=now()-interval '1 minute'");
  item=(await db.query<any>("SELECT * FROM stocks.claim_signal_delivery('654321')")).rows[0];
  assert.equal((await db.query<any>("SELECT stocks.finish_signal_delivery($1,$2,'message') AS done",[item.signal.id,item.lease_token])).rows[0].done,true);
  await db.query("SELECT stocks.record_signal($1::jsonb,'123456','tester','987654','654321')",[sig]);
  assert.equal((await db.query("SELECT * FROM stocks.claim_signal_delivery('654321')")).rows.length,0);
  for (const role of ['anon','authenticated','stocks_app']) {
   assert.equal((await db.query<any>("SELECT has_function_privilege($1,'stocks.fulfill_checkout(text,text,uuid,uuid,text,integer,integer)','EXECUTE') AS allowed",[role])).rows[0].allowed,false);
   assert.equal((await db.query<any>("SELECT has_function_privilege($1,'stocks.record_signal(jsonb,text,text,text,text)','EXECUTE') AS allowed",[role])).rows[0].allowed,false);
  }
  assert.equal((await db.query<any>("SELECT has_table_privilege('stocks_signals','stocks.signals','INSERT') AS allowed")).rows[0].allowed,false);
 } finally {await db.close();}
});

test("baseline refuses a partial existing schema without rebuilding it", async () => {
 const db = new PGlite();
 try {
  await db.exec("CREATE SCHEMA stocks; CREATE TABLE stocks.keep_me(id int); INSERT INTO stocks.keep_me VALUES(42)");
  await assert.rejects(db.exec(await readFile("supabase/migrations/20261004152454_stock_studio_baseline.sql", "utf8")), /Partial stocks schema/);
  assert.equal((await db.query<{id:number}>("SELECT id FROM stocks.keep_me")).rows[0].id, 42);
 } finally { await db.close(); }
});

test("a retrying BUY blocks its CLOSE until the BUY is acknowledged", async () => {
 const db = new PGlite();
 try {
  await db.exec(`CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
   CREATE TABLE auth.users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),email text,raw_user_meta_data jsonb,raw_app_meta_data jsonb,created_at timestamptz DEFAULT now(),last_sign_in_at timestamptz);
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT null::uuid $$;`);
  for (const name of (await readdir("supabase/migrations")).filter(n=>n.endsWith(".sql")).sort()) await db.exec(await readFile(`supabase/migrations/${name}`,"utf8"));
  for (const [action, source] of [['BUY','12345000'],['CLOSE','12345001']]) {
   await db.query("SELECT stocks.record_signal($1::jsonb,'123456','tester',$2,'654321')",[JSON.stringify({action,ticker:'TEST',detail:''}),source]);
  }
  const first=(await db.query<any>("SELECT * FROM stocks.claim_signal_delivery('654321')")).rows[0];
  assert.equal(first.signal.action,'BUY');
  assert.equal((await db.query("SELECT * FROM stocks.claim_signal_delivery('654321')")).rows.length,0);
  await db.query("SELECT stocks.retry_signal_delivery($1,$2,'send failed')",[first.signal.id,first.lease_token]);
  assert.equal((await db.query("SELECT * FROM stocks.claim_signal_delivery('654321')")).rows.length,0);
  await db.exec("UPDATE stocks.signal_outbox SET next_attempt_at=now()-interval '1 minute'");
  const retry=(await db.query<any>("SELECT * FROM stocks.claim_signal_delivery('654321')")).rows[0];
  assert.equal(retry.signal.id,first.signal.id);
  await db.query("SELECT stocks.finish_signal_delivery($1,$2,'message-1')",[retry.signal.id,retry.lease_token]);
  const next=(await db.query<any>("SELECT * FROM stocks.claim_signal_delivery('654321')")).rows[0];
  assert.equal(next.signal.action,'CLOSE');
 } finally {await db.close();}
});
