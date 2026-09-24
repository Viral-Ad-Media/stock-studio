import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { appOrigin } from "@/lib/origin";

// PKCE code exchange — Supabase Auth redirects here after email
// confirmation / OAuth. Must stay public in proxy.ts (excluded from the
// auth gate) or the code is never exchanged before the redirect to a
// protected page bounces back to /login.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const origin = appOrigin(request);
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"), origin);

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  const login = new URL("/login", origin);
  login.searchParams.set("error", "auth_callback_failed");
  return NextResponse.redirect(login);
}

// `next` comes from the URL, so it must be a same-origin path. Without this,
// `${origin}${next}` with next=@evil.com or next=.evil.com redirects off-site
// right after a successful login.
function safeNextPath(next: string | null, origin: string): string {
  const fallback = "/dashboard";
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  try {
    const url = new URL(next, origin);
    return url.origin === origin ? url.pathname + url.search + url.hash : fallback;
  } catch {
    return fallback;
  }
}
