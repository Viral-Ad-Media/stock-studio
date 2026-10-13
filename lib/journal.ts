// Shared journal validation and accounting. Prices are per share; standard
// equity options use 100 shares per contract. Each entry is one complete lot.
export type TradeInput = {
  ticker: string; asset: "stock" | "call" | "put"; side: "long" | "short";
  quantity: number; entry_price: number; exit_price: number | null;
  opened_on: string; closed_on: string | null; strike: number | null; expiration: string | null;
  fees: number; initial_risk: number | null; strategy: string; thesis: string; review: string;
  case_study_id: number | null; source_ref: string;
};
export type JournalTrade = TradeInput & { id: string; archived_at: string | null; updated_at: string; revision: number };
export class InputError extends Error {}
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function text(value: unknown, max: number, label: string): string {
  if (value == null) return "";
  if (typeof value !== "string" || value.length > max) throw new InputError(`${label} must be text of at most ${max} characters.`);
  return value.trim();
}
function number(value: unknown, label: string, zero = false): number {
  if ((typeof value !== "number" && typeof value !== "string") || value === "" || (typeof value === "string" && !value.trim())) throw new InputError(`${label} is required.`);
  const n = Number(value);
  if (!Number.isFinite(n) || n < (zero ? 0 : Number.MIN_VALUE) || n > 1_000_000) throw new InputError(`${label} must be ${zero ? "nonnegative" : "positive"} and at most 1,000,000.`);
  if (Math.abs(n * 1e6 - Math.round(n * 1e6)) > 0.0001) throw new InputError(`${label} allows at most six decimal places.`);
  return n;
}
const optional = (v: unknown) => v == null || v === "";

export function validateTrade(raw: unknown, today = new Date().toISOString().slice(0, 10)): TradeInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new InputError("Enter a trade object.");
  const r = raw as Record<string, unknown>;
  const ticker = text(r.ticker, 12, "Ticker").toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-]{0,11}$/.test(ticker)) throw new InputError("Enter one stock ticker.");
  const asset = r.asset ?? "stock", side = r.side ?? "long";
  if (asset !== "stock" && asset !== "call" && asset !== "put") throw new InputError("Asset must be stock, call or put.");
  if (side !== "long" && side !== "short") throw new InputError("Side must be long or short.");
  if (asset !== "stock" && side !== "long") throw new InputError("This journal supports purchased options only; short options and spreads are not supported.");
  const quantity = number(r.quantity, "Quantity");
  if (asset !== "stock" && !Number.isInteger(quantity)) throw new InputError("Option quantity must be a whole number of contracts.");
  if (asset !== "stock" && quantity > 10000) throw new InputError("Option quantity is limited to 10,000 contracts per lot.");
  if (!validDate(r.opened_on) || r.opened_on > today) throw new InputError("Entry date must be a valid date no later than today.");
  const closed_on = optional(r.closed_on) ? null : r.closed_on;
  if (closed_on != null && (!validDate(closed_on) || closed_on < r.opened_on || closed_on > today)) throw new InputError("Exit date must be between the entry date and today.");
  const exit_price = optional(r.exit_price) ? null : number(r.exit_price, "Exit price", true);
  if ((closed_on == null) !== (exit_price == null)) throw new InputError("Enter both the exit date and price, or leave both blank for an open trade.");
  let expiration: string | null = null, strike: number | null = null;
  if (asset !== "stock") {
    if (!validDate(r.expiration) || r.expiration < r.opened_on) throw new InputError("Option expiration must be a valid date on or after entry.");
    expiration = r.expiration; strike = number(r.strike, "Strike");
  } else if (!optional(r.strike) || !optional(r.expiration)) throw new InputError("Stocks do not have strikes or expirations.");
  const case_study_id = optional(r.case_study_id) ? null : Number(r.case_study_id);
  if (case_study_id != null && (!Number.isSafeInteger(case_study_id) || case_study_id <= 0)) throw new InputError("Choose a valid study.");
  return { ticker, asset, side, quantity, entry_price: number(r.entry_price, "Entry price"), exit_price,
    opened_on: r.opened_on, closed_on: closed_on as string | null, strike, expiration,
    fees: number(r.fees ?? 0, "Total fees", true), initial_risk: optional(r.initial_risk) ? null : number(r.initial_risk, "Initial risk"),
    strategy: text(r.strategy, 100, "Strategy"), thesis: text(r.thesis, 4000, "Thesis"), review: text(r.review, 4000, "Review"),
    case_study_id, source_ref: text(r.source_ref, 200, "Source reference") };
}

export function realizedPnl(t: TradeInput): number | null {
  if (t.exit_price == null || t.closed_on == null) return null;
  return (t.exit_price - t.entry_price) * t.quantity * (t.asset === "stock" ? 1 : 100) * (t.side === "long" ? 1 : -1) - t.fees;
}

export function journalStats(trades: TradeInput[]) {
  const closed = trades.filter((t) => realizedPnl(t) != null).sort((a, b) => a.closed_on!.localeCompare(b.closed_on!) || a.opened_on.localeCompare(b.opened_on));
  const pnls = closed.map((t) => realizedPnl(t)!);
  const wins = pnls.filter((n) => n > 0).length, losses = pnls.filter((n) => n < 0).length;
  const gain = pnls.reduce((sum, n) => sum + Math.max(n, 0), 0), loss = pnls.reduce((sum, n) => sum + Math.max(-n, 0), 0);
  const byStrategy = new Map<string, { name: string; count: number; pnl: number }>();
  const byDay = new Map<string, number>();
  const riskTrades = closed.filter((t) => t.initial_risk != null);
  for (const t of closed) {
    const name = t.strategy || "Unlabelled", row = byStrategy.get(name) ?? { name, count: 0, pnl: 0 };
    row.count++; row.pnl += realizedPnl(t)!; byStrategy.set(name, row);
    byDay.set(t.closed_on!, (byDay.get(t.closed_on!) ?? 0) + realizedPnl(t)!);
  }
  let equity = 0, peak = 0, drawdown = 0;
  const curve = [...byDay].map(([date, pnl]) => {
    equity += pnl; peak = Math.max(peak, equity); drawdown = Math.max(drawdown, peak - equity);
    return { date, pnl: equity };
  });
  return { closed: closed.length, open: trades.length - closed.length, wins, losses, breakeven: closed.length - wins - losses,
    net: gain - loss, winRate: closed.length ? wins / closed.length * 100 : null,
    profitFactor: closed.length >= 30 && loss > 0 ? gain / loss : null,
    averageR: riskTrades.length ? riskTrades.reduce((s, t) => s + realizedPnl(t)! / t.initial_risk!, 0) / riskTrades.length : null,
    riskCount: riskTrades.length, drawdown, curve, strategies: [...byStrategy.values()] };
}

export async function readJsonLimited(req: Request, maxBytes = 1_048_576): Promise<unknown> {
  const reader = req.body?.getReader();
  if (!reader) throw new InputError("Request body is required.");
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new InputError("Request exceeds the 1 MB limit."); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let pos = 0;
  for (const chunk of chunks) { bytes.set(chunk, pos); pos += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new InputError("Invalid JSON."); }
}
