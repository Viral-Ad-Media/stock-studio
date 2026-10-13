import { NextResponse } from "next/server";
import { currentWorkspaceId } from "@/lib/workspace";
import { requireAppAccess } from "@/lib/access";
import { sql } from "@/lib/db";
import { getLeapsChain } from "@/lib/leaps-chain";
import { validateLeaps } from "@/lib/leaps";
import { InputError, text, UUID_PATTERN, readJsonLimited } from "@/lib/journal";

export async function GET(req:Request) {
  const ws=await currentWorkspaceId();if(!ws)return NextResponse.json({error:"unauthorized"},{status:401});
  const symbol=new URL(req.url).searchParams.get("symbol")?.trim().toUpperCase();
  if(!symbol||!/^[A-Z][A-Z0-9.\-]{0,11}$/.test(symbol))return NextResponse.json({error:"Enter one stock or ETF ticker."},{status:400});
  try{return NextResponse.json({chain:await getLeapsChain(symbol)},{headers:{"Cache-Control":"private, no-store"}});}
  catch{return NextResponse.json({error:"Delayed options feed is unavailable. You can still model a scenario with manual inputs."},{status:503});}
}
export async function POST(req:Request) {
  const gate=await requireAppAccess();if(!gate.ok)return gate.response;
  try {
    const body=await readJsonLimited(req) as Record<string,unknown>;
    if(!body||typeof body!=="object")throw new InputError("Enter a plan.");
    const name=text(body.name,100,"Name");if(!name)throw new InputError("Name your scenario.");
    const inputs=validateLeaps(body.inputs);
    const [row]=await sql`INSERT INTO leaps_plans(workspace_id,name,ticker,inputs) VALUES(${gate.ws},${name},${inputs.ticker},${sql.json(inputs)}) RETURNING id`;
    return NextResponse.json({id:row.id},{status:201});
  } catch(e){if(e instanceof InputError)return NextResponse.json({error:e.message},{status:400});console.error("save leaps failed",e);return NextResponse.json({error:"Couldn't save this scenario."},{status:503});}
}
export async function PATCH(req:Request) {
  const gate=await requireAppAccess();if(!gate.ok)return gate.response;
  try {
    const body=await readJsonLimited(req) as Record<string,unknown>;
    if(!body||typeof body.id!=="string"||!UUID_PATTERN.test(body.id)||typeof body.archived!=="boolean")throw new InputError("Choose a valid scenario and archive action.");
    const rows=await sql`UPDATE leaps_plans SET archived_at=CASE WHEN ${body.archived} THEN now() ELSE NULL END,updated_at=now() WHERE workspace_id=${gate.ws} AND id=${body.id}::uuid RETURNING id`;
    return rows.length?NextResponse.json({ok:true}):NextResponse.json({error:"Scenario not found."},{status:404});
  } catch(e){if(e instanceof InputError)return NextResponse.json({error:e.message},{status:400});return NextResponse.json({error:"Couldn't change this scenario."},{status:503});}
}
