const isDev = process.env.NODE_ENV !== "production";

// Supabase is the only third-party origin the browser talks to (auth). Stripe
// Checkout is a full-page redirect, so it needs no CSP allowance.
const supabaseOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin;
  } catch {
    return "https://*.supabase.co";
  }
})();

// Defense in depth behind lib/markdown.ts's sanitizer. 'unsafe-inline' for
// scripts is needed by Next's inline bootstrap without per-request nonces
// (which would force every page, including static marketing pages, dynamic);
// the value here is that nothing can load third-party script, exfiltrate via
// fetch/XHR/images to another origin, frame the app, or hijack <base>/forms.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseOrigin} ${supabaseOrigin.replace(/^https:/, "wss:")}`,
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // lib/engine/prompts.ts reads the methodology from the skill file at
  // runtime — make sure serverless bundles actually contain it.
  outputFileTracingIncludes: {
    "/api/engine/run": ["./.claude/skills/build-studies/SKILL.md"],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
