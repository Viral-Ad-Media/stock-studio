// Fallback market data from Alpaca's free IEX feed, used when Yahoo refuses
// a request (Render's shared outbound IPs are routinely rate-limited by
// Yahoo). Responses are reshaped into Yahoo's chart format so the parsers in
// lib/marketdata.ts work unchanged. Needs ALPACA_KEY_ID and ALPACA_SECRET_KEY
// (a free Alpaca account; paper-trading keys are enough).
//
// Caveats of the free feed: volumes are IEX-only (a few percent of
// consolidated volume), and indices (^GSPC) and FX/crypto pairs aren't covered.

import { assertTimeLeft } from "./deadline";
import { type ChartQuery, type RawBar, ProviderNoData, dayStamp, getJson, queryWindow, toChartBody, usSymbol } from "./providers/common";

export type { ChartQuery };

const DATA_HOST = "https://data.alpaca.markets";

export function alpacaConfigured(): boolean {
  return Boolean(process.env.ALPACA_KEY_ID && process.env.ALPACA_SECRET_KEY);
}

const TIMEFRAMES: Record<string, string> = {
  "1m": "1Min", "2m": "2Min", "5m": "5Min", "15m": "15Min", "30m": "30Min",
  "60m": "1Hour", "1h": "1Hour", "1d": "1Day", "1wk": "1Week", "1mo": "1Month",
};

// Yahoo uses "BRK-B" for share classes; Alpaca uses "BRK.B".
export function alpacaSymbol(ticker: string): string | null {
  return usSymbol(ticker, ".");
}

function alpacaGet(path: string, revalidateSec?: number, deadline?: number): Promise<any> {
  return getJson("Alpaca", `${DATA_HOST}${path}`, {
    "APCA-API-KEY-ID": process.env.ALPACA_KEY_ID ?? "",
    "APCA-API-SECRET-KEY": process.env.ALPACA_SECRET_KEY ?? "",
  }, revalidateSec, deadline);
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

// Returns a body shaped like Yahoo's /v8/finance/chart response.
export async function alpacaChart(ticker: string, q: ChartQuery, revalidateSec?: number, deadline?: number) {
  const symbol = alpacaSymbol(ticker);
  if (!symbol) throw new ProviderNoData(`${ticker} isn't available from the Alpaca fallback`);
  const timeframe = TIMEFRAMES[q.interval];
  if (!timeframe) throw new ProviderNoData(`Unsupported interval "${q.interval}" for the Alpaca fallback`);
  const w = queryWindow(q);
  const iso = (ms: number) => new Date(ms).toISOString();
  const end = w.end != null ? iso(w.end) : undefined;
  // Alpaca stamps daily bars at midnight New York; restamp to the session date.
  const stamp = (t: string) => (w.intraday ? Date.parse(t) : dayStamp(new Date(Date.parse(t) + 6 * 3_600_000).toISOString()));
  const raw = await bars(symbol, timeframe, iso(w.start), end, "raw", revalidateSec, deadline);
  const rows: RawBar[] = raw.map((b) => ({ t: stamp(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
  let adjclose: number[] | undefined;
  if (!w.intraday) {
    const adj = await bars(symbol, timeframe, iso(w.start), end, "all", revalidateSec, deadline);
    const byTime = new Map(adj.map((b) => [stamp(b.t), b.c]));
    adjclose = rows.map((b) => byTime.get(b.t) ?? b.c);
  }
  return toChartBody(ticker, rows, { intraday: w.intraday, sessions: w.sessions, dataSource: "alpaca-iex", adjclose });
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
