import { readFile, writeFile } from "node:fs/promises";
import { buildUniverse } from "../lib/sweep/universe.mjs";
const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("Usage: node scripts/sweep-universe.mjs <ranked-source.json> <scan_universe.json>");
  process.exitCode = 1;
} else {
  try {
    const source = JSON.parse(await readFile(input, "utf8"));
    const result = buildUniverse(source);
    // Never silently replace an existing quarterly universe.
    await writeFile(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log("Created " + result.tickers.length + " ranked symbols at " + output);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
