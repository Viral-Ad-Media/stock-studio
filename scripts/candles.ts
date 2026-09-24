/**
 * CLI wrapper for lib/marketdata.ts's fetchOpeningCandle — kept for manual
 * debugging. The automated worker calls fetchOpeningCandle directly.
 *
 *   npm run candles -- <TICKER> [--date YYYY-MM-DD]
 */
import { fetchOpeningCandle } from "../lib/marketdata";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const ticker = process.argv[2]?.toUpperCase();
if (!ticker || ticker.startsWith("--")) {
  console.error("Usage: npm run candles -- <TICKER> [--date YYYY-MM-DD]");
  process.exit(1);
}

fetchOpeningCandle(ticker, arg("--date"))
  .then((data) => console.log(JSON.stringify(data, null, 2)))
  .catch((e) => {
    console.error(String(e.message ?? e));
    process.exit(1);
  });
