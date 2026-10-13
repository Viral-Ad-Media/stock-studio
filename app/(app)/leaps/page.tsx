import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { currentUser,currentWorkspaceId } from "@/lib/workspace";
import { marketDateET } from "@/lib/earnings";
import LeapsClient from "@/components/leaps/LeapsClient";
export const dynamic="force-dynamic";
export const metadata={title:"LEAPS workspace",description:"Compare long-dated option expirations, liquidity and hypothetical early-exit scenarios."};
export default async function LeapsPage({searchParams}:{searchParams:Promise<{ticker?:string;archived?:string}>}) {
  if(!await currentUser())redirect("/login");
  const ws=await currentWorkspaceId();if(!ws)return <p role="alert">Your workspace is unavailable.</p>;
  const params=await searchParams,archived=params.archived==="1";
  let plans:any[]=[];let savedUnavailable=false;
  try {plans=await sql`SELECT id,name,ticker,inputs,archived_at FROM leaps_plans WHERE workspace_id=${ws} AND (archived_at IS NOT NULL)=${archived} ORDER BY updated_at DESC LIMIT 100`;}
  catch(e){console.error("leaps saved plans unavailable",e);savedUnavailable=true;}
  return <LeapsClient today={marketDateET()} initialTicker={params.ticker??""} plans={plans.map((p)=>({id:String(p.id),name:String(p.name),ticker:String(p.ticker),inputs:p.inputs}))} savedUnavailable={savedUnavailable} archived={archived}/>;
}
