import { Radar, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { sql, formatDate } from "@/lib/db";
import EmptyState from "@/components/guide/EmptyState";
import {
  BOTS,
  VOLUME_DEPENDENT_BOTS,
  botRecord,
  isBotUnderperforming,
  type Direction,
  type Level,
} from "@/lib/setups";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import { currentMembership } from "@/lib/membership";

export const metadata = { title: "Setup bots", description: "Rule-based pattern scans with a paper-tracked record." };

export const dynamic = "force-dynamic";

type MatchRow = { bot: string; symbol: string; direction: Direction; close: string; levels_json: Level[]; detail: string };
type RecordRow = { bot: string; direction: Direction; fwd_return: number | null; spy_return: number | null; invalidated: boolean | null };

function day(d: string) {
  return formatDate(new Date(`${d}T12:00:00Z`));
}

export default async function SetupsPage() {
  // Market-wide data — the same for every workspace, so no workspace filter.
  // Silver sees each bot's track record; today's matches and desk notes are Gold and Diamond.
  const live = (await currentMembership())?.ent.setupsLive ?? true;
  const [scan] = await sql`
    SELECT id, session_date, universe_size, data_source, notes_json FROM setup_scans
    WHERE status = 'done' ORDER BY session_date DESC LIMIT 1
  `;
  const matches = scan && live
    ? ((await sql`
        SELECT bot, symbol, direction, close, levels_json, detail FROM setup_matches
        WHERE scan_id = ${scan.id} ORDER BY bot, symbol
      `) as unknown as MatchRow[])
    : [];
  const history = (await sql`
    SELECT bot, direction, fwd_return::float8 AS fwd_return, spy_return::float8 AS spy_return, invalidated
    FROM setup_matches WHERE resolved_at IS NOT NULL ORDER BY resolved_at DESC, id DESC
  `) as unknown as RecordRow[];
  const notes: Record<string, string> = (live && scan?.notes_json) || {};

  return (
    <div>
      <PageHeader
        title="Setup bots"
        description="Five rule-based scanners check about 100 large caps after every close for well-known chart patterns. A match means a stock's last session fits a pattern's published definition. It is not a prediction or a suggestion to trade. Every match is tracked afterwards, so you can see how each pattern has really behaved."
      />
      {scan ? (
        <div className="mb-6 space-y-2">
          <p className="text-sm font-medium text-slate-300">
            As of the {day(scan.session_date)} close · {scan.universe_size} stocks scanned
            {scan.data_source ? ` · feed: ${scan.data_source === "yahoo" ? "Yahoo consolidated" : scan.data_source === "alpaca" ? "Alpaca IEX fallback" : "Yahoo + Alpaca mixed"}` : ""}
            {live ? <> · {matches.length} {matches.length === 1 ? "match" : "matches"}</> : null}
          </p>
          {(scan.data_source === "alpaca" || scan.data_source === "mixed") && (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              Data-source note: {scan.data_source === "alpaca" ? "this scan used" : "part of this scan used"} Alpaca&apos;s IEX feed (single-exchange volume). Volume-ratio scanners (52-week breakout and Unusual volume) automatically skip IEX-sourced tickers to avoid partial-volume false matches.
            </p>
          )}
        </div>
      ) : (
        <div className="mb-6">
          <EmptyState
            icon={Radar}
            title="The first scan runs after the next market close"
            body="Once a trading session has closed, the bots check about 100 large caps against each pattern below and list every match here. Nothing to set up."
            tips={[
              "Read each bot's definition below; a match means the stock fits that published rule, not that it will move.",
              "Each match shows the pattern's own reference and failure levels.",
              "Every match is followed afterwards, so each bot builds a track record over time.",
            ]}
          />
        </div>
      )}

      {scan && !live && (
        <p className="mb-6 card p-4 text-sm text-slate-300">
          Your plan shows each bot&apos;s track record. Today&apos;s matches and the AI desk notes are part of Gold and Diamond.{" "}
          <Link href="/billing?plan=gold" className="text-emerald-400 underline-offset-2 hover:underline">See plans</Link>
        </p>
      )}
      <div className="space-y-4">
        {BOTS.map((bot) => {
          const rows = matches.filter((m) => m.bot === bot.key);
          const botHist = history.filter((h) => h.bot === bot.key);
          const rec = botRecord(botHist);
          const trailing60 = botRecord(botHist.slice(0, 60));
          const underperforming = isBotUnderperforming(trailing60);
          const skippedForIex = scan?.data_source === "alpaca" && VOLUME_DEPENDENT_BOTS.has(bot.key);
          return (
            <section key={bot.key} aria-labelledby={`bot-${bot.key}`} className="card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 id={`bot-${bot.key}`} className="text-base font-semibold text-slate-100">
                    {bot.name}
                  </h2>
                  {underperforming && (
                    <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300">
                      Trailing 60 follow-through &lt; 50% ({trailing60.followedThrough}%)
                    </span>
                  )}
                  {skippedForIex && (
                    <span className="rounded border border-slate-600 bg-ink-800 px-2 py-0.5 text-[11px] text-fg-subtle">
                      Skipped on IEX volume fallback
                    </span>
                  )}
                </div>
                {live && (
                  <span className="text-xs text-fg-subtle">
                    {rows.length} {rows.length === 1 ? "match" : "matches"}
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-slate-300">{bot.looksFor}</p>
              <p className="mt-1 text-xs text-fg-subtle">Based on: {bot.source}</p>

              {notes[bot.key] && (
                <p className="mt-3 rounded-lg border border-ink-600 bg-ink-800 p-3 text-sm text-slate-300">
                  <span className="font-medium text-slate-100">AI desk note: </span>
                  {notes[bot.key]}
                </p>
              )}

              {rows.length > 0 && (
                <ul className="mt-3 divide-y divide-ink-800">
                  {rows.map((m) => (
                    <li key={m.symbol} className="py-2.5">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-mono font-bold text-slate-100">{m.symbol}</span>
                        <span className="inline-flex items-center gap-1 text-xs text-slate-300">
                          {m.direction === "up" ? (
                            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                          ) : (
                            <ArrowDownRight className="h-3.5 w-3.5" aria-hidden />
                          )}
                          {m.direction === "up" ? "Upside pattern" : "Downside pattern"}
                        </span>
                        <span className="text-sm tabular-nums text-slate-300">${Number(m.close).toFixed(2)}</span>
                      </div>
                      <p className="mt-1 text-sm text-slate-300">{m.detail}</p>
                      {m.levels_json?.length > 0 && (
                        <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                          {m.levels_json.map((l) => (
                            <div key={l.label} className="flex gap-1">
                              <dt className="text-fg-subtle">{l.label}:</dt>
                              <dd className="tabular-nums text-slate-200">${l.value.toFixed(2)}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-3 border-t border-ink-800 pt-3 text-xs text-fg-subtle">
                {rec.resolved === 0 ? (
                  <>Track record: no matches have completed their {bot.horizon}-session follow-up yet.</>
                ) : (
                  <>
                    Track record over {bot.horizon} sessions, {rec.resolved} past {rec.resolved === 1 ? "match" : "matches"}:{" "}
                    <span className="text-slate-300">{rec.followedThrough}% moved further in the pattern&apos;s direction than SPY</span>,
                    average {rec.avgExcess! >= 0 ? "+" : "−"}
                    {Math.abs(rec.avgExcess!).toFixed(1)} pts vs SPY; {rec.invalidatedPct}% hit the pattern&apos;s failure level.
                    {rec.resolved < 30 && " Small sample: treat as anecdotal."}
                  </>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <p className="mt-6 max-w-[72ch] text-xs text-fg-subtle">
        Hypothetical tracking: returns are measured close-to-close from the match session using adjusted prices, with no
        costs, and don&apos;t represent real trades. Past pattern behavior doesn&apos;t predict future results.
        Educational pattern scanning, not a trade recommendation.
      </p>
    </div>
  );
}
