import Link from "next/link";
import { Megaphone, ArrowUpRight, ArrowDownRight, Bell, CircleSlash, ShieldCheck, ShieldAlert, Lock, Star } from "lucide-react";
import { sql, formatDate } from "@/lib/db";
import { currentUser, currentWorkspaceId } from "@/lib/workspace";
import { getMembership } from "@/lib/membership";
import { canReadSignals, SIGNAL_FEED_SQL, SIGNAL_HIDDEN_SQL, signalFeedParams, signalHiddenParams } from "@/lib/signal-feed";
import UpgradeCard from "@/components/billing/UpgradeCard";
import EmptyState from "@/components/guide/EmptyState";
import { ACTION_STYLE, SIGNAL_ACTIONS, formatPrice, type SignalAction } from "@/lib/signals";
import PageHeader from "@/components/ui/PageHeader";

export const metadata = { title: "Signals", description: "The program trader's calls, with the full track record." };

export const dynamic = "force-dynamic";

type SignalRow = {
  id: number;
  posted_at: Date;
  action: SignalAction;
  ticker: string;
  instrument: string | null;
  entry: string | null;
  target: string | null;
  stop: string | null;
  detail: string;
  pick: boolean;
};

const TONE: Record<string, { cls: string; Icon: typeof ArrowUpRight }> = {
  up: { cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400", Icon: ArrowUpRight },
  down: { cls: "border-red-500/30 bg-red-500/10 text-red-400", Icon: ArrowDownRight },
  neutral: { cls: "border-ink-500 bg-ink-800 text-slate-300", Icon: CircleSlash },
  alert: { cls: "border-amber-500/30 bg-amber-500/10 text-amber-400", Icon: Bell },
};

// Icon + word, never colour alone.
function ActionBadge({ action }: { action: SignalAction }) {
  const style = ACTION_STYLE[action];
  const { cls, Icon } = TONE[style.tone];
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold ${cls}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden /> {style.label}
    </span>
  );
}

function time(d: Date) {
  return new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET";
}

export default async function SignalsPage() {
  const user = await currentUser();
  const ws = await currentWorkspaceId();
  if (!user || !ws) return null; // proxy.ts already requires a session
  const { ent } = await getMembership(user.id, ws);

  // Members on a plan (and admins) only — not trial accounts.
  if (!canReadSignals(ent.signals)) {
    return (
      <div>
        <PageHeader title="Signals" />
        <UpgradeCard
          title="Signals come with every plan"
          body="Silver gets the trader's pick of the month live, Gold the 2 weekly picks, and Diamond every call the moment it's posted. Each plan also shows the full track record."
          plan="gold"
        />
      </div>
    );
  }

  // Program-wide feed, the same for every member on a plan — no workspace
  // filter, only the plan's visibility rule (lib/signal-feed.ts).
  const [signals, [hidden], counts, [chain]] = await Promise.all([
    sql.unsafe(SIGNAL_FEED_SQL, signalFeedParams(ent.signals, ent.signalDelayDays, 100)) as unknown as Promise<SignalRow[]>,
    ent.signals === "all" ? Promise.resolve([{ n: 0 }]) : sql.unsafe(SIGNAL_HIDDEN_SQL, signalHiddenParams(ent.signals, ent.signalDelayDays)),
    sql`
      SELECT action, count(*)::int AS n,
        count(*) FILTER (WHERE posted_at > now() - interval '30 days')::int AS n30
      FROM signals GROUP BY action
    `,
    sql`SELECT broken_at, checked FROM verify_signal_chain()`,
  ]);
  const byAction = Object.fromEntries(counts.map((c) => [c.action, c])) as Record<string, { n: number; n30: number }>;
  const total = counts.reduce((s, c) => s + Number(c.n), 0);
  const intact = chain.broken_at == null;

  return (
    <div>
      <PageHeader
        className="mb-4"
        title="Signals"
        description="Calls posted by the program's trader, newest first, the moment they go out on Discord. Every call is kept permanently in the track record below: signals can't be edited, deleted or backdated."
      />
      {ent.signals !== "all" && (
        <div className="card mb-6 max-w-[72ch] p-4 text-sm text-slate-300">
          <p className="flex items-center gap-2 font-medium text-slate-100">
            <Lock className="h-4 w-4 text-amber-400" aria-hidden />
            {ent.signals === "weekly"
              ? "Gold: the trader's first 2 BUY calls each week are live for you, with their follow-ups."
              : "Silver: the trader's first BUY call each month is live for you, with its follow-ups."}
          </p>
          <p className="mt-1">
            Every other call appears here {ent.signalDelayDays} days after it&apos;s posted.
            {hidden.n > 0 && ` ${hidden.n} more ${hidden.n === 1 ? "call is" : "calls are"} live for Diamond members right now.`}{" "}
            <Link href="/billing?plan=diamond" className="text-emerald-400 underline-offset-2 hover:underline">See Diamond</Link>
          </p>
        </div>
      )}
      <p className="mb-6 max-w-[72ch] rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-slate-300">
        These are the trader&apos;s own calls, not personalized advice for your situation. Trading involves risk of
        loss, including options losing their full value, and past calls don&apos;t guarantee future results.
      </p>

      {total === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="No signals yet"
          body="The trader's calls appear here as soon as they're posted."
          tips={[
            "Each signal shows the action, the ticker, and any entry, target or stop the trader gave.",
            "Signals are also posted to the members' Discord channel at the same moment.",
            "The track record is permanent: a call can't be edited or removed after it's posted.",
          ]}
        />
      ) : (
        <>
          <section aria-labelledby="record-heading" className="mb-6">
            <h2 id="record-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">Track record</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <div className="card p-4">
                <div className="text-xs text-fg-subtle">All signals</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-100">{total}</div>
              </div>
              {SIGNAL_ACTIONS.map((a) => (
                <div key={a} className="card p-4">
                  <div className="text-xs text-fg-subtle">{ACTION_STYLE[a].label}</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-100">{byAction[a]?.n ?? 0}</div>
                  <div className="text-xs text-fg-subtle">{byAction[a]?.n30 ?? 0} in 30 days</div>
                </div>
              ))}
            </div>
            <p className={`mt-3 flex items-center gap-2 text-sm ${intact ? "text-emerald-400" : "text-red-400"}`} role={intact ? undefined : "alert"}>
              {intact ? <ShieldCheck className="h-4 w-4" aria-hidden /> : <ShieldAlert className="h-4 w-4" aria-hidden />}
              {intact
                ? `Record verified: all ${chain.checked} signals match their tamper-evident hash chain.`
                : `Record check failed at signal #${chain.broken_at}. The record has been altered outside the app; contact support.`}
            </p>
          </section>

          <section aria-labelledby="feed-heading">
            <h2 id="feed-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">
              Latest {Math.min(signals.length, 100)}
            </h2>
            <ol className="space-y-2">
              {signals.map((s) => {
                const levels = [
                  ["Entry", formatPrice(s.entry)],
                  ["Target", formatPrice(s.target)],
                  ["Stop", formatPrice(s.stop)],
                ].filter(([, v]) => v);
                return (
                  <li key={s.id} className="card p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <ActionBadge action={s.action} />
                        <span className="font-mono font-bold text-slate-100">{s.ticker}</span>
                        {s.instrument && <span className="text-xs font-medium text-slate-300">{s.instrument}</span>}
                        {s.pick && (
                          <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-300">
                            <Star className="h-3 w-3" aria-hidden /> {ent.signals === "weekly" ? "Weekly pick" : "Monthly pick"}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-fg-subtle">
                        #{s.id} · {formatDate(s.posted_at)} {time(s.posted_at)}
                      </span>
                    </div>
                    {levels.length > 0 && (
                      <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
                        {levels.map(([k, v]) => (
                          <div key={k} className="flex gap-1.5">
                            <dt className="text-fg-subtle">{k}</dt>
                            <dd className="tabular-nums text-slate-200">{v}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    {s.detail && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-300">{s.detail}</p>}
                  </li>
                );
              })}
            </ol>
          </section>
        </>
      )}
    </div>
  );
}
