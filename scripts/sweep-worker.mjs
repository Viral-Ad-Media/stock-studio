import "dotenv/config";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { scheduledTick } from "../lib/sweep/scheduler.mjs";

const directory = resolve(process.env.SWEEP_DATA_DIR ?? ".sweep-data");
const once = process.argv.includes("--once");
let stopping = false, child;
const controller = new AbortController();
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => {
  stopping = true;
  controller.abort();
  // Give an active child time to release scanner.lock. The service stop timeout
  // must exceed the bounded child runtime; do not terminate it mid-write.
});
function execute(slot) {
  return new Promise((resolveRun, reject) => {
    let output = "";
    const args = [fileURLToPath(new URL("./sweep-scanner.mjs", import.meta.url)), slot.mode];
    if (slot.mode === "--score") args.push(slot.date);
    child = spawn(process.execPath, args, { env: { ...process.env, SWEEP_DATA_DIR: directory }, stdio: ["ignore", "pipe", "pipe"] });
    const append = chunk => { output = (output + chunk.toString()).slice(-64000); };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    // A hung pass is explicitly failed. A killed process can leave a lock;
    // operators must verify termination before clearing it, per the README.
    const timer = setTimeout(() => child?.kill("SIGTERM"), 330000);
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => { clearTimeout(timer); child = undefined; resolveRun({ code: code ?? 1, output }); });
  });
}
do {
  try {
    const result = await scheduledTick(directory, Math.floor(Date.now() / 1000), execute);
    if (!["IDLE", "ALREADY_ATTEMPTED"].includes(result.status)) console.log(JSON.stringify(result));
    if (once && result.status === "FAILED") process.exitCode = 1;
  } catch (error) {
    console.error("SCHEDULER_FAILED: " + error.message);
    if (once) process.exitCode = 1;
  }
  if (!once && !stopping) await delay(15000, undefined, { signal: controller.signal }).catch(() => undefined);
} while (!once && !stopping);
