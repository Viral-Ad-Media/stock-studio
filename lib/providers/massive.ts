// Massive (formerly Polygon.io): stock aggregates, top movers and options
// chain snapshots. Key: MASSIVE_API_KEY (POLYGON_API_KEY is accepted too).
// Host override: MASSIVE_API_HOST (default https://api.massive.com).

import { assertTimeLeft } from "../deadline";
import {
  type ChainWindow, type ChartQuery, type CboeLikeChain, type CboeOption, type RawBar,
  ProviderNoData, getJson, isoDay, num, queryWindow, toChartBody, usSymbol,
} from "./common";

const key = () => process.env.MASSIVE_API_KEY || process.env.POLYGON_API_KEY || "";
const host = () => (process.env.MASSIVE_API_HOST || "https://api.massive.com").replace(/\/+$/, "");

export function massiveConfigured(): boolean {
  return Boolean(key());
}

// The key goes in a header, never the URL, so it can't leak into logs.
function get(url: string, revalidateSec?: number, deadline?: number) {
  return getJson("Massive", url, { Authorization: `Bearer ${key()}` }, revalidateSec, deadline);
}

// next_url must stay on the Massive host (it carries our auth header).
function sameHost(next: unknown): string | null {
  if (typeof next !== "string") return null;
  try {
    return new URL(next).origin === new URL(host()).origin ? next : null;
  } catch {
    return null;
  }
}

const SPANS: Record<string, [number, string]> = {
  "1m": [1, "minute"], "2m": [2, "minute"], "5m": [5, "minute"], "15m": [15, "minute"], "30m": [30, "minute"],
  "60m": [1, "hour"], "1h": [1, "hour"], "1d": [1, "day"], "1wk": [1, "week"], "1mo": [1, "month"],
};

export async function massiveChart(ticker: string, q: ChartQuery, revalidateSec?: number, deadline?: number) {
  const symbol = usSymbol(ticker, ".");
  if (!symbol) throw new ProviderNoData(`${ticker} isn't available from Massive`);
  const span = SPANS[q.interval];
  if (!span) throw new ProviderNoData(`Unsupported interval "${q.interval}" for Massive`);
  const w = queryWindow(q);
  const end = w.end ?? Date.now();
  // adjusted=true is split-adjusted (Yahoo's `close` is too); Massive has no
  // dividend-adjusted series, so adjclose falls back to the same closes.
  let url: string | null =
    `${host()}/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/${span[0]}/${span[1]}/${Math.floor(w.start)}/${Math.floor(end)}?adjusted=true&sort=asc&limit=50000`;
  const bars: RawBar[] = [];
  for (let page = 0; url && page < 10; page++) {
    assertTimeLeft(deadline);
    const body = await get(url, revalidateSec, deadline);
    for (const r of body?.results ?? []) {
      // Massive stamps daily bars at midnight New York; restamp at 13:30 UTC.
      const t = w.intraday ? Number(r.t) : Date.parse(`${isoDay(Number(r.t) + 6 * 3_600_000)}T13:30:00Z`);
      bars.push({ t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v });
    }
    url = sameHost(body?.next_url);
  }
  if (bars.length === 0) throw new ProviderNoData(`Massive returned no bars for ${ticker}`);
  return toChartBody(ticker, bars, { intraday: w.intraday, sessions: w.sessions, dataSource: "massive" });
}

export async function massiveMovers(count: number, revalidateSec?: number, deadline?: number) {
  const side = async (direction: "gainers" | "losers") => {
    const body = await get(`${host()}/v2/snapshot/locale/us/markets/stocks/${direction}`, revalidateSec, deadline);
    return (body?.tickers ?? []).slice(0, count).map((m: any) => {
      const price = num(m?.lastTrade?.p) ?? num(m?.day?.c);
      const pct = num(m?.todaysChangePerc);
      const vol = num(m?.day?.v);
      return {
        symbol: String(m?.ticker ?? ""),
        name: String(m?.ticker ?? ""),
        price: price && price > 0 ? price : null,
        change_pct: pct != null ? +pct.toFixed(2) : null,
        market_cap: null,
        volume: vol && vol > 0 ? vol : null,
        exchange: null,
      };
    }).filter((m: { symbol: string }) => m.symbol);
  };
  const [gainers, losers] = await Promise.all([side("gainers"), side("losers")]);
  return { gainers, losers };
}

async function previousClose(symbol: string, deadline?: number): Promise<number | null> {
  const body = await get(`${host()}/v2/aggs/ticker/${encodeURIComponent(symbol)}/prev?adjusted=true`, undefined, deadline);
  return num(body?.results?.[0]?.c);
}

// Options chain snapshot within a days-to-expiry and strike window, reshaped
// to CBOE's payload. Needs a Massive plan that includes options.
export async function massiveOptionChain(symbol: string, win: ChainWindow, deadline?: number): Promise<CboeLikeChain | null> {
  const underlying = usSymbol(symbol, ".");
  if (!underlying) return null;
  const now = Date.now();
  let spot = await previousClose(underlying, deadline);
  if (!spot || spot <= 0) return null;
  const qs = new URLSearchParams({
    "expiration_date.gte": isoDay(now + win.minDays * 86_400_000),
    "expiration_date.lte": isoDay(now + win.maxDays * 86_400_000),
    "strike_price.gte": String(+(spot * win.strikeLo).toFixed(2)),
    "strike_price.lte": String(+(spot * win.strikeHi).toFixed(2)),
    limit: "250",
  });
  let url: string | null = `${host()}/v3/snapshot/options/${encodeURIComponent(underlying)}?${qs}`;
  const options: CboeOption[] = [];
  let latest = 0;
  for (let page = 0; url && page < 60; page++) {
    assertTimeLeft(deadline);
    const body = await get(url, undefined, deadline);
    for (const r of body?.results ?? []) {
      const occ = String(r?.details?.ticker ?? "").replace(/^O:/, "");
      if (!occ) continue;
      const live = num(r?.underlying_asset?.price);
      if (live && live > 0) spot = live;
      for (const ns of [r?.last_quote?.last_updated, r?.day?.last_updated, r?.underlying_asset?.last_updated]) {
        const ms = num(ns);
        if (ms && ms / 1e6 > latest) latest = ms / 1e6;
      }
      options.push({
        option: occ,
        bid: num(r?.last_quote?.bid),
        ask: num(r?.last_quote?.ask),
        iv: num(r?.implied_volatility),
        delta: num(r?.greeks?.delta),
        gamma: num(r?.greeks?.gamma),
        open_interest: num(r?.open_interest),
        volume: num(r?.day?.volume),
      });
    }
    url = sameHost(body?.next_url);
  }
  if (options.length === 0) return null;
  return {
    timestamp: latest > 0 ? new Date(latest).toISOString() : null,
    source: "Massive options snapshot",
    data: { current_price: spot, options },
  };
}
