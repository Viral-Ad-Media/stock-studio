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
  const claimed=claims.flat();
  assert.equal(claimed.length,1); // an active destination lease blocks later signals
  const first=claimed[0];
  await db`SELECT stocks.retry_signal_delivery(${first.signal.id},${first.lease_token}::uuid,'temporary send failure')`;
  assert.equal((await db`SELECT * FROM stocks.claim_signal_delivery('654321')`).length,0);
  // Other destinations can progress independently of that retry.
  await db`SELECT stocks.record_signal(${db.json({action:'ALERT',ticker:'TEST',detail:''})},'123456','tester','99887766','777777')`;
  assert.equal((await db`SELECT * FROM stocks.claim_signal_delivery('777777')`).length,1);
  await db`UPDATE stocks.signal_outbox SET next_attempt_at=now()-interval '1 minute' WHERE signal_id=${first.signal.id}`;
  const retryClaims=await Promise.all(Array.from({length:8},()=>db`SELECT * FROM stocks.claim_signal_delivery('654321')`));
  const retries=retryClaims.flat();
  assert.equal(retries.length,1);assert.equal(retries[0].signal.id,first.signal.id);
  const retry=retries[0];
  await db`SELECT stocks.finish_signal_delivery(${retry.signal.id},${retry.lease_token}::uuid,'message-1')`;
  const [second]=await db`SELECT * FROM stocks.claim_signal_delivery('654321')`;
  assert.ok(second.signal.id>first.signal.id);

  // Two paid access sessions can be created before either checkout completes.
  await db`SELECT stocks.fulfill_checkout('cs_access_a','pi_access_a',${profile.ws},${user.id},'access',100,0)`;
  await db`SELECT stocks.fulfill_checkout('cs_access_b','pi_access_b',${profile.ws},${user.id},'access',100,0)`;
  let secondRefund: Promise<unknown> | undefined;
  let secondReturned=false;
  let notifyStarted!:()=>void;
  const started=new Promise<void>(resolve=>{notifyStarted=resolve;});
  try {
    await db.begin(async(tx)=>{
      await tx`SELECT stocks.refund_payment('pi_access_a')`;
      // Leave A uncommitted. Before the fix B could finish, see A as paid,
      // and skip revocation while A had already seen B as paid too.
      secondRefund=db.begin(async(other)=>{
        await other`SELECT 1`; // establish the independent connection
        notifyStarted();
        await other`SELECT stocks.refund_payment('pi_access_b')`;
        secondReturned=true;
      });
      await started;
      await new Promise(resolve=>setTimeout(resolve,150));
      assert.equal(secondReturned,false,'a different intent must wait for the same user');
    });
  } finally {if(secondRefund)await secondRefund;}
  const [access]=await db`SELECT access_granted FROM stocks.profiles WHERE id=${user.id}`;
  assert.equal(access.access_granted,false);
  const statuses=await db`SELECT status FROM stocks.payments WHERE kind='access'`;
  assert.ok(statuses.every(payment=>payment.status==='refunded'));

 }finally {await db.end();}
});
