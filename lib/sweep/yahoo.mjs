import { validateBars } from "./core.mjs";

// Dedicated scanner process only. Do not mutate the Next.js process environment.
export function sanitizeProxyEnvironment(env) {
  for (const key of Object.keys(env)) {
    if (/^(https?_proxy|all_proxy|no_proxy)$/i.test(key)) delete env[key];
  }
}
export function exchangeDate(epoch) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(epoch * 1000));
}
export function regularWindows(result) {
  const regular = result.tradingPeriods?.regular ?? result.tradingPeriods ?? [];
  const windows = Array.isArray(regular) ? regular.flat(Infinity) : [];
  const current = result.meta?.currentTradingPeriod?.regular;
  if (current) windows.push(current);
  return [...new Map(windows.filter(p => Number.isInteger(p?.start) && Number.isInteger(p?.end) &&
    p.end > p.start).map(p => [p.start, { start: p.start, end: p.end }])).values()]
    .sort((a, b) => a.start - b.start);
}
export function parseChart(body, interval, asOf) {
  const result = body?.chart?.result?.[0];
  if (!result || body.chart.error) throw new Error("YAHOO_CHART_ERROR");
  if (result.meta?.exchangeTimezoneName !== "America/New_York") throw new Error("UNSUPPORTED_EXCHANGE_TIMEZONE");
  const timestamps = result.timestamp;
  if (!Array.isArray(timestamps) || !timestamps.length) throw new Error("EMPTY_TAPE");
  const q = result.indicators?.quote?.[0];
  if (!q) throw new Error("MISSING_QUOTES");
  for (let i = 0; i < timestamps.length; i++) {
    if (!Number.isInteger(timestamps[i]) || (i && timestamps[i] <= timestamps[i - 1])) {
      throw new Error("NON_MONOTONIC");
    }
  }
  const windows = regularWindows(result);
  const seconds = interval === "1m" ? 60 : interval === "15m" ? 900 : 86400;
  if (!["1m", "15m", "1d"].includes(interval)) throw new Error("INVALID_INTERVAL");
  if (interval !== "1d" && !windows.length) throw new Error("MISSING_REGULAR_PERIODS");
  const bars = [];
  timestamps.forEach((t, i) => {
    if (interval === "1d") {
      if (exchangeDate(t) >= exchangeDate(asOf)) return; // prior completed sessions only
    } else if (t + seconds > asOf || !windows.some(w => t >= w.start && t + seconds <= w.end)) return;
    const bar = { t, o: q.open?.[i], h: q.high?.[i], l: q.low?.[i], c: q.close?.[i] };
    validateBars([bar], interval === "15m" ? 900 : 60);
    bars.push(bar);
  });
  validateBars(bars, interval === "15m" ? 900 : 60);
  return { bars, windows, symbol: result.meta.symbol };
}

// A module-local queue also serializes separate callers. No Alpaca fallback.
let tail = Promise.resolve();
export function fetchChart(ticker, interval, range, asOf = Math.floor(Date.now() / 1000)) {
  const task = tail.then(async () => {
    if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(ticker)) throw new Error("INVALID_TICKER");
    const query = new URLSearchParams({
      range, interval, includePrePost: "false", includeTradingPeriods: "true",
    });
    const response = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/" +
      encodeURIComponent(ticker) + "?" + query, {
      cache: "no-store", signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
    });
    if (!response.ok) throw new Error("YAHOO_HTTP_" + response.status);
    return parseChart(await response.json(), interval, asOf);
  });
  tail = task.catch(() => undefined);
  return task;
}
export async function fetchDailyContext(ticker, asOf) {
  const daily = await fetchChart(ticker, "1d", "1mo", asOf);
  const history = await fetchChart(ticker, "15m", "1mo", asOf);
  const date = exchangeDate(asOf);
  const sessions = history.windows.filter(w => exchangeDate(w.start) < date && w.end <= asOf).slice(-5);
  if (sessions.length !== 5) throw new Error("INSUFFICIENT_PRIOR_SESSIONS");
  const bars = history.bars.filter(b => sessions.some(w => b.t >= w.start && b.t + 900 <= w.end));
  for (const w of sessions) {
    const tape = bars.filter(b => b.t >= w.start && b.t < w.end);
    validateBars(tape, 900, true);
    if (tape[0].t !== w.start || tape[tape.length - 1].t + 900 !== w.end) {
      throw new Error("INCOMPLETE_PRIOR_SESSION");
    }
  }
  const prior = daily.bars.find(b => exchangeDate(b.t) === exchangeDate(sessions[sessions.length - 1].start));
  if (!prior) throw new Error("PRIOR_DAILY_MISMATCH");
  return { ticker, date, fetchedAt: asOf, prior, sessions, bars15m: bars };
}
