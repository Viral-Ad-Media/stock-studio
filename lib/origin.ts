// The app's public origin, for building absolute redirect/return URLs.
//
// Don't use `new URL(req.url).origin` for this: behind a host's proxy (e.g.
// Render) the server binds 0.0.0.0:$PORT and route handlers see that as the
// request origin, so redirects would point at http://0.0.0.0:10000.
// Order: the configured NEXT_PUBLIC_APP_URL (set this in production), then the
// proxy's forwarded host, then the raw request URL (local dev).
export function appOrigin(req: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // fall through to request-derived origin
    }
  }
  const first = (v: string | null) => v?.split(",")[0]?.trim() || null;
  const host = first(req.headers.get("x-forwarded-host")) ?? first(req.headers.get("host"));
  if (host && !host.startsWith("0.0.0.0")) {
    const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
    const proto = first(req.headers.get("x-forwarded-proto")) ?? (local ? "http" : "https");
    return `${proto}://${host}`;
  }
  return new URL(req.url).origin;
}
