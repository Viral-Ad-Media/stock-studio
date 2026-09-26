// Public-site facts shared by metadata, structured data, sitemap, robots and
// the marketing pages. Client-safe (no Node imports).

// Absolute origin for canonical URLs, sitemap and social cards. Static
// marketing pages are rendered at build time, so NEXT_PUBLIC_APP_URL must be
// set in the build environment in production.
// If it isn't set, the host's own build-time variables are used (Render's
// RENDER_EXTERNAL_URL, Vercel's production domain) so a missed setting never
// publishes localhost canonicals.
function siteUrl(): string {
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const candidates = [process.env.NEXT_PUBLIC_APP_URL, process.env.RENDER_EXTERNAL_URL, vercel ? `https://${vercel}` : undefined];
  for (const c of candidates) {
    if (!c) continue;
    try {
      return new URL(c).origin;
    } catch {
      // try the next one
    }
  }
  return "http://localhost:3200";
}

export const SITE = {
  name: "Stock Studio",
  url: siteUrl(),
  tagline: "Stock research that shows its work.",
  description:
    "Fact-checked, source-cited stock case studies. Queue a ticker and get growth, profitability, valuation and moat analysis verified against SEC filings and earnings releases.",
  operator: "Viral Ad Media",
  email: "viraladmediacontent@gmail.com",
  // Displayed prices. Charged amounts come from the Stripe prices the
  // checkout route uses — keep these in step with them.
  accessPriceUsd: 79,
  creditPackPriceUsd: 10,
  creditPackSize: 10,
  trialDays: 30,
  trialCredits: 5,
} as const;

export function absoluteUrl(path = "/"): string {
  return new URL(path, SITE.url).toString();
}
