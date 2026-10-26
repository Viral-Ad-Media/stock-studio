import { Activity } from "lucide-react";
import type { LiveSnapshot } from "@/lib/shared";
import { LIVE_STALE_MS } from "@/lib/live-data";
import { formatDate } from "@/lib/shared";
import { timestampET } from "@/lib/data-freshness";
import LiveRefreshButton from "@/components/LiveRefreshButton";
import { moveClass, refreshedAge, signedPct } from "@/components/LiveQuote";

const day = (s: string) => formatDate(new Date(`${s}T12:00:00Z`));

// Live market data for a finished study, kept apart from the fact-checked
// text: price now, today's move, the 52-week range and the move since the
// as-of date (versus SPY). Pulls a fresh quote on view once the stored one
// is stale, and has a manual refresh. Free: no credits, no research run.
export default function LivePanel({
  studyId,
  asOfDate,
  snapshot,
  refreshedAt,
}: {
  studyId: number;
  asOfDate: string | null;
  snapshot: LiveSnapshot | null;
  refreshedAt: Date | string | null;
}) {
  const at = refreshedAt ? new Date(refreshedAt).getTime() : NaN;
  const stale = !snapshot || !Number.isFinite(at) || Date.now() - at > LIVE_STALE_MS;
  const age = refreshedAge(refreshedAt);
  const s = snapshot;
  const vs = s?.since && s.since.spyChangePct != null ? Math.round((s.since.changePct - s.since.spyChangePct) * 10) / 10 : null;
  const rangePos =
    s && s.high52w != null && s.low52w != null && s.high52w > s.low52w
      ? Math.min(100, Math.max(0, ((s.price - s.low52w) / (s.high52w - s.low52w)) * 100))
      : null;

  return (
    <section aria-labelledby="live-heading" className="card mb-4 p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="live-heading" className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <Activity className="h-4 w-4 text-emerald-400" aria-hidden /> Live market data
          </h2>
          <p className="mt-0.5 text-xs text-fg-subtle">
            {age ? `Refreshed ${age}` : "Not refreshed yet"}
            {s?.marketTime && <> · price as of {timestampET(s.marketTime)}</>}
          </p>
        </div>
        <LiveRefreshButton scope="study" id={studyId} auto={stale} compact />
      </div>

      {s ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-fg-subtle">Price</dt>
            <dd className="font-mono text-lg font-semibold tabular-nums text-slate-100">${s.price.toFixed(2)}</dd>
          </div>
          <div>
            <dt className="text-xs text-fg-subtle">Today</dt>
            <dd className={`text-lg font-semibold tabular-nums ${moveClass(s.dayChangePct)}`}>
              {s.dayChangePct != null ? signedPct(s.dayChangePct) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-fg-subtle">Since {s.since ? day(s.since.from) : "study"}</dt>
            <dd className={`text-lg font-semibold tabular-nums ${moveClass(s.since?.changePct ?? null)}`}>
              {s.since ? signedPct(s.since.changePct) : "—"}
            </dd>
            {s.since?.spyChangePct != null && (
              <dd className="text-xs text-fg-subtle tabular-nums">
                SPY {signedPct(s.since.spyChangePct)}
                {vs != null && <> · {vs >= 0 ? "ahead" : "behind"} by {Math.abs(vs).toFixed(1)} pts</>}
              </dd>
            )}
          </div>
          <div>
            <dt className="text-xs text-fg-subtle">52-week range</dt>
            {s.low52w != null && s.high52w != null ? (
              <dd className="tabular-nums text-slate-300">
                <span className="text-xs">
                  ${s.low52w.toFixed(2)} – ${s.high52w.toFixed(2)}
                </span>
                {rangePos != null && (
                  <span className="mt-1.5 block h-1.5 rounded-full bg-ink-700" aria-hidden>
                    <span className="relative block h-1.5" style={{ width: `${rangePos}%` }}>
                      <span className="absolute -right-1 -top-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400" />
                    </span>
                  </span>
                )}
              </dd>
            ) : (
              <dd className="text-slate-300">—</dd>
            )}
          </div>
        </dl>
      ) : (
        <p className="text-sm text-slate-400">Pulling the latest price…</p>
      )}

      <p className="mt-3 text-xs text-fg-subtle">
        {s?.source === "alpaca" ? "Alpaca (IEX)" : "Yahoo Finance"} daily data; moves use adjusted closes. The study below
        stays exactly as it was fact-checked{asOfDate ? ` on ${asOfDate}` : ""}, so its prices and multiples are from that
        date. A short-window price move says little about whether the analysis was right.
      </p>
    </section>
  );
}
