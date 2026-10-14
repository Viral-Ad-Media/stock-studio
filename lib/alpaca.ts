// Fallback market data from Alpaca's free IEX feed, used when Yahoo refuses
// a request (Render's shared outbound IPs are routinely rate-limited by
// Yahoo). Responses are reshaped into Yahoo's chart format so the parsers in
// lib/marketdata.ts work unchanged. Needs ALPACA_KEY_ID and ALPACA_SECRET_KEY
// (a free Alpaca account; paper-trading keys are enough).
//
// Caveats of the free feed: volumes are IEX-only (a few percent of
// consolidated volume), and indices (^GSPC) and FX/crypto pairs aren't covered.

import { assertTimeLeft, deadlineSignal } from "./deadline";

const DATA_HOST = "https://data.alpaca.markets";
const TZ = "America/New_York";

export function alpacaConfigured(): boolean {
  return Boolean(process.env.ALPACA_KEY_ID && process.env.ALPACA_SECRET_KEY);
}

export type ChartQuery = { interval: string; range?: string; period1?: number; period2?: number };

const TIMEFRAMES: Record<string, string> = {
  "1m": "1Min", "2m": "2Min", "5m": "5Min", "15m": "15Min", "30m": "30Min",
  "60m": "1Hour", "1h": "1Hour", "1d": "1Day", "1wk": "1Week", "1mo": "1Month",
};

// Yahoo uses "BRK-B" for share classes; Alpaca uses "BRK.B".
export function alpacaSymbol(ticker: string): string | null {
  const t = ticker.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(t)) return null; // ^GSPC, EURUSD=X, BTC-USD style
  if (/-USD$/.test(t)) return null;
  return t.replace(/-/g, ".");
}

async function alpacaGet(path: string, revalidateSec?: number, deadline?: number): Promise<any> {
  const res = await fetch(`${DATA_HOST}${path}`, {
    headers: {
      "APCA-API-KEY-ID": process.env.ALPACA_KEY_ID ?? "",
      "APCA-API-SECRET-KEY": process.env.ALPACA_SECRET_KEY ?? "",
      Accept: "application/json",
    },
    signal: deadlineSignal(deadline, 15_000),
    ...(revalidateSec ? { cache: "force-cache" as const, next: { revalidate: revalidateSec } } : {}),
  });
  if (!res.ok) throw new Error(`Alpaca market data API returned ${res.status}`);
  return res.json();
}

type Bar = { t: string; o: number; h: number; l: number; c: number; v: number };

async function bars(symbol: string, timeframe: string, start: string, end: string | undefined, adjustment: "raw" | "all", revalidateSec?: number, deadline?: number): Promise<Bar[]> {
  const out: Bar[] = [];
  let token: string | undefined;
  for (let page = 0; page < 10; page++) {
    assertTimeLeft(deadline);
    const qs = new URLSearchParams({ timeframe, start, adjustment, feed: "iex", limit: "10000", sort: "asc" });
    if (end) qs.set("end", end);
    if (token) qs.set("page_token", token);
    const body = await alpacaGet(`/v2/stocks/${encodeURIComponent(symbol)}/bars?${qs}`, revalidateSec, deadline);
    out.push(...(body?.bars ?? []));
    token = body?.next_page_token ?? undefined;
    if (!token) break;
  }
  return out;
}

function exchangeDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-CA", { timeZone: TZ });
}

function minutesIntoDay(unix: number): number {
  const [h, m] = new Date(unix * 1000)
    .toLocaleTimeString("en-GB", { timeZone: TZ, hour12: false, hour: "2-digit", minute: "2-digit" })
    .split(":").map(Number);
  return (h % 24) * 60 + m;
}

// Calendar lookback for a Yahoo range string, plus how many trading sessions
// to keep for "Nd" ranges (weekends and holidays make calendar days too many).
function rangeWindow(range: string, now: number): { start: number; sessions?: number } {
  const day = 86_400_000;
  const m = /^(\d+)(d|wk|mo|y)$/.exec(range);
  if (range === "ytd") return { start: Date.UTC(new Date(now).getUTCFullYear(), 0, 1) };
  if (range === "max") return { start: Date.UTC(2016, 0, 1) };
  if (!m) throw new Error(`Unsupported range "${range}" for the Alpaca fallback`);
  const n = Number(m[1]);
  if (m[2] === "d") return { start: now - (Math.ceil(n * 1.5) + 4) * day, sessions: n };
  if (m[2] === "wk") return { start: now - n * 7 * day };
  if (m[2] === "mo") return { start: now - n * 31 * day };
  return { start: now - n * 366 * day };
}

// Returns a body shaped like Yahoo's /v8/finance/chart response.
export async function alpacaChart(ticker: string, q: ChartQuery, revalidateSec?: number, deadline?: number) {
  const symbol = alpacaSymbol(ticker);
  if (!symbol) throw new Error(`${ticker} isn't available from the Alpaca fallback`);
  const timeframe = TIMEFRAMES[q.interval];
  if (!timeframe) throw new Error(`Unsupported interval "${q.interval}" for the Alpaca fallback`);
  const intraday = /Min|Hour/.test(timeframe);

  let start: number;
  let end: number | undefined;
  let sessions: number | undefined;
  if (q.period1 != null) {
    start = q.period1 * 1000;
    end = q.period2 != null ? q.period2 * 1000 : undefined;
  } else {
    ({ start, sessions } = rangeWindow(q.range ?? "1d", Date.now()));
  }
  const iso = (ms: number) => new Date(ms).toISOString();

  let raw = await bars(symbol, timeframe, iso(start), end != null ? iso(end) : undefined, "raw", revalidateSec, deadline);
  // Match Yahoo's includePrePost=false: regular session only (9:30-16:00 ET).
  if (intraday) raw = raw.filter((b) => {
    const mins = minutesIntoDay(Date.parse(b.t) / 1000);
    return mins >= 570 && mins < 960;
  });
  if (sessions != null) {
    const dates = [...new Set(raw.map((b) => exchangeDate(Date.parse(b.t) / 1000)))].slice(-sessions);
    const keep = new Set(dates);
    raw = raw.filter((b) => keep.has(exchangeDate(Date.parse(b.t) / 1000)));
  }

  let adjclose: number[] | undefined;
  if (!intraday) {
    const adj = await bars(symbol, timeframe, iso(start), end != null ? iso(end) : undefined, "all", revalidateSec, deadline);
    const byTime = new Map(adj.map((b) => [b.t, b.c]));
    adjclose = raw.map((b) => byTime.get(b.t) ?? b.c);
  }

  return {
    chart: {
      error: null,
      result: [{
        meta: { symbol: ticker, exchangeTimezoneName: TZ, dataSource: "alpaca-iex" },
        timestamp: raw.map((b) => Math.floor(Date.parse(b.t) / 1000)),
        indicators: {
          quote: [{
            open: raw.map((b) => b.o),
            high: raw.map((b) => b.h),
            low: raw.map((b) => b.l),
            close: raw.map((b) => b.c),
            volume: raw.map((b) => b.v),
          }],
          ...(adjclose ? { adjclose: [{ adjclose }] } : {}),
        },
      }],
    },
  };
}

// Top gainers and losers, shaped like lib/marketdata.ts's Mover rows.
export async function alpacaMovers(count: number, revalidateSec?: number, deadline?: number) {
  const body = await alpacaGet(`/v1beta1/screener/stocks/movers?top=${Math.min(Math.max(count, 1), 50)}`, revalidateSec, deadline);
  const row = (m: any) => ({
    symbol: m.symbol,
    name: m.symbol,
    price: typeof m.price === "number" ? m.price : null,
    change_pct: typeof m.percent_change === "number" ? +m.percent_change.toFixed(2) : null,
    market_cap: null,
    volume: null,
    exchange: null,
  });
  return { gainers: (body?.gainers ?? []).map(row), losers: (body?.losers ?? []).map(row) };
}
