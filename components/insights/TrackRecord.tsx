import { LineChart } from "lucide-react";
import { trackRecordSince } from "@/lib/market-context";
import { formatDate } from "@/lib/shared";

function signed(n: number) {
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}

// "How has this played out?" — the ticker's move (and SPY's) since the study's
// as-of date. Async; render inside <Suspense>. Renders nothing when the data
// isn't there, rather than a guess.
export default async function TrackRecord({ ticker, asOfDate }: { ticker: string; asOfDate: string }) {
  const asOf = new Date(asOfDate);
  if (Number.isNaN(asOf.getTime())) return null;
  let r: Awaited<ReturnType<typeof trackRecordSince>> = null;
  try {
    r = await trackRecordSince(ticker, asOf);
  } catch {
    return null;
  }
  if (!r) return null;
  const vs = r.spyChange != null ? Math.round((r.tickerChange - r.spyChange) * 10) / 10 : null;
  const d = (s: string) => formatDate(new Date(`${s}T12:00:00Z`));

  return (
    <section aria-labelledby="track-heading" className="card mb-4 p-4">
      <h2 id="track-heading" className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-100">
        <LineChart className="h-4 w-4 text-emerald-400" aria-hidden /> Since this study
      </h2>
      <p className="text-sm text-slate-300">
        <span className="font-mono">{ticker}</span> went from ${r.tickerStart.toFixed(2)} ({d(r.from)}) to $
        {r.tickerEnd.toFixed(2)} ({d(r.to)}): <strong className="tabular-nums text-slate-100">{signed(r.tickerChange)}</strong>
        {r.spyChange != null && (
          <>
            , versus <span className="tabular-nums">{signed(r.spyChange)}</span> for SPY
            {vs != null && <> ({vs >= 0 ? "ahead of" : "behind"} the index by {Math.abs(vs).toFixed(1)} pts)</>}
          </>
        )}
        .
      </p>
      <p className="mt-1 text-xs text-fg-subtle">
        Adjusted daily closes from Yahoo Finance. Price movement over a short window says little about whether the study's
        business analysis was right — use it to decide what to re-check, not as a scorecard.
      </p>
    </section>
  );
}
