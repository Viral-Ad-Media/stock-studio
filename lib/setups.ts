// Setup bots — rule-based pattern scanners (adapted from QuantEdgeResearch's
// trade-idea bots, reframed as education). Each bot is a named, published
// chart pattern with fixed rules; a match means "this ticker's last completed
// session fits the pattern's definition", never "trade this". The same feed is
// shown to every user, and every match is paper-tracked so the page can show
// how each pattern has actually behaved. Pure functions — no DB, no fetch.
import type { DailyBars } from "./marketdata";
import type { TickerEarnings } from "./earnings";

// Liquid large caps: the breadth sample plus widely followed names.
export const SETUP_UNIVERSE = [
  "AAPL", "MSFT", "NVDA", "AVGO", "ORCL", "CRM", "AMD", "ADBE", "INTC", "QCOM", "TXN", "MU", "AMAT", "PANW", "NOW", "PLTR", "CRWD",
  "GOOGL", "META", "NFLX", "TMUS", "DIS", "CMCSA", "VZ", "T",
  "AMZN", "TSLA", "HD", "MCD", "NKE", "LOW", "SBUX", "BKNG", "TGT", "UBER", "ABNB",
  "JPM", "BAC", "WFC", "GS", "MS", "C", "SCHW", "AXP", "V", "MA", "PYPL",
  "GE", "CAT", "HON", "UNP", "RTX", "DE", "BA", "LMT", "UPS", "FDX",
  "LLY", "UNH", "JNJ", "ABBV", "MRK", "TMO", "PFE", "AMGN", "GILD", "ISRG", "BMY",
  "XOM", "CVX", "COP", "EOG", "SLB", "OXY", "MPC",
  "LIN", "SHW", "APD", "FCX", "NEM",
  "PG", "KO", "PEP", "COST", "WMT", "MO", "PM",
  "NEE", "SO", "DUK", "AEP",
  "PLD", "AMT", "EQIX", "SPG", "O",
];

export type Level = { label: string; value: number };
export type Direction = "up" | "down";

export type SetupMatch = {
  bot: BotKey;
  symbol: string;
  close: number;
  adjClose: number;
  direction: Direction;
  levels: Level[];
  // The level whose breach means the pattern has failed, per its own rules.
  invalidation: { value: number; when: "close_below" | "close_above" } | null;
  detail: string;
};

export type BotKey = "breakout_52w" | "rsi2_pullback" | "trend_pullback_50" | "volume_surge" | "earnings_gap";

export type Bot = {
  key: BotKey;
  name: string;
  looksFor: string;
  // How long a match is followed for the paper-tracked record, in sessions.
  horizon: number;
  source: string;
};

export const BOTS: Bot[] = [
  {
    key: "breakout_52w",
    name: "52-week breakout",
    looksFor:
      "A close above the highest close of the prior 52 weeks on at least 1.5× the 50-day average volume. The pattern is considered failed on a close back below that old high.",
    horizon: 20,
    source: "Classic breakout/new-high studies (e.g. O'Neil, Darvas)",
  },
  {
    key: "rsi2_pullback",
    name: "Short-term pullback in an uptrend",
    looksFor:
      "A 2-day RSI below 10 while the stock is still above its 200-day average. The published version of this pattern watches for a close back above the 5-day average.",
    horizon: 5,
    source: "Larry Connors' RSI(2) research",
  },
  {
    key: "trend_pullback_50",
    name: "Pullback to a rising 50-day",
    looksFor:
      "A stock in an established uptrend (50-day above a rising 200-day) that has pulled back to touch its rising 50-day average and closed at or above it. Considered failed on a close 3% below the 50-day.",
    horizon: 10,
    source: "Moving-average pullback studies",
  },
  {
    key: "volume_surge",
    name: "Unusual volume",
    looksFor:
      "Volume at least 3× the 50-day average on a move of 4% or more in either direction: a sign that something changed. The day's high and low frame the range.",
    horizon: 5,
    source: "Volume-spike studies",
  },
  {
    key: "earnings_gap",
    name: "Post-earnings gap",
    looksFor:
      "A gap of 5% or more at the open right after an earnings report in the last week that hasn't been filled since. A close back through the pre-report close fills the gap.",
    horizon: 20,
    source: "Post-earnings-announcement drift research",
  },
];

export const BOT_BY_KEY = Object.fromEntries(BOTS.map((b) => [b.key, b])) as Record<BotKey, Bot>;

// ---- indicators ------------------------------------------------------------

export function smaAt(values: number[], n: number, end = values.length - 1): number | null {
  if (end + 1 < n || end < 0) return null;
  let s = 0;
  for (let i = end - n + 1; i <= end; i++) s += values[i];
  return s / n;
}

// Wilder's RSI over the whole series, value at the last bar.
export function rsi(closes: number[], period: number): number | null {
  if (closes.length < period * 10 + 1) return null; // enough history to settle the smoothing
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const usd = (n: number) => `$${n.toFixed(2)}`;
const pct = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n * 100).toFixed(1)}%`;

function avgPriorVolume(b: DailyBars, n = 50): number | null {
  const i = b.volumes.length - 1;
  return smaAt(b.volumes, n, i - 1);
}

function base(b: DailyBars) {
  const i = b.closes.length - 1;
  return { i, close: b.closes[i], adjClose: b.adjCloses[i] };
}

// ---- bots ------------------------------------------------------------------

export function detectBreakout(b: DailyBars): SetupMatch | null {
  const { i, close, adjClose } = base(b);
  if (i < 252) return null;
  const prior = b.closes.slice(i - 251, i);
  const priorHigh = Math.max(...prior);
  const avgVol = avgPriorVolume(b);
  if (!(close > priorHigh) || !avgVol || b.volumes[i] < 1.5 * avgVol) return null;
  const volX = b.volumes[i] / avgVol;
  return {
    bot: "breakout_52w",
    symbol: b.symbol,
    close,
    adjClose,
    direction: "up",
    levels: [{ label: "Prior 52-week closing high", value: r2(priorHigh) }],
    invalidation: { value: r2(priorHigh), when: "close_below" },
    detail: `Closed at ${usd(close)}, above its prior 52-week closing high of ${usd(priorHigh)}, on ${volX.toFixed(1)}× its 50-day average volume.`,
  };
}

export function detectRsi2Pullback(b: DailyBars): SetupMatch | null {
  const { close, adjClose } = base(b);
  const sma200 = smaAt(b.closes, 200);
  const sma5 = smaAt(b.closes, 5);
  const r = rsi(b.closes, 2);
  if (sma200 == null || sma5 == null || r == null) return null;
  if (!(close > sma200 && r < 10)) return null;
  return {
    bot: "rsi2_pullback",
    symbol: b.symbol,
    close,
    adjClose,
    direction: "up",
    levels: [
      { label: "5-day average (pattern's reference)", value: r2(sma5) },
      { label: "200-day average (trend filter)", value: r2(sma200) },
    ],
    invalidation: { value: r2(sma200), when: "close_below" },
    detail: `2-day RSI at ${r.toFixed(1)} while still ${pct(close / sma200 - 1)} above its 200-day average (${usd(sma200)}). The pattern's reference is a close back above the 5-day average (${usd(sma5)}).`,
  };
}

export function detectTrendPullback(b: DailyBars): SetupMatch | null {
  const { i, close, adjClose } = base(b);
  const sma50 = smaAt(b.closes, 50);
  const sma200 = smaAt(b.closes, 200);
  const sma200Prev = smaAt(b.closes, 200, i - 20);
  const sma50Prev = smaAt(b.closes, 50, i - 10);
  if (sma50 == null || sma200 == null || sma200Prev == null || sma50Prev == null) return null;
  const uptrend = sma50 > sma200 && sma200 > sma200Prev && sma50 > sma50Prev && close > sma200;
  const touched = b.lows[i] <= sma50 * 1.01 && close >= sma50;
  // A real pullback: at least 5% above the 50-day at some point in the last 20 sessions.
  let extended = false;
  for (let k = i - 20; k < i; k++) {
    const m = smaAt(b.closes, 50, k);
    if (m != null && b.closes[k] >= m * 1.05) extended = true;
  }
  if (!uptrend || !touched || !extended) return null;
  return {
    bot: "trend_pullback_50",
    symbol: b.symbol,
    close,
    adjClose,
    direction: "up",
    levels: [
      { label: "50-day average", value: r2(sma50) },
      { label: "Failure level (3% below the 50-day)", value: r2(sma50 * 0.97) },
    ],
    invalidation: { value: r2(sma50 * 0.97), when: "close_below" },
    detail: `Pulled back to its rising 50-day average (${usd(sma50)}) with a low of ${usd(b.lows[i])} and closed at ${usd(close)}, while the 50-day holds above a rising 200-day (${usd(sma200)}).`,
  };
}

export function detectVolumeSurge(b: DailyBars): SetupMatch | null {
  const { i, close, adjClose } = base(b);
  if (i < 51) return null;
  const avgVol = avgPriorVolume(b);
  const chg = close / b.closes[i - 1] - 1;
  if (!avgVol || b.volumes[i] < 3 * avgVol || Math.abs(chg) < 0.04) return null;
  const direction: Direction = chg > 0 ? "up" : "down";
  return {
    bot: "volume_surge",
    symbol: b.symbol,
    close,
    adjClose,
    direction,
    levels: [
      { label: "Session high", value: r2(b.highs[i]) },
      { label: "Session low", value: r2(b.lows[i]) },
    ],
    invalidation: direction === "up" ? { value: r2(b.lows[i]), when: "close_below" } : { value: r2(b.highs[i]), when: "close_above" },
    detail: `Moved ${pct(chg)} to ${usd(close)} on ${(b.volumes[i] / avgVol).toFixed(1)}× its 50-day average volume.`,
  };
}

// `earnings` is this ticker's last report from lib/earnings.ts.
export function detectEarningsGap(b: DailyBars, earnings: TickerEarnings | undefined): SetupMatch | null {
  const { i, close, adjClose } = base(b);
  const report = earnings?.last;
  if (!report || i < 6) return null;
  // Reaction session: the report day itself if before the open, else the next session.
  let r = b.dates.indexOf(report.date);
  if (r === -1) {
    r = b.dates.findIndex((d) => d > report.date);
  } else if (report.session !== "pre") {
    r += 1;
  }
  if (r < 1 || r > i || i - r > 4) return null;
  const preClose = b.closes[r - 1];
  const gap = b.opens[r] / preClose - 1;
  if (Math.abs(gap) < 0.05) return null;
  const direction: Direction = gap > 0 ? "up" : "down";
  // Unfilled: no close back through the pre-report close since.
  for (let k = r; k <= i; k++) {
    if (direction === "up" ? b.closes[k] <= preClose : b.closes[k] >= preClose) return null;
  }
  return {
    bot: "earnings_gap",
    symbol: b.symbol,
    close,
    adjClose,
    direction,
    levels: [
      { label: "Pre-report close (gap fill)", value: r2(preClose) },
      { label: direction === "up" ? "Reaction-day low" : "Reaction-day high", value: r2(direction === "up" ? b.lows[r] : b.highs[r]) },
    ],
    invalidation: { value: r2(preClose), when: direction === "up" ? "close_below" : "close_above" },
    detail: `Gapped ${pct(gap)} at the open on ${b.dates[r]} after reporting earnings; now ${usd(close)} versus a pre-report close of ${usd(preClose)}.`,
  };
}

export function scanTicker(b: DailyBars, earnings?: TickerEarnings): SetupMatch[] {
  return [
    detectBreakout(b),
    detectRsi2Pullback(b),
    detectTrendPullback(b),
    detectVolumeSurge(b),
    detectEarningsGap(b, earnings),
  ].filter((m): m is SetupMatch => m !== null);
}

// Cut every series at `date` (inclusive), so a scan only ever sees completed
// sessions — Yahoo's last daily bar is live while the market is open.
export function barsThrough(b: DailyBars, date: string): DailyBars {
  let n = b.dates.length;
  while (n > 0 && b.dates[n - 1] > date) n--;
  return {
    symbol: b.symbol,
    dates: b.dates.slice(0, n),
    opens: b.opens.slice(0, n),
    highs: b.highs.slice(0, n),
    lows: b.lows.slice(0, n),
    closes: b.closes.slice(0, n),
    adjCloses: b.adjCloses.slice(0, n),
    volumes: b.volumes.slice(0, n),
  };
}

// ---- paper tracking --------------------------------------------------------

export type Outcome = {
  exitDate: string;
  exitAdjClose: number;
  fwdReturn: number; // fraction
  spyReturn: number | null;
  invalidated: boolean;
};

// Resolves a match once `horizon` sessions have passed after its session.
// Returns null while it's still open (or the data doesn't reach that far).
export function resolveOutcome(
  m: { sessionDate: string; adjClose: number; horizon: number; invalidation: SetupMatch["invalidation"] },
  bars: DailyBars,
  spy: DailyBars | null,
  spyAdjCloseAtSignal: number | null
): Outcome | null {
  const start = bars.dates.indexOf(m.sessionDate);
  if (start === -1) return null;
  const end = start + m.horizon;
  if (end >= bars.dates.length) return null;
  let invalidated = false;
  if (m.invalidation) {
    for (let k = start + 1; k <= end; k++) {
      const c = bars.closes[k];
      if (m.invalidation.when === "close_below" ? c < m.invalidation.value : c > m.invalidation.value) invalidated = true;
    }
  }
  const exitDate = bars.dates[end];
  const exitAdjClose = bars.adjCloses[end];
  let spyReturn: number | null = null;
  if (spy && spyAdjCloseAtSignal) {
    const j = spy.dates.indexOf(exitDate);
    if (j !== -1) spyReturn = spy.adjCloses[j] / spyAdjCloseAtSignal - 1;
  }
  return { exitDate, exitAdjClose, fwdReturn: exitAdjClose / m.adjClose - 1, spyReturn, invalidated };
}

export type BotRecord = { resolved: number; followedThrough: number; avgExcess: number | null; invalidatedPct: number | null };

// "Followed through" = the move beat SPY in the pattern's direction over the
// horizon. avgExcess is signed by direction (percentage points).
export function botRecord(
  rows: { direction: Direction; fwd_return: number | null; spy_return: number | null; invalidated: boolean | null }[]
): BotRecord {
  const done = rows.filter((r) => r.fwd_return != null && r.spy_return != null);
  if (done.length === 0) return { resolved: 0, followedThrough: 0, avgExcess: null, invalidatedPct: null };
  let ft = 0;
  let excessSum = 0;
  let inv = 0;
  for (const r of done) {
    const excess = (r.fwd_return! - r.spy_return!) * (r.direction === "up" ? 1 : -1);
    if (excess > 0) ft++;
    excessSum += excess;
    if (r.invalidated) inv++;
  }
  return {
    resolved: done.length,
    followedThrough: Math.round((ft / done.length) * 100),
    avgExcess: Math.round((excessSum / done.length) * 1000) / 10,
    invalidatedPct: Math.round((inv / done.length) * 100),
  };
}

// Model-written desk notes must stay descriptive; anything that reads as a
// directive is dropped rather than shown.
const DIRECTIVE_RE = /\b(buy|sell|short|go long|go short|should|recommend|entry|stop[- ]loss|target price|take profit|load up|opportunity to)\b/i;
export function isDescriptiveNote(text: string): boolean {
  return text.trim().length > 0 && !DIRECTIVE_RE.test(text);
}
