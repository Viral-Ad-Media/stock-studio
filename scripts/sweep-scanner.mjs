import "dotenv/config";
import { mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { BLOCKERS, RULES, inspectSweep, resample, scoreAlert, scorecard, validateBars } from "../lib/sweep/core.mjs";
import { exchangeDate, fetchChart, fetchDailyContext, sanitizeProxyEnvironment } from "../lib/sweep/yahoo.mjs";
import { atomicJSON, readJSON, appendJSONL, readJSONL, withLock } from "../lib/sweep/storage.mjs";

const dataDir = resolve(process.env.SWEEP_DATA_DIR ?? ".sweep-data");
const mode = process.argv[2] ?? "--help";
const now = () => Math.floor(Date.now() / 1000);
const manifest = await readJSON(new URL("../config/sweep/acceptance-cases.json", import.meta.url));

async function capture() {
  sanitizeProxyEnvironment(process.env);
  const startedAt = now(), date = exchangeDate(startedAt);
  const universe = await readJSON(process.env.SWEEP_UNIVERSE_PATH ??
    new URL("../config/sweep/scan_universe.json", import.meta.url));
  if (universe.status !== "READY" || !Array.isArray(universe.tickers) || !universe.tickers.length) {
    throw new Error("UNIVERSE_NOT_READY: run sweep-universe with a verified GICS/dollar-volume source");
  }
  if (universe.tickers.length !== new Set(universe.tickers).size ||
      universe.tickers.some(t => typeof t !== "string" || !/^[A-Z][A-Z0-9.-]{0,14}$/.test(t))) {
    throw new Error("INVALID_UNIVERSE");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(universe.asOf) || universe.asOf > date ||
      date.slice(0, 4) !== universe.asOf.slice(0, 4) ||
      Math.floor((Number(date.slice(5, 7)) - 1) / 3) !== Math.floor((Number(universe.asOf.slice(5, 7)) - 1) / 3)) {
    throw new Error("UNIVERSE_REBUILD_REQUIRED");
  }
  await mkdir(join(dataDir, date), { recursive: true });
  const results = [];
  for (const ticker of universe.tickers) {
    // Bound a pass; remaining tickers are visibly unscanned, never silently clean.
    if (now() - startedAt >= 240) {
      results.push({ ticker, status: "NOT_SCANNED", reason: "PASS_BUDGET" });
      continue;
    }
    try {
      const cachePath = join(dataDir, date, ticker + "-context.json");
      let context;
      try { context = await readJSON(cachePath); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      if (!context || context.date !== date || context.ticker !== ticker) {
        context = await fetchDailyContext(ticker, now());
        await atomicJSON(cachePath, context);
      }
      const asOf = now();
      const chart = await fetchChart(ticker, "1m", "1d", asOf);
      const session = chart.windows.find(w => exchangeDate(w.start) === date);
      if (!session) throw new Error("NO_CURRENT_SESSION");
      const bars = chart.bars.filter(b => b.t >= session.start && b.t + 60 <= session.end);
      validateBars(bars, 60, true);
      if (bars[0].t !== session.start) throw new Error("MISSING_SESSION_OPEN");
      const expectedEnd = Math.min(Math.floor(asOf / 60) * 60, session.end);
      if (expectedEnd - (bars[bars.length - 1].t + 60) > 60) throw new Error("STALE_TAPE");
      const snapshot = {
        schemaVersion: 1, strategyVersion: RULES.version, ticker, date, asOf, session,
        universeAsOf: universe.asOf, source: "Yahoo Finance", bars, context,
        bars5m: resample(bars, 5, session, asOf), bars15m: resample(bars, 15, session, asOf),
      };
      await atomicJSON(join(dataDir, date, ticker + "-tape.json"), snapshot);
      results.push({ ticker, status: "CAPTURED", lastBar: bars[bars.length - 1].t });
    } catch (error) {
      results.push({ ticker, status: "FETCH_FAILED", reason: error.message });
    }
  }
  const report = {
    mode: "CAPTURE_ONLY", status: "BLOCKED_METHOD", startedAt, finishedAt: now(), date,
    blockers: BLOCKERS, results, alertsEnabled: false,
  };
  await atomicJSON(join(dataDir, "latest-pass.json"), report);
  await appendJSONL(join(dataDir, "passes.jsonl"), report);
  return report;
}
async function replay(directory) {
  if (!directory) throw new Error("Usage: --replay <fixture-directory>");
  const results = [];
  for (const item of manifest) {
    try {
      const fixture = await readJSON(join(resolve(directory), item.id + ".json"));
      if (fixture.ticker !== item.ticker || exchangeDate(fixture.session.start) !== item.date ||
          fixture.direction !== item.direction) throw new Error("FIXTURE_IDENTITY_MISMATCH");
      const result = inspectSweep(fixture);
      // No historical case can PASS until the complete approved detector exists.
      results.push({ ...item, verification: "BLOCKED_METHOD", diagnostic: result,
        reason: "Replay hypothesis only; target/trend/level definitions are not approved" });
    } catch (error) {
      results.push({ ...item, verification: error.code === "ENOENT" ? "MISSING_TAPE" : "INVALID_TAPE",
        reason: error.message });
    }
  }
  const report = { status: "NOT_READY_FOR_GO_LIVE", strategyVersion: RULES.version, results };
  await atomicJSON(join(dataDir, "acceptance-report.json"), report);
  process.exitCode = 2;
  return report;
}
async function score(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("INVALID_DATE");
  const alerts = (await readJSONL(join(dataDir, "shadow_audit.jsonl"))).filter(a => a.date === date);
  const results = [];
  const keys = new Set();
  for (const alert of alerts) {
    if (typeof alert.id !== "string" || !alert.id || keys.has(alert.id)) throw new Error("INVALID_OR_DUPLICATE_AUDIT_ID");
    keys.add(alert.id);
    if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(alert.ticker)) throw new Error("INVALID_AUDIT_TICKER");
    let verdict;
    try {
      const snapshot = await readJSON(join(dataDir, date, alert.ticker + "-tape.json"));
      if (snapshot.date !== date || snapshot.ticker !== alert.ticker) throw new Error("TAPE_IDENTITY_MISMATCH");
      verdict = scoreAlert(alert, snapshot.bars, snapshot.session, now());
    } catch (error) {
      verdict = { verdict: "UNRESOLVED", reason: error.message };
    }
    results.push({ id: alert.id, ticker: alert.ticker, direction: alert.direction, ...verdict });
  }
  // A zero-alert report during capture-only mode is never presented as a valid shadow day.
  const report = {
    date, mode: "CAPTURE_ONLY", status: "BLOCKED_METHOD", results,
    message: scorecard(date, results), measurementNotice: "Live detection is not enabled; these counts do not establish a completed shadow session.",
  };
  await atomicJSON(join(dataDir, date + "-scorecard.json"), report);
  return report;
}
try {
  if (mode === "--help") {
    console.log("Sweep foundation: --capture | --replay <fixtures> | --score [YYYY-MM-DD]\nCapture only; live alerts and schedules remain disabled until method approval and acceptance replay.");
  } else {
    const result = await withLock(dataDir, async () => {
      if (mode === "--capture") return capture();
      if (mode === "--replay") return replay(process.argv[3]);
      if (mode === "--score") return score(process.argv[3] ?? exchangeDate(now()));
      throw new Error("UNKNOWN_MODE");
    });
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error("SWEEP_FAILED: " + error.message);
  process.exitCode = 1;
}
