import Link from "next/link";
import { sql, formatDate } from "@/lib/db";
import { requireSuperAdminPage, userDirectory } from "@/lib/admin";
import Stat from "@/components/admin/Stat";

export const metadata = { title: "Overview" };

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export default async function AdminOverview() {
  const admin = await requireSuperAdminPage();

  const [u] = await sql`
    SELECT count(*)::int AS total,
      count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS new7,
      count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS new30,
      count(*) FILTER (WHERE access_granted)::int AS paid,
      count(*) FILTER (WHERE NOT access_granted AND trial_ends_at > now())::int AS trialing,
      count(*) FILTER (WHERE NOT access_granted AND trial_ends_at <= now())::int AS expired
    FROM profiles
  `;
  const [p] = await sql`
    SELECT coalesce(sum(amount_cents) FILTER (WHERE status = 'completed'), 0)::int AS revenue,
      coalesce(sum(amount_cents) FILTER (WHERE status = 'completed' AND created_at > now() - interval '30 days'), 0)::int AS revenue30,
      count(*) FILTER (WHERE status = 'refunded')::int AS refunds
    FROM payments
  `;
  const [c] = await sql`
    SELECT coalesce(sum(delta), 0)::int AS outstanding,
      coalesce(-sum(delta) FILTER (WHERE reason = 'job_charge' AND created_at > now() - interval '30 days'), 0)::int AS spent30
    FROM credits_ledger
  `;
  const [j] = await sql`
    SELECT count(*) FILTER (WHERE status = 'pending')::int AS pending,
      count(*) FILTER (WHERE status = 'running')::int AS running,
      count(*) FILTER (WHERE status = 'running' AND updated_at < now() - interval '15 minutes')::int AS stuck,
      count(*) FILTER (WHERE status = 'error' AND updated_at > now() - interval '24 hours')::int AS failed24,
      count(*) FILTER (WHERE status = 'done' AND updated_at > now() - interval '24 hours')::int AS done24,
      max(updated_at) FILTER (WHERE status = 'done') AS last_done,
      min(created_at) FILTER (WHERE status = 'pending') AS oldest_pending
    FROM jobs
  `;
  const [s] = await sql`
    SELECT count(*) FILTER (WHERE status = 'ready')::int AS ready,
      count(*) FILTER (WHERE status = 'ready' AND updated_at > now() - interval '7 days')::int AS ready7
    FROM case_studies
  `;
  const failures = await sql`
    SELECT id, type, result, updated_at FROM jobs WHERE status = 'error' ORDER BY updated_at DESC LIMIT 5
  `;
  const recent = await userDirectory(admin.id, { limit: 5 });

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-100">Overview</h1>
      <p className="mb-6 mt-1 text-sm text-fg-subtle">Across every workspace. Figures are live from the database.</p>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">Customers</h2>
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Accounts" value={u.total} hint={`${u.new7} new in 7 days · ${u.new30} in 30`} />
        <Stat label="Paid access" value={u.paid} />
        <Stat label="On trial" value={u.trialing} />
        <Stat label="Trial expired, not paid" value={u.expired} />
      </div>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">Revenue and credits</h2>
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Revenue, all time" value={usd(p.revenue)} hint={`${p.refunds} refunded payments`} />
        <Stat label="Revenue, 30 days" value={usd(p.revenue30)} />
        <Stat label="Credits outstanding" value={c.outstanding} hint="Unspent balance across all workspaces" />
        <Stat label="Credits spent, 30 days" value={c.spent30} />
      </div>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">Research engine</h2>
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Queue"
          value={`${j.pending} pending · ${j.running} running`}
          hint={j.oldest_pending ? `Oldest pending since ${formatDate(j.oldest_pending)}` : "Nothing waiting"}
        />
        <Stat label="Stuck (running 15+ min)" value={j.stuck} tone={j.stuck ? "bad" : undefined} />
        <Stat label="Last 24 hours" value={`${j.done24} done · ${j.failed24} failed`} tone={j.failed24 ? "warn" : undefined} />
        <Stat label="Studies ready" value={s.ready} hint={`${s.ready7} in the last 7 days · last job done ${j.last_done ? formatDate(j.last_done) : "never"}`} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section aria-labelledby="recent-users" className="card p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 id="recent-users" className="text-sm font-semibold text-slate-100">Newest accounts</h2>
            <Link href="/admin/users" className="text-sm text-emerald-400 underline-offset-2 hover:underline">All users</Link>
          </div>
          <ul className="divide-y divide-ink-800 text-sm">
            {recent.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                <Link href={`/admin/users/${r.id}`} className="truncate text-slate-200 hover:underline">{r.email}</Link>
                <span className="shrink-0 text-xs text-fg-subtle">{formatDate(r.created_at)}</span>
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="recent-failures" className="card p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 id="recent-failures" className="text-sm font-semibold text-slate-100">Latest failed jobs</h2>
            <Link href="/admin/jobs?status=error" className="text-sm text-emerald-400 underline-offset-2 hover:underline">All failures</Link>
          </div>
          {failures.length === 0 ? (
            <p className="text-sm text-fg-subtle">No failed jobs.</p>
          ) : (
            <ul className="divide-y divide-ink-800 text-sm">
              {failures.map((f) => (
                <li key={f.id} className="py-2">
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-200">#{f.id} · {f.type}</span>
                    <span className="text-xs text-fg-subtle">{formatDate(f.updated_at)}</span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 break-words font-mono text-xs text-fg-subtle">{f.result ?? "No error recorded"}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
