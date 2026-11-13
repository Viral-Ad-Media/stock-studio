export async function register() {
  // Long-running hosts only. Serverless deployments use an external scheduler.
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.STOCKS_HOST_SCHEDULER === "1") {
    const { startHostScheduler } = await import("./lib/host-scheduler");
    startHostScheduler();
  }
}
