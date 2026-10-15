import { cboeSymbol, parseOcc } from "./gex";
import { sourceTimestamp } from "./data-freshness";
import { validDate } from "./journal";
export type ChainOption = {
  symbol: string;
  type: "call" | "put";
  strike: number;
  expiration: string;
  days: number;
  bid: number | null;
  ask: number | null;
  iv: number | null;
  volume: number | null;
  openInterest: number | null;
  delta?: number | null;
};
export type LeapsChain = {
  symbol: string;
  spot: number;
  sourceAt: string | null;
  fetchedAt: string;
  options: ChainOption[];
  totalMatches: number;
};
const nullableNumber = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
export function parseLeapsChain(
  symbol: string,
  body: unknown,
  now = Date.now(),
): LeapsChain | null {
  const root = body as { timestamp?: unknown; data?: Record<string, any> };
  const d = root?.data;
  if (!d) return null;
  const quote = d.quote ?? d,
    spot = nullableNumber(quote.current_price);
  if (!spot || !Array.isArray(d.options)) return null;
  const today = new Date(now).toISOString().slice(0, 10);
  const options: ChainOption[] = [];
  for (const o of d.options) {
    const parsed = parseOcc(o?.option);
    if (!parsed || !validDate(parsed.expiration) || parsed.root !== symbol)
      continue;
    const days = (Date.parse(parsed.expiration) - Date.parse(today)) / 86400000;
    if (
      days < 365 ||
      days > 1460 ||
      parsed.strike / spot < 0.5 ||
      parsed.strike / spot > 1.5
    )
      continue;
    const bid = nullableNumber(o.bid),
      ask = nullableNumber(o.ask);
    options.push({
      symbol: o.option,
      type: parsed.type,
      strike: parsed.strike,
      expiration: parsed.expiration,
      days,
      delta:
        typeof o.delta === "number" &&
        Number.isFinite(o.delta) &&
        Math.abs(o.delta) <= 1
          ? o.delta
          : null,
      bid,
      ask: ask != null && bid != null && ask < bid ? null : ask,
      iv: typeof o.iv === "number" && o.iv > 0 && o.iv <= 5 ? o.iv * 100 : null,
      volume: nullableNumber(o.volume),
      openInterest: nullableNumber(o.open_interest),
    });
  }
  // Preserve expiration coverage rather than filling the whole response with
  // strikes from the earliest expiry. Sampling is disclosed, not a ranking.
  const groups = new Map<string, ChainOption[]>();
  for (const option of options) {
    const key = `${option.expiration}:${option.type}`;
    const group = groups.get(key) ?? [];
    group.push(option);
    groups.set(key, group);
  }
  const perGroup = Math.max(1, Math.floor(500 / (groups.size || 1)));
  const sampled = [...groups.values()].flatMap((group) =>
    group
      .sort(
        (a, b) =>
          Math.abs(a.strike - spot) - Math.abs(b.strike - spot) ||
          a.strike - b.strike,
      )
      .slice(0, perGroup),
  );
  sampled.sort(
    (a, b) =>
      a.expiration.localeCompare(b.expiration) ||
      a.strike - b.strike ||
      a.type.localeCompare(b.type),
  );
  return {
    symbol,
    spot,
    sourceAt:
      sourceTimestamp(root.timestamp) ??
      sourceTimestamp(d.timestamp) ??
      sourceTimestamp(quote.timestamp),
    fetchedAt: new Date(now).toISOString(),
    options: sampled.slice(0, 500),
    totalMatches: options.length,
  };
}
const cache = new Map<string, { at: number; value: LeapsChain }>();
const pending = new Map<string, Promise<LeapsChain | null>>();
export async function getLeapsChain(
  symbol: string,
): Promise<LeapsChain | null> {
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < 600000) return hit.value;
  if (pending.has(symbol)) return pending.get(symbol)!;
  const promise = (async () => {
    const res = await fetch(
      `https://cdn.cboe.com/api/global/delayed_quotes/options/${encodeURIComponent(cboeSymbol(symbol))}.json`,
      {
        cache: "no-store",
        signal: AbortSignal.timeout(20000),
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (stock-studio leaps research)",
        },
      },
    );
    if (res.status === 403 || res.status === 404) return null;
    if (!res.ok) throw new Error("Options feed unavailable");
    const reader = res.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 25000000) {
        await reader.cancel();
        throw new Error("Options feed too large");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let pos = 0;
    for (const c of chunks) {
      bytes.set(c, pos);
      pos += c.length;
    }
    const value = parseLeapsChain(
      symbol,
      JSON.parse(new TextDecoder().decode(bytes)),
    );
    if (value) {
      cache.set(symbol, { at: Date.now(), value });
      if (cache.size > 50) cache.delete(cache.keys().next().value!);
    }
    return value;
  })();
  pending.set(symbol, promise);
  try {
    return await promise;
  } finally {
    pending.delete(symbol);
  }
}
