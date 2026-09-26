import { Suspense } from "react";
import Link from "next/link";
import { Activity, BarChart3, Layers } from "lucide-react";
import { sql, formatDate } from "@/lib/db";
import { currentWorkspaceId } from "@/lib/workspace";
import { getMarketContext, BREADTH_UNIVERSE } from "@/lib/market-context";
import { fetchMovers, type Mover } from "@/lib/marketdata";

export const dynamic = "force-dynamic";

function signed(n: number, unit = "%") {
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}${unit}`;
}

// Direction is carried by the sign and an arrow word for screen readers, not color alone.
function Change({ value, unit = "%" }: { value: number; unit?: string }) {
  const cls = value > 0 ? "text-emerald-400" : value < 0 ? "text-red-400" : "text-slate-300";
  return (
    <span className={`tabular-nums ${cls}`}>
      <span className="sr-only">{value > 0 ? "up " : value < 0 ? "down " : ""}</span>
      {signed(value, unit)}
    </span>
  );
}

export default async function MarketPage() {
  const ws = await currentWorkspaceId();
  const [digest] = ws
    ? await sql`
        SELECT id, as_of_date, created_at, summary_line FROM case_studies
        WHERE workspace_id = ${ws} AND variant = 'movers_digest' AND status = 'ready'
        ORDER BY id DESC LIMIT 1
      `
    : [];

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-100">Market context</h1>
      <p className="mb-6 max-w-[70ch] text-sm text-fg-subtle">
        Where the market is, in plain numbers: sector leadership against the S&amp;P 500, how many large caps are
        participating, and today&apos;s biggest movers. Context for reading your studies. It describes what happened, not
        what to do next.
      </p>

      <Suspense fallback={<Loading label="Loading sector and breadth data…" />}>
        <ContextSections />
      </Suspense>

      <section aria-labelledby="movers-heading" className="mt-6">
        <h2 id="movers-heading" className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-100">
          <Activity className="h-4 w-4 text-emerald-400" aria-hidden /> Today&apos;s biggest movers
        </h2>
        {digest ? (
          <Link href={`/study/${digest.id}`} className="card mb-3 block p-4 text-sm hover:border-ink-500">
            <span className="font-medium text-slate-100">Your latest movers digest</span>{" "}
            <span className="text-fg-subtle">
              · {digest.as_of_date ? `as of ${digest.as_of_date}` : formatDate(digest.created_at)}
            </span>
            {digest.summary_line && <p className="mt-1 text-slate-300">{digest.summary_line}</p>}
          </Link>
        ) : (
          <p className="mb-3 text-sm text-fg-subtle">
            Want the story behind each move? Queue a movers digest from the{" "}
            <Link href="/dashboard" className="text-emerald-400 underline underline-offset-2 hover:text-emerald-300">
              dashboard
            </Link>
            .
          </p>
        )}
        <Suspense fallback={<Loading label="Loading movers…" />}>
          <MoversTables />
        </Suspense>
      </section>

      <p className="mt-8 text-xs text-fg-subtle">
        Data: Yahoo Finance daily closes and screeners, refreshed about every 30 minutes. Educational market context —
        not investment advice.
      </p>
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div className="card p-6 text-sm text-fg-subtle" role="status">
      {label}
    </div>
  );
}

async function ContextSections() {
  let ctx: Awaited<ReturnType<typeof getMarketContext>>;
  try {
    ctx = await getMarketContext();
  } catch {
    return <div className="card p-6 text-sm text-fg-subtle">Market data is unavailable right now. Try again in a few minutes.</div>;
  }
  if (ctx.sectors.length === 0) {
    return <div className="card p-6 text-sm text-fg-subtle">Market data is unavailable right now. Try again in a few minutes.</div>;
  }
  const b = ctx.breadth;
  const asOf = ctx.asOf ? formatDate(new Date(`${ctx.asOf}T12:00:00Z`)) : null;

  return (
    <div className="space-y-6">
      {asOf && <p className="text-sm font-medium text-slate-300">As of the {asOf} close</p>}

      {ctx.spy && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="S&P 500 (SPY) today" value={<Change value={ctx.spy.change1d} />} />
          <Stat label="5 sessions" value={<Change value={ctx.spy.change5d} />} />
          <Stat label="1 month" value={<Change value={ctx.spy.change1m} />} />
          <Stat label="From 52-week high" value={<Change value={ctx.spy.pctFrom52wHigh} />} />
        </div>
      )}

      {ctx.readings.divergence && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm text-amber-200">{ctx.readings.divergence}</p>
      )}

      <section aria-labelledby="rotation-heading" className="card p-4">
        <h2 id="rotation-heading" className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-100">
          <Layers className="h-4 w-4 text-emerald-400" aria-hidden /> Sector rotation
        </h2>
        <p className="mb-3 text-sm text-slate-300">{ctx.readings.rotation}</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <caption className="sr-only">Sector ETF performance, sorted by one-month performance relative to SPY</caption>
            <thead>
              <tr className="border-b border-ink-600 text-left text-xs text-fg-subtle">
                <th scope="col" className="py-2 pr-3 font-medium">Sector</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">1 day</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">5 days</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">1 month</th>
                <th scope="col" className="py-2 pl-3 text-right font-medium">vs SPY (1 mo)</th>
              </tr>
            </thead>
            <tbody>
              {ctx.sectors.map((s) => (
                <tr key={s.symbol} className="border-b border-ink-800">
                  <th scope="row" className="py-2 pr-3 text-left font-normal text-slate-200">
                    {s.name} <span className="font-mono text-xs text-fg-subtle">{s.symbol}</span>
                  </th>
                  <td className="px-3 py-2 text-right"><Change value={s.change1d} /></td>
                  <td className="px-3 py-2 text-right"><Change value={s.change5d} /></td>
                  <td className="px-3 py-2 text-right"><Change value={s.change1m} /></td>
                  <td className="py-2 pl-3 text-right font-medium"><Change value={s.relative1m} unit=" pts" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="breadth-heading" className="card p-4">
        <h2 id="breadth-heading" className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-100">
          <BarChart3 className="h-4 w-4 text-emerald-400" aria-hidden /> Market breadth
        </h2>
        <p className="mb-3 text-sm text-slate-300">{ctx.readings.breadth}</p>
        {b && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Meter label="Above 50-day average" pct={b.pctAbove50} />
            <Meter label="Above 200-day average" pct={b.pctAbove200} />
            <Stat label="Rose / fell last session" value={<span className="tabular-nums text-slate-100">{b.advancers} / {b.decliners}</span>} />
            <Stat label="Near 52-wk high / low" value={<span className="tabular-nums text-slate-100">{b.nearHighs} / {b.nearLows}</span>} />
          </div>
        )}
        <p className="mt-3 text-xs text-fg-subtle">
          Sample: {b?.sampled ?? 0} of {BREADTH_UNIVERSE.length} large caps across all eleven sectors. A proxy for
          large-cap participation, not the full S&amp;P 500.
        </p>
      </section>

      {ctx.missing.length > 0 && <p className="text-xs text-fg-subtle">Couldn&apos;t load: {ctx.missing.join(", ")}.</p>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="card p-3">
      <div className="text-xs text-fg-subtle">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function Meter({ label, pct }: { label: string; pct: number }) {
  return (
    <div className="card p-3">
      <div className="text-xs text-fg-subtle">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-slate-100">{pct}%</div>
      <div
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-700"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className="h-full rounded-full bg-emerald-500/70" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

async function MoversTables() {
  let data: Awaited<ReturnType<typeof fetchMovers>>;
  try {
    data = await fetchMovers(5, 900);
  } catch {
    return <div className="card p-4 text-sm text-fg-subtle">Movers are unavailable right now.</div>;
  }
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <MoverList title="Top gainers" rows={data.gainers} />
      <MoverList title="Top losers" rows={data.losers} />
    </div>
  );
}

function MoverList({ title, rows }: { title: string; rows: Mover[] }) {
  return (
    <div className="card p-4">
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-fg-subtle">None reported.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((m) => (
            <li key={m.symbol} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">
                <span className="font-mono font-bold text-slate-100">{m.symbol}</span>{" "}
                <span className="text-fg-subtle">{m.name}</span>
              </span>
              {m.change_pct != null && <Change value={m.change_pct} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
