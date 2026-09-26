import Link from "next/link";
import { sql, formatDate } from "@/lib/db";
import { requireSuperAdminPage, userDirectory, UUID_RE } from "@/lib/admin";

export const metadata = { title: "Audit log" };

const LABELS: Record<string, string> = {
  adjust_credits: "Adjusted credits",
  grant_access: "Granted access",
  revoke_access: "Removed access",
  extend_trial: "Extended trial",
  fail_job: "Failed a job",
};

export default async function AdminAudit() {
  const admin = await requireSuperAdminPage();
  const rows = await sql`SELECT id, admin_user_id, action, target_type, target_id, detail, created_at FROM admin_audit ORDER BY id DESC LIMIT 200`;
  // Resolve admin emails and workspace owners for display.
  const workspaceIds = rows.filter((r) => r.target_type === "workspace").map((r) => r.target_id);
  const owners = workspaceIds.length
    ? await sql`SELECT active_workspace_id::text AS ws, id::text AS user_id FROM profiles WHERE active_workspace_id = ANY(${workspaceIds}::uuid[])`
    : [];
  const ownerOf = new Map(owners.map((o) => [o.ws as string, o.user_id as string]));
  const userIds = [...new Set([...rows.map((r) => r.admin_user_id as string), ...rows.filter((r) => r.target_type === "user").map((r) => r.target_id as string), ...owners.map((o) => o.user_id as string)])].filter((x) => UUID_RE.test(x));
  const people = userIds.length ? await userDirectory(admin.id, { ids: userIds, limit: 200 }) : [];
  const email = new Map(people.map((p) => [p.id, p.email]));

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-100">Audit log</h1>
      <p className="mb-6 mt-1 text-sm text-fg-subtle">Every admin change, newest first (latest 200). Entries can&apos;t be edited or deleted from the app.</p>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <caption className="sr-only">Admin actions</caption>
          <thead>
            <tr className="border-b border-ink-700 text-left text-xs text-fg-subtle">
              <th scope="col" className="px-4 py-3 font-medium">When</th>
              <th scope="col" className="px-4 py-3 font-medium">Admin</th>
              <th scope="col" className="px-4 py-3 font-medium">Action</th>
              <th scope="col" className="px-4 py-3 font-medium">Target</th>
              <th scope="col" className="px-4 py-3 font-medium">Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const userTarget = r.target_type === "user" ? r.target_id : r.target_type === "workspace" ? ownerOf.get(r.target_id) : null;
              const d = r.detail ?? {};
              const summary =
                r.action === "adjust_credits" ? `${d.delta > 0 ? "+" : ""}${d.delta} credits (balance was ${d.balance_before})`
                : r.action === "extend_trial" ? `+${d.days} days, now ends ${formatDate(d.trial_after)}`
                : r.action === "fail_job" ? `${d.refunded_credits ?? 0} credits refunded`
                : "";
              return (
                <tr key={r.id} className="border-b border-ink-800 align-top last:border-0">
                  <td className="whitespace-nowrap px-4 py-3 text-slate-300">{formatDate(r.created_at)}</td>
                  <td className="px-4 py-3 text-slate-300">{email.get(r.admin_user_id) ?? r.admin_user_id}</td>
                  <td className="px-4 py-3 text-slate-100">{LABELS[r.action] ?? r.action}</td>
                  <td className="px-4 py-3 text-slate-300">
                    {userTarget ? (
                      <Link href={`/admin/users/${userTarget}`} className="underline-offset-2 hover:underline">{email.get(userTarget) ?? userTarget}</Link>
                    ) : (
                      `${r.target_type} ${r.target_id}`
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {summary}
                    {d.note && <span className="block text-xs text-fg-subtle">“{d.note}”</span>}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-fg-subtle">No admin changes yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
