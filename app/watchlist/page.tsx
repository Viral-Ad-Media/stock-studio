import { sql, WatchlistRow } from "@/lib/db";
import AutoRefresh from "@/components/AutoRefresh";
import WatchlistClient from "@/components/WatchlistClient";

export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  const rows = (await sql`
    SELECT * FROM watchlist ORDER BY updated_at DESC
  `) as unknown as WatchlistRow[];

  return (
    <div>
      <AutoRefresh />
      <h1 className="text-2xl font-bold text-slate-100 mb-1">Watchlist</h1>
      <p className="text-sm text-slate-500 mb-6">
        Compact tracker entries — thesis, triggers to watch, and a status tag. The engine fills and
        refreshes them.
      </p>
      <WatchlistClient rows={rows} />
    </div>
  );
}
