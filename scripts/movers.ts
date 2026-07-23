/**
 * Market movers fetcher for the morning movers digest.
 *
 *   npm run movers -- [--count 5]
 *
 * Pulls Yahoo Finance's predefined "day gainers" and "day losers" screeners
 * (US equities, no API key) and prints JSON with symbol, name, price, % move,
 * market cap, and volume for each. Run during or after market hours — before
 * the open it reflects the previous session.
 */

export {};

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const count = Math.min(Number(arg("--count") ?? 5), 25);

async function screener(scrId: string) {
  const url = `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=${scrId}&count=${count}&formatted=false`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (stock-studio movers fetcher)" } });
  if (!res.ok) throw new Error(`Yahoo screener ${scrId} returned ${res.status}`);
  const body: any = await res.json();
  const quotes = body?.finance?.result?.[0]?.quotes ?? [];
  return quotes.map((q: any) => ({
    symbol: q.symbol,
    name: q.shortName ?? q.longName ?? q.symbol,
    price: q.regularMarketPrice ?? null,
    change_pct: q.regularMarketChangePercent != null ? +q.regularMarketChangePercent.toFixed(2) : null,
    market_cap: q.marketCap ?? null,
    volume: q.regularMarketVolume ?? null,
    exchange: q.fullExchangeName ?? null,
  }));
}

async function main() {
  const [gainers, losers] = await Promise.all([screener("day_gainers"), screener("day_losers")]);
  if (gainers.length === 0 && losers.length === 0) {
    console.error("Yahoo screeners returned no quotes — try again later or fall back to web research.");
    process.exit(1);
  }
  console.log(
    JSON.stringify(
      {
        as_of: new Date().toISOString(),
        note: "Yahoo Finance predefined screeners (US equities). Percent moves are for the current/most recent regular session.",
        gainers,
        losers,
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
