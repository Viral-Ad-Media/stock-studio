import Link from "next/link";
import { sql, CaseStudy, VARIANTS } from "@/lib/db";
import AutoRefresh from "@/components/AutoRefresh";
import QueuePanel, { QueueJob } from "@/components/QueuePanel";
import { ArrowRight } from "lucide-react";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  queued: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  building: "bg-sky-500/10 text-sky-400 border-sky-500/30",
  ready: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  error: "bg-red-500/10 text-red-400 border-red-500/30",
};

function variantLabel(v: string) {
  return VARIANTS.find((x) => x.value === v)?.label ?? v;
}

export default async function Dashboard() {
  const pendingJobs = (await sql`
    SELECT j.id, j.type, j.status, j.created_at,
           COALESCE(cs.ticker, w.ticker) AS ticker,
           cs.variant AS variant
    FROM jobs j
    LEFT JOIN case_studies cs ON cs.id = (j.payload->>'case_study_id')::bigint
    LEFT JOIN watchlist w ON w.id = (j.payload->>'watchlist_id')::bigint
    WHERE j.status IN ('pending','running')
    ORDER BY j.id
  `) as unknown as QueueJob[];
  const studies = (await sql`
    SELECT * FROM case_studies ORDER BY id DESC LIMIT 50
  `) as unknown as CaseStudy[];

  return (
    <div>
      <AutoRefresh />
      <h1 className="text-2xl font-bold text-slate-100 mb-1">Dashboard</h1>
      <p className="text-sm text-slate-500 mb-6">
        Fact-checked stock case studies, built by the Claude Code engine.
      </p>

      <QueuePanel jobs={pendingJobs} />

      {studies.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-slate-400 mb-4">No case studies yet.</p>
          <Link
            href="/new"
            className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-4 py-2 rounded-lg"
          >
            Queue your first study <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {studies.map((s) => (
            <Link
              key={s.id}
              href={`/study/${s.id}`}
              className="card p-4 hover:border-ink-600 transition-colors block"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono font-bold text-slate-100">{s.ticker}</span>
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-full border ${STATUS_STYLES[s.status] ?? ""}`}
                >
                  {s.status}
                </span>
              </div>
              <div className="text-sm text-slate-400 truncate">
                {s.company ?? "—"} · {variantLabel(s.variant)}
              </div>
              <div className="text-[11px] text-slate-600 mt-2">
                {s.as_of_date ? `As of ${s.as_of_date}` : `Queued ${String(s.created_at).slice(0, 10)}`}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
