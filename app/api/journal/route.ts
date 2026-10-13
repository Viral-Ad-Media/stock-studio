import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { currentWorkspaceId } from "@/lib/workspace";
import { requireAppAccess } from "@/lib/access";
import { InputError, UUID_PATTERN, readJsonLimited, validateTrade } from "@/lib/journal";
import { JournalStore, importKey } from "@/lib/journal-store";
import { exportTradeCsv, parseTradeCsv } from "@/lib/journal-csv";
const store = () => new JournalStore((q,p) => sql.unsafe(q,p));
function failure(error: unknown) {
  if (error instanceof InputError) return NextResponse.json({error:error.message},{status:400});
  if ((error as {code?:string})?.code === "23514") return NextResponse.json({error:"Trade fields or the linked study are invalid for this workspace."},{status:400});
  console.error("journal request failed",error);
  return NextResponse.json({error:"Journal is unavailable. Please try again."},{status:503});
}
export async function GET(req: Request) {
  const ws = await currentWorkspaceId();
  if (!ws) return NextResponse.json({error:"unauthorized"},{status:401});
  try {
    const params = new URL(req.url).searchParams;
    const rows = await store().list(ws,params.get("archived")==="1");
    if (params.get("format")==="csv") return new Response(exportTradeCsv(rows),{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":'attachment; filename="stock-studio-journal.csv"',"Cache-Control":"no-store"}});
    return NextResponse.json({trades:rows},{headers:{"Cache-Control":"no-store"}});
  } catch(e) { return failure(e); }
}
export async function POST(req: Request) {
  const gate = await requireAppAccess(); if (!gate.ok) return gate.response;
  try {
    const body = await readJsonLimited(req) as Record<string, unknown>;
    if (body && typeof body === "object" && "csv" in body) {
      const parsed = parseTradeCsv(body.csv);
      if (parsed.errors.length) return NextResponse.json({error:"Fix every invalid row before importing.",errors:parsed.errors},{status:400});
      if (body.preview === true) return NextResponse.json({preview:parsed.trades,count:parsed.trades.length});
      if (body.confirm !== true) throw new InputError("Review the CSV preview before confirming import.");
      const inserted = await sql.begin(async (tx) => {
        const journal = new JournalStore((q,p)=>tx.unsafe(q,p)); let count=0;
        for (const trade of parsed.trades) if (await journal.insert(gate.ws,trade,importKey(trade))) count++;
        return count;
      });
      return NextResponse.json({inserted,duplicates:parsed.trades.length-Number(inserted)});
    }
    const trade = validateTrade(body);
    return NextResponse.json({trade:await store().insert(gate.ws,trade)},{status:201});
  } catch(e) { return failure(e); }
}
export async function PATCH(req: Request) {
  const gate = await requireAppAccess(); if (!gate.ok) return gate.response;
  try {
    const body = await readJsonLimited(req) as Record<string,unknown>;
    if (!body || typeof body.id!=="string" || !UUID_PATTERN.test(body.id)) throw new InputError("Choose a valid journal entry.");
    if (typeof body.version!=="number" || !Number.isSafeInteger(body.version) || body.version < 1) throw new InputError("The entry version is required. Refresh the journal.");
    const updated = typeof body.archived === "boolean"
      ? await store().archive(gate.ws,body.id,body.version,body.archived)
      : await store().update(gate.ws,body.id,body.version,validateTrade(body.trade));
    if (!updated) return NextResponse.json({error:"Entry changed or is unavailable. Refresh before editing."},{status:409});
    return NextResponse.json({ok:true});
  } catch(e) { return failure(e); }
}
