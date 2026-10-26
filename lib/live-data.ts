// Live market data for finished studies and watchlist rows. A refresh is a
// free, read-only quote pull (Yahoo, Alpaca fallback) stored next to the row
// as live_json — the study's own text, figures and sources are never touched.

import { fetchDailyBars, mapLimit, type DailyBars } from "./marketdata";
import { sql } from "./db";
import type { LiveSnapshot } from "./shared";

export { parseSnapshot, type LiveSnapshot } from "./shared";

// Rows refreshed this recently are skipped, so repeated clicks or a bulk
// refresh right after a single one don't hammer the vendors.
export const LIVE_MIN_INTERVAL_MS = 60_000;
// The study page pulls a new quote on view once the stored one is this old.
export const LIVE_STALE_MS = 30 * 60_000;
// True when any row's live data is missing or older than LIVE_STALE_MS, so the
// page pulls fresh quotes once on view.
export function anyStale(rows: { live_refreshed_at: string | Date | null }[], now = Date.now()): boolean {
  return rows.some((r) => {
    const at = r.live_refreshed_at ? new Date(r.live_refreshed_at).getTime() : NaN;
    return !Number.isFinite(at) || now - at > LIVE_STALE_MS;
  });
}

// A bulk refresh covers at most this many tickers per click.
export const LIVE_BULK_TICKERS = 60;

// Single-company tickers only: not "MARKET" digests or "AAPL vs MSFT".
export function isLiveTicker(ticker: string): boolean {
  return ticker !== "MARKET" && /^[A-Z][A-Z0-9.\-]{0,11}$/.test(ticker);
}

// as_of_date is free text like "July 23, 2026" (or ISO). Read it in local
// time, the same way it was written, and return YYYY-MM-DD.
export function asOfDay(asOfDate: string | null | undefined): string | null {
  if (!asOfDate) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(asOfDate.trim())) return asOfDate.trim();
  const d = new Date(asOfDate);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Yahoo range that covers both the 52-week window and the as-of date.
export function rangeFor(from: string | null, now = Date.now()): string {
  if (!from) return "1y";
  const days = (now - Date.parse(`${from}T12:00:00Z`)) / 86_400_000;
  return days <= 350 ? "1y" : days <= 700 ? "2y" : "5y";
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const pct = (to: number, from: number) => round2(((to - from) / from) * 100);

function sinceDate(b: DailyBars, from: string) {
  const i = b.dates.findIndex((d) => d >= from);
  return i === -1 ? null : i;
}

export function buildSnapshot(bars: DailyBars, spy: DailyBars | null, from: string | null): LiveSnapshot {
  const n = bars.closes.length;
  const price = bars.closes[n - 1];
  const prevClose = n > 1 ? bars.closes[n - 2] : null;
  // Last 52 weeks of highs/lows (~252 sessions).
  const start = Math.max(0, n - 252);
  const highs = bars.highs.slice(start);
  const lows = bars.lows.slice(start);
  let since: LiveSnapshot["since"] = null;
  const i = from ? sinceDate(bars, from) : null;
  if (from && i != null && i < n - 1) {
    const startClose = bars.adjCloses[i];
    let spyChangePct: number | null = null;
    const j = spy ? sinceDate(spy, from) : null;
    if (spy && j != null) spyChangePct = pct(spy.adjCloses.at(-1)!, spy.adjCloses[j]);
    since = { from: bars.dates[i], startClose: round2(startClose), changePct: pct(bars.adjCloses[n - 1], startClose), spyChangePct };
  }
  return {
    price: round2(price),
    prevClose: prevClose != null ? round2(prevClose) : null,
    dayChangePct: prevClose ? pct(price, prevClose) : null,
    high52w: highs.length ? round2(Math.max(...highs)) : null,
    low52w: lows.length ? round2(Math.min(...lows)) : null,
    priceDate: bars.dates[n - 1],
    marketTime: bars.marketTime ?? null,
    source: bars.source ?? "yahoo",
    since,
  };
}

type Target = { table: "case_studies" | "watchlist"; id: number; ticker: string; from: string | null };

export type RefreshResult = { refreshed: number; failed: string[] };

// Pulls one quote series per ticker (sized to the oldest as-of date among its
// rows) plus SPY, then writes each row's snapshot. Never bumps updated_at, so
// list ordering and the watchlist thesis timeline are unaffected.
export async function refreshTargets(ws: string, targets: Target[], deadline = Date.now() + 40_000): Promise<RefreshResult> {
  const byTicker = new Map<string, Target[]>();
  for (const t of targets) if (isLiveTicker(t.ticker)) (byTicker.get(t.ticker) ?? byTicker.set(t.ticker, []).get(t.ticker)!).push(t);
  const tickers = [...byTicker.keys()].slice(0, LIVE_BULK_TICKERS);
  const oldest = (rows: Target[]) => rows.map((r) => r.from).filter((f): f is string => !!f).sort()[0] ?? null;
  const rangeRank = ["1y", "2y", "5y"];
  const spyRange = rangeRank[Math.max(...tickers.map((t) => rangeRank.indexOf(rangeFor(oldest(byTicker.get(t)!)))), 0)];
  const spy = tickers.length ? await fetchDailyBars("SPY", spyRange, 0, deadline).catch(() => null) : null;

  const failed: string[] = [];
  let refreshed = 0;
  await mapLimit(
    tickers,
    4,
    async (ticker) => {
      const rows = byTicker.get(ticker)!;
      let bars: DailyBars;
      try {
        bars = await fetchDailyBars(ticker, rangeFor(oldest(rows)), 0, deadline);
      } catch {
        failed.push(ticker);
        return;
      }
      for (const r of rows) {
        const snap = buildSnapshot(bars, spy, r.from);
        if (r.table === "case_studies") {
          await sql`UPDATE case_studies SET live_json = ${sql.json(snap)}, live_refreshed_at = now() WHERE id = ${r.id} AND workspace_id = ${ws}`;
        } else {
          await sql`UPDATE watchlist SET live_json = ${sql.json(snap)}, live_refreshed_at = now() WHERE id = ${r.id} AND workspace_id = ${ws}`;
        }
        refreshed++;
      }
    },
    deadline,
  ).catch(() => {}); // out of time: keep what was written
  return { refreshed, failed };
}

// Rows in a workspace that a refresh would cover. `scope` narrows it to one
// study, one watchlist row, or everything (ready studies + the watchlist).
export async function liveTargets(
  ws: string,
  scope: { kind: "study" | "watchlist"; id: number } | { kind: "all" },
): Promise<Target[]> {
  const freshCutoff = new Date(Date.now() - LIVE_MIN_INTERVAL_MS);
  const studyId = scope.kind === "study" ? scope.id : null;
  const watchId = scope.kind === "watchlist" ? scope.id : null;
  const studies =
    scope.kind === "watchlist"
      ? []
      : await sql`
          SELECT id, ticker, as_of_date FROM case_studies
          WHERE workspace_id = ${ws} AND status = 'ready' AND variant <> 'movers_digest'
            AND (${studyId}::bigint IS NULL OR id = ${studyId})
            AND (live_refreshed_at IS NULL OR live_refreshed_at < ${freshCutoff})
          ORDER BY id DESC LIMIT 200
        `;
  const watch =
    scope.kind === "study"
      ? []
      : await sql`
          SELECT id, ticker, as_of_date FROM watchlist
          WHERE workspace_id = ${ws}
            AND (${watchId}::bigint IS NULL OR id = ${watchId})
            AND (live_refreshed_at IS NULL OR live_refreshed_at < ${freshCutoff})
          ORDER BY updated_at DESC LIMIT 200
        `;
  return [
    ...studies.map((r) => ({ table: "case_studies" as const, id: Number(r.id), ticker: String(r.ticker), from: asOfDay(r.as_of_date) })),
    ...watch.map((r) => ({ table: "watchlist" as const, id: Number(r.id), ticker: String(r.ticker), from: asOfDay(r.as_of_date) })),
  ].filter((t) => isLiveTicker(t.ticker));
}
