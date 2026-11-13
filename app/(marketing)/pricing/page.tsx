import type { Metadata } from "next";
import Link from "next/link";
import { Check, ArrowRight } from "lucide-react";
import { creditCost } from "@/lib/shared";
import { PLANS, PLAN_IDS, SIGNALS_PER_WEEK, SIGNAL_DELAY_DAYS, usd, type PlanId } from "@/lib/plans";
import { SITE, absoluteUrl } from "@/lib/site";
import Breadcrumbs from "@/components/marketing/Breadcrumbs";
import MarketMotion from "@/components/marketing/MarketMotion";
import ProductMockup from "@/components/marketing/ProductMockup";
import JsonLd, { ORGANIZATION_ID } from "@/components/seo/JsonLd";

export const metadata: Metadata = {
  title: "Pricing",
  description: `Try Stock Studio free for ${SITE.trialDays} days, then enrol in the Silver, Gold or Diamond tier of the coaching program. Every plan includes live signals, the course and monthly research credits.`,
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
const was = (id: PlanId) => `${usd(PLANS[id].programUsd)} (was ${usd(PLANS[id].originalProgramUsd)})`;
const COMPARE_ROWS: [string, string, string, string][] = [
  ["Program price", was("silver"), was("gold"), was("diamond")],
  ["Monthly membership", usd(PLANS.silver.monthlyUsd), usd(PLANS.gold.monthlyUsd), usd(PLANS.diamond.monthlyUsd)],
  ["Live signals", `Up to ${SIGNALS_PER_WEEK.silver} a week`, `Up to ${SIGNALS_PER_WEEK.gold} a week`, "Unlimited"],
  ["Signal track record", `After ${SIGNAL_DELAY_DAYS} days`, `After ${SIGNAL_DELAY_DAYS} days`, "Live"],
  ["Course access", yes, yes, yes],
  ["Q&A sessions", no, "Thursdays, 7pm CST", "Thursdays, 7pm CST"],
  ["Live sessions", no, no, "Monday to Friday, 8:30am to 10:30am CST"],
  ["Account review", no, no, "Free"],
  ["Credits every month", `${PLANS.silver.monthlyCredits}`, `${PLANS.gold.monthlyCredits}`, `${PLANS.diamond.monthlyCredits}`],
  ["Unused plan credits", "Expire each month", "Roll over a month", "Roll over a month"],
  ["Study formats", "Quick take, full study, comparison", "Every format", "Every format"],
  ["Watchlist", "10 tickers", "Unlimited", "Unlimited"],
  ["Reports in progress at once", "3", "10", "10"],
  ["Live data refresh", "Once a day per study", "Any time", "Any time"],
  ["Today, Market, earnings calendar", yes, yes, yes],
  ["Setup bots", "Track record", "Live matches + track record", "Live matches + track record"],
  ["Gamma exposure", no, yes, yes],
  ["LEAPS workspace", no, yes, yes],
  ["Trading journal", "Basic", "With decision analysis", "With decision analysis"],
  ["Sweep Scanner", no, yes, yes],
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
        name: `${PLANS[id].name} plan, monthly membership`,
        description: `Program price: ${usd(PLANS[id].programUsd)}`,
        price: String(PLANS[id].monthlyUsd),
        priceCurrency: "USD",
        url: absoluteUrl("/pricing"),
      })),
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
            Silver, Gold and Diamond are tiers of our coaching program: a
            one-time program price when you enrol, then a monthly membership.
            Every plan includes live signals, the course and monthly credits
            for research.
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
              <p className="mt-2 flex flex-wrap items-baseline gap-x-3 text-4xl font-bold text-slate-100">
                <s className="text-xl font-medium text-fg-subtle">
                  <span className="sr-only">Original price </span>
                  {usd(plan.originalProgramUsd)}
                </s>
                <span>
                  <span className="sr-only">Current price </span>
                  {usd(plan.programUsd)}
                </span>
              </p>
              <p className="mt-1 text-sm text-fg-subtle">
                one-time, then {usd(plan.monthlyUsd)}/month
              </p>
              <p className="mt-3 text-sm text-slate-300">{plan.tagline}</p>
              <ul className="mb-8 mt-6 space-y-3 text-sm text-slate-300">
                {plan.highlights.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden /> {f}
                  </li>
                ))}
              </ul>
              <a
                href={`mailto:${SITE.email}?subject=${encodeURIComponent(`${plan.name} plan`)}`}
                className={`${featured ? "btn-primary" : "btn-secondary"} mt-auto w-full px-5 py-3`}
              >
                Enrol in {plan.name} <ArrowRight className="h-4 w-4" aria-hidden />
              </a>
            </section>
          );
        })}
      </div>

      <p className="mb-10 text-center text-sm text-fg-subtle">
        Not ready to enrol?{" "}
        <Link href="/signup" className="text-emerald-400 underline underline-offset-2 hover:text-emerald-300">
          Start a {SITE.trialDays}-day free trial
        </Link>{" "}
        with every feature except signals and {SITE.trialCredits} starter
        credits, no card required. Once your program payment is received we switch
        your tier on, and you start the monthly membership from your Billing
        page.
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
          The program price is paid once when you enrol, outside the app; the
          monthly membership is billed here and can be cancelled any time. Live
          signals on Silver and Gold are the trader&apos;s first {SIGNALS_PER_WEEK.silver} or{" "}
          {SIGNALS_PER_WEEK.gold} BUY calls each week (New York time), with the
          follow-up calls on those tickers. Signals are the trader&apos;s own
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
