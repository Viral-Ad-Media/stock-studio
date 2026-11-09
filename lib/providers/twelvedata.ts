// Twelve Data: stock time series. Key: TWELVE_DATA_API_KEY.
// The free plan allows 8 requests a minute, so it sits late in the chain.

import {
  type ChartQuery, type RawBar,
  ProviderNoData, ProviderUnavailable, TZ, dayStamp, getJson, msToNewYork, newYorkToMs, num, queryWindow, toChartBody, usSymbol,
} from "./common";

const HOST = "https://api.twelvedata.com";
const key = () => process.env.TWELVE_DATA_API_KEY || "";

export function twelveDataConfigured(): boolean {
  return Boolean(key());
}

const INTERVALS: Record<string, string> = {
  "1m": "1min", "5m": "5min", "15m": "15min", "30m": "30min", "60m": "1h", "1h": "1h",
  "1d": "1day", "1wk": "1week", "1mo": "1month",
};

async function series(params: URLSearchParams, revalidateSec?: number, deadline?: number) {
  const body = await getJson("Twelve Data", `${HOST}/time_series?${params}`, { Authorization: `apikey ${key()}` }, revalidateSec, deadline);
  // Twelve Data reports errors in a 200 body: { status: "error", code: 429, ... }.
  if (body?.status === "error") {
    const code = Number(body?.code);
    if (code === 429 || code === 401 || code === 403 || code >= 500) throw new ProviderUnavailable(`Twelve Data returned ${code}`);
    throw new ProviderNoData(`Twelve Data: ${String(body?.message ?? "no data").slice(0, 120)}`);
  }
  return Array.isArray(body?.values) ? body.values : [];
}

export async function twelveDataChart(ticker: string, q: ChartQuery, revalidateSec?: number, deadline?: number) {
  const symbol = usSymbol(ticker, ".");
  if (!symbol) throw new ProviderNoData(`${ticker} isn't available from Twelve Data`);
  const interval = INTERVALS[q.interval];
  if (!interval) throw new ProviderNoData(`Unsupported interval "${q.interval}" for Twelve Data`);
  const w = queryWindow(q);
  const params = (adjust: string) => {
    const p = new URLSearchParams({
      symbol, interval, timezone: TZ, order: "asc", outputsize: "5000", adjust,
      start_date: msToNewYork(w.start),
    });
    if (w.end != null) p.set("end_date", msToNewYork(w.end));
    return p;
  };
  // Default adjust=splits matches Yahoo's `close`; adjust=all gives adjclose.
  const raw = await series(params("splits"), revalidateSec, deadline);
  const stamp = (dt: string) => (w.intraday ? newYorkToMs(dt) : dayStamp(dt));
  const bars: RawBar[] = raw.map((r: any) => ({
    t: stamp(String(r.datetime)), o: num(r.open)!, h: num(r.high)!, l: num(r.low)!, c: num(r.close)!, v: num(r.volume) ?? 0,
  }));
  if (bars.length === 0) throw new ProviderNoData(`Twelve Data returned no bars for ${ticker}`);
  let adjclose: number[] | undefined;
  if (!w.intraday) {
    const adj = await series(params("all"), revalidateSec, deadline);
    const byTime = new Map<number, number | null>(adj.map((r: any) => [stamp(String(r.datetime)), num(r.close)]));
    adjclose = bars.map((b) => byTime.get(b.t) ?? b.c);
  }
  return toChartBody(ticker, bars, { intraday: w.intraday, sessions: w.sessions, dataSource: "twelvedata", adjclose });
}
