import postgres from "postgres";
import { readFile,readdir } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
test('PostgreSQL concurrent webhook events and signal inserts preserve invariants', {skip:!process.env.TEST_DATABASE_URL},async()=>{
 const db=postgres(process.env.TEST_DATABASE_URL!,{max:8,prepare:false});
 try {
  // Dedicated, disposable test database only. CI creates it for this suite.
  await db.unsafe(`CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
   CREATE TABLE auth.users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),email text,raw_user_meta_data jsonb,raw_app_meta_data jsonb,created_at timestamptz DEFAULT now(),last_sign_in_at timestamptz);
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT null::uuid $$;`);
  for(const name of (await readdir('supabase/migrations')).filter(x=>x.endsWith('.sql')).sort()) await db.unsafe(await readFile(`supabase/migrations/${name}`,'utf8'));
  const [user]=await db`INSERT INTO auth.users(email) VALUES('concurrency@example.test') RETURNING id`;
  const [profile]=await db`SELECT active_workspace_id AS ws FROM stocks.profiles WHERE id=${user.id}`;
  await Promise.all(Array.from({length:20},async(_,i)=>{
   const fulfill=()=>db`SELECT stocks.fulfill_checkout(${`cs_${i}`},${`pi_${i}`},${profile.ws},${user.id},'credits',100,10)`;
   const refund=()=>db`SELECT stocks.refund_payment(${`pi_${i}`})`;
   await Promise.all(i%2?[fulfill(),refund()]:[refund(),fulfill()]);
   await Promise.all([fulfill(),refund()]);
  }));
  const [balance]=await db`SELECT sum(delta)::int AS n FROM stocks.credits_ledger`;
  assert.equal(balance.n,5);
  await Promise.all(Array.from({length:40},(_,i)=>db`SELECT stocks.record_signal(${db.json({action:'BUY',ticker:'TEST',detail:'concurrent'})},'123456','tester',${String(12345000+i)},'654321')`));
  const [chain]=await db`SELECT * FROM stocks.verify_signal_chain()`;
  assert.equal(chain.broken_at,null);assert.equal(Number(chain.checked),40);
  const claims=await Promise.all(Array.from({length:8},()=>db`SELECT * FROM stocks.claim_signal_delivery('654321')`));
  assert.equal(new Set(claims.map(rows=>rows[0].signal.id)).size,8);
 }finally {await db.end();}
});
