import type { Metadata } from "next";
import Link from "next/link";
import { Check, ArrowRight } from "lucide-react";
import { creditCost } from "@/lib/shared";
import { SITE, absoluteUrl } from "@/lib/site";
import Breadcrumbs from "@/components/marketing/Breadcrumbs";
import JsonLd, { ORGANIZATION_ID } from "@/components/seo/JsonLd";

export const metadata: Metadata = {
  title: "Pricing",
  description: `Try Stock Studio free for ${SITE.trialDays} days, then unlock it once for $${SITE.accessPriceUsd} and pay per study with credits. Credit packs from $${SITE.creditPackPriceUsd}; credits never expire.`,
  alternates: { canonical: "/pricing" },
};

// Credit figures come from the same table the billing code charges from.
const CREDIT_ROWS = [
  { variant: "Quick take", credits: creditCost("quick_take") },
  { variant: "Full 4-card study", credits: creditCost("full") },
  { variant: "Social carousel, newsletter section or video script", credits: creditCost("carousel") },
  { variant: "Deep research memo", credits: creditCost("memo") },
  { variant: "Comparison", credits: creditCost("comparison") },
  { variant: "Watchlist entry or refresh", credits: creditCost("watchlist_entry") },
  { variant: "Earnings reaction update", credits: creditCost("earnings_update") },
  { variant: "Market movers digest", credits: creditCost("movers_digest") },
  { variant: "Intraday setup check", credits: creditCost("one_candle") },
];

const INCLUDED_FREE = ["Market context page", "Setup bots and their track record", "Gamma exposure model", "Earnings calendar"];

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
      { "@type": "Offer", name: `${SITE.trialDays}-day free trial`, price: "0", priceCurrency: "USD", url: absoluteUrl("/signup") },
      { "@type": "Offer", name: "One-time access", price: String(SITE.accessPriceUsd), priceCurrency: "USD", url: absoluteUrl("/pricing") },
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
      <Breadcrumbs items={[{ name: "Home", path: "/" }, { name: "Pricing", path: "/pricing" }]} />

      <div className="mb-14 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-slate-100 md:text-5xl">Simple, usage-based pricing</h1>
        <p className="mx-auto mt-4 max-w-xl text-slate-300">
          Try everything free for {SITE.trialDays} days. Unlock once, then pay only for the studies you actually queue.
        </p>
      </div>

      <div className="mb-16 grid grid-cols-1 gap-6 md:grid-cols-2">
        <section aria-labelledby="trial-heading" className="card flex flex-col p-8">
          <h2 id="trial-heading" className="text-sm font-semibold text-emerald-300">
            Free trial
          </h2>
          <p className="mt-2 text-4xl font-bold text-slate-100">$0</p>
          <p className="mt-1 text-sm text-fg-subtle">for {SITE.trialDays} days</p>
          <ul className="mb-8 mt-6 space-y-3 text-sm text-slate-300">
            {[
              "Every study format",
              `${SITE.trialCredits} starter credits included`,
              "Watchlist with thesis tracking",
              "No card required to start",
            ].map((f) => (
              <li key={f} className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden /> {f}
              </li>
            ))}
          </ul>
          <Link href="/signup" className="btn-primary mt-auto w-full px-5 py-3">
            Start free trial <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </section>

        <section aria-labelledby="unlock-heading" className="card relative flex flex-col border-emerald-500/40 p-8">
          <span className="absolute -top-3 right-6 rounded-full border border-emerald-500/40 bg-ink-900 px-3 py-0.5 text-xs font-medium text-emerald-300">
            No subscription
          </span>
          <h2 id="unlock-heading" className="text-sm font-semibold text-slate-300">
            After your trial
          </h2>
          <p className="mt-2 text-4xl font-bold text-slate-100">
            ${SITE.accessPriceUsd} <span className="text-base font-normal text-fg-subtle">one-time</span>
          </p>
          <p className="mt-1 text-sm text-fg-subtle">unlocks the app, then pay per study with credits</p>
          <ul className="mb-8 mt-6 space-y-3 text-sm text-slate-300">
            {[
              "One-time unlock, never a recurring charge",
              `Credit packs: $${SITE.creditPackPriceUsd} for ${SITE.creditPackSize} credits`,
              "Unused credits never expire",
              "Failed studies are refunded automatically",
            ].map((f) => (
              <li key={f} className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden /> {f}
              </li>
            ))}
          </ul>
          <Link href="/signup" className="btn-secondary mt-auto w-full px-5 py-3">
            Start with the free trial first
          </Link>
        </section>
      </div>

      <section aria-labelledby="credits-heading" className="card mb-10 p-8">
        <h2 id="credits-heading" className="text-lg font-semibold text-slate-100">
          Credits per format
        </h2>
        <p className="mb-5 mt-1 text-sm text-fg-subtle">
          1 credit is about $1. Deeper research costs more because it checks more sources and cross-verifies more figures.
          You always see the cost before you queue.
        </p>
        <table className="w-full text-sm">
          <caption className="sr-only">Credits charged per study format</caption>
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
              <tr key={row.variant} className="border-b border-ink-800 last:border-0">
                <th scope="row" className="py-2.5 text-left font-normal text-slate-300">
                  {row.variant}
                </th>
                <td className="py-2.5 text-right tabular-nums text-slate-200">{row.credits}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-5 text-sm text-slate-300">
          Included at no credit cost: {INCLUDED_FREE.join(", ")}. See them on the{" "}
          <Link href="/#features" className="text-emerald-400 underline underline-offset-2 hover:text-emerald-300">
            features overview
          </Link>
          .
        </p>
      </section>

      <p className="text-center text-sm text-fg-subtle">
        Questions about pricing?{" "}
        <a href={`mailto:${SITE.email}`} className="text-emerald-400 underline underline-offset-2 hover:text-emerald-300">
          {SITE.email}
        </a>
      </p>
    </div>
  );
}
