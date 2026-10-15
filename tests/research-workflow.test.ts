import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  contractDraft,
  EMPTY_CONTEXT,
  resolveResearch,
  scenarioJournalHref,
} from "../lib/research-workflow";
import { DEFAULT_LEAPS } from "../lib/leaps";
import { validateTrade } from "../lib/journal";
import { DEFAULT_FILTERS, filterContracts } from "../lib/leaps-discovery";
import { calendarDays, decisionAnalysis } from "../lib/journal-analysis";
import type { ChainOption } from "../lib/leaps-chain";

test("handoffs carry contract and research IDs but never modeled or quoted fill prices", () => {
  const input = {
    ...DEFAULT_LEAPS,
    ticker: "TEST",
    expiration: "2028-10-15",
    as_of: "2026-10-15",
    strike: 100,
    contracts: 2,
    premium: 12,
  };
  const url = new URL(
    scenarioJournalHref(
      input,
      { ...EMPTY_CONTEXT, studyId: 7 },
      "00000000-0000-0000-0000-000000000001",
    ),
    "https://example.test",
  );
  assert.equal(url.searchParams.get("study"), "7");
  assert.equal(
    url.searchParams.get("plan"),
    "00000000-0000-0000-0000-000000000001",
  );
  assert.equal(url.searchParams.has("premium"), false);
  const draft = contractDraft(Object.fromEntries(url.searchParams));
  assert.equal(draft.entry_price, "");
  assert.equal(draft.exit_price, "");
  assert.equal(draft.quantity, "2");
  assert.throws(
    () =>
      validateTrade(
        { ...draft, ticker: "TEST", opened_on: "2026-10-15" },
        "2026-10-15",
      ),
    /Entry price/,
  );
  assert.throws(() =>
    contractDraft({
      asset: "call",
      strike: "NaN",
      expiration: "2028-10-15",
      quantity: "1",
    }),
  );
  assert.throws(() =>
    contractDraft({
      asset: "put",
      strike: "10",
      expiration: "2028-02-30",
      quantity: "1",
    }),
  );
});

test("research handoffs resolve both IDs inside the workspace and ticker", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE SCHEMA stocks; CREATE TABLE stocks.case_studies(id int,workspace_id text,ticker text,status text,summary_line text); CREATE TABLE stocks.watchlist(id int,workspace_id text,ticker text,case_study_id int,thesis text);
 INSERT INTO stocks.case_studies VALUES (1,'a','TEST','ready','Study hypothesis'),(2,'b','TEST','ready','Private research'),(3,'a','OTHER','ready','Other ticker');
 INSERT INTO stocks.watchlist VALUES (1,'a','TEST',1,'Tracked hypothesis'),(2,'b','TEST',2,'Private thesis');`);
    const query = async (q: string, p: any[]) => (await db.query(q, p)).rows;
    const c = await resolveResearch(query, "a", "TEST", {
      studyId: 1,
      watchlistId: 1,
    });
    assert.equal(c.thesis, "Tracked hypothesis");
    await assert.rejects(
      resolveResearch(query, "a", "TEST", { studyId: 2 }),
      /workspace/,
    );
    await assert.rejects(
      resolveResearch(query, "a", "TEST", { watchlistId: 2 }),
      /thesis/,
    );
    await assert.rejects(
      resolveResearch(query, "a", "TEST", { studyId: 3 }),
      /workspace/,
    );
  } finally {
    await db.close();
  }
});

const option: ChainOption = {
  symbol: "TEST281015C00100000",
  type: "call",
  strike: 100,
  expiration: "2028-10-15",
  days: 731,
  bid: 10,
  ask: 12,
  iv: 30,
  volume: 5,
  openInterest: 100,
  delta: 0.7,
};
test("discovery excludes unknown values only for active filters and budgets by selected contract count", () => {
  const unknown = {
    ...option,
    symbol: "unknown",
    bid: null,
    ask: null,
    volume: null,
    openInterest: null,
    delta: null,
  };
  assert.equal(
    filterContracts([option, unknown], DEFAULT_FILTERS).rows.length,
    2,
  );
  for (const change of [
    { minDelta: "0" },
    { maxDelta: "1" },
    { maxSpread: "100" },
    { minVolume: "0" },
    { minOi: "0" },
    { budget: "3000" },
  ])
    assert.equal(
      filterContracts([option, unknown], { ...DEFAULT_FILTERS, ...change }).rows
        .length,
      1,
    );
  assert.equal(
    filterContracts([option], {
      ...DEFAULT_FILTERS,
      budget: "2400",
      contracts: "2",
    }).rows.length,
    1,
  );
  assert.equal(
    filterContracts([option], {
      ...DEFAULT_FILTERS,
      budget: "2399",
      contracts: "2",
    }).rows.length,
    0,
  );
  assert.equal(
    filterContracts([{ ...option, type: "put", delta: -0.7 }], {
      ...DEFAULT_FILTERS,
      minDelta: "0.6",
      maxDelta: "0.8",
    }).rows.length,
    1,
  );
  assert.ok(
    filterContracts([option], {
      ...DEFAULT_FILTERS,
      minDelta: "0.9",
      maxDelta: "0.2",
    }).error,
  );
  assert.ok(
    filterContracts([option], { ...DEFAULT_FILTERS, contracts: "1.5" }).error,
  );
});

test("decision review groups by actual close date, calendar holding days and linked study, excluding open and archived records", () => {
  const base = {
    ...validateTrade(
      {
        ticker: "TEST",
        quantity: 1,
        entry_price: 100,
        exit_price: 110,
        opened_on: "2026-01-01",
        closed_on: "2026-01-31",
        fees: 2,
        case_study_id: 1,
        review: "Followed process",
      },
      "2026-10-15",
    ),
    id: "a",
    archived_at: null,
    updated_at: "2026-10-15",
    revision: 1,
  };
  const loss = {
    ...base,
    id: "b",
    opened_on: "2025-12-31",
    exit_price: 90,
    review: "",
  };
  const a = decisionAnalysis([
    base,
    loss,
    { ...base, id: "c", closed_on: null, exit_price: null },
    { ...base, id: "d", archived_at: "2026-10-15" },
  ]);
  assert.equal(a.count, 2);
  assert.equal(a.expectancy, -2);
  assert.equal(a.averageWin, 8);
  assert.equal(a.averageLoss, -12);
  assert.equal(a.reviewed, 1);
  assert.equal(a.holding[0].count, 1);
  assert.equal(a.holding[1].count, 1);
  assert.equal(a.theses[0].pnl, -4);
  assert.equal(a.calendar.length, 1);
  assert.equal(a.calendar[0].count, 2);
  assert.equal(calendarDays("2024-02").filter(Boolean).length, 29);
  assert.equal(calendarDays("2026-02").filter(Boolean).length, 28);
  assert.deepEqual(calendarDays("invalid"), []);
  assert.equal(decisionAnalysis([]).expectancy, null);
});
