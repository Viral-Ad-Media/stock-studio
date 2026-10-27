import PageHeader from "@/components/ui/PageHeader";
import Link from "next/link";
import { sql, formatDate, adminWritesConfigured } from "@/lib/db";
import { requireSuperAdminPage, userDirectory } from "@/lib/admin";
import { accountPlan } from "@/lib/plans";
import AddUserForm from "@/components/admin/AddUserForm";
import RevokeInviteButton from "@/components/admin/RevokeInviteButton";

export const metadata = { title: "Users" };

import { adminPage } from "@/lib/admin-pagination";
const PAGE = 50;

type Extra = {
  id: string;
  trial_ends_at: string | null;
  access_granted: boolean;
  balance: number;
  studies: number;
  is_admin: boolean;
  disabled_at: string | null;
};

type Invite = {
  id: number;
  email: string;
  credits: number;
  trial_days: number | null;
  access_granted: boolean;
  note: string;
  created_at: string;
};

export default async function AdminUsers({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const admin = await requireSuperAdminPage();
  const { q: rawQ, page: rawPage } = await searchParams;
  const q = (rawQ ?? "").trim().slice(0, 100);
  let page = adminPage(rawPage);

  let users = await userDirectory(admin.id, {
    query: q || null,
    limit: PAGE,
    offset: (page - 1) * PAGE,
  });
  if (!users.length && page > 1) {
    users = await userDirectory(admin.id, {
      query: q || null,
      limit: PAGE,
      offset: 0,
    });
    page = 1;
  }
  const total = users[0]?.total ?? 0;
  const ids = users.map((u) => u.id);
  const extras = ids.length
    ? ((await sql`
        SELECT p.id, p.trial_ends_at, p.access_granted, p.disabled_at,
          coalesce((SELECT sum(delta) FROM credits_ledger l WHERE l.workspace_id = p.active_workspace_id), 0)::int AS balance,
          (SELECT count(*) FROM case_studies cs WHERE cs.workspace_id = p.active_workspace_id)::int AS studies,
          EXISTS (SELECT 1 FROM platform_admins a WHERE a.user_id = p.id) AS is_admin
        FROM profiles p WHERE p.id = ANY(${ids}::uuid[])
      `) as unknown as Extra[])
    : [];
  const byId = new Map(extras.map((e) => [e.id, e]));
  const invites = (await sql`
    SELECT id, email, credits, trial_days, access_granted, note, created_at
    FROM admin_invites WHERE claimed_at IS NULL AND revoked_at IS NULL
    ORDER BY id DESC LIMIT 50
  `) as unknown as Invite[];
  const writesEnabled = adminWritesConfigured();
  const signupUrl = `${(process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "")}/signup`;
  const now = Date.now();
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const link = (p: number) =>
    `/admin/users?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description={
          <>
            {" "}
            {total} {total === 1 ? "account" : "accounts"}
            {q && ` matching “${q}”`}{" "}
          </>
        }
      />

      <form
        method="get"
        className="mb-4 flex flex-wrap items-end gap-2"
        role="search"
      >
        <div className="min-w-0 flex-1 sm:max-w-sm">
          <label htmlFor="user-q" className="field-label">
            Search by email or name
          </label>
          <input
            id="user-q"
            name="q"
            defaultValue={q}
            className="input"
            autoComplete="off"
          />
        </div>
        <button type="submit" className="btn-primary px-4 py-2 text-sm">
          Search
        </button>
        {q && (
          <Link href="/admin/users" className="btn-secondary px-4 py-2 text-sm">
            Clear
          </Link>
        )}
      </form>

      <AddUserForm writesEnabled={writesEnabled} signupUrl={signupUrl} />

      {invites.length > 0 && (
        <section aria-labelledby="invites-heading" className="card overflow-x-auto p-4">
          <h2 id="invites-heading" className="mb-3 text-sm font-semibold text-slate-100">
            Open invites ({invites.length})
          </h2>
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-xs text-fg-subtle">
                <th scope="col" className="pb-2 font-medium">Email</th>
                <th scope="col" className="pb-2 font-medium">Starts with</th>
                <th scope="col" className="pb-2 font-medium">Invited</th>
                <th scope="col" className="pb-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {invites.map((i) => (
                <tr key={i.id} className="border-t border-ink-800">
                  <th scope="row" className="py-2 pr-3 text-left font-normal text-slate-100">
                    {i.email}
                    <span className="block text-xs text-fg-subtle">{i.note}</span>
                  </th>
                  <td className="py-2 pr-3 text-slate-300">
                    {[
                      i.access_granted && "paid access",
                      i.credits > 0 && `+${i.credits} credits`,
                      i.trial_days && `${i.trial_days}-day trial`,
                    ]
                      .filter(Boolean)
                      .join(", ") || "standard trial"}
                  </td>
                  <td className="py-2 pr-3 text-slate-300">{formatDate(i.created_at)}</td>
                  <td className="py-2 text-right">
                    <RevokeInviteButton id={i.id} email={i.email} disabled={!writesEnabled} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <caption className="sr-only">Accounts, newest first</caption>
          <thead>
            <tr className="border-b border-ink-700 text-left text-xs text-fg-subtle">
              <th scope="col" className="px-4 py-3 font-medium">
                Account
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Plan
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                Credits
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                Studies
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Joined
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Last sign-in
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const e = byId.get(u.id);
              const plan = accountPlan(
                {
                  access_granted: Boolean(e?.access_granted),
                  trial_ends_at: e?.trial_ends_at ?? null,
                },
                now,
              );
              const status = plan.detail
                ? `${plan.label}, ${plan.detail}`
                : plan.label;
              return (
                <tr
                  key={u.id}
                  className="border-b border-ink-800 last:border-0"
                >
                  <th scope="row" className="px-4 py-3 text-left font-normal">
                    <Link
                      href={`/admin/users/${u.id}`}
                      className="text-slate-100 underline-offset-2 hover:underline"
                    >
                      {u.email}
                    </Link>
                    <div className="text-xs text-fg-subtle">
                      {u.full_name ?? "No name"} · {u.provider ?? "email"}
                      {e?.is_admin && (
                        <span className="ml-2 rounded-sm border border-amber-500/40 px-1 text-amber-300">
                          Admin
                        </span>
                      )}
                      {e?.disabled_at && (
                        <span className="ml-2 rounded-sm border border-red-500/40 px-1 text-red-300">
                          Disabled
                        </span>
                      )}
                    </div>
                  </th>
                  <td className="px-4 py-3 text-slate-300">{status}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-200">
                    {e?.balance ?? 0}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-200">
                    {e?.studies ?? 0}
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {formatDate(u.created_at)}
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {u.last_sign_in_at
                      ? formatDate(u.last_sign_in_at)
                      : "Never"}
                  </td>
                </tr>
              );
            })}
            {users.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-fg-subtle"
                >
                  No accounts found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <nav
          aria-label="Pages"
          className="mt-4 flex items-center justify-between text-sm"
        >
          {page > 1 ? (
            <Link href={link(page - 1)} className="btn-secondary px-3 py-1.5">
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-fg-subtle">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link href={link(page + 1)} className="btn-secondary px-3 py-1.5">
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
