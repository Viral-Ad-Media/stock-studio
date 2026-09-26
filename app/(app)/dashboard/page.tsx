import { Suspense } from "react";
import Link from "next/link";
import { sql, CaseStudy, VARIANTS, formatDate } from "@/lib/db";
import { currentWorkspaceId } from "@/lib/workspace";
import AutoRefresh from "@/components/AutoRefresh";
import QueuePanel, { QueueJob } from "@/components/QueuePanel";
import StatusBadge from "@/components/StatusBadge";
import GradeBadge from "@/components/insights/GradeBadge";
import EarningsPanel, { EarningsPanelSkeleton } from "@/components/insights/EarningsPanel";
import { parseStoredGrade } from "@/lib/grades";
import { ArrowRight } from "lucide-react";

export const dynamic = "force-dynamic";

function variantLabel(v: string) {
  return VARIANTS.find((x) => x.value === v)?.label ?? v;
}

export default async function Dashboard() {
  const ws = await currentWorkspaceId();

  const pendingJobs = ws
    ? ((await sql`
        SELECT j.id, j.type, j.status, j.created_at,
               COALESCE(cs.ticker, w.ticker) AS ticker,
               cs.variant AS variant
        FROM jobs j
        LEFT JOIN case_studies cs ON cs.id = (j.payload->>'case_study_id')::bigint
        LEFT JOIN watchlist w ON w.id = (j.payload->>'watchlist_id')::bigint
        WHERE j.status IN ('pending','running') AND j.workspace_id = ${ws}
        ORDER BY j.id
      `) as unknown as QueueJob[])
    : [];
  const studies = ws
    ? ((await sql`
        SELECT id, ticker, company, variant, status, as_of_date, created_at, grade_json, summary_line
        FROM case_studies WHERE workspace_id = ${ws} ORDER BY id DESC LIMIT 50
      `) as unknown as CaseStudy[])
    : [];
  const watchTickers = ws
    ? ((await sql`SELECT ticker FROM watchlist WHERE workspace_id = ${ws}`) as unknown as { ticker: string }[]).map((r) => r.ticker)
    : [];

  // Earnings for everything the workspace follows: watchlist + single-ticker
  // studies (not MARKET digests or "AAPL vs MSFT" comparisons). The newest
  // ready study per ticker is where an earnings update gets queued.
  const studyByTicker: Record<string, number> = {};
  for (const s of studies) {
    if (s.status === "ready" && s.variant !== "movers_digest" && !(s.ticker in studyByTicker)) studyByTicker[s.ticker] = s.id;
  }
  const earningsTickers = [...watchTickers, ...Object.keys(studyByTicker)].filter((t) => t !== "MARKET");

  // Only poll while something can still change.
  const inFlight = pendingJobs.length > 0 || studies.some((s) => s.status === "queued" || s.status === "building");

  return (
    <div>
      {inFlight && <AutoRefresh />}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 mb-1">Dashboard</h1>
          <p className="text-sm text-fg-subtle">Fact-checked stock case studies, built by the research engine.</p>
        </div>
        <Link href="/new" className="btn-primary text-sm px-4 py-2">
          New study
        </Link>
      </div>

      <QueuePanel jobs={pendingJobs} />

      {earningsTickers.length > 0 && (
        <Suspense fallback={<EarningsPanelSkeleton />}>
          <EarningsPanel tickers={earningsTickers} studyByTicker={studyByTicker} />
        </Suspense>
      )}

      {studies.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-slate-400 mb-4">No case studies yet.</p>
          <Link
            href="/new"
            className="btn-primary text-sm px-4 py-2"
          >
            Queue your first study <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {studies.map((s) => {
            const grade = parseStoredGrade(s.grade_json);
            return (
              <Link
                key={s.id}
                href={`/study/${s.id}`}
                className="card p-4 hover:border-ink-500 transition-colors block"
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="flex items-center gap-2">
                    {grade && <GradeBadge grade={grade} />}
                    <span className="font-mono font-bold text-slate-100">{s.ticker}</span>
                  </span>
                  <StatusBadge status={s.status} />
                </div>
                <div className="text-sm text-slate-400 truncate">
                  {s.company ?? "—"} · {variantLabel(s.variant)}
                </div>
                {s.summary_line && <p className="mt-2 text-sm text-slate-300 line-clamp-2">{s.summary_line}</p>}
                <div className="text-xs text-fg-subtle mt-2">
                  {s.as_of_date ? `As of ${s.as_of_date}` : `Queued ${formatDate(s.created_at)}`}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
