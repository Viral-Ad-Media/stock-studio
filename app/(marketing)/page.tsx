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
} from "lucide-react";

export const metadata = {
  title: "Stock Studio — fact-checked stock case studies",
  description:
    "Queue a ticker, get a source-cited, business-quality case study in minutes — growth, profitability, valuation, and moat, verified against real filings.",
};

const VARIANTS = [
  { icon: FileText, name: "Full 4-card study", desc: "Growth, profitability, valuation, and moat — each with a clear verdict and a bear case." },
  { icon: BarChart3, name: "Quick take", desc: "One condensed card and a single biggest risk, for when you just need the headline." },
  { icon: Newspaper, name: "Deep research memo", desc: "Source table, bear/base/bull scenarios, and a valuation sensitivity grid." },
  { icon: GitCompare, name: "Comparison", desc: "Two or more tickers, side by side, on growth, margins, valuation, and moat." },
  { icon: Eye, name: "Watchlist tracking", desc: "Compact thesis + triggers per ticker, refreshed automatically as news breaks." },
  { icon: Zap, name: "Intraday setup checks", desc: "One-candle and liquidity-model checklists evaluated against real OHLC data — never invented." },
];

export default function LandingPage() {
  return (
    <div>
      {/* Hero */}
      <section className="max-w-4xl mx-auto px-6 pt-20 pb-16 text-center">
        <h1 className="text-4xl md:text-5xl font-bold text-slate-100 tracking-tight mb-5">
          Stock research that shows its work.
        </h1>
        <p className="text-lg text-slate-400 max-w-2xl mx-auto mb-8">
          Queue a ticker. Get a fact-checked, source-cited case study — growth, profitability,
          valuation, and moat — verified against real filings and earnings releases, not
          generated from memory.
        </p>
        <div className="flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
          <Link
            href="/signup"
            className="btn-primary w-full whitespace-nowrap px-6 py-3 sm:w-auto"
          >
            Start your free trial <ArrowRight className="w-4 h-4" aria-hidden />
          </Link>
          <Link
            href="/pricing"
            className="btn-secondary w-full whitespace-nowrap px-6 py-3 sm:w-auto"
          >
            See pricing
          </Link>
        </div>
        <p className="text-xs text-fg-subtle mt-4">
          30-day free trial. No card required to start. Educational analysis — not investment advice.
        </p>
      </section>

      {/* What every study opens with */}
      <section className="max-w-4xl mx-auto px-6 pb-16">
        <div className="card p-6">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-fg-subtle mb-3">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Every study, no exceptions
          </div>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-sm text-slate-300">
            <li>Opens with a visible &ldquo;As of [date]&rdquo; line — no stale numbers passed off as current</li>
            <li>Cites SEC filings, earnings releases, and reputable finance sources by name</li>
            <li>Never invents a metric — missing data is flagged, not guessed</li>
            <li>Shows conflicting source figures side by side instead of silently picking one</li>
            <li>&ldquo;Acceleration&rdquo; claims are checked quarter-by-quarter, not asserted</li>
            <li>A bear case and specific &ldquo;what would change my mind&rdquo; triggers, every time</li>
          </ul>
        </div>
      </section>

      {/* Formats */}
      <section className="max-w-5xl mx-auto px-6 pb-16">
        <h2 className="text-2xl font-bold text-slate-100 text-center mb-2">One engine, the format you need</h2>
        <p className="text-fg-subtle text-center mb-10 max-w-xl mx-auto">
          Same fact-checking discipline underneath — pick the shape that fits how you'll use it.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {VARIANTS.map(({ icon: Icon, name, desc }) => (
            <div key={name} className="card p-5">
              <Icon className="w-5 h-5 text-emerald-400 mb-3" />
              <div className="font-medium text-slate-100 mb-1">{name}</div>
              <div className="text-sm text-fg-subtle">{desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-4xl mx-auto px-6 pb-20">
        <h2 className="text-2xl font-bold text-slate-100 text-center mb-10">How it works</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { n: "1", t: "Queue a ticker", d: "Pick a format — quick take, full study, comparison — and add any notes you want fact-checked." },
            { n: "2", t: "The engine researches it", d: "Real web search against filings, earnings releases, and finance data — not a single cached answer." },
            { n: "3", t: "Read the verdict", d: "A clear ✅/⚠️/🔴 per section, sources listed, and any corrections to your notes called out separately." },
          ].map(({ n, t, d }) => (
            <div key={n} className="text-center">
              <div className="w-9 h-9 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold flex items-center justify-center mx-auto mb-3">
                {n}
              </div>
              <div className="font-medium text-slate-100 mb-1">{t}</div>
              <div className="text-sm text-fg-subtle">{d}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="max-w-3xl mx-auto px-6 pb-24 text-center">
        <div className="card p-10">
          <h2 className="text-2xl font-bold text-slate-100 mb-2">Try it on a ticker you already know</h2>
          <p className="text-fg-subtle mb-6">
            The fastest way to trust it is to check its work against something you understand.
          </p>
          <Link
            href="/signup"
            className="btn-primary w-full whitespace-nowrap px-6 py-3 sm:w-auto"
          >
            Start your free trial <ArrowRight className="w-4 h-4" aria-hidden />
          </Link>
        </div>
      </section>
    </div>
  );
}
