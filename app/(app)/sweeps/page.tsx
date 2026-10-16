import Link from "next/link";
import { redirect } from "next/navigation";
import { Radar, FlaskConical, Clock3, ArrowUpRight } from "lucide-react";
import { currentUser } from "@/lib/workspace";
import { isSuperAdmin } from "@/lib/admin";
import { readSweepCapture } from "@/lib/sweep/dashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sweep Scanner", description: "Liquidity sweeps, reclaim evidence and shadow testing." };

export default async function SweepsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const admin = await isSuperAdmin(user.id);
  const capture = admin ? await readSweepCapture() : null;
  const report = capture?.report;
  const captured = report?.results.filter(r => r.status === "CAPTURED").length ?? 0;
  const failed = report?.results.filter(r => r.status === "FETCH_FAILED").length ?? 0;
  const skipped = report?.results.filter(r => r.status === "NOT_SCANNED").length ?? 0;
  const timestamp = report ? new Date(report.finishedAt * 1000).toLocaleString("en-US", { timeZone: "America/Chicago" }) + " CT" : null;
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-emerald-400">Market intelligence</p>
          <h1 className="flex items-center gap-3 text-3xl font-bold text-slate-100"><Radar className="h-7 w-7 text-emerald-400" aria-hidden />Sweep Scanner</h1>
          <p className="mt-3 max-w-2xl text-sm text-fg-subtle">Track rapid sweeps through known price levels and the reclaim or rejection that follows.</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300"><FlaskConical className="h-4 w-4" aria-hidden />In development</span>
      </header>
      <section className="card border-amber-500/30 p-6" aria-labelledby="sweep-state">
        <h2 id="sweep-state" className="text-lg font-semibold text-slate-100">Preparing for shadow testing</h2>
        <p className="mt-2 max-w-3xl text-sm text-slate-300">Live alerts are not active. The scanner must reproduce the agreed method and pass historical replay before a measured shadow session begins.</p>
        <p className="mt-2 text-sm text-fg-subtle">There is no verified scanner performance to display yet.</p>
      </section>
      <div className="grid gap-4 md:grid-cols-3">
        {[
          ["01", "Find the sweep", "A fast move through a prior-session or confirmed 15-minute swing level."],
          ["02", "Inspect the reclaim", "Review the closed 1-minute candle, sweep extreme and trend context."],
          ["03", "Plan and review", "Research the company, compare an options scenario and journal the actual fill."],
        ].map(([n, title, body]) => <section key={n} className="card p-5"><p className="font-mono text-xs text-emerald-400">{n}</p><h2 className="mt-3 font-semibold text-slate-100">{title}</h2><p className="mt-2 text-sm text-fg-subtle">{body}</p></section>)}
      </div>
      {admin && <section className="card p-6" aria-labelledby="capture-heading">
        <h2 id="capture-heading" className="flex items-center gap-2 text-lg font-semibold text-slate-100"><Clock3 className="h-5 w-5" aria-hidden />Capture health · admin preview</h2>
        {report ? <>
          <p className="mt-2 text-sm text-fg-subtle">Last pass: {timestamp}. Capture results are not sweep detections.</p>
          {Date.now() / 1000 - report.finishedAt > 600 && <p className="mt-2 text-sm text-amber-300">No capture in the last ten minutes. Check the runner during market hours.</p>}
          <dl className="my-5 grid grid-cols-3 gap-3">{[["Captured", captured], ["Fetch failures", failed], ["Not scanned", skipped]].map(([label, n]) => <div key={label} className="rounded-xl bg-ink-800 p-4"><dt className="text-xs text-fg-subtle">{label}</dt><dd className="mt-1 text-2xl font-semibold text-slate-100">{n}</dd></div>)}</dl>
          <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Latest ticker capture status</caption><thead className="text-fg-subtle"><tr><th className="py-2">Ticker</th><th>Status</th><th>Detail</th><th>Research</th></tr></thead><tbody>{report.results.map(r => <tr key={r.ticker} className="border-t border-ink-700"><th className="py-3 font-mono text-slate-100">{r.ticker}</th><td className="text-slate-300">{r.status.replaceAll("_", " ")}</td><td className="text-fg-subtle">{r.reason ?? "Tape saved"}</td><td><Link href={"/new?ticker=" + encodeURIComponent(r.ticker)} className="inline-flex items-center gap-1 text-emerald-400">Study<ArrowUpRight className="h-3 w-3" aria-hidden /></Link></td></tr>)}</tbody></table></div>
        </> : <p className="mt-3 text-sm text-fg-subtle">{capture?.state === "unavailable" ? "The capture report could not be read. This is a data error, not a zero-alert pass." : capture?.state === "waiting" ? "No capture has completed yet." : "The capture worker is not connected to this deployment."}</p>}
      </section>}
      <p className="text-xs text-fg-subtle">Scanner levels refer to the stock price. Options premiums and actual fills are recorded separately.</p>
    </div>
  );
}
