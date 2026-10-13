import { InputError, validDate } from "./journal";
export type LeapsInput = {
  ticker: string; type: "call" | "put"; spot: number; strike: number; expiration: string;
  as_of: string; premium: number; contracts: number; iv: number; rate: number; dividend: number;
  exit_days: number; scenario_move: number; scenario_iv: number; fees: number;
};
export const DEFAULT_LEAPS: LeapsInput = { ticker: "", type: "call", spot: 100, strike: 100,
  as_of: "", expiration: "", premium: 15, contracts: 1, iv: 30, rate: 4, dividend: 0,
  exit_days: 30, scenario_move: 10, scenario_iv: 30, fees: 0 };

export function daysBetweenDates(a: string, b: string): number { return (Date.parse(b) - Date.parse(a)) / 86400000; }
export function validateLeaps(raw: unknown): LeapsInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new InputError("Scenario inputs are required.");
  const r = raw as Record<string, unknown>;
  const ticker = typeof r.ticker === "string" ? r.ticker.trim().toUpperCase() : "";
  if (!/^[A-Z][A-Z0-9.\-]{0,11}$/.test(ticker)) throw new InputError("Enter one ticker.");
  if (r.type !== "call" && r.type !== "put") throw new InputError("Choose a call or put.");
  if (!validDate(r.as_of) || !validDate(r.expiration)) throw new InputError("Enter valid valuation and expiration dates.");
  const days = daysBetweenDates(r.as_of, r.expiration);
  if (days < 1 || days > 3650) throw new InputError("Expiration must be 1–3,650 days after the valuation date.");
  function n(key: string, min: number, max: number, integer = false) {
    const v = r[key];
    if (v === "" || v == null || (typeof v !== "number" && typeof v !== "string")) throw new InputError(`${key} is required.`);
    const value = Number(v);
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new InputError(`${key} must be between ${min} and ${max}${integer ? " (whole number)" : ""}.`);
    return value;
  }
  return { ticker, type: r.type, as_of: r.as_of, expiration: r.expiration,
    spot: n("spot", .01, 1000000), strike: n("strike", .01, 1000000), premium: n("premium", .000001, 1000000),
    contracts: n("contracts", 1, 10000, true), iv: n("iv", .1, 500), rate: n("rate", -10, 30), dividend: n("dividend", 0, 30),
    exit_days: n("exit_days", 0, days, true), scenario_move: n("scenario_move", -99, 500),
    scenario_iv: n("scenario_iv", .1, 500), fees: n("fees", 0, 1000000) };
}

// Normal CDF approximation (error < 8e-8). European Black-Scholes with a
// continuous dividend yield. NOT an American option or early-exercise model.
export function normalCdf(x: number): number {
  const t = 1 / (1 + .2316419 * Math.abs(x));
  const p = Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI) * t *
    (.319381530 + t * (-.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}
function pdf(x: number) { return Math.exp(-x*x/2) / Math.sqrt(2*Math.PI); }
export function optionModel(type: "call" | "put", spot: number, strike: number, days: number, iv: number, rate: number, dividend: number) {
  const intrinsic = Math.max(0, type === "call" ? spot - strike : strike - spot);
  if (![spot,strike,days,iv,rate,dividend].every(Number.isFinite) || spot <= 0 || strike <= 0 || days < 0 || iv <= 0) throw new InputError("Invalid option model inputs.");
  if (days === 0) return { price: intrinsic, delta: null, gamma: null, theta: null, vega: null };
  const T = days / 365, vol = iv / 100, r = rate / 100, q = dividend / 100;
  const d1 = (Math.log(spot / strike) + (r-q + vol*vol/2)*T) / (vol*Math.sqrt(T)), d2 = d1-vol*Math.sqrt(T);
  const sd = spot*Math.exp(-q*T), kd = strike*Math.exp(-r*T), call = type === "call";
  const price = call ? sd*normalCdf(d1)-kd*normalCdf(d2) : kd*normalCdf(-d2)-sd*normalCdf(-d1);
  const thetaCommon = -sd*pdf(d1)*vol/(2*Math.sqrt(T));
  const theta = (call ? thetaCommon-r*kd*normalCdf(d2)+q*sd*normalCdf(d1) : thetaCommon+r*kd*normalCdf(-d2)-q*sd*normalCdf(-d1)) / 365;
  return { price: Math.max(0, price), delta: Math.exp(-q*T)*(call ? normalCdf(d1) : normalCdf(d1)-1),
    gamma: Math.exp(-q*T)*pdf(d1)/(spot*vol*Math.sqrt(T)), theta,
    vega: sd*pdf(d1)*Math.sqrt(T)/100 };
}

export function leapsAnalysis(i: LeapsInput) {
  const days = daysBetweenDates(i.as_of, i.expiration), multiplier = i.contracts * 100;
  const model = (spot: number, remaining: number, iv: number) => optionModel(i.type, spot, i.strike, remaining, iv, i.rate, i.dividend);
  const current = model(i.spot, days, i.iv);
  const scenario = model(i.spot*(1+i.scenario_move/100), days-i.exit_days, i.scenario_iv);
  const cost = i.premium*multiplier+i.fees;
  return { days, current, scenario, cost,
    expiryBreakeven: i.type === "call" ? i.strike + i.premium + i.fees/multiplier : i.strike-i.premium-i.fees/multiplier,
    scenarioPnl: scenario.price*multiplier-cost,
    intrinsic: Math.max(0, i.type === "call" ? i.spot-i.strike : i.strike-i.spot),
    grid: [-20,-10,0,10,20].map((move) => ({ move, ...model(i.spot*(1+move/100), days-i.exit_days, i.scenario_iv),
      pnl: model(i.spot*(1+move/100), days-i.exit_days, i.scenario_iv).price*multiplier-cost })),
    time: [0,30,90,180].filter((d) => d <= days).map((elapsed) => ({ elapsed, price: model(i.spot,days-elapsed,i.iv).price })),
    comparison: [180,365,730].map((d) => ({ days:d, ...model(i.spot,d,i.iv) })) };
}
