import { Suspense } from "react";
import Link from "next/link";
import { Sigma } from "lucide-react";
import { getGexSnapshot, bucketStrikes, formatGexDollars, GEX_PRESETS } from "@/lib/gex";
import { parseTicker, isInvalid } from "@/lib/validate";
import { formatDate } from "@/lib/shared";
import GexChart from "@/components/gamma/GexChart";

export const dynamic = "force-dynamic";

export default async function GammaPage({ searchParams }: { searchParams: Promise<{ symbol?: string }> }) {
  const { symbol: raw } = await searchParams;
  const parsed = parseTicker(raw ?? "SPY");
  const invalid = isInvalid(parsed) || parsed.includes(" VS ");
  const symbol = invalid ? "SPY" : (parsed as string).replace(/^[\^_]/, "");

  return (
    <div>
      <h1 className="mb-1 flex items-center gap-2 text-2xl font-bold text-slate-100">
        <Sigma className="h-6 w-6 text-emerald-400" aria-hidden /> Gamma exposure
      </h1>
      <p className="mb-5 max-w-[72ch] text-sm text-fg-subtle">
        A model of how options dealers might need to hedge as the price moves, built from open interest on every listed
        strike. Useful for understanding why some price areas attract or repel trading. It is an estimate resting on
        assumptions (below), not a forecast.
      </p>

      <form method="get" className="mb-2 flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="gex-symbol" className="field-label">
            Symbol
          </label>
          <input id="gex-symbol" name="symbol" defaultValue={symbol} className="input w-36 font-mono uppercase" maxLength={12} />
        </div>
        <button type="submit" className="btn-primary px-4 py-2 text-sm">
          Load
        </button>
      </form>
      <nav aria-label="Popular symbols" className="mb-6 flex flex-wrap gap-2 text-sm">
        {GEX_PRESETS.map((p) => (
          <Link
            key={p}
            href={`/gamma?symbol=${p}`}
            aria-current={p === symbol ? "page" : undefined}
            className={`rounded-lg border px-3 py-1.5 font-mono ${
              p === symbol ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300" : "border-ink-500 text-slate-300 hover:bg-ink-800"
            }`}
          >
            {p}
          </Link>
        ))}
      </nav>
      {invalid && raw && (
        <p role="alert" className="mb-4 text-sm text-red-400">
          &ldquo;{String(raw).slice(0, 20)}&rdquo; isn&apos;t a valid symbol. Showing SPY.
        </p>
      )}

      <Suspense key={symbol} fallback={<div className="card p-6 text-sm text-fg-subtle" role="status">Loading the {symbol} options chain…</div>}>
        <GexSection symbol={symbol} />
      </Suspense>

      <section aria-labelledby="gex-method" className="mt-6 max-w-[72ch] text-sm text-slate-300">
        <h2 id="gex-method" className="mb-2 text-sm font-semibold text-slate-100">How this is calculated, and its limits</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Each contract&apos;s gamma is computed with Black-Scholes from its implied volatility, then scaled to the dollars
            of stock that would have to change hands per 1% move: gamma × open interest × 100 × price² × 1%.
          </li>
          <li>
            <strong className="text-slate-100">The key assumption:</strong> dealers are long the calls and short the puts
            that customers hold, so call open interest counts as positive gamma and put open interest as negative. Real
            positioning isn&apos;t public, and this convention is often wrong for individual strikes.
          </li>
          <li>The zero-gamma level is where the modeled total crosses zero when the price is shifted ±15%.</li>
          <li>
            Open interest updates once a day, and the chain is 15-minute delayed (CBOE). Contracts within ±25% of the
            price and a year of expiry are included.
          </li>
        </ul>
        <p className="mt-3 text-xs text-fg-subtle">Educational model of options positioning. Not a trade recommendation.</p>
      </section>
    </div>
  );
}

async function GexSection({ symbol }: { symbol: string }) {
  let snap: Awaited<ReturnType<typeof getGexSnapshot>>;
  try {
    snap = await getGexSnapshot(symbol);
  } catch {
    return <div className="card p-6 text-sm text-fg-subtle">The options chain is unavailable right now. Try again in a few minutes.</div>;
  }
  if (!snap || snap.contracts === 0) {
    return <div className="card p-6 text-sm text-fg-subtle">No listed options with open interest were found for {symbol}.</div>;
  }
  return (
    <div className="space-y-4">
      <p className="card p-4 text-sm text-slate-300">{snap.reading}</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Net gamma per 1% move" value={formatGexDollars(snap.totalGex)} />
        <Stat label="Zero-gamma level" value={snap.zeroGamma != null ? `$${snap.zeroGamma.toFixed(2)}` : "Not in ±15%"} />
        <Stat label="Largest call strike above" value={snap.callWall != null ? `$${snap.callWall}` : "—"} />
        <Stat label="Largest put strike below" value={snap.putWall != null ? `$${snap.putWall}` : "—"} />
      </div>
      <GexChart
        strikes={bucketStrikes(snap.strikes, 40)}
        spot={snap.spot}
        zeroGamma={snap.zeroGamma}
        symbol={snap.symbol}
        bucketed={snap.strikes.length > 40}
      />
      <p className="text-xs text-fg-subtle">
        {snap.contracts.toLocaleString("en-US")} contracts across {snap.expirations} expirations · calls{" "}
        {formatGexDollars(snap.callGex)}, puts {formatGexDollars(-snap.putGex)} · loaded {formatDate(snap.fetchedAt)}{" "}
        {new Date(snap.fetchedAt).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })} ET
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-3">
      <div className="text-xs text-fg-subtle">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-slate-100">{value}</div>
    </div>
  );
}
