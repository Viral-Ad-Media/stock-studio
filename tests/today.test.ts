import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { TODAY_RESEARCH_SQL, TODAY_THESIS_SQL, TODAY_EARNINGS_SQL, TODAY_SETUP_SQL, canReadSignals } from "../lib/today";
import { dataAge, sourceTimestamp, timestampET } from "../lib/data-freshness";
import { parseCboeChain, getGexSnapshot } from "../lib/gex";
import { getMarketContext, SECTORS, BREADTH_UNIVERSE } from "../lib/market-context";

test("freshness never substitutes retrieval time for missing source time", () => {
  const now = Date.parse("2026-10-13T14:00:00Z");
  assert.equal(sourceTimestamp("2026-10-13 09:45:00"), null);
  assert.equal(sourceTimestamp("2026-10-13T09:45:00"), null);
  assert.equal(sourceTimestamp("bad"), null);
  assert.equal(sourceTimestamp(123), null);
  assert.equal(sourceTimestamp("2026-10-13T09:45:00-04:00"), "2026-10-13T13:45:00.000Z");
  assert.equal(dataAge(null, now), "Source time unavailable");
  assert.equal(dataAge("bad", now), "Source time unavailable");
  assert.equal(dataAge("2026-10-13T13:45:00Z", now), "15 minutes old");
  assert.equal(dataAge("2026-10-13T15:00:00Z", now), "Source time is in the future");
  assert.match(timestampET("2026-01-15T14:30:00Z"), /9:30 AM ET/);
  assert.match(timestampET("2026-07-15T13:30:00Z"), /9:30 AM ET/);
});

test("CBOE source timestamps survive snapshot caching; unknown timezone stays unknown", async (t) => {
  const timestamp = "2026-10-13T13:45:00Z";
  const fixture = (time?: string) => ({ timestamp: time, data: { current_price: 100,
    options: [{ option: "TEST261218C00105000", open_interest: 10, iv: 0.3, gamma: 0.01 }] } });
  const now = Date.parse("2026-10-13T14:00:00Z");
  assert.equal(parseCboeChain("TEST", fixture(timestamp), now)?.sourceAt, "2026-10-13T13:45:00.000Z");
  assert.equal(parseCboeChain("TEST", fixture("2026-10-13 09:45:00"), now)?.sourceAt, null);
  assert.equal(parseCboeChain("TEST", fixture(), now)?.sourceAt, null);
  let calls = 0;
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json(fixture(timestamp)); });
  const first = await getGexSnapshot("TEST");
  assert.equal(first?.sourceAt, "2026-10-13T13:45:00.000Z");
  assert.equal(first?.fetchedAt != null, true);
  const cached = await getGexSnapshot("TEST");
  assert.equal(cached, first);
  assert.equal(calls, 1);
});

test("signals need a plan that includes them; a trial never does", () => {
  assert.equal(canReadSignals("none"), false);
  assert.equal(canReadSignals("monthly"), true);
  assert.equal(canReadSignals("weekly"), true);
  assert.equal(canReadSignals("all"), true);
});

test("simultaneous overview requests share one market fetch batch", async (t) => {
  let calls = 0;
  const ts = Array.from({ length: 252 }, (_, i) => 1760000000 + i * 86400);
  const prices = ts.map((_, i) => 100 + i);
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({ chart: { result: [{ timestamp: ts, indicators: {
      quote: [{ open: prices, high: prices, low: prices, close: prices, volume: prices }],
    } }] } });
  });
  const [a, b] = await Promise.all([getMarketContext(), getMarketContext()]);
  assert.equal(a, b);
  assert.equal(a.sectors.length, SECTORS.length);
  assert.equal(calls, 1 + SECTORS.length + BREADTH_UNIVERSE.length);
  assert.equal(await getMarketContext(), a);
  assert.equal(calls, 1 + SECTORS.length + BREADTH_UNIVERSE.length);
});

test("Today queries execute on the replayed schema and isolate workspaces", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE auth.users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),email text,raw_user_meta_data jsonb,raw_app_meta_data jsonb,created_at timestamptz DEFAULT now(),last_sign_in_at timestamptz);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT null::uuid $$;`);
    for (const name of (await readdir("supabase/migrations")).filter((n) => n.endsWith(".sql")).sort()) {
      await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
    }
    await db.exec("SET search_path TO stocks, public");
    const users = ["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"];
    for (const user of users) await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [user, `${user}@example.test`]);
    const workspaces = (await db.query<{ active_workspace_id: string }>("SELECT active_workspace_id FROM profiles ORDER BY id")).rows;
    const a = workspaces[0].active_workspace_id, b = workspaces[1].active_workspace_id;
    for (const [ws, ticker] of [[a, "AAPL"], [b, "PRIVATE"]]) {
      await db.query("INSERT INTO case_studies(workspace_id,ticker,variant,status) VALUES($1,$2,'full','ready')", [ws, ticker]);
      await db.query("INSERT INTO watchlist(workspace_id,ticker,thesis_status) VALUES($1,$2,'broken')", [ws, ticker]);
    }
    // Latest by update time, not highest id; queued studies are not ready research.
    await db.query("UPDATE case_studies SET updated_at='2026-10-12T12:00:00Z' WHERE workspace_id=$1", [a]);
    await db.query("INSERT INTO case_studies(workspace_id,ticker,variant,status,updated_at) VALUES($1,'AAPL','full','ready','2026-10-11T12:00:00Z')", [a]);
    await db.query("INSERT INTO case_studies(workspace_id,ticker,variant,status) VALUES($1,'MSFT','full','queued')", [a]);
    await db.query("INSERT INTO case_studies(workspace_id,ticker,variant,status) VALUES($1,'AAPL VS MSFT','comparison','ready'),($1,'MARKET','movers_digest','ready')", [a]);
    const research = (await db.query<{ticker:string}>(TODAY_RESEARCH_SQL, [a])).rows;
    assert.equal(research.some((r) => r.ticker === "PRIVATE" || r.ticker === "MSFT"), false);
    assert.deepEqual((await db.query<{ticker:string}>(TODAY_THESIS_SQL, [a])).rows.map((r) => r.ticker), ["AAPL"]);
    const earnings = (await db.query<{ticker:string;study_id:number}>(TODAY_EARNINGS_SQL, [a])).rows;
    assert.deepEqual(earnings.map((r) => r.ticker), ["AAPL"]);
    assert.equal(Number(earnings[0].study_id), 1);
    assert.equal((await db.query(TODAY_RESEARCH_SQL, ["00000000-0000-0000-0000-000000000099"])).rows.length, 0);
    assert.equal((await db.query(TODAY_SETUP_SQL)).rows.length, 0);
    await db.exec("INSERT INTO setup_scans(session_date,status,universe_size) VALUES('2026-10-12','done',100),('2026-10-13','running',100)");
    assert.equal((await db.query<{session_date:string}>(TODAY_SETUP_SQL)).rows[0].session_date, "2026-10-12");
  } finally { await db.close(); }
});
