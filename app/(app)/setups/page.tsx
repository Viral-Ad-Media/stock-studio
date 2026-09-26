import { Radar, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { sql, formatDate } from "@/lib/db";
import { BOTS, botRecord, type Direction, type Level } from "@/lib/setups";

export const dynamic = "force-dynamic";

type MatchRow = { bot: string; symbol: string; direction: Direction; close: string; levels_json: Level[]; detail: string };
type RecordRow = { bot: string; direction: Direction; fwd_return: number | null; spy_return: number | null; invalidated: boolean | null };

function day(d: string) {
  return formatDate(new Date(`${d}T12:00:00Z`));
}

export default async function SetupsPage() {
  // Market-wide data — the same for every workspace, so no workspace filter.
  const [scan] = await sql`
    SELECT id, session_date, universe_size, notes_json FROM setup_scans
    WHERE status = 'done' ORDER BY session_date DESC LIMIT 1
  `;
  const matches = scan
    ? ((await sql`
        SELECT bot, symbol, direction, close, levels_json, detail FROM setup_matches
        WHERE scan_id = ${scan.id} ORDER BY bot, symbol
      `) as unknown as MatchRow[])
    : [];
  const history = (await sql`
    SELECT bot, direction, fwd_return::float8 AS fwd_return, spy_return::float8 AS spy_return, invalidated
    FROM setup_matches WHERE resolved_at IS NOT NULL
  `) as unknown as RecordRow[];
  const notes: Record<string, string> = scan?.notes_json ?? {};

  return (
    <div>
      <h1 className="mb-1 flex items-center gap-2 text-2xl font-bold text-slate-100">
        <Radar className="h-6 w-6 text-emerald-400" aria-hidden /> Setup bots
      </h1>
      <p className="mb-2 max-w-[72ch] text-sm text-fg-subtle">
        Five rule-based scanners check about 100 large caps after every close for well-known chart patterns. A match
        means a stock&apos;s last session fits a pattern&apos;s published definition. It is not a prediction or a
        suggestion to trade. Every match is tracked afterwards, so you can see how each pattern has really behaved.
      </p>
      {scan ? (
        <p className="mb-6 text-sm font-medium text-slate-300">
          As of the {day(scan.session_date)} close · {scan.universe_size} stocks scanned · {matches.length}{" "}
          {matches.length === 1 ? "match" : "matches"}
        </p>
      ) : (
        <p className="card mb-6 p-4 text-sm text-slate-300" role="status">
          The first scan runs automatically after the next market close.
        </p>
      )}

      <div className="space-y-4">
        {BOTS.map((bot) => {
          const rows = matches.filter((m) => m.bot === bot.key);
          const rec = botRecord(history.filter((h) => h.bot === bot.key));
          return (
            <section key={bot.key} aria-labelledby={`bot-${bot.key}`} className="card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id={`bot-${bot.key}`} className="text-base font-semibold text-slate-100">
                  {bot.name}
                </h2>
                <span className="text-xs text-fg-subtle">
                  {rows.length} {rows.length === 1 ? "match" : "matches"}
                </span>
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
