import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { test } from "node:test";

async function freshDb() {
 const db = new PGlite();
 await db.exec(`CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE auth.users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),email text,raw_user_meta_data jsonb,raw_app_meta_data jsonb,created_at timestamptz DEFAULT now(),last_sign_in_at timestamptz);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT null::uuid $$;`);
 for (const name of (await readdir("supabase/migrations")).filter(n=>n.endsWith(".sql")).sort()) await db.exec(await readFile(`supabase/migrations/${name}`,"utf8"));
 await db.query("INSERT INTO auth.users(id,email) VALUES('00000000-0000-0000-0000-000000000001','ops@example.test')");
 return db;
}
const issues = async (db: PGlite, sql = "SELECT * FROM stocks.ops_health_issues()") =>
 Object.fromEntries((await db.query<{key:string;severity:string;summary:string}>(sql)).rows.map(r=>[r.key,r]));
const sweep = async (db: PGlite) =>
 (await db.query<{kind:string;key:string}>("SELECT kind,key FROM stocks.ops_alert_sweep() ORDER BY key")).rows.map(r=>`${r.kind}:${r.key}`);

test("worker outage alerts open once, remind, and resolve", async () => {
 const db = await freshDb();
 try {
  assert.deepEqual(await issues(db), {});
  assert.deepEqual(await sweep(db), []);
  await db.exec("SELECT stocks.engine_heartbeat('{\"web_research\":false}'); UPDATE stocks.ops_heartbeats SET beat_at=now()-interval '25 minutes'");
  assert.match((await issues(db)).engine_down.summary, /hasn't run since .* \(25 min ago\)/);
  assert.deepEqual(await sweep(db), ["opened:engine_down"]);
  assert.deepEqual(await sweep(db), [], "an open alert is announced once");
  await db.exec("UPDATE stocks.ops_alerts SET notified_at=now()-interval '4 hours'");
  assert.deepEqual(await sweep(db), ["reminder:engine_down"]);
  await db.exec("SELECT stocks.engine_heartbeat('{}')");
  assert.deepEqual(await sweep(db), ["resolved:engine_down"]);
  assert.deepEqual(await sweep(db), []);
  // It comes back as a new alert, not a silent reopen.
  await db.exec("UPDATE stocks.ops_heartbeats SET beat_at=now()-interval '1 hour'");
  assert.deepEqual(await sweep(db), ["opened:engine_down"]);
  // Without Vault/pg_net the sender still sweeps, it just posts nothing.
  await db.exec("SELECT stocks.engine_heartbeat('{}')");
  assert.equal((await db.query<{n:number}>("SELECT stocks.send_ops_alerts() AS n")).rows[0].n, 0);
  assert.equal((await db.query<{n:number}>("SELECT count(*)::int AS n FROM stocks.ops_alerts WHERE resolved_at IS NULL")).rows[0].n, 0);
 } finally { await db.close(); }
});

test("alerts are posted to the Discord webhook from Vault", async () => {
 const db = await freshDb();
 try {
  // Stand-ins for Supabase Vault and pg_net.
  await db.exec(`CREATE SCHEMA vault; CREATE TABLE vault.decrypted_secrets(name text, decrypted_secret text);
   INSERT INTO vault.decrypted_secrets VALUES('ops_alert_webhook_url','https://discord.test/hook'),('engine_webhook_url','https://app.test/api/engine/run');
   CREATE SCHEMA net; CREATE TABLE net.sent(url text, body jsonb);
   CREATE FUNCTION net.http_post(url text, body jsonb, params jsonb DEFAULT '{}', headers jsonb DEFAULT '{}', timeout_milliseconds integer DEFAULT 5000)
   RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.sent VALUES(url, body) RETURNING 1::bigint $$;`);
  await db.exec("SELECT stocks.engine_heartbeat('{}'); UPDATE stocks.ops_heartbeats SET beat_at=now()-interval '15 minutes'");
  assert.equal((await db.query<{n:number}>("SELECT stocks.send_ops_alerts() AS n")).rows[0].n, 1);
  assert.equal((await db.query<{n:number}>("SELECT stocks.send_ops_alerts() AS n")).rows[0].n, 0);
  await db.exec("SELECT stocks.engine_heartbeat('{}')");
  assert.equal((await db.query<{n:number}>("SELECT stocks.send_ops_alerts() AS n")).rows[0].n, 1);
  const sent = (await db.query<{url:string;body:any}>("SELECT * FROM net.sent")).rows;
  assert.equal(sent.length, 2);
  assert.equal(sent[0].url, "https://discord.test/hook");
  assert.match(sent[0].body.content, /🔴 \*\*engine_down\*\* The research worker hasn't run since/);
  assert.match(sent[0].body.content, /https:\/\/app\.test\/admin\/system$/);
  assert.deepEqual(sent[0].body.allowed_mentions, { parse: [] });
  assert.match(sent[1].body.content, /✅ \*\*engine_down\*\* resolved/);
 } finally { await db.close(); }
});

test("late, held and failing jobs are reported for the jobs the worker takes", async () => {
 const db = await freshDb();
 try {
  const ws = (await db.query<{ws:string}>("SELECT active_workspace_id AS ws FROM stocks.profiles LIMIT 1")).rows[0].ws;
  await db.query("INSERT INTO stocks.case_studies(workspace_id,ticker,variant) VALUES($1,'AAA','one_candle'),($1,'BBB','full')",[ws]);
  await db.query(`INSERT INTO stocks.jobs(workspace_id,type,payload,created_at) VALUES
   ($1,'build_case_study','{"case_study_id":1}',now()-interval '30 minutes'),
   ($1,'build_case_study','{"case_study_id":2}',now()-interval '30 minutes')`,[ws]);
  // Never checked in: the late automated job is critical, the web-research one is left to the manual path.
  let found = await issues(db);
  assert.equal(found.jobs_delayed.severity, "critical");
  assert.match(found.jobs_delayed.summary, /^1 report\(s\).*never checked in/);
  await db.exec(`SELECT stocks.engine_heartbeat('{"web_research":true}')`);
  found = await issues(db);
  assert.equal(found.jobs_delayed.severity, "warning");
  assert.match(found.jobs_delayed.summary, /^2 report\(s\)/);
  // Held for an Anthropic account problem: its own alert, not a late job.
  await db.exec("UPDATE stocks.jobs SET result='waiting for the engine: credit balance is too low' WHERE id=1");
  found = await issues(db);
  assert.match(found.engine_unavailable.summary, /1 job\(s\) are on hold .*: credit balance is too low$/);
  assert.match(found.jobs_delayed.summary, /^1 report\(s\)/);
  await db.exec("UPDATE stocks.jobs SET status='error', result='boom', updated_at=now()");
  found = await issues(db, "SELECT * FROM stocks.ops_health_issues(failures_per_hour => 2)");
  assert.match(found.jobs_failing.summary, /^2 reports failed/);
  assert.equal(found.jobs_delayed, undefined);
 } finally { await db.close(); }
});

test("undelivered signals and a silent signal bot raise alerts", async () => {
 const db = await freshDb();
 try {
  await db.query("SELECT stocks.record_signal($1::jsonb,'123456','tester','987654','654321')",[JSON.stringify({action:'BUY',ticker:'TEST',detail:''})]);
  const item = (await db.query<any>("SELECT * FROM stocks.claim_signal_delivery('654321')")).rows[0];
  await db.query("SELECT stocks.retry_signal_delivery($1,$2,'Missing Access')",[item.signal.id,item.lease_token]);
  const late = "SELECT * FROM stocks.ops_health_issues(delivery_late_after => '0 seconds')";
  assert.match((await issues(db, late)).signal_delivery_delayed.summary, /^1 signal\(s\) not delivered .*Last error: Missing Access$/);
  assert.equal((await issues(db)).signal_delivery_delayed, undefined, "fresh signals get a grace period");
  assert.equal((await issues(db)).signal_bot_down, undefined, "a bot that never ran stays quiet");
  await db.exec("SELECT stocks.signal_bot_heartbeat(); UPDATE stocks.ops_heartbeats SET beat_at=now()-interval '10 minutes'");
  assert.equal((await issues(db)).signal_bot_down.severity, "critical");
 } finally { await db.close(); }
});

test("only the owning role can beat, and app roles can't send alerts", async () => {
 const db = await freshDb();
 try {
  const can = async (role: string, fn: string) =>
   (await db.query<{ok:boolean}>("SELECT has_function_privilege($1,$2,'EXECUTE') AS ok",[role,fn])).rows[0].ok;
  assert.equal(await can("stocks_app", "stocks.engine_heartbeat(jsonb)"), true);
  assert.equal(await can("stocks_signals", "stocks.engine_heartbeat(jsonb)"), false);
  assert.equal(await can("stocks_signals", "stocks.signal_bot_heartbeat(jsonb)"), true);
  assert.equal(await can("stocks_app", "stocks.signal_bot_heartbeat(jsonb)"), false);
  for (const role of ["anon","authenticated","stocks_app","stocks_signals"]) {
   assert.equal(await can(role, "stocks.send_ops_alerts()"), false, role);
   assert.equal(await can(role, "stocks.ops_alert_sweep(interval)"), false, role);
  }
  assert.equal((await db.query<{ok:boolean}>("SELECT has_table_privilege('stocks_app','stocks.ops_alerts','UPDATE') AS ok")).rows[0].ok, false);
  assert.equal((await db.query<{ok:boolean}>("SELECT has_table_privilege('stocks_app','stocks.ops_alerts','SELECT') AS ok")).rows[0].ok, true);
 } finally { await db.close(); }
});
