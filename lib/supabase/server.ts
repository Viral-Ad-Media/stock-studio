import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Server-side Supabase client — used ONLY for auth (session lookup, sign
// in/out, PKCE code exchange). All actual data reads/writes go through
// lib/db.ts's raw postgres client (the stocks_app service role), never
// through this client's .from() calls — the `stocks` schema isn't exposed
// to PostgREST at all, by design (see the migration's REVOKE on
// anon/authenticated). This client only ever touches Supabase Auth
// endpoints (GoTrue), which is separate infrastructure.
export function createClient() {
  const cookieStore = cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set");
  }
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component with no response to attach to
          // (middleware already refreshes the session on every request).
        }
      },
    },
  });
}
