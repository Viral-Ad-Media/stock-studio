import { Suspense } from "react";
import { sql, WatchlistRow } from "@/lib/db";
import { currentWorkspaceId } from "@/lib/workspace";
import AutoRefresh from "@/components/AutoRefresh";
import WatchlistClient, { type ThesisHistoryEntry } from "@/components/WatchlistClient";
import EarningsPanel, { EarningsPanelSkeleton } from "@/components/insights/EarningsPanel";

export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  const ws = await currentWorkspaceId();
  const rows = ws
    ? ((await sql`
        SELECT * FROM watchlist WHERE workspace_id = ${ws} ORDER BY updated_at DESC
      `) as unknown as WatchlistRow[])
    : [];
  // The last few theses per row, newest first (the current one included).
  const history = ws
    ? ((await sql`
        SELECT id, watchlist_id, as_of_date, thesis, thesis_status, thesis_status_note, created_at
        FROM (
          SELECT h.*, row_number() OVER (PARTITION BY watchlist_id ORDER BY id DESC) AS rn
          FROM watchlist_history h WHERE workspace_id = ${ws}
        ) x WHERE rn <= 6 ORDER BY id DESC
      `) as unknown as ThesisHistoryEntry[])
    : [];
  const historyByRow: Record<number, ThesisHistoryEntry[]> = {};
  for (const h of history) (historyByRow[h.watchlist_id] ??= []).push(h);

  const studyByTicker: Record<string, number> = {};
  for (const r of rows) if (r.case_study_id) studyByTicker[r.ticker] = r.case_study_id;

  return (
    <div>
      {rows.some((r) => !r.thesis) && <AutoRefresh />}
      <h1 className="text-2xl font-bold text-slate-100 mb-1">Watchlist</h1>
      <p className="text-sm text-fg-subtle mb-6">
        Compact tracker entries: thesis, triggers to watch, and a status tag. Each refresh re-checks whether the thesis
        still holds and keeps the previous versions as a timeline.
      </p>
      {rows.length > 0 && (
        <Suspense fallback={<EarningsPanelSkeleton />}>
          <EarningsPanel tickers={rows.map((r) => r.ticker)} studyByTicker={studyByTicker} />
        </Suspense>
      )}
      <WatchlistClient rows={rows} history={historyByRow} />
    </div>
  );
}
