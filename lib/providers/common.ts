// Shared plumbing for the keyed market-data providers (Massive, Finnhub,
// Twelve Data, Tiingo, Alpaca). Each provider fetches raw bars and hands them
// to toChartBody, which reshapes them into Yahoo's /v8/finance/chart format
// so the parsers in lib/marketdata.ts work unchanged whoever served the data.
// Keys come from env vars only; nothing here logs or returns them.

import { deadlineSignal } from "../deadline";

export const TZ = "America/New_York";

export type ChartQuery = { interval: string; range?: string; period1?: number; period2?: number };

// One bar, timestamp in epoch milliseconds.
export type RawBar = { t: number; o: number; h: number; l: number; c: number; v: number };

// The provider refused or couldn't serve the request (rate limit, outage,
// bad/insufficient key). The caller cools the provider down and moves on.
export class ProviderUnavailable extends Error {}

// A provider error that isn't about availability (unknown ticker, empty
// result, unsupported interval). The caller moves on without a cooldown.
export class ProviderNoData extends Error {}

// Yahoo-style tickers: "BRK-B" for share classes; indices (^GSPC), FX
// (EURUSD=X) and crypto (BTC-USD) aren't served by the keyed US-equity feeds.
export function usSymbol(ticker: string, classSeparator: "." | "-" = "."): string | null {
  const t = ticker.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(t)) return null;
  if (/-USD$/.test(t)) return null;
  return t.replace(/[-.]/g, classSeparator);
}

export async function getJson(
  provider: string,
  url: string,
  headers: Record<string, string>,
  revalidateSec?: number,
  deadline?: number,
): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json", ...headers },
      signal: deadlineSignal(deadline, 15_000),
      ...(revalidateSec ? { cache: "force-cache" as const, next: { revalidate: revalidateSec } } : {}),
    });
  } catch (err) {
    // Deadline aborts propagate; plain network failures mean "try the next one".
    if (deadline != null && deadline <= Date.now()) throw err;
    throw new ProviderUnavailable(`${provider} request failed: ${(err as Error).message}`);
  }
  if (res.status === 429 || res.status >= 500 || res.status === 401 || res.status === 403) {
    throw new ProviderUnavailable(`${provider} market data API returned ${res.status}`);
  }
  if (res.status === 404) throw new ProviderNoData(`${provider} has no data for this request`);
  if (!res.ok) throw new Error(`${provider} market data API returned ${res.status}`);
  return res.json();
}

export function exchangeDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: TZ });
}

function minutesIntoDay(ms: number): number {
  const [h, m] = new Date(ms)
    .toLocaleTimeString("en-GB", { timeZone: TZ, hour12: false, hour: "2-digit", minute: "2-digit" })
    .split(":").map(Number);
  return (h % 24) * 60 + m;
}

// Date-only bars (daily/weekly/monthly) get stamped at 13:30 UTC on their
// session date, like Yahoo's, so the UTC date and the New York date agree.
export function dayStamp(date: string): number {
  return Date.parse(`${date.slice(0, 10)}T13:30:00Z`);
}

// Wall-clock time in New York ("2026-11-09 09:30:00") to epoch ms.
export function newYorkToMs(local: string): number {
  const wanted = Date.parse(local.trim().replace(" ", "T") + "Z");
  let guess = wanted;
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
    const asLocal = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
    guess += wanted - asLocal;
  }
  return guess;
}

// Epoch ms to New York wall-clock "YYYY-MM-DD HH:MM:SS".
export function msToNewYork(ms: number): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

// Calendar lookback for a Yahoo range string, plus how many trading sessions
// to keep for "Nd" ranges (weekends and holidays make calendar days too many).
export function rangeWindow(range: string, now: number): { start: number; sessions?: number } {
  const day = 86_400_000;
  const m = /^(\d+)(d|wk|mo|y)$/.exec(range);
  if (range === "ytd") return { start: Date.UTC(new Date(now).getUTCFullYear(), 0, 1) };
  if (range === "max") return { start: Date.UTC(2016, 0, 1) };
  if (!m) throw new ProviderNoData(`Unsupported range "${range}"`);
  const n = Number(m[1]);
  if (m[2] === "d") return { start: now - (Math.ceil(n * 1.5) + 4) * day, sessions: n };
  if (m[2] === "wk") return { start: now - n * 7 * day };
  if (m[2] === "mo") return { start: now - n * 31 * day };
  return { start: now - n * 366 * day };
}

export const INTRADAY = new Set(["1m", "2m", "5m", "15m", "30m", "60m", "1h", "90m"]);

// Resolves a chart query to an absolute window in epoch ms.
export function queryWindow(q: ChartQuery, now = Date.now()): { start: number; end?: number; sessions?: number; intraday: boolean } {
  const intraday = INTRADAY.has(q.interval);
  if (q.period1 != null) {
    return { start: q.period1 * 1000, end: q.period2 != null ? q.period2 * 1000 : undefined, intraday };
  }
  return { ...rangeWindow(q.range ?? "1d", now), intraday };
}

// Returns a body shaped like Yahoo's /v8/finance/chart response.
// `adjclose` (aligned with `bars`) is split+dividend adjusted where the
// provider offers it; otherwise the closes stand in.
export function toChartBody(
  ticker: string,
  bars: RawBar[],
  opts: { intraday: boolean; sessions?: number; dataSource: string; adjclose?: number[] },
) {
  let rows = bars.map((b, i) => ({ b, adj: opts.adjclose?.[i] }))
    .filter(({ b }) => [b.t, b.o, b.h, b.l, b.c].every(Number.isFinite))
    .sort((a, b) => a.b.t - b.b.t);
  // Match Yahoo's includePrePost=false: regular session only (9:30-16:00 ET).
  if (opts.intraday) rows = rows.filter(({ b }) => {
    const mins = minutesIntoDay(b.t);
    return mins >= 570 && mins < 960;
  });
  if (opts.sessions != null) {
    const keep = new Set([...new Set(rows.map(({ b }) => exchangeDate(b.t)))].slice(-opts.sessions));
    rows = rows.filter(({ b }) => keep.has(exchangeDate(b.t)));
  }
  return {
    chart: {
      error: null,
      result: [{
        meta: { symbol: ticker, exchangeTimezoneName: TZ, dataSource: opts.dataSource },
        timestamp: rows.map(({ b }) => Math.floor(b.t / 1000)),
        indicators: {
          quote: [{
            open: rows.map(({ b }) => b.o),
            high: rows.map(({ b }) => b.h),
            low: rows.map(({ b }) => b.l),
            close: rows.map(({ b }) => b.c),
            volume: rows.map(({ b }) => (Number.isFinite(b.v) ? b.v : 0)),
          }],
          ...(opts.intraday ? {} : { adjclose: [{ adjclose: rows.map(({ b, adj }) => (Number.isFinite(adj) ? adj! : b.c)) }] }),
        },
      }],
    },
  };
}

// A CBOE-shaped options payload ({ timestamp, data: { current_price, options }})
// so parseCboeChain (lib/gex.ts) and parseLeapsChain (lib/leaps-chain.ts)
// read any provider's chain unchanged.
export type CboeOption = {
  option: string; // OCC symbol, e.g. NVDA260819C00110000
  bid: number | null;
  ask: number | null;
  iv: number | null; // decimal (0.32 = 32%)
  delta: number | null;
  gamma: number | null;
  open_interest: number | null;
  volume: number | null;
};
export type CboeLikeChain = { timestamp: string | null; source: string; data: { current_price: number; options: CboeOption[] } };

export type ChainWindow = { minDays: number; maxDays: number; strikeLo: number; strikeHi: number };

export function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

export function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
