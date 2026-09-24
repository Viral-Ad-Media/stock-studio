import Link from "next/link";
import { Check, ArrowRight } from "lucide-react";
import { creditCost } from "@/lib/shared";

export const metadata = {
  title: "Pricing — Stock Studio",
  description: "A 30-day free trial, then a one-time unlock plus pay-as-you-go credits.",
};

// NOTE: the dollar figures on this page are placeholders pending the
// actual Stripe products (Phase 4 of the SaaS build) — confirm real
// pricing before launch. The structure (trial → one-time unlock → credits)
// is the decided model.
// Credit figures come from the same table the billing code charges from.
const CREDIT_COSTS = [
  { variant: "Quick take", credits: creditCost("quick_take") },
  { variant: "Full 4-card study", credits: creditCost("full") },
  { variant: "Deep research memo", credits: creditCost("memo") },
  { variant: "Comparison / watchlist entry", credits: creditCost("comparison") },
  { variant: "Intraday setup check", credits: creditCost("one_candle") },
];

export default function PricingPage() {
  return (
    <div className="max-w-5xl mx-auto px-6 py-16">
      <div className="text-center mb-14">
        <h1 className="text-3xl md:text-4xl font-bold text-slate-100 mb-3">Simple, usage-based pricing</h1>
        <p className="text-slate-500 max-w-xl mx-auto">
          Try everything free for 30 days. Unlock once, then pay only for the studies you
          actually queue.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-16">
        <div className="card p-8">
          <div className="text-sm font-medium text-emerald-400 mb-1">Free trial</div>
          <div className="text-3xl font-bold text-slate-100 mb-1">$0</div>
          <div className="text-sm text-slate-500 mb-6">for 30 days</div>
          <ul className="space-y-3 text-sm text-slate-300 mb-8">
            {[
              "Full access to every study format",
              "Watchlist with automatic refresh",
              "No card required to start",
            ].map((f) => (
              <li key={f} className="flex items-start gap-2">
                <Check className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" /> {f}
              </li>
            ))}
          </ul>
          <Link
            href="/signup"
            className="inline-flex items-center gap-2 w-full justify-center bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-5 py-2.5 rounded-lg"
          >
            Start free trial <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        <div className="card p-8 border-emerald-500/30">
          <div className="text-sm font-medium text-slate-400 mb-1">After your trial</div>
          <div className="text-3xl font-bold text-slate-100 mb-1">
            $79 <span className="text-base font-normal text-slate-500">one-time</span>
          </div>
          <div className="text-sm text-slate-500 mb-6">unlocks the app, then pay per study with credits</div>
          <ul className="space-y-3 text-sm text-slate-300 mb-8">
            {[
              "One-time unlock — no recurring subscription",
              "Credit packs from $10 (10 credits)",
              "Unused credits never expire",
            ].map((f) => (
              <li key={f} className="flex items-start gap-2">
                <Check className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" /> {f}
              </li>
            ))}
          </ul>
          <Link
            href="/signup"
            className="inline-flex items-center gap-2 w-full justify-center border border-ink-600 hover:border-ink-500 text-slate-200 font-medium px-5 py-2.5 rounded-lg"
          >
            Start with the free trial first
          </Link>
        </div>
      </div>

      <div className="card p-8 mb-10">
        <h2 className="text-lg font-semibold text-slate-100 mb-1">How credits work</h2>
        <p className="text-sm text-slate-500 mb-5">
          1 credit ≈ $1. Deeper research costs more because it does more — more sources checked,
          more figures cross-verified. You always see the cost before you queue a study.
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 border-b border-ink-700">
              <th className="pb-2 font-medium">Format</th>
              <th className="pb-2 font-medium text-right">Credits</th>
            </tr>
          </thead>
          <tbody>
            {CREDIT_COSTS.map((row) => (
              <tr key={row.variant} className="border-b border-ink-800 last:border-0">
                <td className="py-2.5 text-slate-300">{row.variant}</td>
                <td className="py-2.5 text-right text-slate-400">{row.credits}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-center text-sm text-slate-500">
        Questions about pricing?{" "}
        <a href="mailto:support@stockstudio.app" className="text-emerald-400 hover:underline">
          support@stockstudio.app
        </a>
      </div>
    </div>
  );
}
