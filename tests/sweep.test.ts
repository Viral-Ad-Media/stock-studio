import test from "node:test";
import assert from "node:assert/strict";
import { RULES, validateBars, resample, confirmedSwings, trendTag, priority, detectionKey,
  inspectSweep, formatAlert, scoreAlert, scorecard } from "../lib/sweep/core.mjs";
import { parseChart, sanitizeProxyEnvironment } from "../lib/sweep/yahoo.mjs";
import { buildUniverse, SECTORS, PINNED } from "../lib/sweep/universe.mjs";
import { withLock, readJSONL, appendJSONL } from "../lib/sweep/storage.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const start = Date.parse("2026-10-16T13:30:00Z") / 1000;
const session = { start, end: start + 390 * 60 };
const b = (i: number, o = 101, h = 101.1, l = 100.9, c = 101) => ({ t: start + i * 60, o, h, l, c });
const tape = [b(0), b(1, 101, 101, 99.9, 99.95), b(2, 99.95, 100.3, 99.92, 100.2)];
// Explicit test hypothesis, NOT a production or approved strategy setting.
const semantics = { velocityOrigin: "open", reclaimCandle: "following", extreme: "first-breach", consume: "first-breach", lookback: "extreme" };
const input = (bars = tape) => ({ ticker: "DEMO", bars, session, asOf: bars.at(-1)!.t + 60,
  level: { price: 100, name: "prior low", knownAt: start }, direction: "CALL", semantics });

test("fixed numerical rules are preserved", () => {
  assert.equal(RULES.moveFraction, .004);
  assert.equal(RULES.penetrationFraction, .0005);
  assert.equal(RULES.velocityBars, 5);
  assert.equal(RULES.reclaimBars, 5);
});
test("bad OHLC, duplicate, missing and non-monotonic bars fail closed", () => {
  assert.throws(() => validateBars([b(0, 101, 99, 100, 101)]), /INVALID_BAR/);
  assert.throws(() => validateBars([b(0), b(0)]), /NON_MONOTONIC/);
  assert.throws(() => validateBars([b(1), b(0)]), /NON_MONOTONIC/);
  assert.throws(() => validateBars([b(0), b(2)], 60, true), /MISSING_BAR/);
  assert.throws(() => validateBars([b(0, NaN)]), /INVALID_BAR/);
});
test("resampling excludes incomplete groups and missing candles", () => {
  const bars = Array.from({ length: 15 }, (_, i) => b(i));
  assert.equal(resample(bars, 5, session, start + 14 * 60).length, 2);
  assert.equal(resample(bars, 15, session, start + 14 * 60).length, 0);
  assert.equal(resample(bars, 15, session, start + 15 * 60).length, 1);
  assert.equal(resample(bars.filter((_, i) => i !== 2), 5, session, start + 15 * 60).length, 2);
});
test("pivot confirmation waits for both right bars to CLOSE", () => {
  const bars = [101, 102, 105, 103, 102].map((h, i) => ({ t: start + i * 900, o: 100, h, l: 99, c: 100 }));
  assert.equal(confirmedSwings(bars, start + 4 * 900, "strict").length, 0);
  assert.equal(confirmedSwings(bars, start + 5 * 900, "strict")[0].knownAt, start + 5 * 900);
  assert.throws(() => confirmedSwings(bars, start + 5 * 900, null), /POLICY_REQUIRED/);
});
test("unknown trend is never promoted to A+", () => {
  assert.equal(trendTag([], start), "Unknown");
  assert.equal(priority("CALL", "Unknown"), null);
  assert.equal(priority("CALL", "Uptrend"), "A+");
  assert.equal(priority("PUT", "Uptrend"), "B");
  assert.equal(priority("PUT", "Range"), "A+");
});
test("replay candidate preserves trigger, level and raw evidence without becoming an alert", () => {
  const r = inspectSweep(input());
  assert.equal(r.status, "CANDIDATE_ONLY");
  assert.equal(r.entry, 100.2);
  assert.equal(r.triggerAt, start + 180);
  assert.deepEqual(r.auditBars, tape);
  assert.throws(() => inspectSweep({ ...input(), semantics: null }), /EXPLICIT/);
  assert.throws(() => formatAlert(r), /INCOMPLETE_ALERT/);
});
test("PUT is the arithmetic mirror", () => {
  const mirrored = tape.map(bar => ({ t: bar.t, o: 200 - bar.o, h: 200 - bar.l, l: 200 - bar.h, c: 200 - bar.c }));
  const r = inspectSweep({ ...input(mirrored), direction: "PUT" });
  assert.equal(r.status, "CANDIDATE_ONLY");
  assert.ok(Math.abs(r.entry - 99.8) < 1e-9);
});
test("opening gaps and repeated alerts cannot qualify", () => {
  const gap = [b(0, 99.9, 100.1, 99, 99.8), b(1, 99.8, 100.3, 99.8, 100.2)];
  assert.equal(inspectSweep(input(gap)).reason, "GAP_THROUGH");
  assert.equal(inspectSweep({ ...input(), alreadyAlerted: true }).reason, "ALREADY_ALERTED");
  assert.equal(detectionKey("2026-10-16", "meta", 100, "CALL"), detectionKey("2026-10-16", "META", 100.00, "CALL"));
});
test("breakdown with no reclaim, shallow wick and slow move are rejected", () => {
  assert.equal(inspectSweep(input(tape.slice(0, 2))).reason, "NO_RECLAIM_WITHIN_5");
  assert.equal(inspectSweep(input([b(0), b(1, 101, 101, 99.99, 100.1)])).reason, "NO_PENETRATION");
  assert.equal(inspectSweep(input([b(0, 100.1, 100.1, 100, 100.05), b(1, 100.05, 100.1, 99.94, 100.01)])).reason, "VELOCITY");
});
test("late reclaim, unknown level and stale event are rejected", () => {
  const late = [tape[0], tape[1], ...Array.from({ length: 5 }, (_, i) => b(i + 2, 99.95, 100, 99.92, 99.99)), b(7, 99.99, 100.3, 99.99, 100.2)];
  assert.equal(inspectSweep(input(late)).reason, "NO_RECLAIM_WITHIN_5");
  assert.equal(inspectSweep({ ...input(), level: { price: 100, name: "future", knownAt: start + 999 } }).reason, "NO_PENETRATION");
  assert.equal(inspectSweep({ ...input(), asOf: start + 1500 }).reason, "OUTSIDE_20_MINUTES");
});
test("a deeper extreme does not silently reset the clock", () => {
  const bars = [tape[0], tape[1], b(2, 99.95, 100.3, 99.8, 100.2)];
  assert.equal(inspectSweep(input(bars)).reason, "EXTREME_RESET_UNDEFINED");
});
test("scoring ignores pre-trigger touches and uses closes for invalidation", () => {
  const a = { direction: "CALL", entry: 100.2, extreme: 99.9, t1: 101, triggerAt: start + 60 };
  assert.equal(scoreAlert(a, [b(0), b(1, 100.2, 100.5, 99.8, 100.1)], session, start + 120).verdict, "PENDING");
  assert.equal(scoreAlert(a, [b(1, 100.2, 100.5, 99.8, 99.85)], session, start + 120).verdict, "MISS");
  assert.equal(scoreAlert(a, [b(1, 100.2, 101.1, 100, 100.8)], session, start + 120).verdict, "HIT");
});
test("scoring never treats missing data or same-bar ties as OPEN", () => {
  const a = { direction: "CALL", entry: 100.2, extreme: 99.9, t1: 101, triggerAt: start + 60 };
  assert.equal(scoreAlert(a, [b(2)], session, session.end).verdict, "UNRESOLVED");
  assert.equal(scoreAlert(a, [b(1, 100.2, 101.1, 99.8, 99.85)], session, session.end).reason, "SAME_BAR_TIE");
  const short = { start, end: start + 120 };
  assert.equal(scoreAlert(a, [b(1, 100.2, 100.5, 100, 100.1)], short, short.end).verdict, "OPEN");
});
test("zero scorecard is explicit and formatter has one line", () => {
  assert.equal(scorecard("2026-10-16", []), "Scanner scorecard 2026-10-16: 0 alerts · 0 hit t1 · 0 invalidated · 0 open");
  const alert = { ticker: "DEMO", direction: "CALL", grade: "A+", trend: "Uptrend", levelName: "prior low", level: 100, extreme: 99.9, entry: 100.2, t1: 101, t2: 102 };
  assert.equal(formatAlert(alert), "🚨 SWEEP [A+] DEMO CALL — swept 100.00 (prior low), extreme 99.90, 1m reclaim close 100.20 → entry ~100.20 · t1 (OB) 101.00 · t2 102.00 · 15m trend: Uptrend");
});
test("Yahoo parser rejects bad prices and removes unfinished candles", () => {
  const chart = (close: unknown[]) => ({ chart: { result: [{ meta: { symbol: "DEMO", exchangeTimezoneName: "America/New_York", currentTradingPeriod: { regular: session } },
    timestamp: [start, start + 60], indicators: { quote: [{ open: [101, 101], high: [102, 102], low: [100, 100], close }] } }] } });
  assert.equal(parseChart(chart([101, null]), "1m", start + 60).bars.length, 1);
  assert.throws(() => parseChart(chart([101, null]), "1m", start + 120), /INVALID_BAR/);
  const env = { HTTP_PROXY: "bad", https_proxy: "bad", NO_PROXY: "*", DATABASE_URL: "keep" };
  sanitizeProxyEnvironment(env);
  assert.deepEqual(env, { DATABASE_URL: "keep" });
});
test("universe ranks every sector, pins Mag 7 and rejects mismatched windows", () => {
  const sessions = Array.from({ length: 30 }, (_, i) => ({ date: new Date(Date.UTC(2026, 8, i + 1)).toISOString().slice(0, 10), close: 10, volume: 100 }));
  const rows = SECTORS.flatMap((sector, s) => Array.from({ length: 11 }, (_, n) => ({
    ticker: "S" + s + "N" + n, sector, sessions: sessions.map(b => ({ ...b, volume: 100 + n })),
  })));
  for (const ticker of PINNED) rows.push({ ticker, sector: "Information Technology", sessions });
  const source = { asOf: "2026-10-16", provenance: "Synthetic fixture only", rows };
  const u = buildUniverse(source);
  assert.ok(PINNED.every(t => u.tickers.includes(t)));
  assert.ok(!u.tickers.includes("S0N0"));
  assert.ok(u.tickers.includes("S0N10"));
  assert.throws(() => buildUniverse({ ...source, rows: rows.slice(0, 10) }), /MISSING_PIN/);
  rows[0].sessions = sessions.map((b, i) => i ? b : { ...b, date: "2026-08-31" });
  assert.throws(() => buildUniverse(source), /MISMATCH/);
});
test("overlapping passes exit and audit JSONL survives a new reader", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sweep-test-"));
  try {
    const result = await withLock(dir, async () => {
      assert.deepEqual(await withLock(dir, async () => assert.fail("overlap ran")), { status: "SKIPPED_OVERLAP" });
      await appendJSONL(join(dir, "audit.jsonl"), { id: "one", bars: tape });
      return "done";
    });
    assert.equal(result, "done");
    assert.deepEqual(await readJSONL(join(dir, "audit.jsonl")), [{ id: "one", bars: tape }]);
    assert.equal(await withLock(dir, async () => "again"), "again");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
