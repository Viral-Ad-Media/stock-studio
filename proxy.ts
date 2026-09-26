import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { REMEMBER_COOKIE, applyRemember, rememberFromCookieValue } from "@/lib/auth-cookies";

// Real auth gate: requires a valid Supabase session. Refreshes the session
// cookie on every request (required by @supabase/ssr so server components
// always see a fresh token) and redirects signed-out users to /login.
export async function proxy(req: NextRequest) {
  let res = NextResponse.next({ request: req });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    // Unconfigured deployment must not be silently open.
    if (process.env.NODE_ENV === "production") {
      return new NextResponse(
        "Locked: set NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY and redeploy.",
        { status: 503 }
      );
    }
    return res;
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        const remember = rememberFromCookieValue(req.cookies.get(REMEMBER_COOKIE)?.value);
        cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, applyRemember(options, remember)));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const login = req.nextUrl.clone();
    login.pathname = "/login";
    return NextResponse.redirect(login);
  }

  return res;
}

// Allowlist of protected paths — everything else (marketing pages, login,
// signup, auth callback, the engine webhook) is public by default. Safer
// than a denylist now that public routes outnumber protected ones.
export const config = {
  matcher: [
    "/dashboard/:path*",
    "/new/:path*",
    "/watchlist/:path*",
    "/market/:path*",
    "/setups/:path*",
    "/gamma/:path*",
    "/study/:path*",
    "/api/case-studies/:path*",
    "/api/jobs/:path*",
    "/api/watchlist/:path*",
    "/billing/:path*",
    // Checkout needs a session; /api/billing/webhook stays public (Stripe-signature auth).
    "/api/billing/checkout/:path*",
  ],
};
