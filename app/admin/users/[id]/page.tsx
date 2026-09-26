import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { sql, formatDate, adminWritesConfigured, VARIANTS } from "@/lib/db";
import { requireSuperAdminPage, userDirectory, UUID_RE } from "@/lib/admin";
import UserActions from "@/components/admin/UserActions";
import StatusBadge from "@/components/StatusBadge";

export const metadata = { title: "User" };

const REASONS: Record<string, string> = {
  trial_grant: "Trial credits",
  grandfather: "Grandfathered",
  purchase: "Purchase",
  purchase_refund: "Purchase refund",
  job_charge: "Report charge",
  job_refund: "Report refund",
  admin_adjust: "Admin adjustment",
};

export default async function AdminUser({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireSuperAdminPage();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const [u] = await userDirectory(admin.id, { ids: [id], limit: 1 });
  if (!u) notFound();

  const [p] = await sql`SELECT active_workspace_id, trial_ends_at, access_granted FROM profiles WHERE id = ${id}`;
  const ws = p.active_workspace_id as string;
  const [bal] = await sql`SELECT coalesce(sum(delta), 0)::int AS balance FROM credits_ledger WHERE workspace_id = ${ws}`;
  const [isAdmin] = await sql`SELECT 1 AS ok FROM platform_admins WHERE user_id = ${id}`;
  const ledger = await sql`SELECT id, delta, reason, ref, created_at FROM credits_ledger WHERE workspace_id = ${ws} ORDER BY id DESC LIMIT 50`;
  const payments = await sql`SELECT id, kind, amount_cents, credits, status, created_at, refunded_at FROM payments WHERE workspace_id = ${ws} ORDER BY id DESC`;
  const studies = await sql`SELECT id, ticker, variant, status, created_at FROM case_studies WHERE workspace_id = ${ws} ORDER BY id DESC LIMIT 20`;
  const [counts] = await sql`
    SELECT (SELECT count(*) FROM case_studies WHERE workspace_id = ${ws})::int AS studies,
           (SELECT count(*) FROM watchlist WHERE workspace_id = ${ws})::int AS watch
  `;
  const audit = await sql`SELECT action, detail, created_at FROM admin_audit WHERE target_id IN (${id}, ${ws}) ORDER BY id DESC LIMIT 20`;

  const trialEnds = p.trial_ends_at ? new Date(p.trial_ends_at) : null;
  const trialActive = trialEnds ? trialEnds.getTime() > Date.now() : false;

  return (
    <div className="space-y-6">
      <Link href="/admin/users" className="inline-flex items-center gap-1.5 text-sm text-fg-subtle hover:text-slate-300">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Users
      </Link>
      <div>
        <h1 className="break-all text-2xl font-bold text-slate-100">{u.email}</h1>
        <p className="mt-1 text-sm text-fg-subtle">
          {u.full_name ?? "No name"} · signs in with {u.provider ?? "email"} · joined {formatDate(u.created_at)} · last sign-in{" "}
          {u.last_sign_in_at ? formatDate(u.last_sign_in_at) : "never"}
          {isAdmin && <span className="ml-2 rounded border border-amber-500/40 px-1 text-amber-300">Admin</span>}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card p-4"><div className="text-xs text-fg-subtle">Access</div><div className="mt-1 text-lg font-semibold text-slate-100">{p.access_granted ? "Paid" : trialActive ? "Trial" : "Expired"}</div></div>
        <div className="card p-4"><div className="text-xs text-fg-subtle">Trial ends</div><div className="mt-1 text-lg font-semibold text-slate-100">{trialEnds ? formatDate(trialEnds) : "—"}</div></div>
        <div className="card p-4"><div className="text-xs text-fg-subtle">Credit balance</div><div className="mt-1 text-lg font-semibold tabular-nums text-slate-100">{bal.balance}</div></div>
        <div className="card p-4"><div className="text-xs text-fg-subtle">Studies · watchlist</div><div className="mt-1 text-lg font-semibold tabular-nums text-slate-100">{counts.studies} · {counts.watch}</div></div>
      </div>

      <UserActions userId={id} accessGranted={Boolean(p.access_granted)} writesEnabled={adminWritesConfigured()} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section aria-labelledby="ledger-heading" className="card overflow-x-auto p-4">
          <h2 id="ledger-heading" className="mb-3 text-sm font-semibold text-slate-100">Credit ledger (latest 50)</h2>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-fg-subtle"><th scope="col" className="pb-2 font-medium">Date</th><th scope="col" className="pb-2 font-medium">Reason</th><th scope="col" className="pb-2 text-right font-medium">Change</th></tr></thead>
            <tbody>
              {ledger.map((l) => (
                <tr key={l.id} className="border-t border-ink-800">
                  <td className="py-1.5 text-slate-300">{formatDate(l.created_at)}</td>
                  <td className="py-1.5 text-slate-300">{REASONS[l.reason] ?? l.reason}<span className="ml-1 text-xs text-fg-subtle">{l.ref}</span></td>
                  <td className="py-1.5 text-right tabular-nums text-slate-100">{l.delta > 0 ? `+${l.delta}` : l.delta}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <div className="space-y-6">
          <section aria-labelledby="pay-heading" className="card p-4">
            <h2 id="pay-heading" className="mb-3 text-sm font-semibold text-slate-100">Payments</h2>
            {payments.length === 0 ? <p className="text-sm text-fg-subtle">No payments.</p> : (
              <ul className="divide-y divide-ink-800 text-sm">
                {payments.map((x) => (
                  <li key={x.id} className="flex justify-between gap-3 py-1.5">
                    <span className="text-slate-300">{x.kind === "access" ? "Access fee" : `${x.credits} credits`} · {formatDate(x.created_at)}</span>
                    <span className="tabular-nums text-slate-100">${(x.amount_cents / 100).toFixed(2)}{x.status === "refunded" && <span className="ml-1 text-red-400">refunded</span>}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="studies-heading" className="card p-4">
            <h2 id="studies-heading" className="mb-3 text-sm font-semibold text-slate-100">Latest studies</h2>
            {studies.length === 0 ? <p className="text-sm text-fg-subtle">No studies yet.</p> : (
              <ul className="divide-y divide-ink-800 text-sm">
                {studies.map((st) => (
                  <li key={st.id} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="truncate text-slate-300"><span className="font-mono text-slate-100">{st.ticker}</span> · {VARIANTS.find((v) => v.value === st.variant)?.label ?? st.variant} · {formatDate(st.created_at)}</span>
                    <StatusBadge status={st.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="uaudit-heading" className="card p-4">
            <h2 id="uaudit-heading" className="mb-3 text-sm font-semibold text-slate-100">Admin history</h2>
            {audit.length === 0 ? <p className="text-sm text-fg-subtle">No admin changes.</p> : (
              <ul className="divide-y divide-ink-800 text-sm">
                {audit.map((a, i) => (
                  <li key={i} className="py-1.5 text-slate-300">
                    <span className="text-slate-100">{a.action.replace(/_/g, " ")}</span> · {formatDate(a.created_at)}
                    {a.detail?.note && <span className="block text-xs text-fg-subtle">{a.detail.note}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
