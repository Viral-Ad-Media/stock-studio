import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";

// A cookie's presence is not authentication. Validate the persisted session.
export async function proxy(req: NextRequest) {
  if (!process.env.AUTH_DATABASE_URL || !process.env.BETTER_AUTH_SECRET) {
    return new NextResponse("Authentication is not configured", { status: 503 });
  }
  const session = await getAuth().api.getSession({ headers: req.headers });
  if (!session) {
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/today/:path*",
    "/journal/:path*",
    "/leaps/:path*",
    "/api/journal/:path*",
    "/api/leaps/:path*",
    "/dashboard/:path*",
    "/new/:path*",
    "/watchlist/:path*",
    "/market/:path*",
    "/setups/:path*",
    "/sweeps/:path*",
    "/gamma/:path*",
    "/signals/:path*",
    "/study/:path*",
    "/api/case-studies/:path*",
    "/api/jobs/:path*",
    "/api/watchlist/:path*",
    "/api/push/:path*",
    "/api/offline/:path*",
    "/billing/:path*",
    "/admin/:path*",
    "/api/admin/:path*",
    // Checkout and the portal need a session; /api/billing/webhook stays public (Stripe-signature auth).
    "/api/billing/checkout/:path*",
    "/api/billing/portal/:path*",
  ],
};
