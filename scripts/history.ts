/**
 * CLI wrapper for lib/marketdata.ts's fetchHistory — kept for manual
 * debugging. The automated worker calls fetchHistory directly.
 *
 *   npm run history -- <TICKER> [--interval 1m|5m|15m|30m|60m|1d|1wk] [--range 1d|5d|1mo|3mo|6mo|1y|2y|5y]
 */
import { fetchHistory } from "../lib/marketdata";

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

fetchHistory(ticker, arg("--interval") ?? "5m", arg("--range") ?? "5d")
  .then((data) => console.log(JSON.stringify(data, null, 2)))
  .catch((e) => {
    console.error(String(e.message ?? e));
    process.exit(1);
  });
