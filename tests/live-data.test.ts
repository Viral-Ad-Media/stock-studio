import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSnapshot, asOfDay, rangeFor, anyStale, isLiveTicker, LIVE_STALE_MS } from "../lib/live-data";
import { parseSnapshot } from "../lib/shared";
import type { DailyBars } from "../lib/marketdata";

function bars(dates: string[], closes: number[], extra: Partial<DailyBars> = {}): DailyBars {
  return {
    symbol: "TEST", dates, opens: closes, highs: closes.map((c) => c + 1), lows: closes.map((c) => c - 1),
    closes, adjCloses: closes, volumes: closes.map(() => 100), ...extra,
  };
}

test("snapshot: price, day move, 52-week range and move since the as-of date vs SPY", () => {
  const t = bars(["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"], [100, 110, 120, 126], { marketTime: "2026-10-23T20:00:00.000Z", source: "alpaca" });
  const spy = bars(["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"], [500, 505, 510, 525]);
  const s = buildSnapshot(t, spy, "2026-10-21");
  assert.equal(s.price, 126);
  assert.equal(s.prevClose, 120);
  assert.equal(s.dayChangePct, 5);
  assert.equal(s.high52w, 127);
  assert.equal(s.low52w, 99);
  assert.equal(s.source, "alpaca");
  assert.equal(s.marketTime, "2026-10-23T20:00:00.000Z");
  assert.deepEqual(s.since, { from: "2026-10-21", startClose: 110, changePct: 14.55, spyChangePct: 3.96 });
});

test("snapshot: weekend as-of date starts at the next session; same-day or missing gives no since", () => {
  const t = bars(["2026-10-23", "2026-10-26", "2026-10-27"], [10, 11, 12]);
  assert.equal(buildSnapshot(t, null, "2026-10-24").since?.from, "2026-10-26");
  assert.equal(buildSnapshot(t, null, "2026-10-24").since?.spyChangePct, null);
  assert.equal(buildSnapshot(t, null, "2026-10-27").since, null);
  assert.equal(buildSnapshot(t, null, "2026-11-01").since, null);
  assert.equal(buildSnapshot(t, null, null).since, null);
  assert.equal(buildSnapshot(bars(["2026-10-27"], [12]), null, null).dayChangePct, null);
});

test("as-of dates, ranges, tickers and staleness", () => {
  assert.equal(asOfDay("July 23, 2026"), "2026-07-23");
  assert.equal(asOfDay("2026-07-23"), "2026-07-23");
  assert.equal(asOfDay("not a date"), null);
  assert.equal(asOfDay(null), null);
  const now = Date.parse("2026-10-26T12:00:00Z");
  assert.equal(rangeFor(null, now), "1y");
  assert.equal(rangeFor("2026-01-02", now), "1y");
  assert.equal(rangeFor("2025-06-01", now), "2y");
  assert.equal(rangeFor("2023-06-01", now), "5y");
  assert.ok(isLiveTicker("BRK.B"));
  assert.ok(!isLiveTicker("MARKET"));
  assert.ok(!isLiveTicker("AAPL vs MSFT"));
  assert.ok(anyStale([{ live_refreshed_at: null }], now));
  assert.ok(anyStale([{ live_refreshed_at: new Date(now - LIVE_STALE_MS - 1) }], now));
  assert.ok(!anyStale([{ live_refreshed_at: new Date(now - 60_000).toISOString() }], now));
  assert.equal(parseSnapshot(null), null);
  assert.equal(parseSnapshot({ price: "1" }), null);
  assert.ok(parseSnapshot({ price: 1, priceDate: "2026-10-26" }));
});
