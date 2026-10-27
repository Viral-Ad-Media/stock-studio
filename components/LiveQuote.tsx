import type { LiveSnapshot } from "@/lib/shared";
import { dataAge } from "@/lib/data-freshness";

export function signedPct(n: number) {
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}

export function moveClass(n: number | null) {
  return n == null || n === 0 ? "text-slate-300" : n > 0 ? "text-emerald-400" : "text-red-400";
}

// "just now", "5 minutes ago", "2 days ago" for a refresh time.
export function refreshedAge(at: string | Date | null) {
  if (!at) return null;
  const age = dataAge(at instanceof Date ? at.toISOString() : at);
  if (age === "Less than a minute old") return "just now";
  return / old$/.test(age) ? age.replace(/ old$/, " ago") : null;
}

// One-line live quote for dashboard cards and watchlist rows:
// "$123.45  +1.2% today  +15.3% since study  Live · 5 minutes ago".
export default function LiveQuote({
  snapshot,
  refreshedAt,
  sinceLabel = "since study",
}: {
  snapshot: LiveSnapshot | null;
  refreshedAt: string | Date | null;
  sinceLabel?: string;
}) {
  if (!snapshot) return null;
  const age = refreshedAge(refreshedAt);
  return (
    <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm tabular-nums">
      <span className="font-mono font-semibold text-slate-100">${snapshot.price.toFixed(2)}</span>
      {snapshot.dayChangePct != null && (
        <span className={moveClass(snapshot.dayChangePct)}>{signedPct(snapshot.dayChangePct)} today</span>
      )}
      {snapshot.since && (
        <span className={moveClass(snapshot.since.changePct)}>
          {signedPct(snapshot.since.changePct)} {sinceLabel}
        </span>
      )}
      {age && <span className="text-xs text-fg-subtle">Live · {age}</span>}
    </p>
  );
}
