// Gamma exposure (GEX) from CBOE's free, 15-minute-delayed options chains (no
// API key) — adapted from QuantEdgeResearch's GEX service. Educational: it is
// a *model* of how options dealers might hedge, built on a standard but
// unverifiable assumption about who holds which side. The UI says so, and
// nothing here produces a directional call.

// Index options are served under a leading underscore.
const CBOE_INDEX = new Set(["SPX", "NDX", "RUT", "VIX", "XSP", "DJX"]);
export const GEX_PRESETS = ["SPY", "SPX", "QQQ", "IWM"];

// Rate for Black-Scholes. Its effect on gamma over these horizons is small.
const RISK_FREE = 0.04;
const MAX_DAYS = 365;
const STRIKE_BAND = 0.25; // contracts within ±25% of spot
const PROFILE_BAND = 0.1; // strikes shown within ±10%

export type OccContract = { root: string; expiration: string; type: "call" | "put"; strike: number };

// NVDA260819C00110000 → NVDA, 2026-08-19, call, 110. CBOE sends contract
// details only inside the OCC symbol; the root can differ from the requested
// symbol (SPX chains contain SPXW), so it's parsed, never sliced by length.
export function parseOcc(occ: string): OccContract | null {
  const m = /^([A-Z0-9.]+?)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(String(occ ?? "").trim().toUpperCase());
  if (!m) return null;
  const [, root, yy, mm, dd, cp, strike8] = m;
  const month = Number(mm), day = Number(dd);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const strike = Number(strike8) / 1000;
  if (!(strike > 0)) return null;
  return { root, expiration: `20${yy}-${mm}-${dd}`, type: cp === "C" ? "call" : "put", strike };
}

function normPdf(x: number) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

// Black-Scholes gamma (per $1 move in the underlying, per share).
export function bsGamma(spot: number, strike: number, years: number, iv: number, r = RISK_FREE): number {
  if (!(spot > 0 && strike > 0 && years > 0 && iv > 0)) return 0;
  const vt = iv * Math.sqrt(years);
  const d1 = (Math.log(spot / strike) + (r + (iv * iv) / 2) * years) / vt;
  return normPdf(d1) / (spot * vt);
}

// Dollar gamma for a 1% move: how many dollars of the underlying the holders
// would need to trade per 1% move, per contract (100 shares).
export function dollarGammaPer1Pct(gamma: number, spot: number, openInterest: number): number {
  return gamma * openInterest * 100 * spot * spot * 0.01;
}

// Years until 4pm New York time on the expiration date; same-day contracts
// keep a floor of an hour so they don't blow up to infinity.
export function yearsToExpiry(expiration: string, now = Date.now()): number {
  // 16:00 ET ≈ 20:00 UTC (EDT) / 21:00 UTC (EST); 20:30 splits the difference.
  const close = Date.parse(`${expiration}T20:30:00Z`);
  const ms = Math.max(close - now, 3_600_000);
  return ms / (365 * 86_400_000);
}

export type GexContract = { type: "call" | "put"; strike: number; years: number; iv: number; oi: number; gamma: number };
export type GexStrike = { strike: number; call: number; put: number; net: number };

export type GexSnapshot = {
  symbol: string;
  spot: number;
  fetchedAt: string;
  contracts: number;
  expirations: number;
  totalGex: number; // $ per 1% move, calls minus puts
  callGex: number;
  putGex: number; // positive number (magnitude)
  zeroGamma: number | null;
  callWall: number | null;
  putWall: number | null;
  strikes: GexStrike[]; // within ±10% of spot, ascending
  reading: string;
};

// Standard convention: call OI adds dealer gamma, put OI subtracts it. Uses
// Black-Scholes gamma from each contract's IV where available so the profile
// and the zero-gamma search use the same model; falls back to CBOE's gamma.
function contractGex(c: GexContract, spot: number): number {
  const g = c.iv > 0 ? bsGamma(spot, c.strike, c.years, c.iv) : c.gamma;
  const v = dollarGammaPer1Pct(g, spot, c.oi);
  return c.type === "call" ? v : -v;
}

export function totalGexAt(contracts: GexContract[], spot: number): number {
  let sum = 0;
  for (const c of contracts) sum += contractGex(c, spot);
  return sum;
}

// The price at which modeled net dealer gamma crosses zero, searched on a
// grid ±15% around spot; the crossing nearest spot wins. Null if none.
export function findZeroGamma(contracts: GexContract[], spot: number): number | null {
  const steps = 120;
  let best: number | null = null;
  let prevX = spot * 0.85;
  let prevY = totalGexAt(contracts, prevX);
  for (let i = 1; i <= steps; i++) {
    const x = spot * (0.85 + (0.3 * i) / steps);
    const y = totalGexAt(contracts, x);
    if ((prevY <= 0 && y > 0) || (prevY >= 0 && y < 0)) {
      // Linear interpolation between grid points.
      const cross = prevX + ((0 - prevY) * (x - prevX)) / (y - prevY);
      if (best === null || Math.abs(cross - spot) < Math.abs(best - spot)) best = cross;
    }
    prevX = x;
    prevY = y;
  }
  return best === null ? null : Math.round(best * 100) / 100;
}

function money(n: number): string {
  const a = Math.abs(n);
  const s = a >= 1e9 ? `$${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `$${(a / 1e6).toFixed(1)}M` : `$${Math.round(a).toLocaleString("en-US")}`;
  return n < 0 ? `−${s}` : s;
}
export { money as formatGexDollars };

export function readGex(s: Pick<GexSnapshot, "symbol" | "spot" | "totalGex" | "zeroGamma" | "callWall" | "putWall">): string {
  const sign = s.totalGex >= 0 ? "positive" : "negative";
  const behavior =
    s.totalGex >= 0
      ? "In this model, dealers hedging positive gamma trade against the move (selling rallies, buying dips), which tends to coincide with calmer, range-bound trading."
      : "In this model, dealers hedging negative gamma trade with the move (buying rallies, selling dips), which tends to coincide with larger swings.";
  const parts = [
    `Modeled net dealer gamma for ${s.symbol} is ${sign}: about ${money(s.totalGex)} of hedging per 1% move at $${s.spot.toFixed(2)}.`,
    behavior,
  ];
  if (s.zeroGamma != null) {
    parts.push(
      `The model's zero-gamma level is near $${s.zeroGamma.toFixed(2)}, ${s.spot >= s.zeroGamma ? "below" : "above"} the current price.`
    );
  }
  const walls = [
    s.callWall != null ? `the largest call concentration above the price sits at $${s.callWall}` : null,
    s.putWall != null ? `the largest put concentration below it at $${s.putWall}` : null,
  ].filter(Boolean);
  if (walls.length) {
    const w = walls.join(" and ");
    parts.push(`${w[0].toUpperCase()}${w.slice(1)}.`);
  }
  return parts.join(" ");
}

export function buildGexSnapshot(symbol: string, spot: number, contracts: GexContract[], expirations: number): GexSnapshot | null {
  if (!(spot > 0) || contracts.length === 0) return null;
  const byStrike = new Map<number, GexStrike>();
  let callGex = 0;
  let putGex = 0;
  for (const c of contracts) {
    const v = contractGex(c, spot);
    const row = byStrike.get(c.strike) ?? { strike: c.strike, call: 0, put: 0, net: 0 };
    if (c.type === "call") {
      row.call += v;
      callGex += v;
    } else {
      row.put += v; // negative
      putGex += -v;
    }
    row.net = row.call + row.put;
    byStrike.set(c.strike, row);
  }
  const all = [...byStrike.values()].sort((a, b) => a.strike - b.strike);

  let callWall: number | null = null;
  let putWall: number | null = null;
  let maxCall = 0;
  let maxPut = 0;
  for (const r of all) {
    if (r.strike > spot && r.call > maxCall) (maxCall = r.call), (callWall = r.strike);
    if (r.strike < spot && -r.put > maxPut) (maxPut = -r.put), (putWall = r.strike);
  }
  const totalGex = callGex - putGex;
  const zeroGamma = findZeroGamma(contracts, spot);
  const strikes = all.filter((r) => Math.abs(r.strike / spot - 1) <= PROFILE_BAND);
  const base = { symbol, spot, totalGex, zeroGamma, callWall, putWall };
  return {
    ...base,
    fetchedAt: new Date().toISOString(),
    contracts: contracts.length,
    expirations,
    callGex,
    putGex,
    strikes,
    reading: readGex(base),
  };
}

// Parses CBOE's delayed-quotes payload. CBOE has moved the quote fields
// between data.quote and data itself; accept both.
export function parseCboeChain(symbol: string, body: unknown, now = Date.now()): { spot: number; contracts: GexContract[]; expirations: number } | null {
  const data = (body as { data?: Record<string, any> })?.data;
  if (!data) return null;
  const quote = data.quote ?? data;
  const spot = Number(quote.current_price ?? quote.close ?? quote.prev_day_close);
  const raw: any[] = Array.isArray(data.options) ? data.options : [];
  if (!(spot > 0) || raw.length === 0) return null;
  const today = new Date(now).toISOString().slice(0, 10);
  const exps = new Set<string>();
  const contracts: GexContract[] = [];
  for (const o of raw) {
    const occ = parseOcc(o?.option);
    if (!occ || occ.expiration < today) continue;
    const oi = Number(o.open_interest) || 0;
    if (oi <= 0) continue;
    if (Math.abs(occ.strike / spot - 1) > STRIKE_BAND) continue;
    const years = yearsToExpiry(occ.expiration, now);
    if (years * 365 > MAX_DAYS) continue;
    exps.add(occ.expiration);
    contracts.push({ type: occ.type, strike: occ.strike, years, iv: Number(o.iv) || 0, oi, gamma: Number(o.gamma) || 0 });
  }
  return { spot, contracts, expirations: exps.size };
}

export function cboeSymbol(symbol: string): string {
  const s = symbol.toUpperCase().replace(/^[\^_]/, "");
  return CBOE_INDEX.has(s) ? `_${s}` : s;
}

// Chains run to several MB (over Next's 2 MB data-cache limit), so the small
// computed snapshot is memoized instead. The source is 15-minute delayed.
const memo = new Map<string, { at: number; value: GexSnapshot | null }>();
const MEMO_MS = 10 * 60 * 1000;

export async function getGexSnapshot(symbol: string): Promise<GexSnapshot | null> {
  const display = symbol.toUpperCase().replace(/^[\^_]/, "");
  const hit = memo.get(display);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.value;

  const res = await fetch(`https://cdn.cboe.com/api/global/delayed_quotes/options/${encodeURIComponent(cboeSymbol(display))}.json`, {
    headers: { "User-Agent": "Mozilla/5.0 (stock-studio gamma exposure)", Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  let value: GexSnapshot | null = null;
  if (res.status !== 403 && res.status !== 404) {
    // 403/404: no listed options for this symbol.
    if (!res.ok) throw new Error(`CBOE returned ${res.status}`);
    const parsed = parseCboeChain(display, await res.json());
    value = parsed ? buildGexSnapshot(display, parsed.spot, parsed.contracts, parsed.expirations) : null;
  }
  memo.set(display, { at: Date.now(), value });
  if (memo.size > 200) memo.delete(memo.keys().next().value!);
  return value;
}

// Merge adjacent strikes into at most `maxRows` equal-width buckets, so SPY's
// $1 strikes and SPX's $5 strikes chart at a similar density.
export function bucketStrikes(strikes: GexStrike[], maxRows = 40): GexStrike[] {
  if (strikes.length <= maxRows) return strikes;
  const lo = strikes[0].strike;
  const hi = strikes[strikes.length - 1].strike;
  const width = (hi - lo) / maxRows;
  const out: GexStrike[] = [];
  for (let k = 0; k < maxRows; k++) {
    const from = lo + k * width;
    const to = k === maxRows - 1 ? hi + 1e-9 : from + width;
    const inBin = strikes.filter((s) => s.strike >= from && s.strike < to);
    if (inBin.length === 0) continue;
    const call = inBin.reduce((a, s) => a + s.call, 0);
    const put = inBin.reduce((a, s) => a + s.put, 0);
    // Labelled by the midpoint of the strikes it holds.
    const strike = Math.round(((inBin[0].strike + inBin[inBin.length - 1].strike) / 2) * 100) / 100;
    out.push({ strike, call, put, net: call + put });
  }
  return out;
}
