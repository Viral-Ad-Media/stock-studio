// Trade signals: parsing the trader's one-line input, the approved-poster
// list, and display helpers. Shared by the Discord bot (scripts/signal-bot.ts)
// and the /signals page. Client-safe — no database or Discord imports.

export const SIGNAL_ACTIONS = ["BUY", "SELL", "EXIT", "CLOSE", "ALERT"] as const;
export type SignalAction = (typeof SIGNAL_ACTIONS)[number];

export type ParsedSignal = {
  action: SignalAction;
  ticker: string;
  instrument: "CALL" | "PUT" | null;
  entry: number | null;
  target: number | null;
  stop: number | null;
  detail: string; // everything after the ticker, as typed
};

// Same shape the database CHECK enforces: NVDA, BRK.B, BTC-USD.
export const TICKER_RE = /^[A-Z][A-Z0-9]{0,5}([.-][A-Z0-9]{1,4})?$/;
export const MAX_DETAIL = 1000;

const LINE_RE = /^\s*(BUY|SELL|EXIT|CLOSE|ALERT)\s+([A-Za-z][A-Za-z0-9]{0,5}(?:[.-][A-Za-z0-9]{1,4})?)\b\s*([\s\S]*)$/i;
const NUM = String.raw`\$?(\d{1,7}(?:\.\d{1,4})?)`;
const ENTRY_RE = new RegExp(String.raw`(?:^|\s)@\s*${NUM}`, "i");
const TARGET_RE = new RegExp(String.raw`\b(?:tp|pt|target)\s*[:=]?\s*${NUM}`, "i");
const STOP_RE = new RegExp(String.raw`\b(?:sl|stop)\s*[:=]?\s*${NUM}`, "i");
const INSTRUMENT_RE = /\b(CALLS?|PUTS?)\b/i;

export const SIGNAL_FORMAT_HELP =
  "Format: `ACTION TICKER [CALL|PUT] [@entry] [tp target] [sl stop] notes` — e.g. " +
  "`BUY GOOGL CALL @12.40 tp 15 sl 11 breakout over 285`. Actions: BUY, SELL, EXIT, CLOSE, ALERT.";

function num(re: RegExp, text: string): number | null {
  const m = text.match(re);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// One input line → a signal, or an error to show the poster.
export function parseSignal(text: string | null | undefined): ParsedSignal | { error: string } {
  const m = (text ?? "").match(LINE_RE);
  if (!m) return { error: SIGNAL_FORMAT_HELP };
  const ticker = m[2].toUpperCase();
  if (!TICKER_RE.test(ticker)) return { error: `"${m[2]}" doesn't look like a ticker. ${SIGNAL_FORMAT_HELP}` };
  const detail = m[3].trim();
  if (detail.length > MAX_DETAIL) return { error: `Keep the details under ${MAX_DETAIL} characters.` };
  const inst = detail.match(INSTRUMENT_RE)?.[1].toUpperCase();
  return {
    action: m[1].toUpperCase() as SignalAction,
    ticker,
    instrument: inst ? (inst.startsWith("CALL") ? "CALL" : "PUT") : null,
    entry: num(ENTRY_RE, detail),
    target: num(TARGET_RE, detail),
    stop: num(STOP_RE, detail),
    detail,
  };
}

export function isParseError(p: ParsedSignal | { error: string }): p is { error: string } {
  return "error" in p;
}

// SIGNAL_POSTER_IDS: comma-separated Discord user IDs allowed to post. The
// bot refuses to start without at least one, so a misconfigured deploy can't
// quietly accept signals from everyone in the channel.
export function parsePosterIds(raw: string | undefined): Set<string> {
  const ids = (raw ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => /^\d{5,25}$/.test(s));
  return new Set(ids);
}

export const ACTION_STYLE: Record<SignalAction, { label: string; tone: "up" | "down" | "neutral" | "alert"; color: number }> = {
  BUY: { label: "Buy", tone: "up", color: 0x2ecc71 },
  SELL: { label: "Sell", tone: "down", color: 0xe74c3c },
  EXIT: { label: "Exit", tone: "down", color: 0xe74c3c },
  CLOSE: { label: "Close", tone: "neutral", color: 0x95a5a6 },
  ALERT: { label: "Alert", tone: "alert", color: 0xf1c40f },
};

export function formatPrice(n: number | string | null | undefined): string | null {
  if (n == null) return null;
  const v = Number(n);
  return Number.isFinite(v) ? `$${v.toFixed(2)}` : null;
}
