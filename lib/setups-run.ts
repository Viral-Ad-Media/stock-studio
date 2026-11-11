// Runs the daily setup-bot scan (lib/setups.ts) and keeps its paper-tracked
// record current. Called at the end of each worker invocation (the pg_cron
// backstop hits it every minute; the per-session claim below makes that a
// no-op once today's scan exists) and by `npm run engine -- scan-setups`.
import { sql } from "./db";
import { assertTimeLeft } from "./deadline";
import { fetchDailyBars, mapLimit, type DailyBars } from "./marketdata";
import { earningsForTickers, marketDateET } from "./earnings";
import {
  SETUP_UNIVERSE,
  BOTS,
  scanTicker,
  barsThrough,
  resolveOutcome,
  isDescriptiveNote,
  type SetupMatch,
} from "./setups";
import { ENGINE_MODEL, extractStructured } from "./engine/anthropic";
import { UsageMeter } from "./engine/usage";
import { resolveSetupStudyPlan } from "./engine/postcheck";
import { methodologyPromptHash, methodologyVersion } from "./engine/prompts";

// Minutes after 4pm ET before a session counts as complete (Yahoo's daily bar
// settles a little after the close).
const SETTLE_MINUTES = 20;

function etNow(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  return { date: marketDateET(now), minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

// The most recent session whose daily bar is final, from SPY's bars.
export function lastCompletedSession(spyDates: string[], now = new Date()): string | null {
  const et = etNow(now);
  for (let k = spyDates.length - 1; k >= 0; k--) {
    const d = spyDates[k];
    if (d < et.date) return d;
    if (d === et.date && et.minutes >= 16 * 60 + SETTLE_MINUTES) return d;
  }
  return null;
}

type RunResult = {
  ran: boolean;
  session?: string;
  matches?: number;
  resolved?: number;
  resolvedPlans?: number;
  dataSource?: "yahoo" | "alpaca" | "mixed";
  reason?: string;
};

export function summarizeScanDataSource(bars: DailyBars[]): "yahoo" | "alpaca" | "mixed" {
  let yahoo = 0;
  let alpaca = 0;
  for (const b of bars) {
    if (b.source === "alpaca") alpaca++;
    else yahoo++;
  }
  if (alpaca > 0 && yahoo > 0) return "mixed";
  if (alpaca > 0) return "alpaca";
  return "yahoo";
}

export async function maybeRunSetupScan({
  deadline,
  force = false,
  skipDeskNotes = false,
}: {
  deadline: number;
  force?: boolean;
  skipDeskNotes?: boolean;
}): Promise<RunResult> {
  // Cheap exit: the latest done scan is from today (after the close) or the
  // previous weekday — nothing new can exist yet. Skips the Yahoo fetch on
  // nearly every per-minute invocation.
  if (!force) {
    const [last] = await sql`SELECT max(session_date) AS d FROM setup_scans WHERE status = 'done'`;
    if (last?.d && last.d >= expectedLatestSession()) return { ran: false, reason: "up to date" };
  }

  const dataDeadline = deadline - 10_000; // leave time to persist failure or completion
  assertTimeLeft(dataDeadline);
  const spyRaw = await fetchDailyBars("SPY", "2y", 900, dataDeadline);
  const session = lastCompletedSession(spyRaw.dates);
  if (!session) return { ran: false, reason: "no completed session" };

  // Claim the session. A failed run is retried after 15 minutes (not every
  // cron minute — that would hammer Yahoo while it's down), a stale running
  // one after 15 minutes, and a done one only with force.
  const [claim] = await sql`
    INSERT INTO setup_scans (session_date) VALUES (${session})
    ON CONFLICT (session_date) DO UPDATE SET status = 'running', started_at = now(), error = NULL, finished_at = NULL
      WHERE (setup_scans.status = 'error' AND setup_scans.finished_at < now() - interval '15 minutes')
         OR (setup_scans.status = 'running' AND setup_scans.started_at < now() - interval '15 minutes')
         OR ${force}
    RETURNING id
  `;
  if (!claim) return { ran: false, session, reason: "already scanned or in progress" };

  try {
    const spy = barsThrough(spyRaw, session);
    const barsList = await mapLimit(SETUP_UNIVERSE, 8, (t) => fetchDailyBars(t, "2y", 900, dataDeadline), dataDeadline);
    const bars = barsList.filter((b): b is DailyBars => b !== null).map((b) => barsThrough(b, session));
    // A mostly failed fetch must not be recorded as a real (empty) scan.
    if (bars.length < SETUP_UNIVERSE.length * 0.8) {
      throw new Error(`Only ${bars.length}/${SETUP_UNIVERSE.length} tickers loaded — market data unavailable`);
    }
    const dataSource = summarizeScanDataSource(bars);
    const byTicker = new Map(bars.map((b) => [b.symbol, b]));
    let earnings: Awaited<ReturnType<typeof earningsForTickers>> | null = null;
    try {
      earnings = await earningsForTickers(SETUP_UNIVERSE, { back: 10, ahead: 0, deadline: dataDeadline });
    } catch {
      earnings = null; // earnings_gap just finds nothing today
    }

    assertTimeLeft(dataDeadline);
    const matches: SetupMatch[] = [];
    for (const b of bars) {
      // Only tickers that actually traded on the session being scanned.
      if (b.dates.at(-1) !== session) continue;
      matches.push(...scanTicker(b, earnings?.get(b.symbol)));
    }
    const spyAdj = spy.dates.at(-1) === session ? spy.adjCloses.at(-1)! : null;

    const resolved = await resolveOpenMatches(byTicker, spy, dataDeadline);
    const resolvedPlans = await resolveOpenStudyPlans(byTicker, session, dataDeadline);
    const meter = new UsageMeter(ENGINE_MODEL);
    const notes =
      !skipDeskNotes && deadline - Date.now() > 45_000
        ? await deskNotes(session, matches, deadline, meter)
        : null;
    const usageJson =
      meter.totals.calls > 0
        ? {
            ...meter.totals,
            prompt_version: methodologyVersion(),
            prompt_hash: methodologyPromptHash(),
          }
        : null;
    const costUsd = meter.totals.calls > 0 ? meter.costUsd() : null;

    await sql.begin(async (tx) => {
      await tx`DELETE FROM setup_matches WHERE session_date = ${session}`;
      for (const m of matches) {
        const bot = BOTS.find((x) => x.key === m.bot)!;
        await tx`
          INSERT INTO setup_matches
            (scan_id, session_date, bot, symbol, direction, close, adj_close, spy_adj_close,
             levels_json, invalidation_json, detail, horizon_sessions)
          VALUES
            (${claim.id}, ${session}, ${m.bot}, ${m.symbol}, ${m.direction}, ${m.close}, ${m.adjClose}, ${spyAdj},
             ${sql.json(m.levels)}, ${m.invalidation ? sql.json(m.invalidation) : null}, ${m.detail}, ${bot.horizon})
        `;
      }
      await tx`
        UPDATE setup_scans SET status = 'done', universe_size = ${bars.length},
          data_source = ${dataSource},
          notes_json = ${notes ? sql.json(notes) : null},
          usage_json = COALESCE(${usageJson ? sql.json(usageJson) : null}, usage_json),
          cost_usd = CASE WHEN ${costUsd}::numeric IS NULL THEN cost_usd ELSE coalesce(cost_usd, 0) + ${costUsd}::numeric END,
          finished_at = now()
        WHERE id = ${claim.id}
      `;
    });
    return { ran: true, session, matches: matches.length, resolved, resolvedPlans, dataSource };
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
    await sql`UPDATE setup_scans SET status = 'error', error = ${msg}, finished_at = now() WHERE id = ${claim.id}`;
    throw err;
  }
}

// Previous weekday, or today once the session has settled. Holidays make this
// conservative (one extra SPY fetch, cached), never wrong.
function expectedLatestSession(now = new Date()): string {
  const et = etNow(now);
  const d = new Date(`${et.date}T12:00:00Z`);
  const isWeekday = (x: Date) => x.getUTCDay() !== 0 && x.getUTCDay() !== 6;
  if (isWeekday(d) && et.minutes >= 16 * 60 + SETTLE_MINUTES) return et.date;
  do d.setUTCDate(d.getUTCDate() - 1);
  while (!isWeekday(d));
  return d.toISOString().slice(0, 10);
}

// Close out every open match whose horizon has passed, using the bars just
// fetched (anything outside the universe or not yet due stays open).
async function resolveOpenMatches(byTicker: Map<string, DailyBars>, spy: DailyBars, deadline: number): Promise<number> {
  const open = await sql`
    SELECT id, symbol, session_date, adj_close, spy_adj_close, horizon_sessions, invalidation_json
    FROM setup_matches WHERE resolved_at IS NULL ORDER BY id LIMIT 2000
  `;
  let n = 0;
  for (const m of open) {
    assertTimeLeft(deadline);
    const bars = byTicker.get(m.symbol);
    if (!bars) continue;
    const out = resolveOutcome(
      { sessionDate: m.session_date, adjClose: Number(m.adj_close), horizon: m.horizon_sessions, invalidation: m.invalidation_json },
      bars,
      spy,
      m.spy_adj_close != null ? Number(m.spy_adj_close) : null
    );
    if (!out) continue;
    await sql`
      UPDATE setup_matches SET resolved_at = now(), exit_date = ${out.exitDate}, fwd_return = ${out.fwdReturn},
        spy_return = ${out.spyReturn}, invalidated = ${out.invalidated}
      WHERE id = ${m.id} AND resolved_at IS NULL
    `;
    n++;
  }
  return n;
}

const NOTES_TOOL = {
  toolName: "record_desk_notes",
  instructions:
    "Write one short descriptive note per bot that has matches today: what the matched tickers have in common " +
    "(sectors, size of moves, whether it's one theme or scattered), using only the scan data given. 2 sentences max. " +
    "Describe; never advise. Do not use the words buy, sell, short, should, recommend, entry, stop-loss, target or opportunity.",
  schema: {
    type: "object",
    properties: {
      notes: {
        type: "array",
        items: {
          type: "object",
          properties: { bot: { type: "string", enum: BOTS.map((b) => b.key) }, note: { type: "string" } },
          required: ["bot", "note"],
        },
      },
    },
    required: ["notes"],
  },
};

// Resolves open setup-study plans (one_candle / davinci_model, SR 11-7 R2)
// against subsequent daily bars, fetching up to 15 non-universe tickers if needed.
async function resolveOpenStudyPlans(
  byTicker: Map<string, DailyBars>,
  session: string,
  deadline: number
): Promise<number> {
  const open = await sql`
    SELECT id, ticker, session_date, direction, entry_price, stop_price, target_price, horizon_sessions
    FROM setup_study_plans
    WHERE resolved_at IS NULL AND session_date < ${session}
    ORDER BY id LIMIT 500
  `.catch(() => []);
  if (open.length === 0) return 0;

  const extraTickers = [...new Set(open.map((p) => String(p.ticker)))].filter((t) => !byTicker.has(t)).slice(0, 15);
  if (extraTickers.length > 0 && deadline - Date.now() > 15_000) {
    const extraBars = await mapLimit(extraTickers, 4, (t) => fetchDailyBars(t, "6mo", 900, deadline), deadline);
    for (const b of extraBars) {
      if (b) byTicker.set(b.symbol, barsThrough(b, session));
    }
  }

  let n = 0;
  for (const p of open) {
    assertTimeLeft(deadline);
    const bars = byTicker.get(p.ticker);
    if (!bars) continue;
    const out = resolveSetupStudyPlan(
      {
        sessionDate: p.session_date,
        direction: p.direction,
        entryPrice: Number(p.entry_price),
        stopPrice: Number(p.stop_price),
        targetPrice: Number(p.target_price),
        horizonSessions: Number(p.horizon_sessions),
      },
      bars
    );
    if (!out) continue;
    await sql`
      UPDATE setup_study_plans
      SET resolved_at = now(), exit_date = ${out.exitDate}, outcome = ${out.outcome}
      WHERE id = ${p.id} AND resolved_at IS NULL
    `;
    n++;
  }
  return n;
}

// One small model call per session. Any failure (no key, timeout) or any note
// that reads as a directive just means no note — the scan itself stands.
async function deskNotes(
  session: string,
  matches: SetupMatch[],
  deadline: number,
  meter: UsageMeter
): Promise<Record<string, string> | null> {
  if (!process.env.ANTHROPIC_API_KEY || matches.length === 0) return null;
  const data = BOTS.map((b) => ({
    bot: b.key,
    pattern: b.name,
    matches: matches.filter((m) => m.bot === b.key).map((m) => ({ symbol: m.symbol, direction: m.direction, detail: m.detail })),
  })).filter((x) => x.matches.length > 0);
  try {
    const out = await extractStructured<{ notes: { bot: string; note: string }[] }>({
      researchedText: `Pattern-scan results for the ${session} session (rule-based; data only):\n${JSON.stringify(data, null, 2)}`,
      instructions: NOTES_TOOL.instructions,
      toolName: NOTES_TOOL.toolName,
      schema: NOTES_TOOL.schema,
      deadline,
      meter,
    });
    const notes: Record<string, string> = {};
    for (const n of Array.isArray(out.notes) ? out.notes : []) {
      const text = String(n?.note ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
      if (BOTS.some((b) => b.key === n?.bot) && isDescriptiveNote(text)) notes[n.bot] = text;
    }
    return Object.keys(notes).length ? notes : null;
  } catch (err) {
    console.warn("setups: desk notes skipped", err);
    return null;
  }
}
