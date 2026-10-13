import { InputError, validateTrade, type TradeInput } from "./journal";

export const CSV_COLUMNS = ["ticker", "asset", "side", "quantity", "entry_price", "opened_on", "exit_price", "closed_on", "strike", "expiration", "fees", "initial_risk", "strategy", "thesis", "review", "source_ref"] as const;
export const CSV_TEMPLATE = CSV_COLUMNS.join(",") + "\n";

// RFC-style quoted cells, including escaped quotes and embedded line breaks.
function cells(csv: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false, afterQuote = false;
  const pushCell = () => { row.push(cell); cell = ""; afterQuote = false; };
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (quoted) {
      if (c === '"' && csv[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; afterQuote = true; } else cell += c;
    } else if (c === '"') {
      if (cell || afterQuote) throw new InputError("Unexpected quote in CSV."); quoted = true;
    } else if (c === ',') pushCell();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && csv[i + 1] === '\n') i++;
      pushCell(); if (row.some((v) => v.trim())) rows.push(row); row = [];
    } else {
      if (afterQuote) throw new InputError("Unexpected text after a quoted cell."); cell += c;
    }
  }
  if (quoted) throw new InputError("Unclosed quoted CSV cell.");
  pushCell(); if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}

export function parseTradeCsv(csv: unknown): { trades: TradeInput[]; errors: string[] } {
  if (typeof csv !== "string" || new TextEncoder().encode(csv).length > 1_000_000) throw new InputError("CSV must be text under 1 MB.");
  const [header, ...rows] = cells(csv.replace(/^\uFEFF/, ""));
  if (!header || !rows.length) throw new InputError("CSV needs a header and at least one trade.");
  if (rows.length > 500) throw new InputError("Import at most 500 trades per file.");
  const names = header.map((s) => s.trim().toLowerCase());
  if (new Set(names).size !== names.length) throw new InputError("CSV has duplicate column names.");
  if (names.some((s) => !CSV_COLUMNS.includes(s as typeof CSV_COLUMNS[number]))) throw new InputError("Use the journal CSV template columns. Broker files must first be mapped to that format.");
  for (const key of ["ticker", "quantity", "entry_price", "opened_on"]) if (!names.includes(key)) throw new InputError(`CSV is missing ${key}.`);
  const trades: TradeInput[] = [], errors: string[] = [];
  rows.forEach((row, i) => {
    try {
      if (row.length !== names.length) throw new InputError("Column count does not match the header.");
      const raw = Object.fromEntries(names.map((name, j) => [name, row[j].trim()]));
      raw.asset ||= "stock"; raw.side ||= "long"; raw.fees ||= "0";
      trades.push(validateTrade(raw));
    } catch (e) { errors.push(`Row ${i + 2}: ${e instanceof Error ? e.message : "Invalid trade"}`); }
  });
  return { trades, errors };
}

function safeCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  // Spreadsheet formula injection protection for user-controlled text.
  const safe = /^[\s]*[=+\-@]/.test(s) || /^[\t\r]/.test(s) ? `'${s}` : s;
  return '"' + safe.replaceAll('"', '""') + '"';
}
export function exportTradeCsv(trades: TradeInput[]): string {
  return CSV_TEMPLATE + trades.map((t) => CSV_COLUMNS.map((key) => safeCell(t[key])).join(",")).join("\n") + "\n";
}
