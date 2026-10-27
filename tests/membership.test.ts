import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { test } from "node:test";
import { effectiveTier, entitlementsFor, planCreditGrant, canQueueVariant, PLANS } from "../lib/plans";
import { SIGNAL_FEED_SQL, SIGNAL_HIDDEN_SQL, signalFeedParams, signalHiddenParams, canReadSignals } from "../lib/signal-feed";

test("effective tier: founding beats a plan, a live plan beats the trial", () => {
  assert.equal(effectiveTier({ accessGranted: true, trialActive: false, plan: "silver" }), "founding");
  assert.equal(effectiveTier({ accessGranted: false, trialActive: true, plan: "gold" }), "gold");
  assert.equal(effectiveTier({ accessGranted: false, trialActive: true, plan: null }), "trial");
  assert.equal(effectiveTier({ accessGranted: false, trialActive: false, plan: null }), "none");
  assert.equal(effectiveTier({ accessGranted: false, trialActive: false, plan: null, admin: true }), "founding");
});

test("entitlements follow the approved plan matrix", () => {
  const diamond = entitlementsFor("diamond");
  const gold = entitlementsFor("gold");
  const silver = entitlementsFor("silver");
  assert.deepEqual(entitlementsFor("founding"), diamond);
  assert.equal(diamond.signals, "all");
  assert.equal(gold.signals, "weekly");
  assert.equal(gold.signalDelayDays, 7);
  assert.equal(silver.signals, "monthly");
  assert.equal(silver.signalDelayDays, 30);
  // The trial has Gold features, but never the trader's calls.
  assert.equal(entitlementsFor("trial").signals, "none");
  assert.equal(entitlementsFor("trial").leaps, true);
  assert.equal(canReadSignals(entitlementsFor("trial").signals), false);
  assert.equal(canReadSignals(entitlementsFor("none").signals), false);
  assert.deepEqual([diamond.watchlistMax, gold.watchlistMax, silver.watchlistMax], [null, 50, 10]);
  assert.deepEqual([diamond.maxOpenJobs, gold.maxOpenJobs, silver.maxOpenJobs], [10, 5, 3]);
  assert.deepEqual([diamond.sweeps, gold.sweeps, silver.sweeps], [true, false, false]);
  assert.deepEqual([gold.gamma, gold.leaps, silver.gamma, silver.leaps], [true, true, false, false]);
  assert.equal(canQueueVariant(silver, "memo"), false);
  assert.equal(canQueueVariant(silver, "full"), true);
  assert.equal(canQueueVariant(gold, "memo"), true);
  assert.deepEqual([PLANS.silver.monthlyUsd, PLANS.gold.monthlyUsd, PLANS.diamond.monthlyUsd], [29, 59, 129]);
  assert.deepEqual(planCreditGrant("gold", "month"), { credits: 30, carryCap: 30 });
  assert.deepEqual(planCreditGrant("silver", "month"), { credits: 10, carryCap: 0 });
  assert.deepEqual(planCreditGrant("diamond", "year"), { credits: 900, carryCap: 900 });
});

async function migrated(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
   CREATE TABLE auth.users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),email text,raw_user_meta_data jsonb,raw_app_meta_data jsonb,created_at timestamptz DEFAULT now(),last_sign_in_at timestamptz);
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT null::uuid $$;`);
  for (const name of (await readdir("supabase/migrations")).filter((n) => n.endsWith(".sql")).sort()) {
    await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
  }
  return db;
}

test("plan credits: one grant per invoice, Silver expiry, Gold rollover, upgrade top-up, ACLs", async () => {
  const db = await migrated();
  try {
    const user = "00000000-0000-0000-0000-000000000002";
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,'plan@example.test')", [user]);
    const ws = (await db.query<{ ws: string }>("SELECT active_workspace_id AS ws FROM stocks.profiles WHERE id=$1", [user])).rows[0].ws;
    const balance = async () => Number((await db.query<{ b: number }>("SELECT sum(delta) AS b FROM stocks.credits_ledger WHERE workspace_id=$1", [ws])).rows[0].b);
    const upsert = (sub: string, plan: string, status: string) =>
      db.query<{ ok: boolean }>("SELECT stocks.upsert_subscription($1,$2,'cus_1',$3,$4,'month',$5,now()+interval '30 days',false) AS ok", [user, ws, sub, plan, status]);
    const grant = (inv: string, mode: string, credits: number, cap: number) =>
      db.query<{ n: number }>("SELECT stocks.grant_plan_credits('sub_1',$1,$2,$3,$4) AS n", [inv, mode, credits, cap]);
    const spend = async (cost: number) => {
      const { rows } = await db.query<{ id: number }>("INSERT INTO stocks.jobs(workspace_id,type,payload) VALUES($1,'build_case_study','{}') RETURNING id", [ws]);
      await db.query("SELECT stocks.charge_job_credits($1,$2)", [rows[0].id, cost]);
    };

    assert.equal(await balance(), 5); // trial credits
    await upsert("sub_1", "silver", "active");
    assert.equal((await grant("in_1", "renewal", 10, 0)).rows[0].n, 10);
    assert.equal((await grant("in_1", "renewal", 10, 0)).rows[0].n, 0); // replay
    assert.equal(await balance(), 15);
    await spend(4); // plan credits go first: 6 plan credits left
    await grant("in_2", "renewal", 10, 0); // Silver: the 6 unused expire
    assert.equal(await balance(), 15 - 4 - 6 + 10);
    assert.equal(
      Number((await db.query<{ d: number }>("SELECT delta AS d FROM stocks.credits_ledger WHERE reason='plan_expire' AND ref='in_2'")).rows[0].d),
      -6,
    );

    // Upgrade to Gold mid-period: only the difference, then a Gold renewal carries up to 30.
    await upsert("sub_1", "gold", "active");
    assert.equal((await grant("in_3", "upgrade", 30, 30)).rows[0].n, 20);
    const before = await balance();
    await grant("in_4", "renewal", 30, 30); // 30 unused plan credits, all carried
    assert.equal(await balance(), before + 30);
    await grant("in_5", "renewal", 30, 30); // 60 unused, 30 carried, 30 expire
    assert.equal(await balance(), before + 30);

    // A late event for an old, cancelled subscription can't replace a live one.
    assert.equal((await upsert("sub_0", "silver", "canceled")).rows[0].ok, false);
    assert.equal((await db.query<{ plan: string }>("SELECT plan FROM stocks.subscriptions")).rows[0].plan, "gold");

    await assert.rejects(db.query("SELECT stocks.grant_plan_credits('sub_missing','in_x','renewal',10,0)"), /not recorded/);
    for (const role of ["anon", "authenticated", "stocks_app"]) {
      for (const fn of [
        "stocks.upsert_subscription(uuid,uuid,text,text,text,text,text,timestamptz,boolean)",
        "stocks.grant_plan_credits(text,text,text,integer,integer)",
      ]) {
        assert.equal((await db.query<{ ok: boolean }>("SELECT has_function_privilege($1,$2,'EXECUTE') AS ok", [role, fn])).rows[0].ok, false, `${role} ${fn}`);
      }
      assert.equal((await db.query<{ ok: boolean }>("SELECT has_table_privilege($1,'stocks.subscriptions','INSERT') AS ok", [role])).rows[0].ok, false);
    }
    assert.equal((await db.query<{ ok: boolean }>("SELECT has_function_privilege('stocks_billing','stocks.grant_plan_credits(text,text,text,integer,integer)','EXECUTE') AS ok")).rows[0].ok, true);
    assert.equal((await db.query<{ ok: boolean }>("SELECT has_table_privilege('stocks_app','stocks.subscriptions','SELECT') AS ok")).rows[0].ok, true);
  } finally {
    await db.close();
  }
});

test("signal picks: Gold gets 2 BUYs a week, Silver 1 a month, follow-ups included, the rest after the delay", async () => {
  const db = await migrated();
  try {
    // Backdate signals for the test: the chain trigger stamps posted_at itself.
    await db.exec("ALTER TABLE stocks.signals DISABLE TRIGGER signals_chain");
    const add = (id: number, action: string, ticker: string, postedAt: string) =>
      db.query(
        "INSERT INTO stocks.signals(id,posted_at,action,ticker,author_discord_id,source_message_id,hash) OVERRIDING SYSTEM VALUE VALUES($1,$2,$3,$4,'123456',$5,'x')",
        [id, postedAt, action, ticker, String(100000 + id)],
      );
    const now = Date.now();
    const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();
    // An old week: three BUYs, a follow-up on the first and on the third.
    await add(1, "BUY", "AAA", "2026-09-01T14:00:00Z"); // week + month pick
    await add(2, "BUY", "BBB", "2026-09-02T14:00:00Z"); // week pick
    await add(3, "BUY", "CCC", "2026-09-03T14:00:00Z"); // not a pick
    await add(4, "CLOSE", "AAA", "2026-09-04T14:00:00Z"); // follows a pick
    await add(5, "EXIT", "CCC", "2026-09-04T15:00:00Z"); // follows a non-pick
    await add(6, "BUY", "DDD", "2026-09-08T14:00:00Z"); // next week: week pick, not the month's first
    const tiers = Object.fromEntries(
      (await db.query<{ id: number; gold: boolean; silver: boolean }>("SELECT * FROM stocks.signal_live_tiers() ORDER BY id")).rows.map((r) => [Number(r.id), [r.gold, r.silver]]),
    );
    assert.deepEqual(tiers, {
      1: [true, true],
      2: [true, false],
      3: [false, false],
      4: [true, true],
      5: [false, false],
      6: [true, false],
    });

    // Recent calls: the delay decides what a non-pick member sees.
    await add(7, "BUY", "EEE", daysAgo(10));
    await add(8, "BUY", "FFF", daysAgo(1));
    await add(9, "BUY", "GGG", daysAgo(1));
    await add(10, "BUY", "HHH", daysAgo(1));
    await db.exec("SET search_path TO stocks, public");
    const feed = async (access: "all" | "weekly" | "monthly", delay: number | null) =>
      (await db.query<{ id: number }>(SIGNAL_FEED_SQL, signalFeedParams(access, delay, 100))).rows.map((r) => Number(r.id)).sort((a, b) => a - b);
    const hidden = async (access: "all" | "weekly" | "monthly", delay: number | null) =>
      Number((await db.query<{ n: number }>(SIGNAL_HIDDEN_SQL, signalHiddenParams(access, delay))).rows[0].n);
    assert.deepEqual(await feed("all", null), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const recentGoldPicks = (await db.query<{ id: number }>("SELECT id FROM stocks.signal_live_tiers() WHERE gold AND id >= 8")).rows.map((r) => Number(r.id));
    const gold = await feed("weekly", 7);
    assert.ok(gold.includes(7), "older than 7 days is visible to Gold");
    for (const id of [8, 9, 10]) assert.equal(gold.includes(id), recentGoldPicks.includes(id), `Gold sees #${id} only if it is a weekly pick`);
    assert.equal(await hidden("weekly", 7), 3 - recentGoldPicks.length);
    const silver = await feed("monthly", 30);
    assert.ok([1, 2, 3, 4, 5, 6].every((id) => silver.includes(id)), "older than 30 days is visible to Silver");
    assert.equal(silver.includes(10), false);
  } finally {
    await db.close();
  }
});

test("tier channels: a Gold/Silver pick is queued for those channels too, each drained in order", async () => {
  const db = await migrated();
  try {
    const record = (action: string, ticker: string, source: string) =>
      db.query("SELECT stocks.record_signal($1::jsonb,'123456','tester',$2,'111111','222222','333333')", [
        JSON.stringify({ action, ticker, detail: "" }),
        source,
      ]);
    await record("BUY", "AAA", "900001"); // first BUY: Gold + Silver pick
    await record("BUY", "BBB", "900002"); // Gold pick (2nd this week) unless the week rolled over, never Silver
    await record("BUY", "CCC", "900003");
    await record("BUY", "AAA", "900001"); // replay: nothing new
    const outbox = async (dest: string) =>
      (await db.query<{ signal_id: number }>("SELECT signal_id FROM stocks.signal_outbox WHERE destination=$1 ORDER BY signal_id", [dest])).rows.map((r) => Number(r.signal_id));
    const ids = (await db.query<{ id: number }>("SELECT id FROM stocks.signals ORDER BY id")).rows.map((r) => Number(r.id));
    const tiers = (await db.query<{ id: number; gold: boolean; silver: boolean }>("SELECT * FROM stocks.signal_live_tiers() ORDER BY id")).rows;
    assert.deepEqual(await outbox("111111"), ids);
    assert.deepEqual(await outbox("222222"), tiers.filter((t) => t.gold).map((t) => Number(t.id)));
    assert.deepEqual(await outbox("333333"), tiers.filter((t) => t.silver).map((t) => Number(t.id)));
    assert.equal((await outbox("333333")).length, 1);

    // Each destination drains independently with its own lease.
    const main = (await db.query<any>("SELECT * FROM stocks.claim_signal_delivery('111111')")).rows[0];
    const silver = (await db.query<any>("SELECT * FROM stocks.claim_signal_delivery('333333')")).rows[0];
    assert.equal(main.signal.id, silver.signal.id);
    assert.notEqual(main.lease_token, silver.lease_token);
    assert.equal((await db.query<any>("SELECT stocks.finish_signal_delivery($1,$2,'m1') AS done", [silver.signal.id, silver.lease_token])).rows[0].done, true);
    assert.equal((await db.query<any>("SELECT delivered_at FROM stocks.signal_outbox WHERE destination='111111' AND signal_id=$1", [main.signal.id])).rows[0].delivered_at, null);
    assert.equal((await db.query<any>("SELECT stocks.finish_signal_delivery($1,$2,'m2') AS done", [main.signal.id, main.lease_token])).rows[0].done, true);
    for (const role of ["anon", "authenticated", "stocks_app"]) {
      assert.equal((await db.query<{ ok: boolean }>("SELECT has_function_privilege($1,'stocks.record_signal(jsonb,text,text,text,text,text,text)','EXECUTE') AS ok", [role])).rows[0].ok, false);
    }
    assert.equal((await db.query<{ ok: boolean }>("SELECT has_function_privilege('stocks_signals','stocks.record_signal(jsonb,text,text,text,text,text,text)','EXECUTE') AS ok")).rows[0].ok, true);
  } finally {
    await db.close();
  }
});
