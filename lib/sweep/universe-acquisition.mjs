import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { buildUniverse, PINNED, SECTORS } from "./universe.mjs";
import { previousSessions, validDate } from "./calendar.mjs";
import { fetchChart, exchangeDate } from "./yahoo.mjs";
import { readJSON, atomicJSON } from "./storage.mjs";
import { validateBars } from "./core.mjs";

export function validateCatalog(catalog) {
  if (!catalog || catalog.scope !== "US_EQUITIES" || catalog.classification !== "GICS" ||
      catalog.complete !== true || typeof catalog.provenance !== "string" || !catalog.provenance.trim() ||
      !validDate(catalog.asOf) || !Array.isArray(catalog.rows)) throw new Error("COMPLETE_GICS_CATALOG_REQUIRED");
  const seen = new Set();
  for (const row of catalog.rows) {
    if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(row.ticker) || !SECTORS.includes(row.sector) || seen.has(row.ticker)) throw new Error("INVALID_CATALOG_ROW");
    seen.add(row.ticker);
  }
  for (const ticker of PINNED) if (!seen.has(ticker)) throw new Error("MISSING_PIN:" + ticker);
  for (const sector of SECTORS) if (catalog.rows.filter(r => r.sector === sector).length < 10) throw new Error("INSUFFICIENT_SECTOR:" + sector);
  return catalog;
}
export function rankingSessions(chart, sessions) {
  validateBars(chart.bars);
  return sessions.map(s => {
    const matches = chart.bars.filter(b => exchangeDate(b.t) === s.date);
    if (matches.length !== 1 || !Number.isFinite(matches[0].v) || matches[0].v < 0) throw new Error("MISSING_DAILY_OHLCV:" + s.date);
    return { date: s.date, close: matches[0].c, volume: matches[0].v };
  });
}
export async function acquireUniverse(catalog, directory, asOf, fetcher = fetchChart) {
  validateCatalog(catalog);
  if (!validDate(asOf) || catalog.asOf > asOf) throw new Error("INVALID_CATALOG_DATE");
  const age = (Date.parse(asOf) - Date.parse(catalog.asOf)) / 86400000;
  if (age > 92) throw new Error("STALE_GICS_CATALOG");
  const sessions = previousSessions(asOf, 30);
  const period = { period1: sessions[0].start, period2: sessions.at(-1).end + 60 };
  const cache = join(directory, asOf);
  await mkdir(cache, { recursive: true });
  const rows = [], failures = [];
  for (const row of catalog.rows) {
    try {
      const path = join(cache, row.ticker + "-ranking.json");
      let chart;
      try { chart = await readJSON(path); } catch (error) { if (error.code !== "ENOENT") throw error; }
      if (!chart) {
        chart = await fetcher(row.ticker, "1d", period);
        rankingSessions(chart, sessions);
        await atomicJSON(path, chart);
      }
      if (chart.symbol !== row.ticker) throw new Error("RANKING_SYMBOL_MISMATCH");
      rows.push({ ...row, sessions: rankingSessions(chart, sessions) });
    } catch (error) { failures.push({ ticker: row.ticker, reason: error.message }); }
  }
  // Dropping failed candidates would bias the top-ten ranking. Never publish
  // a READY universe from a partial source download.
  const report = { asOf, status: failures.length ? "INCOMPLETE" : "COMPLETE", requested: catalog.rows.length, captured: rows.length, failures };
  await atomicJSON(join(directory, "universe-acquisition.json"), report);
  if (failures.length) return { report, universe: null };
  const universe = buildUniverse({ asOf, provenance: catalog.provenance + "; Yahoo daily OHLCV", rows });
  await atomicJSON(join(directory, "scan_universe.json"), universe);
  return { report, universe };
}
