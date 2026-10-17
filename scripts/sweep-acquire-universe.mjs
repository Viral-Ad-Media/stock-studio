import "dotenv/config";
import { resolve } from "node:path";
import { acquireUniverse } from "../lib/sweep/universe-acquisition.mjs";
import { readJSON, withLock } from "../lib/sweep/storage.mjs";
import { marketDate } from "../lib/sweep/calendar.mjs";
import { sanitizeProxyEnvironment } from "../lib/sweep/yahoo.mjs";

const [catalogFile, outputDir] = process.argv.slice(2);
try {
  if (!catalogFile || !outputDir) throw new Error("Usage: sweep-acquire-universe <complete-gics-catalog.json> <output-directory>");
  sanitizeProxyEnvironment(process.env);
  const directory = resolve(outputDir);
  const result = await withLock(directory, async () => acquireUniverse(await readJSON(catalogFile), directory, marketDate(Date.now() / 1000)));
  console.log(JSON.stringify(result.report ?? result, null, 2));
  if (result.report?.status === "INCOMPLETE") process.exitCode = 2;
} catch (error) {
  console.error("UNIVERSE_FAILED: " + error.message);
  process.exitCode = 1;
}
