import type { Metadata } from "next";
import { PLANS, PLAN_IDS } from "@/lib/plans";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  FileText,
  BarChart3,
  Eye,
  Newspaper,
  Zap,
  GitCompare,
  Search,
  ListChecks,
  BadgeCheck,
} from "lucide-react";
import ProductMockup, {
  type MockupKind,
} from "@/components/marketing/ProductMockup";
import MarketMotion from "@/components/marketing/MarketMotion";
import JsonLd, {
  organizationLd,
  ORGANIZATION_ID,
} from "@/components/seo/JsonLd";
import { SITE, absoluteUrl } from "@/lib/site";
import { PUBLIC_EXAMPLE as example } from "@/lib/public-example";

export const metadata: Metadata = {
  title: {
    absolute: "Stock Studio: research-led LEAPS planning & decision review",
  },
  description: SITE.description,
  alternates: { canonical: "/" },
};

const GUARANTEES = [
  "Opens with a visible “As of” date, so numbers are never passed off as current",
  "Cites SEC filings, earnings releases and reputable finance sources by name",
  "Never invents a metric: missing data is flagged, not guessed",
  "Shows conflicting source figures side by side instead of silently picking one",
  "“Acceleration” claims are checked quarter by quarter, not asserted",
  "A bear case and specific “what would change my mind” triggers, every time",
];

const FEATURES = [
  {
    id: "studies",
    title: "A verdict you can check, card by card",
    body: "Every study answers four questions: is the business growing, is it profitable, what are you paying for it, and how durable is its advantage. Each card ends in a clear verdict, and a research grade sums up how the business scores on the verified facts.",
    bullets: [
      "Growth, profitability, valuation and moat, each with a verdict",
      "Research grade with the fact behind every score",
      "Corrections to your own notes called out separately",
    ],
    shot: "study" as MockupKind,
  },
  {
    id: "dashboard",
    title: "Every study and every earnings date in one place",
    body: "Each study card carries its grade and a one-line summary of what the numbers mean. Upcoming and just-reported earnings for the companies you follow sit on top, with a link to update the study after a report.",
    bullets: [
      "One-sentence summary on every card",
      "Earnings calendar for your tickers",
      "Live build status while research runs",
    ],
    shot: "dashboard" as MockupKind,
  },
  {
    id: "watchlist",
    title: "Know when a thesis starts to crack",
    body: "Each watchlist refresh re-checks the previous thesis against what has happened since and marks it intact, weakening or broken, citing the specific development. Every version is kept as a timeline.",
    bullets: [
      "Thesis status with the reason behind it",
      "Triggers to watch for each ticker",
      "A timeline of every earlier thesis",
    ],
    shot: "watchlist" as MockupKind,
  },
  {
    id: "market",
    title: "Where the market is, in plain numbers",
    body: "Sector performance against the S&P 500, how many large caps are participating, and today's biggest movers, with a plain-English reading of what the numbers say. Context for your studies, not a signal.",
    bullets: [
      "Sector rotation versus SPY",
      "Breadth across large caps",
      "Today's top gainers and losers",
    ],
    shot: "market" as MockupKind,
  },
  {
    id: "setups",
    title: "Pattern scanners that keep score on themselves",
    body: "Five rule-based bots scan about 100 large caps after every close for well-known chart patterns, from 52-week breakouts to post-earnings gaps. Every match is tracked afterwards, so each bot shows how its pattern has really behaved.",
    bullets: [
      "Published pattern rules, not black boxes",
      "An AI desk note describing each day's matches",
      "A paper-tracked record against SPY",
    ],
    shot: "setups" as MockupKind,
  },
  {
    id: "gamma",
    title: "See how options positioning shapes the tape",
    body: "A dealer-gamma model for SPY, SPX, QQQ, IWM or any optionable stock, built from CBOE's delayed options data: net gamma per 1% move, the zero-gamma level and the largest strikes, with the model's assumptions spelled out.",
    bullets: [
      "Strike-by-strike gamma chart",
      "Zero-gamma level and largest call and put strikes",
      "Plain-English reading of the model",
    ],
    shot: "gamma" as MockupKind,
  },

  {
    id: "journal",
    title: "Close the loop on your decisions",
    body: "Record actual entries and exits, connect the trade to your research, and review realized results after fees. Import mapped CSV lots after reviewing a preview.",
    bullets: [
      "Research links and entry/exit reviews",
      "Realized P&L and strategy contributions",
      "CSV preview, import and export",
    ],
    shot: "journal" as MockupKind,
  },
  {
    id: "leaps",
    title: "See what changes when your assumptions do",
    body: "Compare long-dated options using delayed chains or manual assumptions. Explore price, time and volatility scenarios before recording an actual trade separately.",
    bullets: [
      "Early-exit and expiration comparisons",
      "Greeks and disclosed model assumptions",
      "Optional sensitivity explorer and saved scenarios",
    ],
    shot: "leaps" as MockupKind,
  },
];

const FORMATS = [
  {
    icon: FileText,
    name: "Full 4-card study",
    desc: "Growth, profitability, valuation and moat, each with a verdict, plus a bear case.",
  },
  {
    icon: BarChart3,
    name: "Quick take",
    desc: "One condensed card and the single biggest risk, for when you need the headline.",
  },
  {
    icon: Newspaper,
    name: "Deep research memo",
    desc: "Source table, bear, base and bull scenarios, and a valuation sensitivity grid.",
  },
  {
    icon: GitCompare,
    name: "Comparison",
    desc: "Two or more tickers side by side on growth, margins, valuation and moat.",
  },
  {
    icon: Eye,
    name: "Watchlist tracking",
    desc: "Thesis and triggers per ticker, re-checked as news and earnings land.",
  },
  {
    icon: Zap,
    name: "Intraday setup checks",
    desc: "One-candle and liquidity-model checklists run against real price data.",
  },
];

const STEPS = [
  {
    icon: Search,
    t: "Queue a ticker",
    d: "Pick a format and add any notes you want fact-checked. You see the credit cost before you queue.",
  },
  {
    icon: ListChecks,
    t: "The engine researches it",
    d: "Live search across filings, earnings releases and market data, not one cached answer from memory.",
  },
  {
    icon: BadgeCheck,
    t: "Read the verdict",
    d: "A clear verdict per card, every source listed, and any corrections to your notes shown separately.",
  },
];

const FAQ = [
  {
    q: "Is this investment advice?",
    a: "No. Stock Studio's case studies are educational business analysis, and every study ends with a not-investment-advice line. Members on a paid plan can also follow the program trader's own buy and sell calls in Signals. Those are general calls shared with every member, not advice tailored to you, and trading involves risk of loss.",
  },
  {
    q: "Where do the numbers come from?",
    a: "Company earnings releases and investor-relations material, SEC filings such as 10-Qs and 10-Ks, and market data. Sources are listed on every study, and conflicting figures are shown side by side.",
  },
  {
    q: "What happens if data is missing?",
    a: "The study says what is missing and uses a safer substitute. It never estimates or invents a figure to fill the gap.",
  },
  {
    q: "How does the free trial work?",
    a: `You get ${SITE.trialDays} days and ${SITE.trialCredits} starter credits, with no card required. The trial has Gold features. After that, pick Silver ($${PLANS.silver.monthlyUsd}/month), Gold ($${PLANS.gold.monthlyUsd}/month) or Diamond ($${PLANS.diamond.monthlyUsd}/month); each includes monthly credits, and you can cancel any time.`,
  },
  {
    q: "What do the product previews show?",
    a: "Theme-aware illustrations of Stock Studio’s workflows using fictional companies and sample numbers. They are not live accounts, broker statements, verified results or market quotes.",
  },
];

export default function LandingPage() {
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      organizationLd(),
      {
        "@type": "WebSite",
        "@id": `${SITE.url}/#website`,
        url: SITE.url,
        name: SITE.name,
        description: SITE.description,
        publisher: { "@id": ORGANIZATION_ID },
        inLanguage: "en-US",
      },
      {
        "@type": "SoftwareApplication",
        name: SITE.name,
        url: SITE.url,
        applicationCategory: "FinanceApplication",
        operatingSystem: "Web",
        description: SITE.description,
        image: absoluteUrl("/opengraph-image.png"),
        publisher: { "@id": ORGANIZATION_ID },
        offers: [
          {
            "@type": "Offer",
            name: "Free trial",
            price: "0",
            priceCurrency: "USD",
            url: absoluteUrl("/pricing"),
          },
          ...PLAN_IDS.map((id) => ({
            "@type": "Offer",
            name: `${PLANS[id].name} plan, monthly`,
            price: String(PLANS[id].monthlyUsd),
            priceCurrency: "USD",
            url: absoluteUrl("/pricing"),
          })),
        ],
      },
      {
        "@type": "FAQPage",
        mainEntity: FAQ.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
    ],
  };

  return (
    <div>
      <JsonLd data={ld} />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <MarketMotion />
        <div className="relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-6 pb-16 pt-16 lg:grid-cols-[1fr_1.15fr] lg:pb-24 lg:pt-24">
          <div>
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Every figure
              sourced, every study dated
            </p>
            <h1 className="text-4xl font-bold tracking-tight text-slate-100 sm:text-5xl lg:text-[3.4rem] lg:leading-[1.05]">
              Research the company. Plan the trade. Review the decision.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-slate-300">
              Build a source-cited company thesis, track what changes, compare
              long-dated options scenarios, then record your actual fills and
              review the decision. Research-led LEAPS planning in one workspace.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/signup"
                className="btn-primary w-full whitespace-nowrap px-6 py-3 sm:w-auto"
              >
                Start your free trial{" "}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <Link
                href="/examples"
                className="btn-secondary w-full px-5 py-3 text-center sm:w-auto"
              >
                Explore a real research example
              </Link>
            </div>
            <p className="mt-4 text-sm text-fg-subtle">
              {SITE.trialDays}-day free trial with {SITE.trialCredits} credits.
              No card required.
            </p>
          </div>

          <div className="relative">
            {/* Decorative depth layer behind the main shot; hidden from assistive tech. */}
            <div
              aria-hidden
              className="absolute -left-10 -top-8 hidden w-[72%] rotate-[-2deg] [filter:brightness(0.55)] lg:block"
            >
              <ProductMockup kind="dashboard" compact />
            </div>
            <ProductMockup
              kind="study"
              className="relative lg:ml-10 lg:mt-10"
            />
          </div>
        </div>
      </section>

      {/* Guarantees */}
      <section
        aria-labelledby="guarantees-heading"
        className="mx-auto max-w-6xl px-6 pb-20"
      >
        <div className="card p-6 sm:p-8">
          <h2
            id="guarantees-heading"
            className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-emerald-300"
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden /> Every study, no
            exceptions
          </h2>
          <ul className="mt-4 grid grid-cols-1 gap-x-10 gap-y-3 text-sm text-slate-300 md:grid-cols-2">
            {GUARANTEES.map((g) => (
              <li key={g} className="flex items-start gap-2">
                <CheckCircle2
                  className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400"
                  aria-hidden
                />
                {g}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Features */}
      <section
        id="features"
        aria-labelledby="features-heading"
        className="scroll-mt-20"
      >
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2
            id="features-heading"
            className="text-3xl font-bold tracking-tight text-slate-100 sm:text-4xl"
          >
            Everything around the study, too
          </h2>
          <p className="mt-3 text-slate-300">
            Research, tracking and market context in one workspace. The previews
            below illustrate the current workspace using fictional companies and
            sample numbers.
          </p>
        </div>
        <div className="mx-auto max-w-6xl space-y-24 px-6 py-16 lg:space-y-32 lg:py-24">
          {FEATURES.map((f, i) => (
            <article
              key={f.id}
              id={f.id}
              className="grid scroll-mt-24 grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-16"
            >
              <div className={i % 2 ? "lg:order-2" : ""}>
                <h3 className="text-2xl font-bold tracking-tight text-slate-100 sm:text-3xl">
                  {f.title}
                </h3>
                <p className="mt-4 text-slate-300">{f.body}</p>
                <ul className="mt-5 space-y-2 text-sm text-slate-300">
                  {f.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-2">
                      <span
                        className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400"
                        aria-hidden
                      />
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
              <ProductMockup
                kind={f.shot}
                className={i % 2 ? "lg:order-1" : ""}
              />
            </article>
          ))}
        </div>
      </section>

      <section
        className="mx-auto max-w-6xl px-6 py-12"
        aria-labelledby="evidence-heading"
      >
        <div className="card flex flex-wrap items-center justify-between gap-6 p-6 sm:p-8">
          <div className="max-w-2xl">
            <h2 id="evidence-heading" className="text-2xl font-semibold">
              Check a source. Try the decision workflow.
            </h2>
            <p className="mt-3 text-sm text-fg-subtle">
              Inspect Apple’s {example.period} earnings excerpt with primary-source links,
              then explore a hypothetical research-to-review demonstration. No
              account required.
            </p>
            <p className="mt-3 text-sm text-slate-300">
              ${example.revenueBillion} billion revenue · {example.growthPercent}%
              {" "}year-over-year growth · sources checked {example.reviewedOn}
            </p>
          </div>
          <Link href="/examples" className="btn-primary px-5 py-3">
            View example &amp; interactive demo
          </Link>
        </div>
      </section>
      {/* How it works — follows the selected theme */}
      <section
        id="how-it-works"
        aria-labelledby="how-heading"
        className="scroll-mt-16 border-y border-ink-700 bg-ink-900/45 text-slate-100"
      >
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2
            id="how-heading"
            className="text-center text-3xl font-bold tracking-tight sm:text-4xl"
          >
            How it works
          </h2>
          <ol className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
            {STEPS.map(({ icon: Icon, t, d }, i) => (
              <li
                key={t}
                className="rounded-xl border border-ink-700 bg-ink-900 p-6"
              >
                <div className="flex items-center gap-3">
                  <span
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/15 text-sm font-bold text-emerald-400"
                    aria-hidden
                  >
                    {i + 1}
                  </span>
                  <Icon className="h-5 w-5 text-emerald-400" aria-hidden />
                </div>
                <h3 className="mt-4 font-semibold">{t}</h3>
                <p className="mt-2 text-sm text-fg-subtle">{d}</p>
              </li>
            ))}
          </ol>

          <h2 className="mt-20 text-center text-2xl font-bold tracking-tight sm:text-3xl">
            One engine, the format you need
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-fg-subtle">
            The same fact-checking underneath. Pick the shape that fits how you
            will use it; see{" "}
            <Link
              href="/pricing"
              className="font-medium text-emerald-400 underline underline-offset-2"
            >
              credit costs per format
            </Link>
            .
          </p>
          <ul className="mt-10 grid grid-cols-1 gap-x-10 md:grid-cols-2 lg:grid-cols-3">
            {FORMATS.map(({ icon: Icon, name, desc }) => (
              <li
                key={name}
                className="flex gap-3 border-t border-ink-700 py-5"
              >
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" aria-hidden />
                <div>
                  <h3 className="font-semibold text-slate-100">{name}</h3>
                  <p className="mt-1 text-sm text-fg-subtle">{desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* FAQ */}
      <section
        id="faq"
        aria-labelledby="faq-heading"
        className="mx-auto max-w-3xl scroll-mt-20 px-6 py-20"
      >
        <h2
          id="faq-heading"
          className="text-center text-3xl font-bold tracking-tight text-slate-100"
        >
          Questions
        </h2>
        <div className="mt-10 divide-y divide-ink-700 rounded-xl border border-ink-700">
          {FAQ.map((f) => (
            <details key={f.q} className="group p-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-slate-100">
                {f.q}
                <span
                  className="text-emerald-400 transition-transform group-open:rotate-45"
                  aria-hidden
                >
                  +
                </span>
              </summary>
              <p className="mt-3 text-sm text-slate-300">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="rounded-2xl border border-emerald-500/30 bg-ink-900 p-10 text-center sm:p-14">
          <h2 className="text-2xl font-bold text-slate-100 sm:text-3xl">
            Try it on a ticker you already know
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-slate-300">
            The fastest way to trust it is to check its work against a company
            you understand.
          </p>
          <Link
            href="/signup"
            className="btn-primary mt-8 w-full whitespace-nowrap px-6 py-3 sm:w-auto"
          >
            Start your free trial <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </section>
    </div>
  );
}
