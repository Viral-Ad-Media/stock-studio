import { SITE, absoluteUrl } from "@/lib/site";
import { CREDIT_COSTS } from "@/lib/shared";

// llms.txt (https://llmstxt.org): a plain-text summary of the public site for
// language models. Built at build time from the same constants as the pages.
export const dynamic = "force-static";

export function GET() {
  const body = `# ${SITE.name}

> ${SITE.description}

${SITE.name} is operated by ${SITE.operator}. It produces educational business analysis, never personalized investment advice. Every study opens with a visible "As of" date, cites its sources, and never invents a metric.

## Pages

- [Home](${absoluteUrl("/")}): what Stock Studio does, its features, how it works, and FAQ
- [Pricing](${absoluteUrl("/pricing")}): ${SITE.trialDays}-day free trial with ${SITE.trialCredits} credits, then a one-time $${SITE.accessPriceUsd} unlock and credit packs ($${SITE.creditPackPriceUsd} for ${SITE.creditPackSize} credits)
- [Start a free trial](${absoluteUrl("/signup")})
- [Terms of Service](${absoluteUrl("/terms")})
- [Privacy Policy](${absoluteUrl("/privacy")})

## Features

- Case studies: growth, profitability, valuation and moat, each with a verdict, a research grade, a bear case and cited sources
- Formats: quick take, full 4-card study, deep research memo, comparison, social carousel, newsletter section, video script, earnings reaction update
- Watchlist thesis tracker: each refresh marks the prior thesis intact, weakening or broken, with a timeline of earlier theses
- Earnings calendar for followed tickers
- Market context: sector rotation versus the S&P 500, large-cap breadth, daily movers
- Setup bots: rule-based chart-pattern scanners with a paper-tracked record
- Gamma exposure: a dealer-gamma model from CBOE delayed options data

## Credit costs per format

${Object.entries(CREDIT_COSTS)
  .map(([k, v]) => `- ${k.replace(/_/g, " ")}: ${v} credits`)
  .join("\n")}

## Contact

${SITE.email}
`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
