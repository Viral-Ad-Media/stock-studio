import { sql } from "./db";
import { runWorkerLoop } from "./engine/worker";
import { runSignalRelayOnce } from "./signal-relay-host";

declare global { var __stocksHostScheduler: ReturnType<typeof setInterval> | undefined; }

let running = false;
export async function runHostMaintenance() {
  if (running) return;
  running = true;
  try {
    // A transaction lock stays pinned to one backend with Neon pooling.
    // Overlapping processes/deployments cannot run two maintenance loops.
    await sql.begin(async tx => {
      const [lock] = await tx`SELECT pg_try_advisory_xact_lock(hashtext('stocks.host-maintenance')) AS acquired`;
      if (!lock.acquired) return;
      // Separate opt-in: database migration must not activate paid research.
      if (process.env.STOCKS_ENGINE_ENABLED === "1") await runWorkerLoop();
      const alerts = await tx`SELECT * FROM stocks.ops_alert_sweep()`;
      const webhook = process.env.OPS_ALERT_WEBHOOK_URL;
      if (alerts.length && webhook) {
        const response = await fetch(webhook, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: alerts.map(a => `[${a.kind}] ${a.severity}: ${a.summary}`).join("\n").slice(0, 1900), allowed_mentions: { parse: [] } }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error("Alert delivery failed");
      }
    });
  } catch {
    // Credentials and webhook URLs must never reach application logs.
    console.error("host-scheduler: maintenance failed; check database and alert delivery configuration");
  } finally { running = false; }
}

// The Discord signal relay, when its settings are present. It runs beside
// maintenance rather than inside it: a research run can hold maintenance for
// minutes, and a trade call shouldn't wait for that.
export async function runHostSignalRelay() {
  try {
    await runSignalRelayOnce();
  } catch (error) {
    // Relay errors name the Discord endpoint or the database error, never the bot token or a connection URL.
    console.error("host-scheduler: signal relay pass failed:", error instanceof Error ? error.message : String(error));
  }
}

export function startHostScheduler() {
  if (globalThis.__stocksHostScheduler) return;
  globalThis.__stocksHostScheduler = setInterval(() => { void runHostSignalRelay(); void runHostMaintenance(); }, 60_000);
  globalThis.__stocksHostScheduler.unref();
}
