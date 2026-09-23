/**
 * General-purpose OHLC history fetcher — for setups that need swing
 * structure across many candles (e.g. the Da Vinci liquidity model), where
 * a single opening range isn't enough. For the one-candle strategy's fixed
 * "first 5 minutes" rule, use `npm run candles` instead.
 *
 *   npm run history -- <TICKER> [--interval 1m|2m|5m|15m|30m|60m|1d|1wk] [--range 1d|5d|1mo|3mo|6mo|1y|2y|5y]
 *
 * Pulls OHLC from Yahoo Finance's public chart API at the requested interval
 * and range and prints JSON: the full candle series (exchange-local
 * timestamps) plus session/timezone metadata. Yahoo enforces its own limits
 * on how far back intraday intervals go (roughly: 1m ~7d, other sub-daily
 * intervals ~60d, daily/weekly effectively unlimited) — if the request
 * exceeds what's available, Yahoo silently returns less than asked for, so
 * always check the actual first/last timestamps in the output rather than
 * assuming the requested range was honored.
 */

export {};

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const ticker = process.argv[2]?.toUpperCase();
if (!ticker || ticker.startsWith("--")) {
  console.error(
    "Usage: npm run history -- <TICKER> [--interval 1m|5m|15m|30m|60m|1d|1wk] [--range 1d|5d|1mo|3mo|6mo|1y|2y|5y]"
  );
  process.exit(1);
}

const interval = arg("--interval") ?? "5m";
const range = arg("--range") ?? "5d";

type Candle = { t: string; o: number; h: number; l: number; c: number; v: number };

async function main() {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    ticker!
  )}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}&includePrePost=false`;

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (stock-studio history fetcher)" },
  });
  if (!res.ok) {
    console.error(`Yahoo chart API returned ${res.status} for ${ticker}`);
    process.exit(1);
  }
  const body: any = await res.json();
  const result = body?.chart?.result?.[0];
  if (!result || body?.chart?.error) {
    console.error(`No chart data for ${ticker}: ${JSON.stringify(body?.chart?.error ?? "empty result")}`);
    process.exit(1);
  }

  const meta = result.meta;
  const tz: string = meta.exchangeTimezoneName ?? "America/New_York";
  const isIntraday = /^\d+(m|h)$/.test(interval) || ["1m", "2m", "5m", "15m", "30m", "60m", "90m"].includes(interval);
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
    if (q.open?.[i] == null) continue;
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
    console.error(`No candles returned for ${ticker} at interval=${interval} range=${range}`);
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        ticker,
        interval,
        requested_range: range,
        exchange_timezone: tz,
        candle_count: candles.length,
        first_candle_time: candles[0].t,
        last_candle_time: candles[candles.length - 1].t,
        note: "Times are exchange-local. Yahoo may return fewer candles than requested if the range exceeds what it retains for this interval — check first/last_candle_time, not just the requested range.",
        candles,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
