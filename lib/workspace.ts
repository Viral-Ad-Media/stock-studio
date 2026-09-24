import { cache } from "react";
import { sql } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";

export type SessionUser = { id: string; email: string | null };

// Supabase Auth session → user id/email. Cached per request.
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { id: user.id, email: user.email ?? null };
});

// Resolves the signed-in user's active workspace id via the app's own
// service-role Postgres connection (not the Supabase client — the `stocks`
// schema isn't exposed to PostgREST). Falls back to the user's first
// workspace membership if active_workspace_id somehow isn't set. Cached
// per request — never inline this lookup elsewhere.
export const currentWorkspaceId = cache(async (): Promise<string | null> => {
  const user = await currentUser();
  if (!user) return null;

  const [profile] = await sql`
    SELECT active_workspace_id FROM profiles WHERE id = ${user.id}
  `;
  if (profile?.active_workspace_id) return profile.active_workspace_id as string;

  const [membership] = await sql`
    SELECT workspace_id FROM workspace_members WHERE user_id = ${user.id} ORDER BY created_at LIMIT 1
  `;
  return (membership?.workspace_id as string) ?? null;
});
