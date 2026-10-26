import { daysBetweenDates, optionModel, type LeapsInput } from "./leaps";

export type PlotPoint = { x: number; label: string; values: number[] };

// Numeric domains preserve distance (dates and prices are not category slots).
export function plotDomain(points: PlotPoint[]) {
  if (!points.length) return { xMin: 0, xMax: 1, yMin: -1, yMax: 1 };
  const xs = points.map(p => p.x), ys = points.flatMap(p => p.values);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const low = Math.min(0, ...ys), high = Math.max(0, ...ys);
  const pad = (high - low || 1) * .1;
  return { xMin, xMax: xMax === xMin ? xMin + 1 : xMax, yMin: low - pad, yMax: high + pad };
}

export function journalPlot(curve: { date: string; pnl: number }[]) {
  // Do not invent a prior date or an unrecorded account balance. The second
  // series is the distance below the running realized peak (0 or negative).
  let peak = 0;
  return curve.map(p => {
    peak = Math.max(peak, p.pnl);
    return { x: Date.parse(p.date), label: p.date, values: [p.pnl, p.pnl - peak] };
  });
}

// Short labels for tight spaces (calendar cells, axis ticks): $257, -$1.8K.
export function compactMoney(value: number) {
  const abs = Math.abs(value), sign = value < 0 ? "-" : "";
  if (abs < 1000) return `${sign}$${abs.toFixed(abs >= 100 || Number.isInteger(abs) ? 0 : 2)}`;
  const [n, unit] = abs < 1e6 ? [abs / 1e3, "K"] : [abs / 1e6, "M"];
  return `${sign}$${n.toFixed(n < 100 ? 1 : 0).replace(/\.0$/, "")}${unit}`;
}

// Round-number value ticks (1, 2, 2.5 or 5 × 10^k) covering [min, max].
export function niceTicks(min: number, max: number, count: number) {
  const raw = (max - min) / Math.max(1, count), mag = 10 ** Math.floor(Math.log10(raw || 1));
  const step = [1, 2, 2.5, 5, 10].reduce((best, m) => Math.abs(m * mag - raw) < Math.abs(best - raw) ? m * mag : best, mag);
  const ticks: number[] = [];
  for (let k = Math.ceil(min / step - 1e-9); k * step <= max + step * 1e-9; k++) ticks.push(Number((k * step).toPrecision(12)) || 0);
  return ticks;
}

// Evenly spaced axis ticks that include both ends of the domain.
export function axisTicks(min: number, max: number, count: number) {
  const n = Math.max(1, Math.round(count));
  return Array.from({ length: n + 1 }, (_, k) => min + (max - min) * k / n);
}

export function leapsPlots(i: LeapsInput) {
  const days = daysBetweenDates(i.as_of, i.expiration), lot = i.contracts * 100;
  const cost = i.premium * lot + i.fees;
  const price = (spot: number, remaining: number, iv: number) => optionModel(i.type, spot, i.strike, remaining, iv, i.rate, i.dividend).price;
  // Include the exact strike, current spot and selected scenario in the range.
  const scenarioSpot = i.spot * (1 + i.scenario_move / 100);
  const lo = Math.max(.01, Math.min(i.spot * .5, i.strike * .8, scenarioSpot));
  const hi = Math.max(i.spot * 1.5, i.strike * 1.2, scenarioSpot);
  const spots = [...new Set([...Array.from({ length: 41 }, (_, n) => lo + (hi - lo) * n / 40), i.strike, i.spot, scenarioSpot])].sort((a,b) => a-b);
  const payoff: PlotPoint[] = spots.map(spot => ({ x: spot, label: spot.toFixed(2), values: [
    price(spot, days - i.exit_days, i.scenario_iv) * lot - cost,
    price(spot, 0, i.scenario_iv) * lot - cost,
  ] }));
  const elapsed = [...new Set([...Array.from({ length: 25 }, (_, n) => Math.round(days * n / 24)), i.exit_days])].sort((a,b) => a-b);
  const decay: PlotPoint[] = elapsed.map(d => ({ x: d, label: `${d} days`, values: [price(i.spot, days - d, i.iv)] }));
  return { payoff, decay };
}
