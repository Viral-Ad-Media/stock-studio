import Link from "next/link";
import { sql, formatDate } from "@/lib/db";
import { requireSuperAdminPage } from "@/lib/admin";
import FailJobButton from "@/components/admin/FailJobButton";
import { formatCost } from "@/lib/engine/usage";
import { STALE_LOCK_MS } from "@/lib/engine/worker";

export const metadata = { title: "Jobs" };

const FILTERS = [
  { key: "open", label: "Queued and running" },
  { key: "error", label: "Failed" },
  { key: "done", label: "Done" },
  { key: "all", label: "All" },
] as const;

// Same threshold the fail route enforces (api/admin/jobs/[id]).
const STUCK_MS = Math.max(15 * 60_000, STALE_LOCK_MS);

export default async function AdminJobs({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireSuperAdminPage();
  const { status: raw } = await searchParams;
  const filter = FILTERS.some((f) => f.key === raw) ? (raw as (typeof FILTERS)[number]["key"]) : "open";
  const statuses = filter === "open" ? ["pending", "running"] : filter === "all" ? ["pending", "running", "done", "error"] : [filter];

  const jobs = await sql`
    SELECT j.id, j.type, j.status, j.attempts, j.result, j.locked_at, j.created_at, j.updated_at, j.cost_usd, j.usage_json,
           coalesce(cs.ticker, w.ticker) AS ticker, cs.variant, ws.name AS workspace
    FROM jobs j
    LEFT JOIN case_studies cs ON cs.id = (j.payload->>'case_study_id')::bigint
    LEFT JOIN watchlist w ON w.id = (j.payload->>'watchlist_id')::bigint
    LEFT JOIN workspaces ws ON ws.id = j.workspace_id
    WHERE j.status = ANY(${statuses})
    ORDER BY j.id DESC LIMIT 200
  `;
  const now = Date.now();

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-100">Jobs</h1>
      <p className="mb-6 mt-1 text-sm text-fg-subtle">
        The research queue across every workspace (latest 200). Pending jobs, and running jobs untouched for {Math.round(STUCK_MS / 60_000)} minutes or more,
        can be failed; their credits are refunded. Model cost is an estimate at list price, summed over every attempt.
      </p>
      <nav aria-label="Filter jobs" className="mb-4 flex flex-wrap gap-2 text-sm">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/admin/jobs?status=${f.key}`}
            aria-current={f.key === filter ? "page" : undefined}
            className={`rounded-lg border px-3 py-1.5 ${f.key === filter ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300" : "border-ink-500 text-slate-300 hover:bg-ink-800"}`}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[940px] text-sm">
          <caption className="sr-only">Jobs, newest first</caption>
          <thead>
            <tr className="border-b border-ink-700 text-left text-xs text-fg-subtle">
              <th scope="col" className="px-4 py-3 font-medium">Job</th>
              <th scope="col" className="px-4 py-3 font-medium">Workspace</th>
              <th scope="col" className="px-4 py-3 font-medium">Status</th>
              <th scope="col" className="px-4 py-3 font-medium">Updated</th>
              <th scope="col" className="px-4 py-3 font-medium">Model cost</th>
              <th scope="col" className="px-4 py-3 font-medium">Result</th>
              <th scope="col" className="px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => {
              const stuck = j.status === "running" && now - new Date(j.updated_at).getTime() > STUCK_MS;
              const canFail = j.status === "pending" || stuck;
              return (
                <tr key={j.id} className="border-b border-ink-800 align-top last:border-0">
                  <th scope="row" className="px-4 py-3 text-left font-normal">
                    <span className="text-slate-100">#{j.id}</span> <span className="font-mono text-slate-200">{j.ticker ?? ""}</span>
                    <div className="text-xs text-fg-subtle">{j.type}{j.variant ? ` · ${j.variant}` : ""} · {j.attempts} {j.attempts === 1 ? "attempt" : "attempts"}</div>
                  </th>
                  <td className="max-w-[12rem] truncate px-4 py-3 text-slate-300">{j.workspace}</td>
                  <td className="px-4 py-3">
                    <span className={stuck ? "text-red-400" : "text-slate-300"}>{stuck ? "Stuck" : j.status}</span>
                    {j.status === "running" && <div className="text-xs text-fg-subtle">{j.locked_at ? "worker" : "manual engine"}</div>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-300">
                    {formatDate(j.updated_at)}
                    <div className="text-xs text-fg-subtle">{new Date(j.updated_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" })} UTC</div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-300">
                    {formatCost(j.cost_usd)}
                    {j.usage_json && (
                      <div className="text-xs text-fg-subtle">
                        {Number(j.usage_json.web_search_requests ?? 0)} searches ·{" "}
                        {Math.round((Number(j.usage_json.input_tokens ?? 0) + Number(j.usage_json.cache_read_input_tokens ?? 0) + Number(j.usage_json.cache_creation_input_tokens ?? 0)) / 1000)}k in ·{" "}
                        {Math.round(Number(j.usage_json.output_tokens ?? 0) / 1000)}k out
                      </div>
                    )}
                  </td>
                  <td className="max-w-[18rem] px-4 py-3"><p className="line-clamp-3 break-words font-mono text-xs text-fg-subtle">{j.result ?? "—"}</p></td>
                  <td className="px-4 py-3">{canFail && <FailJobButton jobId={j.id} />}</td>
                </tr>
              );
            })}
            {jobs.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-fg-subtle">No jobs in this view.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
