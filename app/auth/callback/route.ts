import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// PKCE code exchange — Supabase Auth redirects here after email
// confirmation / OAuth. Must stay public in middleware (excluded from the
// auth gate) or the code is never exchanged before the redirect to a
// protected page bounces back to /login.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  const login = new URL("/login", origin);
  login.searchParams.set("error", "auth_callback_failed");
  return NextResponse.redirect(login);
}
