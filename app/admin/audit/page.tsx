import PageHeader from "@/components/ui/PageHeader";
import Link from "next/link";
import { sql, formatDate } from "@/lib/db";
import { requireSuperAdminPage, userDirectory, UUID_RE } from "@/lib/admin";

export const metadata = { title: "Audit log" };

import AdminPagination from "@/components/admin/AdminPagination";
import { adminPage, ADMIN_PAGE_SIZE } from "@/lib/admin-pagination";

const LABELS: Record<string, string> = {
  adjust_credits: "Adjusted credits",
  grant_access: "Granted access",
  revoke_access: "Removed access",
  extend_trial: "Extended trial",
  fail_job: "Failed a job",
};

export default async function AdminAudit({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; q?: string; page?: string }>;
}) {
  const admin = await requireSuperAdminPage();
  const params = await searchParams;
  const action =
    params.action && Object.hasOwn(LABELS, params.action) ? params.action : "";
  const q = (params.q ?? "").trim().slice(0, 100);
  const [count] =
    await sql`SELECT count(*)::int AS total FROM admin_audit WHERE (${action} = '' OR action = ${action}) AND (${q} = '' OR target_id ILIKE ${`%${q}%`} OR detail->>'note' ILIKE ${`%${q}%`})`;
  const page = adminPage(params.page, count.total);
  const rows =
    await sql`SELECT id, admin_user_id, action, target_type, target_id, detail, created_at FROM admin_audit WHERE (${action} = '' OR action = ${action}) AND (${q} = '' OR target_id ILIKE ${`%${q}%`} OR detail->>'note' ILIKE ${`%${q}%`}) ORDER BY id DESC LIMIT ${ADMIN_PAGE_SIZE} OFFSET ${(page - 1) * ADMIN_PAGE_SIZE}`;
  // Resolve admin emails and workspace owners for display.
  const workspaceIds = rows
    .filter((r) => r.target_type === "workspace")
    .map((r) => r.target_id);
  const owners = workspaceIds.length
    ? await sql`SELECT active_workspace_id::text AS ws, id::text AS user_id FROM profiles WHERE active_workspace_id = ANY(${workspaceIds}::uuid[])`
    : [];
  const ownerOf = new Map(
    owners.map((o) => [o.ws as string, o.user_id as string]),
  );
  const userIds = [
    ...new Set([
      ...rows.map((r) => r.admin_user_id as string),
      ...rows
        .filter((r) => r.target_type === "user")
        .map((r) => r.target_id as string),
      ...owners.map((o) => o.user_id as string),
    ]),
  ].filter((x) => UUID_RE.test(x));
  const people = userIds.length
    ? await userDirectory(admin.id, { ids: userIds, limit: 200 })
    : [];
  const email = new Map(people.map((p) => [p.id, p.email]));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Superadmin"
        title="Audit log"
        description={
          <>
            {" "}
            Every admin change, newest first (complete history). Entries
            can&apos;t be edited or deleted from the app.{" "}
          </>
        }
      />
      <form
        method="get"
        role="search"
        className="mb-4 flex flex-wrap items-end gap-3"
      >
        <div>
          <label htmlFor="audit-action" className="field-label">
            Action
          </label>
          <select
            id="audit-action"
            name="action"
            defaultValue={action}
            className="input"
          >
            <option value="">All actions</option>
            {Object.entries(LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="w-full sm:max-w-sm">
          <label htmlFor="audit-q" className="field-label">
            Target ID or reason
          </label>
          <input
            id="audit-q"
            name="q"
            defaultValue={q}
            maxLength={100}
            className="input"
          />
        </div>
        <button className="btn-primary px-4 py-2 text-sm">Apply filters</button>
        {(q || action) && (
          <Link href="/admin/audit" className="btn-secondary px-4 py-2 text-sm">
            Clear
          </Link>
        )}
      </form>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <caption className="sr-only">Admin actions</caption>
          <thead>
            <tr className="border-b border-ink-700 text-left text-xs text-fg-subtle">
              <th scope="col" className="px-4 py-3 font-medium">
                When
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Admin
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Action
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Target
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Details
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const userTarget =
                r.target_type === "user"
                  ? r.target_id
                  : r.target_type === "workspace"
                    ? ownerOf.get(r.target_id)
                    : null;
              const d = r.detail ?? {};
              const summary =
                r.action === "adjust_credits"
                  ? `${d.delta > 0 ? "+" : ""}${d.delta} credits (balance was ${d.balance_before})`
                  : r.action === "extend_trial"
                    ? `+${d.days} days, now ends ${formatDate(d.trial_after)}`
                    : r.action === "fail_job"
                      ? `${d.refunded_credits ?? 0} credits refunded`
                      : "";
              return (
                <tr
                  key={r.id}
                  className="border-b border-ink-800 align-top last:border-0"
                >
                  <td className="whitespace-nowrap px-4 py-3 text-slate-300">
                    {formatDate(r.created_at)}
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {email.get(r.admin_user_id) ?? r.admin_user_id}
                  </td>
                  <td className="px-4 py-3 text-slate-100">
                    {LABELS[r.action] ?? r.action}
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {userTarget ? (
                      <Link
                        href={`/admin/users/${userTarget}`}
                        className="underline-offset-2 hover:underline"
                      >
                        {email.get(userTarget) ?? userTarget}
                      </Link>
                    ) : (
                      `${r.target_type} ${r.target_id}`
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {summary}
                    {d.note && (
                      <span className="block text-xs text-fg-subtle">
                        “{d.note}”
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-fg-subtle"
                >
                  No admin changes yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <AdminPagination
        path="/admin/audit"
        page={page}
        total={count.total}
        filters={{ ...(action ? { action } : {}), ...(q ? { q } : {}) }}
      />
    </div>
  );
}
