import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { currentUser, currentWorkspaceId } from "@/lib/workspace";
import { getBillingState } from "@/lib/billing";
import { isSuperAdmin } from "@/lib/admin";
import { getMarketContext } from "@/lib/market-context";
import { marketDateET } from "@/lib/earnings";
import { marketDay, timestampET } from "@/lib/data-freshness";
import { TODAY_RESEARCH_SQL, TODAY_THESIS_SQL, TODAY_EARNINGS_SQL, TODAY_SETUP_SQL, canReadSignals } from "@/lib/today";
import { VARIANTS } from "@/lib/shared";
import { parseStoredGrade } from "@/lib/grades";
import GradeBadge from "@/components/insights/GradeBadge";
import EarningsPanel from "@/components/insights/EarningsPanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Today", description: "Your daily research, thesis, earnings and market overview." };

export default async function TodayPage() {
  // Defense in depth: this page requires a session even if the proxy's
  // configuration changes. All tenant queries use this server-resolved ws.
  const user = await currentUser();
  if (!user) redirect("/login");
  const ws = await currentWorkspaceId();
  if (!ws) return <p role="alert">Your workspace is unavailable. Please sign in again.</p>;
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-emerald-400">{marketDay(marketDateET())} · New York market date</p>
          <h1 className="text-3xl font-bold tracking-tight text-slate-100">Today</h1>
          <p className="mt-2 max-w-[65ch] text-sm text-fg-subtle">Research the company. Track the thesis. Review the latest market context. Data below may describe an earlier session; each section shows its own date.</p>
        </div>
        <Link href="/new" className="btn-primary px-4 py-2 text-sm">New study</Link>
      </header>

      <Suspense fallback={<Loading title="Market context" />}><MarketOverview /></Suspense>
      <div className="grid gap-4 lg:grid-cols-2">
        <Suspense fallback={<Loading title="Theses needing review" />}><ThesisOverview ws={ws} /></Suspense>
        <Suspense fallback={<Loading title="Latest research" />}><ResearchOverview ws={ws} /></Suspense>
      </div>
      <Suspense fallback={<Loading title="Earnings calendar" />}><EarningsOverview ws={ws} /></Suspense>
      <div className="grid gap-4 lg:grid-cols-2">
        <Suspense fallback={<Loading title="Latest setup scan" />}><SetupOverview /></Suspense>
        <Suspense fallback={<Loading title="Member signals" />}><SignalOverview userId={user.id} ws={ws} /></Suspense>
      </div>
      <p className="text-xs text-fg-subtle">This overview reads existing reports and scans; opening it does not queue research or spend report credits. Research and pattern scans are educational, not trade recommendations.</p>
    </div>
  );
}

function Panel({ title, href, children }: { title: string; href: string; children: React.ReactNode }) {
  return <section className="card p-5">
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-base font-semibold text-slate-100">{title}</h2>
      <Link href={href} className="shrink-0 text-xs text-emerald-400 underline underline-offset-2">View all<span className="sr-only">: {title}</span></Link>
    </div>
    {children}
  </section>;
}

function Loading({ title }: { title: string }) {
  return <section className="card p-5" role="status"><h2 className="font-semibold text-slate-100">{title}</h2><p className="mt-2 text-sm text-fg-subtle">Loading…</p></section>;
}

function Unavailable({ title, href, error }: { title: string; href: string; error: unknown }) {
  console.error(`today: ${title} unavailable`, error);
  return <Panel title={title} href={href}><p className="text-sm text-fg-subtle">This section is unavailable right now. Other sections can still be used.</p></Panel>;
}

async function MarketOverview() {
  try {
    const ctx = await getMarketContext();
    if (!ctx.spy || !ctx.asOf) return <Panel title="Market context" href="/market"><p className="text-sm text-fg-subtle">Market data is unavailable right now.</p></Panel>;
    return <Panel title="Market context" href="/market">
      <p className="mb-3 text-xs text-fg-subtle">Source: Yahoo Finance daily bars · Latest bar: {marketDay(ctx.asOf)} · May be in progress during the session; not live quotes</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["SPY · 1 session", ctx.spy.change1d], ["SPY · 5 sessions", ctx.spy.change5d], ["SPY · 1 month", ctx.spy.change1m]].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg border border-ink-700 p-3">
            <p className="text-xs text-fg-subtle">{label}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-slate-100">{Number(value) > 0 ? "+" : ""}{Number(value).toFixed(1)}%</p>
          </div>
        ))}
        <div className="rounded-lg border border-ink-700 p-3"><p className="text-xs text-fg-subtle">Large caps above 50-day average</p><p className="mt-1 text-lg font-semibold text-slate-100">{ctx.breadth ? `${ctx.breadth.pctAbove50}%` : "Unavailable"}</p></div>
      </div>
      <p className="mt-3 text-sm text-slate-300">{ctx.readings.rotation}</p>
      {ctx.readings.divergence && <p className="mt-2 text-sm text-amber-300">{ctx.readings.divergence}</p>}
      <p className="mt-3 text-xs text-fg-subtle">Breadth sample: {ctx.breadth?.sampled ?? 0} large caps, not the full S&amp;P 500. Daily series are cached for about 30 minutes.{ctx.missing.length > 0 && ` Some data could not be loaded: ${ctx.missing.join(", ")}.`}</p>
    </Panel>;
  } catch (error) { return <Unavailable title="Market context" href="/market" error={error} />; }
}

async function ThesisOverview({ ws }: { ws: string }) {
  try {
    const rows = await sql.unsafe(TODAY_THESIS_SQL, [ws]);
    return <Panel title="Theses needing review" href="/watchlist">
      {rows.length === 0 ? <p className="text-sm text-fg-subtle">No tracked theses are currently marked weakening or broken. This reflects the latest saved research, not continuous monitoring.</p> : <ul className="divide-y divide-ink-800">{rows.map((r) => <li key={r.id} className="py-3 first:pt-0">
        <Link href="/watchlist" className="font-mono font-bold text-slate-100 underline underline-offset-2">{r.ticker}</Link>
        <span className="ml-2 rounded border border-amber-500/30 px-2 py-0.5 text-xs text-amber-300">{r.thesis_status}</span>
        <p className="mt-1 text-sm text-slate-300">{r.thesis_status_note || "Review the thesis and its triggers in your watchlist."}</p>
        <p className="mt-1 text-xs text-fg-subtle">Research as of {r.as_of_date || "an unspecified date"} · Updated {timestampET(r.updated_at)}</p>
      </li>)}</ul>}
    </Panel>;
  } catch (error) { return <Unavailable title="Theses needing review" href="/watchlist" error={error} />; }
}

async function ResearchOverview({ ws }: { ws: string }) {
  try {
    const rows = await sql.unsafe(TODAY_RESEARCH_SQL, [ws]);
    return <Panel title="Latest research" href="/dashboard">
      {rows.length === 0 ? <p className="text-sm text-fg-subtle">Your completed studies appear here. <Link href="/new" className="text-emerald-400 underline">Queue your first study</Link>.</p> : <ul className="divide-y divide-ink-800">{rows.map((r) => {
        const grade = parseStoredGrade(r.grade_json);
        return <li key={r.id} className="py-3 first:pt-0"><Link href={`/study/${r.id}`} className="block rounded hover:bg-ink-800">
          <div className="flex items-center gap-2">{grade && <GradeBadge grade={grade} />}<span className="font-mono font-bold text-slate-100">{r.ticker}</span></div>
          <p className="mt-1 text-sm text-slate-300">{r.summary_line || VARIANTS.find((v) => v.value === r.variant)?.label || r.variant}</p>
          <p className="mt-1 text-xs text-fg-subtle">Research as of {r.as_of_date || "an unspecified date"} · Updated {timestampET(r.updated_at)}</p>
        </Link></li>;
      })}</ul>}
    </Panel>;
  } catch (error) { return <Unavailable title="Latest research" href="/dashboard" error={error} />; }
}

async function EarningsOverview({ ws }: { ws: string }) {
  try {
    const rows = await sql.unsafe(TODAY_EARNINGS_SQL, [ws]);
    if (!rows.length) return <Panel title="Earnings calendar" href="/watchlist"><p className="text-sm text-fg-subtle">Add companies to your watchlist or complete a study to see their earnings dates.</p></Panel>;
    const studyByTicker = Object.fromEntries(rows.filter((r) => r.study_id != null).map((r) => [r.ticker, Number(r.study_id)]));
    return <EarningsPanel tickers={rows.map((r) => r.ticker)} studyByTicker={studyByTicker} />;
  } catch (error) { return <Unavailable title="Earnings calendar" href="/watchlist" error={error} />; }
}

async function SetupOverview() {
  try {
    const [scan] = await sql.unsafe(TODAY_SETUP_SQL);
    return <Panel title="Latest setup scan" href="/setups">
      {scan ? <><p className="text-2xl font-semibold tabular-nums text-slate-100">{scan.matches} pattern matches</p><p className="mt-2 text-sm text-slate-300">Across {scan.universe_size} stocks in the latest completed scan.</p><p className="mt-2 text-xs text-fg-subtle">Source: Stock Studio rule-based scanners using Yahoo Finance bars · As of {marketDay(scan.session_date)} close. These are pattern matches, not trader calls.</p></> : <p className="text-sm text-fg-subtle">No completed scan yet. Matches appear after the worker completes a market-close scan.</p>}
    </Panel>;
  } catch (error) { return <Unavailable title="Latest setup scan" href="/setups" error={error} />; }
}

async function SignalOverview({ userId, ws }: { userId: string; ws: string }) {
  try {
    const [billing, admin] = await Promise.all([getBillingState(userId, ws), isSuperAdmin(userId)]);
    // Check entitlement BEFORE querying the program-wide feed. A trial is
    // research access, not signal access. Fail closed if either check fails.
    if (!canReadSignals(billing.accessGranted, admin)) return <Panel title="Member signals" href="/billing"><p className="text-sm text-fg-subtle">Unlock full access to see the program trader&apos;s calls. Signals are not included in trial access.</p></Panel>;
    const rows = await sql`SELECT id, posted_at, action, ticker, instrument, detail FROM signals ORDER BY id DESC LIMIT 3`;
    return <Panel title="Member signals" href="/signals">
      {rows.length ? <ul className="divide-y divide-ink-800">{rows.map((r) => <li key={r.id} className="py-2 first:pt-0"><p className="font-mono text-sm font-semibold text-slate-100">{r.action} {r.ticker} {r.instrument}</p><p className="mt-1 text-sm text-slate-300">{r.detail}</p><p className="mt-1 text-xs text-fg-subtle">Posted {timestampET(r.posted_at)}</p></li>)}</ul> : <p className="text-sm text-fg-subtle">No trader calls have been posted yet.</p>}
      <p className="mt-3 text-xs text-fg-subtle">Source: program trader. General calls shared with members, not personalized advice. Trading involves loss risk; options can lose their full value. See Signals for the complete record.</p>
    </Panel>;
  } catch (error) { return <Unavailable title="Member signals" href="/signals" error={error} />; }
}
