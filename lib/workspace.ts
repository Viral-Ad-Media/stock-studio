import { cache } from "react";
import { sql } from "@/lib/db";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";

export type SessionUser = { id: string; email: string | null; name: string | null };

// Validate the database-backed Better Auth session on every request.
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;
  return { id: session.user.id, email: session.user.email, name: session.user.name || null };
});

// Resolves the signed-in user's active workspace id via the app's own
// private server Postgres connection. Falls back to the user's first
// workspace membership if active_workspace_id somehow isn't set, and
// provisions one (stocks.provision_user — same trial as signup, at most once)
// for a migrated account that predates the signup trigger.
// A disabled account (super admin console) gets no workspace, so every route
// that needs one answers "unauthorized".
// Cached per request — never inline this lookup elsewhere.
export const currentWorkspaceId = cache(async (): Promise<string | null> => {
  const user = await currentUser();
  if (!user) return null;

  const [profile] = await sql`
    SELECT active_workspace_id, disabled_at FROM profiles WHERE id = ${user.id}
  `;
  if (profile?.disabled_at) return null;
  if (profile?.active_workspace_id) return profile.active_workspace_id as string;

  const [membership] = await sql`
    SELECT workspace_id FROM workspace_members WHERE user_id = ${user.id} ORDER BY created_at LIMIT 1
  `;
  if (membership?.workspace_id) return membership.workspace_id as string;

  const [provisioned] = await sql`SELECT provision_user(${user.id}::uuid) AS workspace_id`;
  return (provisioned?.workspace_id as string) ?? null;
});

// Whether a super admin has disabled this account (stocks.admin_set_disabled).
export const accountDisabled = cache(async (userId: string): Promise<boolean> => {
  const [row] = await sql`SELECT disabled_at FROM profiles WHERE id = ${userId}`;
  return Boolean(row?.disabled_at);
});
