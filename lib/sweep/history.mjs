import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { validateBars } from "./core.mjs";
import { sessionFor, previousSessions } from "./calendar.mjs";
import { fetchChart, fetchDailyContext } from "./yahoo.mjs";
import { atomicJSON } from "./storage.mjs";

export function tapeHash(tape) {
  return createHash("sha256").update(JSON.stringify({ ticker: tape.ticker, date: tape.date,
    session: tape.session, bars: tape.bars, context: tape.context })).digest("hex");
}
export function validateHistoricalTape(tape, item) {
  if (!tape || tape.ticker !== item.ticker || tape.date !== item.date || tape.direction !== item.direction) throw new Error("FIXTURE_IDENTITY_MISMATCH");
  const session = sessionFor(item.date);
  if (!session || tape.session?.start !== session.start || tape.session?.end !== session.end) throw new Error("FIXTURE_SESSION_MISMATCH");
  validateBars(tape.bars, 60, true);
  if (tape.bars[0].t !== session.start || tape.bars.at(-1).t + 60 !== session.end) throw new Error("INCOMPLETE_HISTORICAL_TAPE");
  if (!tape.context || tape.context.date !== item.date || tape.context.ticker !== item.ticker) throw new Error("MISSING_HISTORICAL_CONTEXT");
  const expected = previousSessions(item.date, 5);
  if (!Array.isArray(tape.context.sessions) || tape.context.sessions.length !== 5 ||
      tape.context.sessions.some((s, i) => s.start !== expected[i].start || s.end !== expected[i].end)) throw new Error("HISTORICAL_CONTEXT_SESSION_MISMATCH");
  validateBars(tape.context.bars15m, 900);
  for (const priorSession of expected) {
    const bars = tape.context.bars15m.filter(b => b.t >= priorSession.start && b.t < priorSession.end);
    validateBars(bars, 900, true);
    if (bars[0].t !== priorSession.start || bars.at(-1).t + 900 !== priorSession.end) throw new Error("INCOMPLETE_HISTORICAL_CONTEXT");
  }
  validateBars([tape.context.prior]);
  if (tape.context.prior.t !== expected.at(-1).start) throw new Error("PRIOR_DAILY_SESSION_MISMATCH");
  if (tape.source !== "Yahoo Finance" || tape.sha256 !== tapeHash(tape)) throw new Error("FIXTURE_HASH_MISMATCH");
  return tape;
}
export function historicalEvidence(tape, item) {
  validateHistoricalTape(tape, item);
  const extremeKey = item.direction === "CALL" ? "l" : "h";
  const expectedObserved = item.extreme == null ? null : tape.bars.some(b => Math.abs(b[extremeKey] - item.extreme) <= 0.011);
  return {
    barCount: tape.bars.length, open: tape.bars[0].o,
    sessionLow: Math.min(...tape.bars.map(b => b.l)), sessionHigh: Math.max(...tape.bars.map(b => b.h)),
    priorLow: tape.context.prior.l, priorHigh: tape.context.prior.h,
    priorSessionDate: tape.context.sessions.at(-1).date,
    briefExtreme: item.extreme ?? null, briefExtremeObserved: expectedObserved,
    briefLevel: item.level ?? null,
    openingGapThroughPriorLow: tape.bars[0].o < tape.context.prior.l,
    openingGapThroughBriefLevel: item.level == null ? null : item.direction === "CALL" ? tape.bars[0].o < item.level : tape.bars[0].o > item.level,
    note: expectedObserved === false ? "Stated extreme not found in the downloaded minute-bar lows/highs within $0.011; investigate source/price-scale mismatch. Do not alter the brief or tape." : "Price evidence only; not a detector acceptance result.",
    sha256: tape.sha256,
  };
}
export async function acquireHistory(manifest, directory, asOf = Math.floor(Date.now() / 1000)) {
  await mkdir(directory, { recursive: true });
  const results = [];
  for (const item of manifest) {
    const file = join(directory, item.id + ".json");
    try {
      let tape;
      try { tape = JSON.parse(await readFile(file, "utf8")); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      if (!tape) {
        const session = sessionFor(item.date);
        if (!session || session.end > asOf) throw new Error("HISTORICAL_SESSION_NOT_COMPLETE");
        const context = await fetchDailyContext(item.ticker, session.start);
        const chart = await fetchChart(item.ticker, "1m", { period1: session.start, period2: session.end }, asOf);
        tape = {
          schemaVersion: 1, ticker: item.ticker, date: item.date, direction: item.direction,
          source: "Yahoo Finance", retrievedAt: new Date(asOf * 1000).toISOString(),
          session, bars: chart.bars.filter(b => b.t >= session.start && b.t + 60 <= session.end), context,
        };
        tape.sha256 = tapeHash(tape);
        validateHistoricalTape(tape, item);
        await atomicJSON(file, tape);
      }
      results.push({ id: item.id, status: "CAPTURED", evidence: historicalEvidence(tape, item) });
    } catch (error) {
      results.push({ id: item.id, status: "UNAVAILABLE", reason: error.message });
    }
  }
  const report = { generatedAt: new Date(asOf * 1000).toISOString(), status: "EVIDENCE_ONLY", results };
  await atomicJSON(join(directory, "acquisition-report.json"), report);
  return report;
}
