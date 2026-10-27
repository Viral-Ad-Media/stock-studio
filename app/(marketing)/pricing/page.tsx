import type { Metadata } from "next";
import Link from "next/link";
import { Check, ArrowRight } from "lucide-react";
import { creditCost } from "@/lib/shared";
import { PLANS, PLAN_IDS } from "@/lib/plans";
import { SITE, absoluteUrl } from "@/lib/site";
import Breadcrumbs from "@/components/marketing/Breadcrumbs";
import MarketMotion from "@/components/marketing/MarketMotion";
import ProductMockup from "@/components/marketing/ProductMockup";
import JsonLd, { ORGANIZATION_ID } from "@/components/seo/JsonLd";

export const metadata: Metadata = {
  title: "Pricing",
  description: `Try Stock Studio free for ${SITE.trialDays} days, then pick Silver ($${PLANS.silver.monthlyUsd}/month), Gold ($${PLANS.gold.monthlyUsd}/month) or Diamond ($${PLANS.diamond.monthlyUsd}/month). Every plan includes monthly research credits.`,
  alternates: { canonical: "/pricing" },
};

// Credit figures come from the same table the billing code charges from.
const CREDIT_ROWS = [
  { variant: "Quick take", credits: creditCost("quick_take") },
  { variant: "Full 4-card study", credits: creditCost("full") },
  {
    variant: "Social carousel, newsletter section or video script",
    credits: creditCost("carousel"),
  },
  { variant: "Deep research memo", credits: creditCost("memo") },
  { variant: "Comparison", credits: creditCost("comparison") },
  {
    variant: "Watchlist entry or refresh",
    credits: creditCost("watchlist_entry"),
  },
  {
    variant: "Earnings reaction update",
    credits: creditCost("earnings_update"),
  },
  { variant: "Market movers digest", credits: creditCost("movers_digest") },
  { variant: "Intraday setup check", credits: creditCost("one_candle") },
];

const INCLUDED_FREE = [
  "Market context page",
  "Setup bots",
  "Gamma exposure model (Gold and Diamond)",
  "Earnings calendar",
];

const yes = "Included";
const no = "—";
// Feature rows for the comparison table: [feature, Silver, Gold, Diamond].
const COMPARE_ROWS: [string, string, string, string][] = [
  ["Credits every month", `${PLANS.silver.monthlyCredits}`, `${PLANS.gold.monthlyCredits}`, `${PLANS.diamond.monthlyCredits}`],
  ["Unused plan credits", "Expire each month", "Roll over a month", "Roll over a month"],
  [`Credits per $${SITE.creditPackPriceUsd} pack`, `${SITE.creditPackSize}`, `${SITE.creditPackSize}`, `${Math.round(SITE.creditPackSize * 1.5)}`],
  ["Study formats", "Quick take, full study, comparison", "Every format", "Every format"],
  ["Watchlist", "10 tickers", "50 tickers", "Unlimited"],
  ["Reports in progress at once", "3", "5", "10"],
  ["Live data refresh", "Once a day per study", "Any time", "Any time"],
  ["Today, Market, earnings calendar", yes, yes, yes],
  ["Setup bots", "Track record", "Live matches + track record", "Live matches + track record"],
  ["Gamma exposure", no, yes, yes],
  ["LEAPS workspace", no, yes, yes],
  ["Trading journal", "Basic", "With decision analysis", "With decision analysis"],
  ["Sweep Scanner", no, no, yes],
  ["Live signals", "Pick of the month", "2 weekly picks", "Every call"],
  ["Signal track record", "After 30 days", "After 7 days", "Live"],
];

export default function PricingPage() {
  const ld = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: SITE.name,
    description: SITE.description,
    image: absoluteUrl("/opengraph-image.png"),
    brand: { "@type": "Brand", name: SITE.name },
    manufacturer: { "@id": ORGANIZATION_ID },
    offers: [
      {
        "@type": "Offer",
        name: `${SITE.trialDays}-day free trial`,
        price: "0",
        priceCurrency: "USD",
        url: absoluteUrl("/signup"),
      },
      ...PLAN_IDS.map((id) => ({
        "@type": "Offer",
        name: `${PLANS[id].name} plan, monthly`,
        price: String(PLANS[id].monthlyUsd),
        priceCurrency: "USD",
        url: absoluteUrl("/pricing"),
      })),
      {
        "@type": "Offer",
        name: `${SITE.creditPackSize}-credit pack`,
        price: String(SITE.creditPackPriceUsd),
        priceCurrency: "USD",
        url: absoluteUrl("/pricing"),
      },
    ],
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <JsonLd data={ld} />
      <Breadcrumbs
        items={[
          { name: "Home", path: "/" },
          { name: "Pricing", path: "/pricing" },
        ]}
      />

      <div className="relative isolate mb-14 overflow-hidden rounded-2xl border border-ink-700 px-6 py-14 text-center">
        <MarketMotion />
        <div className="relative pointer-events-none">
          <h1 className="text-3xl font-bold tracking-tight text-slate-100 md:text-5xl">
            Pick the plan that fits how you trade
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-slate-300">
            Try Gold free for {SITE.trialDays} days. Then choose Silver, Gold or
            Diamond. Every plan includes monthly credits for research, and you
            can cancel any time.
          </p>
        </div>
      </div>

      <div className="mb-10 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {PLAN_IDS.map((id) => {
          const plan = PLANS[id];
          const featured = id === "gold";
          return (
            <section
              key={id}
              aria-labelledby={`${id}-heading`}
              className={`card relative flex flex-col p-8 ${featured ? "border-emerald-500/40" : ""}`}
            >
              {featured && (
                <span className="absolute -top-3 right-6 rounded-full border border-emerald-500/40 bg-ink-900 px-3 py-0.5 text-xs font-medium text-emerald-300">
                  Most popular
                </span>
              )}
              <h2 id={`${id}-heading`} className="text-sm font-semibold text-emerald-300">
                {plan.name}
              </h2>
              <p className="mt-2 text-4xl font-bold text-slate-100">
                ${plan.monthlyUsd}
                <span className="text-base font-normal text-fg-subtle">/month</span>
              </p>
              <p className="mt-1 text-sm text-fg-subtle">
                or ${plan.yearlyUsd.toLocaleString("en-US")} a year (2 months free)
              </p>
              <p className="mt-3 text-sm text-slate-300">{plan.tagline}</p>
              <ul className="mb-8 mt-6 space-y-3 text-sm text-slate-300">
                {plan.highlights.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden /> {f}
                  </li>
                ))}
              </ul>
              <Link href="/signup" className={`${featured ? "btn-primary" : "btn-secondary"} mt-auto w-full px-5 py-3`}>
                Start free trial <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </section>
          );
        })}
      </div>

      <p className="mb-10 text-center text-sm text-fg-subtle">
        The {SITE.trialDays}-day free trial has Gold features and{" "}
        {SITE.trialCredits} starter credits, with no card required. Signals start
        when you pick a plan.
      </p>

      <section aria-labelledby="compare-heading" className="card mb-10 overflow-x-auto p-8">
        <h2 id="compare-heading" className="text-lg font-semibold text-slate-100">
          Compare plans
        </h2>
        <table className="mt-5 w-full min-w-[560px] text-sm">
          <caption className="sr-only">What each plan includes</caption>
          <thead>
            <tr className="border-b border-ink-700 text-left text-fg-subtle">
              <th scope="col" className="pb-2 font-medium">Feature</th>
              {PLAN_IDS.map((id) => (
                <th key={id} scope="col" className="pb-2 font-medium">{PLANS[id].name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COMPARE_ROWS.map(([feature, ...cells]) => (
              <tr key={feature} className="border-b border-ink-800 last:border-0 align-top">
                <th scope="row" className="py-2.5 pr-4 text-left font-normal text-slate-300">{feature}</th>
                {cells.map((c, i) => (
                  <td key={i} className="py-2.5 pr-4 text-slate-200">{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-5 text-xs text-fg-subtle">
          Weekly picks are the trader&apos;s first 2 BUY calls each week, and the
          monthly pick is the first BUY call each month (New York time). Follow-up
          calls on those tickers are live too. Signals are the trader&apos;s own
          calls, not personalized advice, and trading involves risk of loss.
        </p>
      </section>

      <section aria-labelledby="credits-heading" className="card mb-10 p-8">
        <h2
          id="credits-heading"
          className="text-lg font-semibold text-slate-100"
        >
          Credits per format
        </h2>
        <p className="mb-5 mt-1 text-sm text-fg-subtle">
          1 credit is about $1. Deeper research costs more because it checks
          more sources and cross-verifies more figures. You always see the cost
          before you queue.
        </p>
        <table className="w-full text-sm">
          <caption className="sr-only">
            Credits charged per study format
          </caption>
          <thead>
            <tr className="border-b border-ink-700 text-left text-fg-subtle">
              <th scope="col" className="pb-2 font-medium">
                Format
              </th>
              <th scope="col" className="pb-2 text-right font-medium">
                Credits
              </th>
            </tr>
          </thead>
          <tbody>
            {CREDIT_ROWS.map((row) => (
              <tr
                key={row.variant}
                className="border-b border-ink-800 last:border-0"
              >
                <th
                  scope="row"
                  className="py-2.5 text-left font-normal text-slate-300"
                >
                  {row.variant}
                </th>
                <td className="py-2.5 text-right tabular-nums text-slate-200">
                  {row.credits}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-5 text-sm text-slate-300">
          Included at no credit cost: {INCLUDED_FREE.join(", ")}. See them on
          the{" "}
          <Link
            href="/#features"
            className="text-emerald-400 underline underline-offset-2 hover:text-emerald-300"
          >
            features overview
          </Link>
          .
        </p>
      </section>

      <section className="mb-12" aria-labelledby="workspace-preview-heading">
        <h2
          id="workspace-preview-heading"
          className="text-2xl font-semibold tracking-tight text-slate-100"
        >
          Connect your thesis to your review
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-fg-subtle">
          Record actual trades in the journal and explore hypothetical options
          scenarios separately. Illustrations below use synthetic data, not
          customer results.
        </p>
        <div className="mt-6 grid items-start gap-6 md:grid-cols-2">
          <ProductMockup kind="journal" compact />
          <ProductMockup kind="leaps" compact />
        </div>
      </section>

      <p className="text-center text-sm text-fg-subtle">
        Questions about pricing?{" "}
        <a
          href={`mailto:${SITE.email}`}
          className="text-emerald-400 underline underline-offset-2 hover:text-emerald-300"
        >
          {SITE.email}
        </a>
      </p>
    </div>
  );
}
