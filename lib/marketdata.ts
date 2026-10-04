// Pure market-data fetchers, shared by the CLI scripts (npm run
// candles/history/movers — kept for manual debugging) and the automated
// worker (lib/engine/worker.ts). All Yahoo Finance public endpoints, no API
// key. Functions throw on failure rather than process.exit, so callers
// (CLI or worker) decide how to handle it.

import { assertTimeLeft, deadlineSignal, waitWithinBudget } from "./deadline";

export type Candle = { t: string; o: number; h: number; l: number; c: number; v: number };

// `revalidateSec` opts a read into Next's data cache (dashboard/market pages);
// the worker and CLI always fetch fresh. Outside Next the option is ignored.
async function yahooFetch(url: string, label: string, revalidateSec?: number, deadline?: number) {
  // Bounded: the worker has a fixed per-invocation time budget.
  const get = (u: string) =>
    fetch(u, {
      headers: { "User-Agent": "Mozilla/5.0 (stock-studio market data fetcher)" },
      signal: deadlineSignal(deadline, 15_000),
      ...(revalidateSec ? { cache: "force-cache" as const, next: { revalidate: revalidateSec } } : {}),
    });
  let res = await get(url);
  // Yahoo rate-limits shared hosting IPs per host. Retry a 429/5xx twice with
  // a short backoff, alternating query1 <-> query2 (same API, separate limits).
  for (let attempt = 1; attempt <= 2 && (res.status === 429 || res.status >= 500); attempt++) {
    await waitWithinBudget(attempt * 1500, deadline);
    const alt = /\/\/query1\./.test(url) ? url.replace("//query1.", "//query2.") : url.replace("//query2.", "//query1.");
    res = await get(attempt % 2 === 1 ? alt : url);
  }
  if (!res.ok) throw new Error(`Yahoo ${label} API returned ${res.status}`);
  const body: any = await res.json();
  return body;
}

// The one-candle strategy's fixed "first 5 minutes of the regular session"
// rule — see lib/engine/methodology.md's One-candle section.
export async function fetchOpeningCandle(ticker: string, date?: string, deadline?: number) {
  let url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    ticker
  )}?interval=1m&includePrePost=false`;
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
      throw new Error(`Invalid session date "${date}" — expected YYYY-MM-DD`);
    }
    const start = Math.floor(new Date(`${date}T00:00:00-05:00`).getTime() / 1000);
    url += `&period1=${start}&period2=${start + 86400}`;
  } else {
    url += `&range=1d`;
  }

  const body = await yahooFetch(url, "chart", undefined, deadline);
  const result = body?.chart?.result?.[0];
  if (!result || body?.chart?.error) {
    throw new Error(`No chart data for ${ticker}: ${JSON.stringify(body?.chart?.error ?? "empty result")}`);
  }

  const meta = result.meta;
  const tz: string = meta.exchangeTimezoneName ?? "America/New_York";
  const regularStart: number = meta.currentTradingPeriod?.regular?.start ?? meta.regularTradingPeriodStartTime;

  const ts: number[] = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0] ?? {};
  const fmt = (unix: number) =>
    new Date(unix * 1000).toLocaleString("en-US", {
      timeZone: tz,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  const candles: (Candle & { unix: number })[] = [];
  for (let i = 0; i < ts.length; i++) {
    if (![ts[i], q.open?.[i], q.high?.[i], q.low?.[i], q.close?.[i]].every(Number.isFinite)) continue;
    candles.push({
      unix: ts[i],
      t: fmt(ts[i]),
      o: +q.open[i].toFixed(4),
      h: +q.high[i].toFixed(4),
      l: +q.low[i].toFixed(4),
      c: +q.close[i].toFixed(4),
      v: q.volume?.[i] ?? 0,
    });
  }
  if (candles.length === 0) {
    throw new Error(`No 1-minute candles returned for ${ticker} (market not open yet, or date out of 1m-history range)`);
  }

  const sessionDate = date ?? exchangeDate(candles[0].unix, tz);
  // Historical payloads sometimes contain current-session metadata. Use an
  // explicit period for the requested day, or the fixed US equity open.
  const periods = (result.tradingPeriods?.regular ?? []).flat(Infinity) as { start?: number }[];
  const candidates = [regularStart, ...periods.map((p) => p.start)];
  const sessionStart = candidates.find((start) => Number.isFinite(start) && exchangeDate(start!, tz) === sessionDate)
    ?? (tz === "America/New_York" ? exchangeTime(sessionDate, 9, 30, tz) : undefined);
  if (sessionStart == null) throw new Error(`Cannot verify regular-session opening time for ${ticker}`);
  const firstFive = candles.filter((c) => c.unix >= sessionStart && c.unix < sessionStart + 300).sort((a, b) => a.unix - b.unix);
  if (Date.now() < (sessionStart + 300) * 1000 || firstFive.length !== 5 ||
      firstFive.some((c, i) => c.unix !== sessionStart + i * 60)) {
    throw new Error(`Incomplete opening range for ${ticker}: need five completed 1-minute bars at the regular session open`);
  }
  const opening = {
    start: fmt(sessionStart),
    end: fmt(sessionStart + 300),
    open: firstFive[0].o,
    high: Math.max(...firstFive.map((c) => c.h)),
    low: Math.min(...firstFive.map((c) => c.l)),
    close: firstFive[firstFive.length - 1].c,
    volume: firstFive.reduce((s, c) => s + c.v, 0),
  };

  const series = candles
    .filter((c) => c.unix >= sessionStart && c.unix < sessionStart + 2 * 3600)
    .map(({ unix, ...rest }) => rest);

  return {
    ticker,
    exchange_timezone: tz,
    session_date: sessionDate,
    note: "Times are exchange-local. The regular session start comes from the exchange metadata (9:30 ET for US equities).",
    first_five_minute_candle: opening,
    one_minute_candles: series,
  };
}

// General-purpose OHLC across many candles — for swing-structure setups
// like the Da Vinci liquidity model, where a single opening range isn't
// enough. See lib/engine/methodology.md's Da Vinci section.
export async function fetchHistory(ticker: string, interval = "5m", range = "5d", deadline?: number) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    ticker
  )}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}&includePrePost=false`;

  const body = await yahooFetch(url, "chart", undefined, deadline);
  const result = body?.chart?.result?.[0];
  if (!result || body?.chart?.error) {
    throw new Error(`No chart data for ${ticker}: ${JSON.stringify(body?.chart?.error ?? "empty result")}`);
  }

  const meta = result.meta;
  const tz: string = meta.exchangeTimezoneName ?? "America/New_York";
  const isIntraday = ["1m", "2m", "5m", "15m", "30m", "60m", "90m"].includes(interval);
  const fmt = (unix: number) =>
    new Date(unix * 1000).toLocaleString("en-US", {
      timeZone: tz,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      ...(isIntraday ? { hour: "2-digit" as const, minute: "2-digit" as const } : {}),
    });

  const ts: number[] = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0] ?? {};
  const candles: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    if (![ts[i], q.open?.[i], q.high?.[i], q.low?.[i], q.close?.[i]].every(Number.isFinite)) continue;
    candles.push({
      t: fmt(ts[i]),
      o: +q.open[i].toFixed(4),
      h: +q.high[i].toFixed(4),
      l: +q.low[i].toFixed(4),
      c: +q.close[i].toFixed(4),
      v: q.volume?.[i] ?? 0,
    });
  }
  if (candles.length === 0) {
    throw new Error(`No candles returned for ${ticker} at interval=${interval} range=${range}`);
  }

  return {
    ticker,
    interval,
    requested_range: range,
    exchange_timezone: tz,
    candle_count: candles.length,
    first_candle_time: candles[0].t,
    last_candle_time: candles[candles.length - 1].t,
    note: "Times are exchange-local. Yahoo may return fewer candles than requested if the range exceeds what it retains for this interval — check first/last_candle_time, not just the requested range.",
    candles,
  };
}

export type Mover = {
  symbol: string;
  name: string;
  price: number | null;
  change_pct: number | null;
  market_cap: number | null;
  volume: number | null;
  exchange: string | null;
};

async function screener(scrId: string, count: number, revalidateSec?: number, deadline?: number): Promise<Mover[]> {
  const url = `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=${scrId}&count=${count}&formatted=false`;
  const body = await yahooFetch(url, "screener", revalidateSec, deadline);
  const quotes = body?.finance?.result?.[0]?.quotes ?? [];
  return quotes.map((q: any) => ({
    symbol: q.symbol,
    name: q.shortName ?? q.longName ?? q.symbol,
    price: q.regularMarketPrice ?? null,
    change_pct: q.regularMarketChangePercent != null ? +q.regularMarketChangePercent.toFixed(2) : null,
    market_cap: q.marketCap ?? null,
    volume: q.regularMarketVolume ?? null,
    exchange: q.fullExchangeName ?? null,
  }));
}

export async function fetchMovers(count = 5, revalidateSec?: number, deadline?: number) {
  const [gainers, losers] = await Promise.all([
    screener("day_gainers", count, revalidateSec, deadline),
    screener("day_losers", count, revalidateSec, deadline),
  ]);
  if (gainers.length === 0 && losers.length === 0) {
    throw new Error("Yahoo screeners returned no quotes — try again later or fall back to web research.");
  }
  return {
    as_of: new Date().toISOString(),
    note: "Yahoo Finance predefined screeners (US equities). Percent moves are for the current/most recent regular session.",
    gainers,
    losers,
  };
}

export type DailyCloses = { symbol: string; dates: string[]; closes: number[] };

// Daily OHLCV, oldest first. `closes` are raw (use them with opens/highs/lows);
// `adjCloses` are split/dividend-adjusted (use them for returns).
export type DailyBars = {
  symbol: string;
  dates: string[];
  opens: number[];
  highs: number[];
  lows: number[];
  closes: number[];
  adjCloses: number[];
  volumes: number[];
};

export async function fetchDailyBars(ticker: string, range = "1y", revalidateSec = 1800, deadline?: number): Promise<DailyBars> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    ticker
  )}?interval=1d&range=${encodeURIComponent(range)}&includePrePost=false`;
  const body = await yahooFetch(url, "chart", revalidateSec, deadline);
  const result = body?.chart?.result?.[0];
  if (!result || body?.chart?.error) throw new Error(`No chart data for ${ticker}`);
  const ts: number[] = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0] ?? {};
  const adj: (number | null)[] = result.indicators?.adjclose?.[0]?.adjclose ?? q.close ?? [];
  const bars: DailyBars = { symbol: ticker, dates: [], opens: [], highs: [], lows: [], closes: [], adjCloses: [], volumes: [] };
  const ok = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  for (let i = 0; i < ts.length; i++) {
    const [o, h, l, c, a] = [q.open?.[i], q.high?.[i], q.low?.[i], q.close?.[i], adj[i]];
    // Skip half-filled rows (Yahoo emits nulls for halted/partial sessions).
    if (!ok(o) || !ok(h) || !ok(l) || !ok(c)) continue;
    bars.dates.push(new Date(ts[i] * 1000).toISOString().slice(0, 10));
    bars.opens.push(o);
    bars.highs.push(h);
    bars.lows.push(l);
    bars.closes.push(c);
    bars.adjCloses.push(ok(a) ? a : c);
    bars.volumes.push(ok(q.volume?.[i]) ? q.volume[i] : 0);
  }
  if (bars.closes.length === 0) throw new Error(`No daily bars returned for ${ticker}`);
  return bars;
}

// Adjusted daily closes (oldest first) for the market-context page and study
// track records. Same URL as fetchDailyBars, so both share one cache entry.
export async function fetchDailyCloses(ticker: string, range = "1y", revalidateSec = 1800): Promise<DailyCloses> {
  const b = await fetchDailyBars(ticker, range, revalidateSec);
  return { symbol: b.symbol, dates: b.dates, closes: b.adjCloses };
}

// Runs `fn` over `items` with at most `limit` in flight; failures become null
// so one bad ticker never sinks a whole panel.
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>, deadline?: number): Promise<(R | null)[]> {
  const out: (R | null)[] = new Array(items.length).fill(null);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      assertTimeLeft(deadline);
      const i = next++;
      try {
        out[i] = await fn(items[i]);
      } catch {
        assertTimeLeft(deadline);
        out[i] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function exchangeDate(unix: number, timezone: string): string {
  return new Date(unix * 1000).toLocaleDateString("en-CA", { timeZone: timezone });
}

// Convert a local opening time to UTC without hard-coding EST/EDT offsets.
export function exchangeTime(date: string, hour: number, minute: number, timezone: string): number {
  const wanted = Date.parse(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
  let guess = wanted;
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
    const local = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
    guess += wanted - local;
  }
  return guess / 1000;
}
