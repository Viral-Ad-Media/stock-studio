import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { test } from "node:test";
import { accountPlan, effectiveTier, entitlementsFor, planCreditGrant, canQueueVariant, FEATURE_PLAN, PLANS, SIGNALS_PER_WEEK, SIGNAL_DELAY_DAYS } from "../lib/plans";
import { SIGNAL_FEED_SQL, SIGNAL_HIDDEN_SQL, signalFeedParams, signalHiddenParams, canReadSignals } from "../lib/signal-feed";

test("effective tier: founding beats a plan, a live plan beats the trial, enrolment caps a plan", () => {
  assert.equal(effectiveTier({ accessGranted: true, trialActive: false, plan: "silver" }), "founding");
  assert.equal(effectiveTier({ accessGranted: false, trialActive: true, plan: "gold" }), "gold");
  assert.equal(effectiveTier({ accessGranted: false, trialActive: true, plan: null }), "trial");
  assert.equal(effectiveTier({ accessGranted: false, trialActive: false, plan: null }), "none");
  assert.equal(effectiveTier({ accessGranted: false, trialActive: false, plan: null, admin: true }), "founding");
  // Enrolment alone unlocks nothing: the monthly subscription has to be live.
  assert.equal(effectiveTier({ accessGranted: false, trialActive: false, plan: null, enrolledPlan: "diamond" }), "none");
  // Gold costs less a month than Silver, so a Silver enrolee who moves to
  // the Gold price in Stripe still only gets Silver.
  assert.equal(effectiveTier({ accessGranted: false, trialActive: false, plan: "gold", enrolledPlan: "silver" }), "silver");
  assert.equal(effectiveTier({ accessGranted: false, trialActive: false, plan: "diamond", enrolledPlan: "gold" }), "gold");
  assert.equal(effectiveTier({ accessGranted: false, trialActive: false, plan: "silver", enrolledPlan: "gold" }), "silver");
  assert.equal(effectiveTier({ accessGranted: false, trialActive: false, plan: "gold", enrolledPlan: "gold" }), "gold");
});

test("entitlements follow the coaching plan matrix", () => {
  const diamond = entitlementsFor("diamond");
  const gold = entitlementsFor("gold");
  const silver = entitlementsFor("silver");
  // Diamond and Founding: every feature and every signal.
  assert.deepEqual(entitlementsFor("founding"), diamond);
  assert.deepEqual([diamond.gamma, diamond.leaps, diamond.sweeps, diamond.setupsLive, diamond.journalAnalysis], [true, true, true, true, true]);
  assert.deepEqual([diamond.watchlistMax, diamond.maxOpenJobs, diamond.variants], [null, 10, null]);
  assert.deepEqual([diamond.signals, diamond.signalsPerWeek, diamond.signalDelayDays], ["all", null, null]);
  // Gold: every feature, 5 signals a week.
  assert.deepEqual({ ...gold, signals: "all", signalsPerWeek: null, signalDelayDays: null }, diamond);
  assert.deepEqual([gold.signals, gold.signalsPerWeek, gold.signalDelayDays], ["gold", 5, 7]);
  // Silver: the research core and 3 signals a week; the rest is locked.
  assert.deepEqual([silver.signals, silver.signalsPerWeek, silver.signalDelayDays], ["silver", 3, 7]);
  assert.deepEqual([silver.gamma, silver.leaps, silver.sweeps, silver.setupsLive, silver.journalAnalysis], [false, false, false, false, false]);
  assert.deepEqual([silver.watchlistMax, silver.maxOpenJobs, silver.liveRefreshCooldownHours], [10, 3, 24]);
  assert.equal(canQueueVariant(silver, "memo"), false);
  assert.equal(canQueueVariant(silver, "full"), true);
  assert.equal(canQueueVariant(gold, "memo"), true);
  // Every locked feature points the member at Gold; unlimited signals at Diamond.
  for (const f of ["gamma", "leaps", "sweeps", "setupsLive", "journalAnalysis", "allVariants"] as const) assert.equal(FEATURE_PLAN[f], "gold");
  assert.equal(FEATURE_PLAN.signalsLive, "diamond");
  // The trial has every feature, but never the trader's calls.
  assert.equal(entitlementsFor("trial").signals, "none");
  assert.equal(entitlementsFor("trial").leaps, true);
  assert.equal(canReadSignals(entitlementsFor("trial").signals), false);
  assert.equal(canReadSignals(entitlementsFor("none").signals), false);
  assert.equal(canReadSignals(silver.signals), true);
  assert.deepEqual([PLANS.silver.monthlyUsd, PLANS.gold.monthlyUsd, PLANS.diamond.monthlyUsd], [97, 47, 47]);
  assert.deepEqual([PLANS.silver.programUsd, PLANS.gold.programUsd, PLANS.diamond.programUsd], [497, 2497, 4997]);
  assert.deepEqual([PLANS.silver.originalProgramUsd, PLANS.gold.originalProgramUsd, PLANS.diamond.originalProgramUsd], [2497, 7497, 11497]);
  assert.deepEqual(planCreditGrant("gold", "month"), { credits: 30, carryCap: 30 });
  assert.deepEqual(planCreditGrant("silver", "month"), { credits: 10, carryCap: 0 });
  assert.deepEqual(planCreditGrant("diamond", "month"), { credits: 75, carryCap: 75 });
});

test("admin plan label shows the enrolment beside the subscription", () => {
  const base = { access_granted: false, trial_ends_at: null };
  assert.deepEqual(accountPlan({ ...base, enrolled_plan: "gold" }), { key: "expired", label: "Trial expired", detail: "enrolled in Gold, not subscribed" });
  assert.deepEqual(accountPlan({ ...base, enrolled_plan: "gold", sub_plan: "gold", sub_status: "active" }), { key: "gold", label: "Gold", detail: null });
  assert.deepEqual(accountPlan({ ...base, enrolled_plan: "gold", sub_plan: "silver", sub_status: "active" }), { key: "silver", label: "Silver", detail: "enrolled in Gold" });
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

test("signal picks: Gold gets 5 BUYs a week, Silver 3, follow-ups included, the rest after the delay", async () => {
  const db = await migrated();
  try {
    assert.deepEqual([SIGNALS_PER_WEEK.gold, SIGNALS_PER_WEEK.silver, SIGNAL_DELAY_DAYS], [5, 3, 7]);
    // Backdate signals for the test: the chain trigger stamps posted_at itself.
    await db.exec("ALTER TABLE stocks.signals DISABLE TRIGGER signals_chain");
    const add = (id: number, action: string, ticker: string, postedAt: string) =>
      db.query(
        "INSERT INTO stocks.signals(id,posted_at,action,ticker,author_discord_id,source_message_id,hash) OVERRIDING SYSTEM VALUE VALUES($1,$2,$3,$4,'123456',$5,'x')",
        [id, postedAt, action, ticker, String(100000 + id)],
      );
    const now = Date.now();
    const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();
    // An old week (Mon 31 Aug to Fri 4 Sep 2026): six BUYs and three follow-ups.
    await add(1, "BUY", "AAA", "2026-08-31T14:00:00Z"); // 1st: Gold + Silver
    await add(2, "BUY", "BBB", "2026-08-31T15:00:00Z"); // 2nd: Gold + Silver
    await add(3, "BUY", "CCC", "2026-09-01T14:00:00Z"); // 3rd: Gold + Silver
    await add(4, "BUY", "DDD", "2026-09-02T14:00:00Z"); // 4th: Gold only
    await add(5, "BUY", "EEE", "2026-09-03T14:00:00Z"); // 5th: Gold only
    await add(6, "BUY", "FFF", "2026-09-03T15:00:00Z"); // 6th: Diamond only
    await add(7, "CLOSE", "AAA", "2026-09-04T14:00:00Z"); // follows a Silver pick
    await add(8, "EXIT", "DDD", "2026-09-04T15:00:00Z"); // follows a Gold-only pick
    await add(9, "EXIT", "FFF", "2026-09-04T16:00:00Z"); // follows a non-pick
    await add(10, "BUY", "GGG", "2026-09-08T14:00:00Z"); // next week: the count starts again
    const tiers = Object.fromEntries(
      (await db.query<{ id: number; gold: boolean; silver: boolean }>("SELECT * FROM stocks.signal_live_tiers() ORDER BY id")).rows.map((r) => [Number(r.id), [r.gold, r.silver]]),
    );
    assert.deepEqual(tiers, {
      1: [true, true],
      2: [true, true],
      3: [true, true],
      4: [true, false],
      5: [true, false],
      6: [false, false],
      7: [true, true],
      8: [true, false],
      9: [false, false],
      10: [true, true],
    });

    // Recent calls: the delay decides what a non-pick member sees.
    await add(11, "BUY", "HHH", daysAgo(10));
    for (let i = 0; i < 7; i++) await add(12 + i, "BUY", `R${i}`, daysAgo(1)); // ids 12..18, a day old
    await db.exec("SET search_path TO stocks, public");
    type Access = "all" | "gold" | "silver";
    const feed = async (access: Access, delay: number | null) =>
      (await db.query<{ id: number }>(SIGNAL_FEED_SQL, signalFeedParams(access, delay, 100))).rows.map((r) => Number(r.id)).sort((a, b) => a - b);
    const hidden = async (access: Access, delay: number | null) =>
      Number((await db.query<{ n: number }>(SIGNAL_HIDDEN_SQL, signalHiddenParams(access, delay))).rows[0].n);
    const recent = [12, 13, 14, 15, 16, 17, 18];
    const picks = async (col: "gold" | "silver") =>
      (await db.query<{ id: number }>(`SELECT id FROM stocks.signal_live_tiers() WHERE ${col} AND id >= 12`)).rows.map((r) => Number(r.id));
    assert.deepEqual(await feed("all", null), [...Array(18)].map((_, i) => i + 1));
    assert.equal(await hidden("all", null), 0);
    for (const [access, col] of [["gold", "gold"], ["silver", "silver"]] as const) {
      const live = await picks(col);
      const seen = await feed(access, SIGNAL_DELAY_DAYS);
      assert.ok([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].every((id) => seen.includes(id)), `${access}: older than the delay is visible`);
      for (const id of recent) assert.equal(seen.includes(id), live.includes(id), `${access} sees #${id} only if it is a weekly pick`);
      assert.equal(await hidden(access, SIGNAL_DELAY_DAYS), recent.length - live.length);
    }
    // Seven BUYs in at most two calendar weeks: neither tier sees them all, Gold sees at least as many as Silver.
    assert.ok((await picks("gold")).length < recent.length);
    assert.ok((await picks("silver")).length <= (await picks("gold")).length);
  } finally {
    await db.close();
  }
});

test("plan enrolment: only an admin sets it, with a note and an audit row", async () => {
  const db = await migrated();
  try {
    const admin = "00000000-0000-0000-0000-000000000011";
    const member = "00000000-0000-0000-0000-000000000012";
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,'admin@example.test'),($2,'member@example.test')", [admin, member]);
    await db.query("INSERT INTO stocks.platform_admins(user_id) VALUES($1)", [admin]);
    const enrolled = async () => (await db.query<{ enrolled_plan: string | null }>("SELECT enrolled_plan FROM stocks.profiles WHERE id=$1", [member])).rows[0].enrolled_plan;
    assert.equal(await enrolled(), null);

    await db.query("SELECT stocks.admin_set_enrolled_plan($1,$2,'gold','program fee received')", [admin, member]);
    assert.equal(await enrolled(), "gold");
    await assert.rejects(db.query("SELECT stocks.admin_set_enrolled_plan($1,$2,'platinum','typo')", [admin, member]), /unknown plan/);
    await assert.rejects(db.query("SELECT stocks.admin_set_enrolled_plan($1,$2,'diamond','')", [admin, member]), /note is required/);
    await assert.rejects(db.query("SELECT stocks.admin_set_enrolled_plan($1,$2,'diamond','not an admin')", [member, member]));
    assert.equal(await enrolled(), "gold");
    await db.query("SELECT stocks.admin_set_enrolled_plan($1,$2,NULL,'refunded the program fee')", [admin, member]);
    assert.equal(await enrolled(), null);

    const audit = (await db.query<{ detail: any }>("SELECT detail FROM stocks.admin_audit WHERE action='set_enrolled_plan' ORDER BY id")).rows.map((r) => [r.detail.plan_before, r.detail.plan_after]);
    assert.deepEqual(audit, [[null, "gold"], ["gold", null]]);
    // The app role can read the column but never write it.
    assert.equal((await db.query<{ ok: boolean }>("SELECT has_column_privilege('stocks_app','stocks.profiles','enrolled_plan','UPDATE') AS ok")).rows[0].ok, false);
    for (const role of ["anon", "authenticated", "stocks_app"]) {
      assert.equal((await db.query<{ ok: boolean }>("SELECT has_function_privilege($1,'stocks.admin_set_enrolled_plan(uuid,uuid,text,text)','EXECUTE') AS ok", [role])).rows[0].ok, false);
    }
    assert.equal((await db.query<{ ok: boolean }>("SELECT has_function_privilege('stocks_admin','stocks.admin_set_enrolled_plan(uuid,uuid,text,text)','EXECUTE') AS ok")).rows[0].ok, true);
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
    await record("BUY", "AAA", "900001"); // first BUY of the week: Gold + Silver pick
    await record("BUY", "BBB", "900002");
    await record("BUY", "CCC", "900003");
    await record("BUY", "DDD", "900004"); // 4th: Gold only (unless the week rolled over)
    await record("BUY", "EEE", "900005");
    await record("BUY", "FFF", "900006"); // 6th: neither
    await record("BUY", "AAA", "900001"); // replay: nothing new
    const outbox = async (dest: string) =>
      (await db.query<{ signal_id: number }>("SELECT signal_id FROM stocks.signal_outbox WHERE destination=$1 ORDER BY signal_id", [dest])).rows.map((r) => Number(r.signal_id));
    const ids = (await db.query<{ id: number }>("SELECT id FROM stocks.signals ORDER BY id")).rows.map((r) => Number(r.id));
    const tiers = (await db.query<{ id: number; gold: boolean; silver: boolean }>("SELECT * FROM stocks.signal_live_tiers() ORDER BY id")).rows;
    assert.equal(ids.length, 6);
    assert.deepEqual(await outbox("111111"), ids);
    assert.deepEqual(await outbox("222222"), tiers.filter((t) => t.gold).map((t) => Number(t.id)));
    assert.deepEqual(await outbox("333333"), tiers.filter((t) => t.silver).map((t) => Number(t.id)));
    // The first call is always a pick for both tiers; six in a row can't all be Silver picks
    // unless the week rolled over mid-test, and never more than Gold gets.
    assert.ok((await outbox("333333")).includes(ids[0]));
    assert.ok((await outbox("333333")).length <= (await outbox("222222")).length);

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
