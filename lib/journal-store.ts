import { createHash } from "node:crypto";
import { type TradeInput, type JournalTrade } from "./journal";
export type Query = (query: string, params?: any[]) => Promise<any[]>;
const FIELDS = ["ticker","asset","side","quantity","entry_price","exit_price","opened_on","closed_on","strike","expiration","fees","initial_risk","strategy","thesis","review","case_study_id","source_ref"] as const;
export function importKey(t: TradeInput): string {
  const economic = [t.ticker,t.asset,t.side,t.quantity,t.entry_price,t.exit_price,t.opened_on,t.closed_on,t.strike,t.expiration,t.fees];
  return createHash("sha256").update(JSON.stringify(t.source_ref ? ["source", t.source_ref] : ["trade", ...economic])).digest("hex");
}
export function tradeRow(r: any): JournalTrade {
  const result = { ...r };
  for (const key of ["quantity","entry_price","exit_price","strike","fees","initial_risk","case_study_id"]) result[key] = r[key] == null ? null : Number(r[key]);
  for (const key of ["opened_on","closed_on","expiration"]) result[key] = r[key] == null ? null : r[key] instanceof Date ? r[key].toISOString().slice(0,10) : String(r[key]).slice(0,10);
  for (const key of ["updated_at","archived_at"]) result[key] = r[key] == null ? null : new Date(r[key]).toISOString();
  return result as JournalTrade;
}
export class JournalStore {
  constructor(private query: Query) {}
  async list(ws: string, archived = false): Promise<JournalTrade[]> {
    const rows = await this.query(`SELECT * FROM stocks.journal_trades WHERE workspace_id=$1 AND (archived_at IS NOT NULL)=$2 ORDER BY opened_on DESC,created_at DESC,id DESC LIMIT 10001`, [ws, archived]);
    // Never silently truncate analytics or export.
    if (rows.length > 10000) throw new Error("Journal exceeds the 10,000-entry view limit.");
    return rows.map(tradeRow);
  }
  async insert(ws: string, t: TradeInput, key: string | null = null): Promise<JournalTrade | null> {
    const rows = await this.query(`INSERT INTO stocks.journal_trades(workspace_id,${FIELDS.join(",")},import_key)
      VALUES(${Array.from({length:FIELDS.length+2},(_,i)=>`$${i+1}`).join(",")})
      ON CONFLICT (workspace_id,import_key) WHERE import_key IS NOT NULL DO NOTHING RETURNING *`,
      [ws, ...FIELDS.map((k) => t[k]), key]);
    return rows[0] ? tradeRow(rows[0]) : null;
  }
  async update(ws: string, id: string, version: number, t: TradeInput): Promise<JournalTrade | null> {
    const rows = await this.query(`UPDATE stocks.journal_trades SET ${FIELDS.map((k,i)=>`${k}=$${i+4}`).join(",")}, updated_at=clock_timestamp(),revision=revision+1
      WHERE workspace_id=$1 AND id=$2 AND revision=$3 AND archived_at IS NULL RETURNING *`,
      [ws,id,version,...FIELDS.map((k)=>t[k])]);
    return rows[0] ? tradeRow(rows[0]) : null;
  }
  async archive(ws: string, id: string, version: number, archived: boolean): Promise<boolean> {
    const rows = await this.query(`UPDATE stocks.journal_trades SET archived_at=CASE WHEN $4::boolean THEN now() ELSE NULL END,updated_at=clock_timestamp(),revision=revision+1
      WHERE workspace_id=$1 AND id=$2 AND revision=$3 RETURNING id`,[ws,id,version,archived]);
    return rows.length > 0;
  }
}
