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

// Pre-record numeric sanity rule (SR 11-7 R5 / SS-09): catches inverted
// stops/targets, missing @entry when tp/sl are supplied, and missing-decimal
// magnitude typos before record_signal writes to the immutable hash chain.
export function validateSignalLevels(sig: ParsedSignal): string | null {
  const { action, instrument, entry, target, stop } = sig;
  if (target == null && stop == null) return null;

  if (action === "EXIT" || action === "CLOSE") {
    return "EXIT/CLOSE signals record an exit fill (`@price`), not new `tp`/`sl` levels.";
  }
  if (entry == null) {
    return "Include `@entry` whenever `tp` or `sl` is specified so levels can be sanity-checked.";
  }

  // Plausible magnitude bands relative to entry (catches e.g. `@12.40 sl 110`).
  const isOption = instrument === "CALL" || instrument === "PUT";
  const minTargetRatio = isOption ? 0.1 : 0.2;
  const maxTargetRatio = isOption ? 15 : 3.0;
  const minStopRatio = isOption ? 0.05 : 0.2;
  const maxStopRatio = isOption ? 3.0 : 2.0;

  if (target != null && (target < entry * minTargetRatio || target > entry * maxTargetRatio)) {
    return `Target (${target}) is outside plausible range relative to entry (${entry}) — check for a typo.`;
  }
  if (stop != null && (stop < entry * minStopRatio || stop > entry * maxStopRatio)) {
    return `Stop (${stop}) is outside plausible range relative to entry (${entry}) — check for a typo.`;
  }

  // Directional ordering checks.
  if (action === "BUY" && instrument !== "PUT") {
    if (target != null && !(target > entry)) {
      return `For BUY ${instrument ?? "stock"}, target (${target}) must be above entry (${entry}).`;
    }
    if (stop != null && !(stop < entry)) {
      return `For BUY ${instrument ?? "stock"}, stop (${stop}) must be below entry (${entry}).`;
    }
  } else if (action === "SELL" && instrument === null) {
    if (target != null && !(target < entry)) {
      return `For SELL stock, target (${target}) must be below entry (${entry}).`;
    }
    if (stop != null && !(stop > entry)) {
      return `For SELL stock, stop (${stop}) must be above entry (${entry}).`;
    }
  } else {
    // PUTs, SELL CALL/PUT, or ALERT with levels: entry must still sit strictly
    // between stop and target when both are given, and neither may equal entry.
    if (target != null && target === entry) {
      return `Target (${target}) cannot equal entry (${entry}).`;
    }
    if (stop != null && stop === entry) {
      return `Stop (${stop}) cannot equal entry (${entry}).`;
    }
    if (target != null && stop != null) {
      const entryBetween = (stop < entry && entry < target) || (target < entry && entry < stop);
      if (!entryBetween) {
        return `Entry (${entry}) must sit strictly between stop (${stop}) and target (${target}) — check for a typo.`;
      }
    }
  }

  return null;
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
  const parsed: ParsedSignal = {
    action: m[1].toUpperCase() as SignalAction,
    ticker,
    instrument: inst ? (inst.startsWith("CALL") ? "CALL" : "PUT") : null,
    entry: num(ENTRY_RE, detail),
    target: num(TARGET_RE, detail),
    stop: num(STOP_RE, detail),
    detail,
  };
  const levelError = validateSignalLevels(parsed);
  if (levelError) return { error: levelError };
  return parsed;
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
