// Keyed market-data providers that back up Yahoo (stock bars, movers) and
// CBOE (options chains). Each one is used only when its API key is set, in
// the order given by MARKET_DATA_PROVIDERS (comma-separated; default below).
// A provider that rate-limits or errors is skipped for a cooldown so a scan
// over many tickers doesn't spend its time budget on doomed requests.

import { alpacaChart, alpacaConfigured, alpacaMovers } from "../alpaca";
import { type ChainWindow, type ChartQuery, type CboeLikeChain, ProviderNoData, ProviderUnavailable } from "./common";
import { finnhubChart, finnhubConfigured, finnhubOptionChain } from "./finnhub";
import { massiveChart, massiveConfigured, massiveMovers, massiveOptionChain } from "./massive";
import { tiingoChart, tiingoConfigured } from "./tiingo";
import { twelveDataChart, twelveDataConfigured } from "./twelvedata";

export { ProviderNoData, ProviderUnavailable };
export type { ChainWindow, ChartQuery, CboeLikeChain };

export type ProviderId = "massive" | "finnhub" | "twelvedata" | "tiingo" | "alpaca";

type Mover = { symbol: string; name: string; price: number | null; change_pct: number | null; market_cap: number | null; volume: number | null; exchange: string | null };

type Provider = {
  id: ProviderId;
  label: string;
  configured: () => boolean;
  chart?: (ticker: string, q: ChartQuery, revalidateSec?: number, deadline?: number) => Promise<any>;
  movers?: (count: number, revalidateSec?: number, deadline?: number) => Promise<{ gainers: Mover[]; losers: Mover[] }>;
  optionChain?: (symbol: string, win: ChainWindow, deadline?: number) => Promise<CboeLikeChain | null>;
};

const PROVIDERS: Record<ProviderId, Provider> = {
  massive: { id: "massive", label: "Massive", configured: massiveConfigured, chart: massiveChart, movers: massiveMovers, optionChain: massiveOptionChain },
  tiingo: { id: "tiingo", label: "Tiingo", configured: tiingoConfigured, chart: tiingoChart },
  twelvedata: { id: "twelvedata", label: "Twelve Data", configured: twelveDataConfigured, chart: twelveDataChart },
  finnhub: { id: "finnhub", label: "Finnhub", configured: finnhubConfigured, chart: finnhubChart, optionChain: finnhubOptionChain },
  alpaca: { id: "alpaca", label: "Alpaca (IEX)", configured: alpacaConfigured, chart: alpacaChart, movers: alpacaMovers },
};

const DEFAULT_ORDER: ProviderId[] = ["massive", "tiingo", "twelvedata", "finnhub", "alpaca"];

export function providerOrder(): ProviderId[] {
  const raw = (process.env.MARKET_DATA_PROVIDERS ?? "").toLowerCase().split(",").map((s) => s.trim().replace(/[\s_-]/g, ""));
  const picked = raw.map((s) => (s === "polygon" ? "massive" : s)).filter((s): s is ProviderId => s in PROVIDERS);
  return picked.length ? [...new Set(picked)] : DEFAULT_ORDER;
}

const COOLDOWN_MS = 10 * 60_000;
const cooldownUntil = new Map<ProviderId, number>();
export function resetProviderCooldowns() {
  cooldownUntil.clear();
}

function ready(p: Provider): boolean {
  return p.configured() && (cooldownUntil.get(p.id) ?? 0) <= Date.now();
}

function candidates(kind: "chart" | "movers" | "optionChain"): Provider[] {
  return providerOrder().map((id) => PROVIDERS[id]).filter((p) => p[kind] && ready(p));
}

// True when at least one keyed provider could serve this kind of request.
export function hasFallback(kind: "chart" | "movers" | "optionChain" = "chart"): boolean {
  return candidates(kind).length > 0;
}

async function firstThatWorks<T>(kind: "chart" | "movers" | "optionChain", call: (p: Provider) => Promise<T | null>, deadline?: number): Promise<{ value: T; provider: Provider } | null> {
  let lastError: unknown = null;
  for (const p of candidates(kind)) {
    if (deadline != null && deadline <= Date.now()) break;
    try {
      const value = await call(p);
      if (value != null) return { value, provider: p };
    } catch (err) {
      lastError = err;
      if (err instanceof ProviderUnavailable) cooldownUntil.set(p.id, Date.now() + COOLDOWN_MS);
      else if (!(err instanceof ProviderNoData)) {
        // Deadline and unexpected errors stop the chain rather than spending
        // the remaining budget on more providers.
        if (deadline != null && deadline <= Date.now()) throw err;
      }
    }
  }
  if (lastError) throw lastError;
  return null;
}

// Yahoo-shaped chart body from the first provider that answers.
export async function fallbackChart(ticker: string, q: ChartQuery, revalidateSec?: number, deadline?: number) {
  const hit = await firstThatWorks("chart", (p) => p.chart!(ticker, q, revalidateSec, deadline), deadline);
  if (!hit) throw new ProviderNoData(`No market data provider returned bars for ${ticker}`);
  return hit.value;
}

export async function fallbackMovers(count: number, revalidateSec?: number, deadline?: number) {
  const hit = await firstThatWorks("movers", (p) => p.movers!(count, revalidateSec, deadline), deadline);
  if (!hit) throw new ProviderNoData("No market data provider returned movers");
  return { ...hit.value, source: `${hit.provider.label} market movers` };
}

// CBOE-shaped options chain from the first keyed provider that has one, or
// null when none is configured or none has listed options for the symbol.
export async function fallbackOptionChain(symbol: string, win: ChainWindow, deadline?: number): Promise<CboeLikeChain | null> {
  const hit = await firstThatWorks("optionChain", (p) => p.optionChain!(symbol, win, deadline), deadline);
  return hit?.value ?? null;
}

// Human label for a chart body's meta.dataSource, as stored in DailyBars.source.
import type { MarketSource } from "../shared";
export type { MarketSource };
export function sourceFromMeta(dataSource: unknown): MarketSource {
  if (dataSource === "alpaca-iex") return "alpaca";
  return typeof dataSource === "string" && dataSource in PROVIDERS ? (dataSource as ProviderId) : "yahoo";
}
