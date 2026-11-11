// Tiingo: end-of-day prices (with split+dividend adjusted closes) and IEX
// intraday bars. Key: TIINGO_API_KEY. Intraday volume is IEX-only.

import {
  type ChartQuery, type RawBar,
  ProviderNoData, dayStamp, getJson, isoDay, num, queryWindow, toChartBody, usSymbol,
} from "./common";

const HOST = "https://api.tiingo.com";
const key = () => process.env.TIINGO_API_KEY || "";

export function tiingoConfigured(): boolean {
  return Boolean(key());
}

function get(path: string, revalidateSec?: number, deadline?: number) {
  return getJson("Tiingo", `${HOST}${path}`, { Authorization: `Token ${key()}` }, revalidateSec, deadline);
}

const DAILY: Record<string, string> = { "1d": "daily", "1wk": "weekly", "1mo": "monthly" };
const INTRADAY: Record<string, string> = {
  "1m": "1min", "5m": "5min", "15m": "15min", "30m": "30min", "60m": "1hour", "1h": "1hour",
};

export async function tiingoChart(ticker: string, q: ChartQuery, revalidateSec?: number, deadline?: number) {
  const symbol = usSymbol(ticker, "-");
  if (!symbol) throw new ProviderNoData(`${ticker} isn't available from Tiingo`);
  const w = queryWindow(q);
  const startDate = isoDay(w.start);
  const endDate = w.end != null ? isoDay(w.end) : undefined;
  let bars: RawBar[];
  let adjclose: number[] | undefined;
  if (DAILY[q.interval]) {
    const qs = new URLSearchParams({ startDate, resampleFreq: DAILY[q.interval] });
    if (endDate) qs.set("endDate", endDate);
    const rows: any[] = (await get(`/tiingo/daily/${encodeURIComponent(symbol)}/prices?${qs}`, revalidateSec, deadline)) ?? [];
    bars = rows.map((r) => ({ t: dayStamp(String(r.date)), o: num(r.open)!, h: num(r.high)!, l: num(r.low)!, c: num(r.close)!, v: num(r.volume) ?? 0 }));
    adjclose = rows.map((r, i) => num(r.adjClose) ?? bars[i].c);
  } else if (INTRADAY[q.interval]) {
    const qs = new URLSearchParams({ startDate, resampleFreq: INTRADAY[q.interval], columns: "open,high,low,close,volume" });
    if (endDate) qs.set("endDate", endDate);
    const rows: any[] = (await get(`/iex/${encodeURIComponent(symbol)}/prices?${qs}`, revalidateSec, deadline)) ?? [];
    bars = rows.map((r) => ({ t: Date.parse(String(r.date)), o: num(r.open)!, h: num(r.high)!, l: num(r.low)!, c: num(r.close)!, v: num(r.volume) ?? 0 }));
    if (w.end != null) bars = bars.filter((b) => b.t < w.end!);
  } else {
    throw new ProviderNoData(`Unsupported interval "${q.interval}" for Tiingo`);
  }
  if (!Array.isArray(bars) || bars.length === 0) throw new ProviderNoData(`Tiingo returned no bars for ${ticker}`);
  return toChartBody(ticker, bars, { intraday: w.intraday, sessions: w.sessions, dataSource: "tiingo", adjclose });
}
