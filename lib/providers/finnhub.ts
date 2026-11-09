// Finnhub: stock candles and options chains. Key: FINNHUB_API_KEY.
// Note: Finnhub's free tier covers quotes but not historical candles; candle
// requests on a free key return 403 and the chain moves to the next provider.

import {
  type ChainWindow, type ChartQuery, type CboeLikeChain, type CboeOption, type RawBar,
  ProviderNoData, dayStamp, getJson, isoDay, num, queryWindow, toChartBody, usSymbol,
} from "./common";

const HOST = "https://finnhub.io/api/v1";
const key = () => process.env.FINNHUB_API_KEY || "";

export function finnhubConfigured(): boolean {
  return Boolean(key());
}

function get(path: string, revalidateSec?: number, deadline?: number) {
  return getJson("Finnhub", `${HOST}${path}`, { "X-Finnhub-Token": key() }, revalidateSec, deadline);
}

const RESOLUTIONS: Record<string, string> = {
  "1m": "1", "5m": "5", "15m": "15", "30m": "30", "60m": "60", "1h": "60", "1d": "D", "1wk": "W", "1mo": "M",
};

export async function finnhubChart(ticker: string, q: ChartQuery, revalidateSec?: number, deadline?: number) {
  const symbol = usSymbol(ticker, ".");
  if (!symbol) throw new ProviderNoData(`${ticker} isn't available from Finnhub`);
  const resolution = RESOLUTIONS[q.interval];
  if (!resolution) throw new ProviderNoData(`Unsupported interval "${q.interval}" for Finnhub`);
  const w = queryWindow(q);
  const qs = new URLSearchParams({
    symbol, resolution,
    from: String(Math.floor(w.start / 1000)),
    to: String(Math.floor((w.end ?? Date.now()) / 1000)),
  });
  const body = await get(`/stock/candle?${qs}`, revalidateSec, deadline);
  if (body?.s !== "ok" || !Array.isArray(body?.t)) throw new ProviderNoData(`Finnhub returned no candles for ${ticker}`);
  const bars: RawBar[] = body.t.map((t: number, i: number) => ({
    // Daily candles are stamped at 00:00 UTC; restamp to the session date.
    t: w.intraday ? t * 1000 : dayStamp(isoDay(t * 1000)),
    o: body.o?.[i], h: body.h?.[i], l: body.l?.[i], c: body.c?.[i], v: body.v?.[i],
  }));
  return toChartBody(ticker, bars, { intraday: w.intraday, sessions: w.sessions, dataSource: "finnhub" });
}

// Finnhub reports IV as a percentage on some contracts and a decimal on
// others; normalize to a decimal (CBOE convention).
function ivDecimal(v: unknown): number | null {
  const n = num(v);
  if (n == null || n <= 0) return null;
  return n > 5 ? n / 100 : n;
}

export async function finnhubOptionChain(symbol: string, win: ChainWindow, deadline?: number): Promise<CboeLikeChain | null> {
  const underlying = usSymbol(symbol, ".");
  if (!underlying) return null;
  const body = await get(`/stock/option-chain?symbol=${encodeURIComponent(underlying)}`, undefined, deadline);
  const spot = num(body?.lastTradePrice);
  if (!spot || spot <= 0 || !Array.isArray(body?.data)) return null;
  const now = Date.now();
  const minExp = isoDay(now + win.minDays * 86_400_000);
  const maxExp = isoDay(now + win.maxDays * 86_400_000);
  const options: CboeOption[] = [];
  for (const exp of body.data) {
    const expiration = String(exp?.expirationDate ?? "");
    if (expiration < minExp || expiration > maxExp) continue;
    for (const side of ["CALL", "PUT"] as const) {
      for (const o of exp?.options?.[side] ?? []) {
        const strike = num(o?.strike);
        const occ = String(o?.contractName ?? "");
        if (!occ || !strike || strike < spot * win.strikeLo || strike > spot * win.strikeHi) continue;
        options.push({
          option: occ,
          bid: num(o?.bid),
          ask: num(o?.ask),
          iv: ivDecimal(o?.impliedVolatility),
          delta: num(o?.delta),
          gamma: num(o?.gamma),
          open_interest: num(o?.openInterest),
          volume: num(o?.volume),
        });
      }
    }
  }
  if (options.length === 0) return null;
  // Finnhub only gives the last trade's date, not a time; leave the source
  // time unset rather than invent one.
  return { timestamp: null, source: "Finnhub options chain", data: { current_price: spot, options } };
}
