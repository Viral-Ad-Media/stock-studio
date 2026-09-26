// Market context: sector rotation vs SPY and large-cap breadth (adapted from
// QuantEdgeResearch's sector-rotation and market-breadth services). Every
// number comes from Yahoo daily closes, and every "what this means" sentence
// is generated here from those numbers — descriptive context, never a signal.
import { fetchDailyCloses, mapLimit, type DailyCloses } from "./marketdata";

export const SECTORS = [
  { symbol: "XLK", name: "Technology" },
  { symbol: "XLC", name: "Communication Services" },
  { symbol: "XLY", name: "Consumer Discretionary" },
  { symbol: "XLF", name: "Financials" },
  { symbol: "XLI", name: "Industrials" },
  { symbol: "XLV", name: "Health Care" },
  { symbol: "XLE", name: "Energy" },
  { symbol: "XLB", name: "Materials" },
  { symbol: "XLP", name: "Consumer Staples" },
  { symbol: "XLU", name: "Utilities" },
  { symbol: "XLRE", name: "Real Estate" },
];

// ~5 of the largest names per sector: a bounded proxy for large-cap breadth,
// not the whole S&P 500 (the page says so).
export const BREADTH_UNIVERSE = [
  "AAPL", "MSFT", "NVDA", "AVGO", "ORCL", "CRM", "AMD",
  "GOOGL", "META", "NFLX", "TMUS", "DIS",
  "AMZN", "TSLA", "HD", "MCD", "NKE", "LOW",
  "JPM", "BAC", "WFC", "GS", "V", "MA",
  "GE", "CAT", "HON", "UNP", "RTX", "DE",
  "LLY", "UNH", "JNJ", "ABBV", "MRK", "TMO",
  "XOM", "CVX", "COP", "EOG", "SLB",
  "LIN", "SHW", "APD", "FCX", "NEM",
  "PG", "KO", "PEP", "COST", "WMT",
  "NEE", "SO", "DUK", "AEP",
  "PLD", "AMT", "EQIX", "SPG",
];

export type SectorRow = {
  symbol: string;
  name: string;
  change1d: number;
  change5d: number;
  change1m: number;
  relative1m: number; // vs SPY, percentage points
};

export type Breadth = {
  sampled: number;
  advancers: number;
  decliners: number;
  pctAbove50: number;
  pctAbove200: number;
  nearHighs: number; // within 3% of the 52-week closing high
  nearLows: number;
};

export type MarketContext = {
  asOf: string; // last session date in the data, YYYY-MM-DD
  spy: { change1d: number; change5d: number; change1m: number; pctFrom52wHigh: number } | null;
  sectors: SectorRow[];
  breadth: Breadth | null;
  readings: { rotation: string; breadth: string; divergence: string | null };
  missing: string[];
};

const pct = (a: number, b: number) => ((a - b) / b) * 100;
const round1 = (n: number) => Math.round(n * 10) / 10;

// Percent change over the last `sessions` sessions.
export function changeOver(d: DailyCloses, sessions: number): number | null {
  const c = d.closes;
  if (c.length <= sessions) return null;
  return round1(pct(c[c.length - 1], c[c.length - 1 - sessions]));
}

export function sma(closes: number[], n: number): number | null {
  if (closes.length < n) return null;
  const slice = closes.slice(-n);
  return slice.reduce((s, x) => s + x, 0) / n;
}

export function computeBreadth(series: DailyCloses[]): Breadth | null {
  if (series.length < 10) return null;
  let advancers = 0, decliners = 0, above50 = 0, n50 = 0, above200 = 0, n200 = 0, nearHighs = 0, nearLows = 0;
  for (const d of series) {
    const c = d.closes;
    const last = c[c.length - 1];
    if (c.length >= 2) {
      if (last > c[c.length - 2]) advancers++;
      else if (last < c[c.length - 2]) decliners++;
    }
    const m50 = sma(c, 50);
    if (m50 != null) { n50++; if (last > m50) above50++; }
    const m200 = sma(c, 200);
    if (m200 != null) { n200++; if (last > m200) above200++; }
    const window = c.slice(-252);
    if (last >= Math.max(...window) * 0.97) nearHighs++;
    if (last <= Math.min(...window) * 1.03) nearLows++;
  }
  return {
    sampled: series.length,
    advancers,
    decliners,
    pctAbove50: n50 ? Math.round((above50 / n50) * 100) : 0,
    pctAbove200: n200 ? Math.round((above200 / n200) * 100) : 0,
    nearHighs,
    nearLows,
  };
}

const DEFENSIVE = new Set(["XLP", "XLU", "XLV", "XLRE"]);
const CYCLICAL = new Set(["XLK", "XLY", "XLF", "XLI", "XLC", "XLB", "XLE"]);

function signed(n: number): string {
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}`;
}

export function readRotation(sectors: SectorRow[]): string {
  if (sectors.length < 3) return "Not enough sector data loaded to describe rotation.";
  const sorted = [...sectors].sort((a, b) => b.relative1m - a.relative1m);
  const [lead, second] = sorted;
  const lag = sorted[sorted.length - 1];
  const top3 = sorted.slice(0, 3);
  const defensiveLead = top3.filter((s) => DEFENSIVE.has(s.symbol)).length;
  const cyclicalLead = top3.filter((s) => CYCLICAL.has(s.symbol)).length;
  const tilt =
    defensiveLead >= 2
      ? "Defensive sectors are leading, which often reflects a more cautious tape."
      : cyclicalLead === 3
        ? "Growth and cyclical sectors are leading, which often reflects risk appetite."
        : "Leadership is mixed between defensive and cyclical groups.";
  return (
    `Over the past month ${lead.name} (${signed(lead.relative1m)} pts vs SPY) and ${second.name} ` +
    `(${signed(second.relative1m)}) have outperformed the index, while ${lag.name} lagged ` +
    `(${signed(lag.relative1m)}). ${tilt}`
  );
}

export function readBreadth(b: Breadth | null): string {
  if (!b) return "Not enough stock data loaded to measure breadth.";
  const health =
    b.pctAbove50 >= 70
      ? "Participation is broad"
      : b.pctAbove50 >= 50
        ? "Participation is moderate"
        : b.pctAbove50 >= 30
          ? "Participation is narrow"
          : "Participation is weak";
  return (
    `${health}: ${b.pctAbove50}% of the ${b.sampled} large caps sampled are above their 50-day average ` +
    `and ${b.pctAbove200}% above their 200-day. Last session ${b.advancers} rose and ${b.decliners} fell; ` +
    `${b.nearHighs} sit within 3% of a 52-week high versus ${b.nearLows} near a low.`
  );
}

// The classic "index up, most stocks not" (or the reverse) read.
export function readDivergence(spy: MarketContext["spy"], b: Breadth | null): string | null {
  if (!spy || !b) return null;
  if (spy.pctFrom52wHigh > -3 && b.pctAbove50 < 50) {
    return (
      `SPY is within ${Math.abs(spy.pctFrom52wHigh).toFixed(1)}% of its 52-week high while fewer than half of ` +
      "sampled large caps are above their 50-day average — gains are concentrated in fewer names."
    );
  }
  if (spy.pctFrom52wHigh < -10 && b.pctAbove50 > 60) {
    return (
      `SPY is ${Math.abs(spy.pctFrom52wHigh).toFixed(1)}% below its 52-week high, yet most sampled large caps ` +
      "are back above their 50-day average — participation is improving ahead of the index."
    );
  }
  return null;
}

let memo: { at: number; value: MarketContext } | null = null;
const MEMO_MS = 10 * 60 * 1000;

export async function getMarketContext(): Promise<MarketContext> {
  if (memo && Date.now() - memo.at < MEMO_MS) return memo.value;

  const missing: string[] = [];
  const [spyData, ...sectorData] = await mapLimit(["SPY", ...SECTORS.map((s) => s.symbol)], 6, (t) =>
    fetchDailyCloses(t, "1y")
  );

  let spy: MarketContext["spy"] = null;
  if (spyData) {
    const high = Math.max(...spyData.closes.slice(-252));
    spy = {
      change1d: changeOver(spyData, 1) ?? 0,
      change5d: changeOver(spyData, 5) ?? 0,
      change1m: changeOver(spyData, 21) ?? 0,
      pctFrom52wHigh: round1(pct(spyData.closes[spyData.closes.length - 1], high)),
    };
  } else {
    missing.push("SPY");
  }

  const sectors: SectorRow[] = [];
  SECTORS.forEach((s, i) => {
    const d = sectorData[i];
    const c1 = d && changeOver(d, 1);
    const c5 = d && changeOver(d, 5);
    const c21 = d && changeOver(d, 21);
    if (!d || c1 == null || c5 == null || c21 == null) {
      missing.push(s.symbol);
      return;
    }
    sectors.push({
      ...s,
      change1d: c1,
      change5d: c5,
      change1m: c21,
      relative1m: round1(c21 - (spy?.change1m ?? 0)),
    });
  });
  sectors.sort((a, b) => b.relative1m - a.relative1m);

  const universe = await mapLimit(BREADTH_UNIVERSE, 8, (t) => fetchDailyCloses(t, "1y"));
  const series = universe.filter((d): d is DailyCloses => d !== null);
  const breadth = computeBreadth(series);

  const value: MarketContext = {
    asOf: spyData?.dates[spyData.dates.length - 1] ?? series[0]?.dates.at(-1) ?? "",
    spy,
    sectors,
    breadth,
    readings: { rotation: readRotation(sectors), breadth: readBreadth(breadth), divergence: readDivergence(spy, breadth) },
    missing,
  };
  // Don't pin an empty result (e.g. Yahoo briefly down) for the whole window.
  if (sectors.length > 0) memo = { at: Date.now(), value };
  return value;
}

// Study track record: how the ticker (and SPY) moved from the study's as-of
// date to the latest close. Plain arithmetic on real closes — not a verdict on
// the study.
export type TrackRecord = {
  from: string;
  to: string;
  tickerStart: number;
  tickerEnd: number;
  tickerChange: number;
  spyChange: number | null;
};

export function closeOnOrAfter(d: DailyCloses, date: string): { date: string; close: number } | null {
  const i = d.dates.findIndex((x) => x >= date);
  return i === -1 ? null : { date: d.dates[i], close: d.closes[i] };
}

export async function trackRecordSince(ticker: string, asOf: Date): Promise<TrackRecord | null> {
  const days = (Date.now() - asOf.getTime()) / 86_400_000;
  if (!(days >= 1)) return null; // too fresh (or a future/invalid date) to say anything
  // as_of_date is parsed from "July 23, 2026" in local time — read it back in
  // local time too, so a server east of UTC doesn't shift it a day earlier.
  const from = `${asOf.getFullYear()}-${String(asOf.getMonth() + 1).padStart(2, "0")}-${String(asOf.getDate()).padStart(2, "0")}`;
  const range = days <= 170 ? "6mo" : days <= 350 ? "1y" : days <= 700 ? "2y" : "5y";
  const [t, s] = await Promise.all([fetchDailyCloses(ticker, range, 3600), fetchDailyCloses("SPY", range, 3600).catch(() => null)]);
  const start = closeOnOrAfter(t, from);
  if (!start || start.date === t.dates.at(-1)) return null;
  const end = { date: t.dates.at(-1)!, close: t.closes.at(-1)! };
  let spyChange: number | null = null;
  if (s) {
    const s0 = closeOnOrAfter(s, from);
    if (s0) spyChange = round1(pct(s.closes.at(-1)!, s0.close));
  }
  return {
    from: start.date,
    to: end.date,
    tickerStart: start.close,
    tickerEnd: end.close,
    tickerChange: round1(pct(end.close, start.close)),
    spyChange,
  };
}
