/**
 * CLI wrapper for lib/marketdata.ts's fetchMovers — kept for manual
 * debugging. The automated worker calls fetchMovers directly.
 *
 *   npm run movers -- [--count 5]
 */
import { fetchMovers } from "../lib/marketdata";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}

fetchMovers(Math.min(Number(arg("--count") ?? 5), 25))
  .then((data) => console.log(JSON.stringify(data, null, 2)))
  .catch((e) => {
    console.error(String(e.message ?? e));
    process.exit(1);
  });
