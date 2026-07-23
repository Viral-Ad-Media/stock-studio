/**
 * Intraday candle fetcher for one-candle setup analysis.
 *
 *   npm run candles -- <TICKER> [--date YYYY-MM-DD]
 *
 * Pulls 1-minute OHLC from Yahoo Finance's public chart API, identifies the
 * first five-minute candle of the regular session (9:30–9:35 ET for US
 * equities — derived from the exchange's own session start, not hardcoded),
 * and prints JSON: the 5-minute opening candle plus the 1-minute series for
 * the first ~2 hours. 1-minute history is only available for roughly the
 * last 30 days.
 */

export {};

type Candle = { t: string; o: number; h: number; l: number; c: number; v: number };

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const ticker = process.argv[2]?.toUpperCase();
if (!ticker || ticker.startsWith("--")) {
  console.error("Usage: npm run candles -- <TICKER> [--date YYYY-MM-DD]");
  process.exit(1);
}

const date = arg("--date"); // defaults to the most recent session

async function main() {
  let url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    ticker!
  )}?interval=1m&includePrePost=false`;
  if (date) {
    const start = Math.floor(new Date(`${date}T00:00:00-05:00`).getTime() / 1000);
    url += `&period1=${start}&period2=${start + 86400}`;
  } else {
    url += `&range=1d`;
  }

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (stock-studio candle fetcher)" },
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
  const regularStart: number =
    meta.currentTradingPeriod?.regular?.start ?? meta.regularTradingPeriodStartTime;

  const ts: number[] = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0] ?? {};
  const fmt = (unix: number) =>
    new Date(unix * 1000).toLocaleString("en-US", {
      timeZone: tz,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  const candles: (Candle & { unix: number })[] = [];
  for (let i = 0; i < ts.length; i++) {
    if (q.open?.[i] == null) continue;
    candles.push({
      unix: ts[i],
      t: fmt(ts[i]),
      o: +q.open[i].toFixed(4),
      h: +q.high[i].toFixed(4),
      l: +q.low[i].toFixed(4),
      c: +q.close[i].toFixed(4),
      v: q.volume?.[i] ?? 0,
    });
  }
  if (candles.length === 0) {
    console.error(`No 1-minute candles returned for ${ticker} (market not open yet, or date out of 1m-history range)`);
    process.exit(1);
  }

  // First five minutes of the regular session. Yahoo's regular.start metadata
  // describes the CURRENT trading day, so for historical --date requests fall
  // back to the first returned candle (pre/post market is excluded, so the
  // series starts at the session open).
  let sessionStart = regularStart ?? candles[0].unix;
  if (!candles.some((c) => c.unix >= sessionStart && c.unix < sessionStart + 300)) {
    sessionStart = candles[0].unix;
  }
  const firstFive = candles.filter((c) => c.unix >= sessionStart && c.unix < sessionStart + 300);
  if (firstFive.length === 0) {
    console.error(`No candles found in the first five minutes of the regular session for ${ticker}`);
    process.exit(1);
  }
  const opening = {
    start: fmt(sessionStart),
    end: fmt(sessionStart + 300),
    open: firstFive[0].o,
    high: Math.max(...firstFive.map((c) => c.h)),
    low: Math.min(...firstFive.map((c) => c.l)),
    close: firstFive[firstFive.length - 1].c,
    volume: firstFive.reduce((s, c) => s + c.v, 0),
  };

  // 1-minute series for the first two hours of the session (enough for
  // break → FVG → retest → engulfing analysis) — strip the unix field.
  const series = candles
    .filter((c) => c.unix >= sessionStart && c.unix < sessionStart + 2 * 3600)
    .map(({ unix, ...rest }) => rest);

  console.log(
    JSON.stringify(
      {
        ticker,
        exchange_timezone: tz,
        session_date: fmt(sessionStart).slice(0, 10),
        note: "Times are exchange-local. The regular session start comes from the exchange metadata (9:30 ET for US equities).",
        first_five_minute_candle: opening,
        one_minute_candles: series,
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
