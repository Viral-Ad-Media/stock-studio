import { redirect } from "next/navigation";
import { currentUser, currentWorkspaceId } from "@/lib/workspace";
import { sql } from "@/lib/db";
import { JournalStore } from "@/lib/journal-store";
import JournalClient from "@/components/journal/JournalClient";
import { marketDateET } from "@/lib/earnings";
export const dynamic="force-dynamic";
export const metadata={title:"Trading journal",description:"Review your stock and purchased-options trades, theses and realized results."};
export default async function JournalPage({searchParams}:{searchParams:Promise<{archived?:string;ticker?:string;study?:string}>}) {
  if(!await currentUser())redirect("/login");
  const ws=await currentWorkspaceId();if(!ws)return <p role="alert">Your workspace is unavailable.</p>;
  const params=await searchParams,archived=params.archived==="1";
  try {
    const [rows,studies]=await Promise.all([
      new JournalStore((q,p)=>sql.unsafe(q,p)).list(ws,archived),
      sql`SELECT id,ticker,variant FROM case_studies WHERE workspace_id=${ws} AND status='ready' ORDER BY id DESC LIMIT 100`,
    ]);
    return <JournalClient rows={rows} studies={studies.map((s)=>({id:Number(s.id),ticker:String(s.ticker),variant:String(s.variant)}))}
      today={marketDateET()} archived={archived} initialTicker={params.ticker??""} initialStudy={params.study??""} />;
  }catch(e){console.error("journal page failed",e);return <div className="card p-6"><h1 className="text-2xl font-bold">Trading journal</h1><p className="mt-3" role="alert">Your journal is unavailable right now. Please try again shortly.</p></div>;}
}
