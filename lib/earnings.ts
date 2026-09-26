// Earnings calendar from Nasdaq's public calendar API (no key). Adapted from
// QuantEdgeResearch's earnings-calendar service. An earnings date means
// variance is coming, not which way — the UI shows it as a scheduled event,
// never as a signal.
import { mapLimit } from "./marketdata";

export type EarningsEvent = {
  symbol: string;
  company: string;
  date: string; // YYYY-MM-DD (the session it reports on)
  session: "pre" | "post" | null; // before the open / after the close / unspecified
  epsForecast: number | null;
  fiscalQuarter: string | null;
};

// Today's date in US market time, YYYY-MM-DD.
export function marketDateET(d = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((new Date(`${to}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) / 86_400_000);
}

function parseSession(t: unknown): EarningsEvent["session"] {
  const s = String(t ?? "").toLowerCase();
  if (s.includes("pre-market")) return "pre";
  if (s.includes("after-hours")) return "post";
  return null;
}

// "$2.33", "($0.14)" for negatives, "" / "N/A" when absent.
export function parseEps(v: unknown): number | null {
  const s = String(v ?? "").trim();
  if (!/\d/.test(s)) return null;
  const n = Number(s.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n)) return null;
  return /\(.*\)|^-/.test(s) ? -n : n;
}

export function parseEarningsRows(date: string, body: unknown): EarningsEvent[] {
  const rows: unknown[] = (body as { data?: { rows?: unknown[] } })?.data?.rows ?? [];
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r) => {
      const row = r as Record<string, unknown>;
      return {
        symbol: String(row.symbol ?? "").trim().toUpperCase(),
        company: String(row.name ?? "").trim(),
        date,
        session: parseSession(row.time),
        epsForecast: parseEps(row.epsForecast),
        fiscalQuarter: row.fiscalQuarterEnding ? String(row.fiscalQuarterEnding) : null,
      };
    })
    .filter((e) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(e.symbol));
}

async function fetchDay(date: string): Promise<EarningsEvent[]> {
  const res = await fetch(`https://api.nasdaq.com/api/calendar/earnings?date=${date}`, {
    headers: { "User-Agent": "Mozilla/5.0 (stock-studio earnings calendar)", Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
    // A day's calendar barely changes; past days never do.
    cache: "force-cache",
    next: { revalidate: date < marketDateET() ? 86_400 : 21_600 },
  });
  if (!res.ok) throw new Error(`Nasdaq earnings calendar returned ${res.status}`);
  return parseEarningsRows(date, await res.json());
}

export type TickerEarnings = { last: EarningsEvent | null; next: EarningsEvent | null };

// Most recent report in the last `back` days and the next one within `ahead`
// days, for each ticker. Weekends are skipped (nobody reports on Saturday),
// and a day that fails to load is just missing — this is context, not a gate.
export async function earningsForTickers(
  tickers: string[],
  { back = 7, ahead = 30 }: { back?: number; ahead?: number } = {}
): Promise<Map<string, TickerEarnings>> {
  const wanted = new Set(tickers.map((t) => t.toUpperCase()));
  const out = new Map<string, TickerEarnings>();
  if (wanted.size === 0) return out;

  const today = marketDateET();
  const days: string[] = [];
  for (let i = -back; i <= ahead; i++) {
    const d = addDays(today, i);
    const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) days.push(d);
  }
  const results = await mapLimit(days, 6, fetchDay);

  results.forEach((events) => {
    for (const e of events ?? []) {
      if (!wanted.has(e.symbol)) continue;
      const cur = out.get(e.symbol) ?? { last: null, next: null };
      if (e.date < today || (e.date === today && e.session === "pre")) {
        if (!cur.last || e.date > cur.last.date) cur.last = e;
      } else if (!cur.next || e.date < cur.next.date) {
        cur.next = e;
      }
      out.set(e.symbol, cur);
    }
  });
  return out;
}

export function sessionLabel(s: EarningsEvent["session"]): string {
  return s === "pre" ? "before the open" : s === "post" ? "after the close" : "time not confirmed";
}
