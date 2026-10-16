import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";

export type CaptureRow = { ticker: string; status: "CAPTURED" | "FETCH_FAILED" | "NOT_SCANNED"; reason?: string; lastBar?: number };
export type CaptureReport = { date: string; startedAt: number; finishedAt: number; results: CaptureRow[] };
export async function readSweepCapture(): Promise<{ state: "not-configured" | "waiting" | "unavailable" | "ready"; report: CaptureReport | null }> {
  if (!process.env.SWEEP_DATA_DIR) return { state: "not-configured", report: null };
  try {
    const raw = JSON.parse(await readFile(join(resolve(process.env.SWEEP_DATA_DIR), "latest-pass.json"), "utf8"));
    if (raw.mode !== "CAPTURE_ONLY" || raw.alertsEnabled !== false ||
        !/^\d{4}-\d{2}-\d{2}$/.test(raw.date) ||
        !Number.isFinite(raw.startedAt) || !Number.isFinite(raw.finishedAt) ||
        !Array.isArray(raw.results) || raw.results.length > 1000 ||
        !raw.results.every((r: CaptureRow) => /^[A-Z][A-Z0-9.-]{0,14}$/.test(r.ticker) &&
          ["CAPTURED", "FETCH_FAILED", "NOT_SCANNED"].includes(r.status) &&
          (r.reason === undefined || typeof r.reason === "string"))) throw new Error("Invalid capture report");
    return { state: "ready", report: raw };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { state: "waiting", report: null };
    console.error("Sweep capture report unavailable", error);
    return { state: "unavailable", report: null };
  }
}
