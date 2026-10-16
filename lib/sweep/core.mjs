/**
 * Sweep Scanner primitives. No model calls, network, wall clock or I/O.
 * Times are UTC epoch seconds at BAR OPEN. Prices are unrounded.
 * A candidate is NOT an alert; target/method approval is deliberately separate.
 */
export const RULES = Object.freeze({
  version: "luqman-2026-10-16",
  moveFraction: 0.004,
  penetrationFraction: 0.0005,
  velocityBars: 5,
  reclaimBars: 5,
  lookbackSeconds: 1200,
  breakdownSeconds: 1800,
});
export const BLOCKERS = Object.freeze([
  "Exact velocity endpoints and 20-minute window anchor",
  "Same-candle reclaim and extreme-reset semantics",
  "Whether an unsuccessful wick consumes a level",
  "Swing ties, level lifecycle and insufficient trend history",
  "Mechanical 5m consolidation definition and order-block target price",
  "Meaning of opposing session level",
  "Same-bar scoring tie and opening audit-window policy",
]);
export function validateBars(bars, interval = 60, contiguous = false) {
  if (!Array.isArray(bars) || !bars.length) throw new Error("EMPTY_TAPE");
  bars.forEach((b, i) => {
    if (![b.t, b.o, b.h, b.l, b.c].every(Number.isFinite) ||
        !Number.isInteger(b.t) || b.t % interval !== 0 ||
        Math.min(b.o, b.h, b.l, b.c) <= 0 ||
        b.h < Math.max(b.o, b.l, b.c) || b.l > Math.min(b.o, b.h, b.c)) {
      throw new Error("INVALID_BAR:" + i);
    }
    if (i && b.t <= bars[i - 1].t) throw new Error("NON_MONOTONIC:" + i);
    if (contiguous && i && b.t - bars[i - 1].t !== interval) throw new Error("MISSING_BAR:" + i);
  });
  return bars;
}
export function sessionBars(bars, session, asOf) {
  validateBars(bars);
  if (![session.start, session.end, asOf].every(Number.isFinite) ||
      session.end <= session.start) throw new Error("INVALID_SESSION");
  return bars.filter(b => b.t >= session.start && b.t + 60 <= Math.min(session.end, asOf));
}
export function resample(bars, minutes, session, asOf) {
  if (![5, 15].includes(minutes)) throw new Error("INVALID_INTERVAL");
  const filtered = sessionBars(bars, session, asOf);
  const groups = new Map();
  for (const b of filtered) {
    const start = session.start + Math.floor((b.t - session.start) / (minutes * 60)) * minutes * 60;
    if (!groups.has(start)) groups.set(start, []);
    groups.get(start).push(b);
  }
  const result = [];
  for (const [start, group] of groups) {
    if (group.length !== minutes || group.some((b, i) => b.t !== start + i * 60)) continue;
    result.push({ t: start, o: group[0].o, h: Math.max(...group.map(b => b.h)),
      l: Math.min(...group.map(b => b.l)), c: group[group.length - 1].c });
  }
  return result;
}
export function confirmedSwings(bars, asOf, tiePolicy) {
  if (tiePolicy !== "strict") throw new Error("SWING_TIE_POLICY_REQUIRED");
  validateBars(bars, 900);
  const closed = bars.filter(b => b.t + 900 <= asOf);
  const swings = [];
  for (let i = 2; i < closed.length - 2; i++) {
    const neighbors = [closed[i - 2], closed[i - 1], closed[i + 1], closed[i + 2]];
    const b = closed[i], knownAt = closed[i + 2].t + 900;
    if (neighbors.every(n => b.h > n.h)) swings.push({ kind: "high", price: b.h, t: b.t, knownAt });
    if (neighbors.every(n => b.l < n.l)) swings.push({ kind: "low", price: b.l, t: b.t, knownAt });
  }
  return swings;
}
export function trendTag(swings, asOf) {
  const highs = swings.filter(s => s.kind === "high" && s.knownAt <= asOf).slice(-2);
  const lows = swings.filter(s => s.kind === "low" && s.knownAt <= asOf).slice(-2);
  if (highs.length < 2 || lows.length < 2) return "Unknown";
  if (highs[1].price > highs[0].price && lows[1].price > lows[0].price) return "Uptrend";
  if (highs[1].price < highs[0].price && lows[1].price < lows[0].price) return "Downtrend";
  return "Range";
}
export function priority(direction, trend) {
  if (!["CALL", "PUT"].includes(direction)) throw new Error("INVALID_DIRECTION");
  if (trend === "Unknown") return null;
  if (!["Uptrend", "Downtrend", "Range"].includes(trend)) throw new Error("INVALID_TREND");
  return trend === "Range" || (direction === "CALL" ? trend === "Uptrend" : trend === "Downtrend") ? "A+" : "B";
}
export function detectionKey(date, ticker, level, direction) {
  return [date, ticker.toUpperCase(), Number(level).toString(), direction].join(":");
}

/**
 * Replay-only hypothesis evaluator. These explicit semantics are NOT approved
 * method defaults. Live activation must not call this until definitions are signed off.
 * Level knownAt is the confirmation time, not the swing candle's timestamp.
 */
export function inspectSweep(input) {
  const { bars, session, asOf, level, direction, semantics } = input;
  if (!["CALL", "PUT"].includes(direction)) throw new Error("INVALID_DIRECTION");
  if (!semantics || !["open", "close", "wick"].includes(semantics.velocityOrigin) ||
      !["include", "following"].includes(semantics.reclaimCandle) ||
      semantics.extreme !== "first-breach" || semantics.consume !== "first-breach" ||
      semantics.lookback !== "extreme") throw new Error("EXPLICIT_REPLAY_SEMANTICS_REQUIRED");
  if (!Number.isFinite(level.price) || level.price <= 0 || !Number.isFinite(level.knownAt)) {
    throw new Error("INVALID_LEVEL");
  }
  const tape = sessionBars(bars, session, asOf);
  if (!tape.length || tape[0].t !== session.start) return { status: "REJECTED", reason: "MISSING_SESSION_OPEN" };
  validateBars(tape, 60, true);
  const call = direction === "CALL";
  const beyond = price => call ? price < level.price : price > level.price;
  const reclaimed = price => call ? price > level.price : price < level.price;
  const priceAt = b => call ? b.l : b.h;
  if (beyond(tape[0].o)) return { status: "REJECTED", reason: "GAP_THROUGH" };
  if (input.alreadyAlerted) return { status: "REJECTED", reason: "ALREADY_ALERTED" };
  const extremeIndex = tape.findIndex(b => b.t >= level.knownAt &&
    (call ? b.l <= level.price * (1 - RULES.penetrationFraction) :
      b.h >= level.price * (1 + RULES.penetrationFraction)));
  if (extremeIndex < 0) return { status: "REJECTED", reason: "NO_PENETRATION" };
  const extremeBar = tape[extremeIndex], extreme = priceAt(extremeBar);
  if (asOf - (extremeBar.t + 60) > RULES.lookbackSeconds) {
    return { status: "REJECTED", reason: "OUTSIDE_20_MINUTES" };
  }
  let originIndex = -1;
  for (let i = Math.max(0, extremeIndex - RULES.velocityBars + 1); i <= extremeIndex; i++) {
    // A close cannot precede an extreme on its own candle.
    if (semantics.velocityOrigin === "close" && i === extremeIndex) continue;
    const origin = semantics.velocityOrigin === "open" ? tape[i].o :
      semantics.velocityOrigin === "close" ? tape[i].c : call ? tape[i].h : tape[i].l;
    const fraction = (call ? origin - extreme : extreme - origin) / origin;
    if (fraction >= RULES.moveFraction) { originIndex = i; break; }
  }
  if (originIndex < 0) return { status: "REJECTED", reason: "VELOCITY" };
  const offset = semantics.reclaimCandle === "include" ? 0 : 1;
  const last = Math.min(tape.length - 1, extremeIndex + RULES.reclaimBars - (offset === 0 ? 1 : 0));
  let reclaimIndex = -1;
  for (let i = extremeIndex + offset; i <= last; i++) {
    if (reclaimed(tape[i].c)) { reclaimIndex = i; break; }
  }
  if (reclaimIndex < 0) return { status: "REJECTED", reason: "NO_RECLAIM_WITHIN_5" };
  // Earlier sub-threshold excursions can still be a sustained breakdown.
  let beyondStart = extremeIndex;
  while (beyondStart > 0 && beyond(tape[beyondStart - 1].c)) beyondStart--;
  if (tape[reclaimIndex].t + 60 - tape[beyondStart].t >= RULES.breakdownSeconds) {
    return { status: "REJECTED", reason: "BREAKDOWN_30_MINUTES" };
  }
  // A deeper extreme needs a signed-off reset policy, not an implicit reset.
  if (tape.slice(extremeIndex + 1, reclaimIndex + 1).some(b =>
    call ? b.l < extreme : b.h > extreme)) {
    return { status: "BLOCKED", reason: "EXTREME_RESET_UNDEFINED" };
  }
  return {
    status: "CANDIDATE_ONLY", reason: "TARGET_DEFINITIONS_AND_METHOD_APPROVAL_REQUIRED",
    ticker: input.ticker, direction, level: level.price, levelName: level.name,
    extreme, entry: tape[reclaimIndex].c, triggerAt: tape[reclaimIndex].t + 60,
    originAt: tape[originIndex].t, extremeAt: extremeBar.t,
    auditBars: tape.slice(Math.max(0, extremeIndex - 10), reclaimIndex + 1),
    precedingBars: Math.min(10, extremeIndex), semantics: { ...semantics },
  };
}
export function formatAlert(a) {
  if (!["CALL", "PUT"].includes(a.direction) || !["A+", "B"].includes(a.grade) ||
      !["Uptrend", "Downtrend", "Range"].includes(a.trend) ||
      !/^[A-Z][A-Z0-9.-]{0,14}$/.test(a.ticker) ||
      typeof a.levelName !== "string" || !a.levelName || /[\r\n]/.test(a.levelName) ||
      ![a.level, a.extreme, a.entry, a.t1, a.t2].every(n => Number.isFinite(n) && n > 0)) {
    throw new Error("INCOMPLETE_ALERT");
  }
  const p = n => n.toFixed(2);
  return "🚨 SWEEP [" + a.grade + "] " + a.ticker + " " + a.direction +
    " — swept " + p(a.level) + " (" + a.levelName + "), extreme " + p(a.extreme) +
    ", 1m reclaim close " + p(a.entry) + " → entry ~" + p(a.entry) +
    " · t1 (OB) " + p(a.t1) + " · t2 " + p(a.t2) + " · 15m trend: " + a.trend;
}

/** Missing data / same-bar ties are unresolved, never silently counted as OPEN. */
export function scoreAlert(alert, bars, session, asOf) {
  if (!["CALL", "PUT"].includes(alert.direction) ||
      ![alert.triggerAt, alert.entry, alert.extreme, alert.t1].every(Number.isFinite) ||
      alert.triggerAt < session.start || alert.triggerAt >= session.end ||
      (alert.direction === "CALL" ? alert.t1 <= alert.entry || alert.extreme >= alert.entry :
        alert.t1 >= alert.entry || alert.extreme <= alert.entry)) throw new Error("INVALID_SCORE_INPUT");
  const available = sessionBars(bars, session, asOf).filter(b => b.t >= alert.triggerAt);
  let expected = alert.triggerAt;
  for (const b of available) {
    if (b.t !== expected) return { verdict: "UNRESOLVED", reason: "MISSING_SUBSEQUENT_BARS" };
    expected += 60;
    const hit = alert.direction === "CALL" ? b.h >= alert.t1 : b.l <= alert.t1;
    const miss = alert.direction === "CALL" ? b.c < alert.extreme : b.c > alert.extreme;
    if (hit && miss) return { verdict: "UNRESOLVED", reason: "SAME_BAR_TIE", at: b.t + 60 };
    if (hit || miss) return { verdict: hit ? "HIT" : "MISS", at: b.t + 60 };
  }
  if (asOf < session.end) return { verdict: "PENDING", reason: "SESSION_NOT_ENDED" };
  if (expected !== session.end) return { verdict: "UNRESOLVED", reason: "MISSING_SUBSEQUENT_BARS" };
  return { verdict: "OPEN" };
}
export function scorecard(date, results) {
  const count = verdict => results.filter(r => r.verdict === verdict).length;
  const incomplete = results.some(r => !["HIT", "MISS", "OPEN"].includes(r.verdict));
  return "Scanner scorecard " + date + ": " + results.length + " alerts · " +
    count("HIT") + " hit t1 · " + count("MISS") + " invalidated · " + count("OPEN") + " open" +
    (incomplete ? " · " + (count("PENDING") + count("UNRESOLVED")) + " unscored (incomplete)" : "") +
    results.map(r => "\n" + r.ticker + ", " + r.direction + ", " + r.verdict +
      (r.reason ? " (" + r.reason + ")" : "")).join("");
}
