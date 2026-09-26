import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { earningsForTickers, marketDateET, daysBetween, sessionLabel } from "@/lib/earnings";
import { formatDate } from "@/lib/shared";

type Props = {
  tickers: string[];
  // Ticker → a ready study for it, so "just reported" rows can point at the
  // study page (where the earnings update is queued).
  studyByTicker?: Record<string, number>;
};

function day(date: string) {
  return formatDate(new Date(`${date}T12:00:00Z`));
}

// Async server component — render it inside <Suspense> so a slow calendar
// never holds up the page.
export default async function EarningsPanel({ tickers, studyByTicker = {} }: Props) {
  const unique = [...new Set(tickers.map((t) => t.toUpperCase()).filter((t) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(t)))];
  if (unique.length === 0) return null;

  let map: Awaited<ReturnType<typeof earningsForTickers>>;
  try {
    map = await earningsForTickers(unique);
  } catch {
    return <EarningsShell>{<p className="text-sm text-fg-subtle">The earnings calendar is unavailable right now.</p>}</EarningsShell>;
  }

  const today = marketDateET();
  const upcoming = unique
    .map((t) => ({ t, e: map.get(t)?.next }))
    .filter((x): x is { t: string; e: NonNullable<typeof x.e> } => !!x.e)
    .sort((a, b) => a.e.date.localeCompare(b.e.date));
  const reported = unique
    .map((t) => ({ t, e: map.get(t)?.last }))
    .filter((x): x is { t: string; e: NonNullable<typeof x.e> } => !!x.e);

  if (upcoming.length === 0 && reported.length === 0) {
    return (
      <EarningsShell>
        <p className="text-sm text-fg-subtle">No reports scheduled in the next 30 days for your tickers.</p>
      </EarningsShell>
    );
  }

  return (
    <EarningsShell>
      {reported.length > 0 && (
        <ul className="mb-3 space-y-1.5">
          {reported.map(({ t, e }) => (
            <li key={`r-${t}`} className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-mono font-bold text-slate-100">{t}</span>
              <span className="text-slate-300">reported {day(e.date)}</span>
              {studyByTicker[t] && (
                <Link href={`/study/${studyByTicker[t]}`} className="text-emerald-400 underline underline-offset-2 hover:text-emerald-300">
                  Update the study
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
      {upcoming.length > 0 && (
        <ul className="space-y-1.5">
          {upcoming.map(({ t, e }) => {
            const inDays = daysBetween(today, e.date);
            return (
              <li key={`u-${t}`} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="font-mono font-bold text-slate-100">{t}</span>
                <span className="text-slate-300">
                  {day(e.date)} · {sessionLabel(e.session)}
                </span>
                <span className="text-xs text-fg-subtle">
                  {inDays === 0 ? "today" : inDays === 1 ? "tomorrow" : `in ${inDays} days`}
                  {e.epsForecast != null && ` · consensus EPS ${e.epsForecast < 0 ? "-" : ""}$${Math.abs(e.epsForecast).toFixed(2)}`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-xs text-fg-subtle">
        Source: Nasdaq earnings calendar. A report date means volatility is likely, not which direction.
      </p>
    </EarningsShell>
  );
}

function EarningsShell({ children }: { children: React.ReactNode }) {
  return (
    <section aria-labelledby="earnings-heading" className="card mb-6 p-4">
      <h2 id="earnings-heading" className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-100">
        <CalendarClock className="h-4 w-4 text-emerald-400" aria-hidden /> Earnings calendar
      </h2>
      {children}
    </section>
  );
}

export function EarningsPanelSkeleton() {
  return (
    <EarningsShell>
      <p className="text-sm text-fg-subtle" role="status">
        Loading upcoming reports…
      </p>
    </EarningsShell>
  );
}
