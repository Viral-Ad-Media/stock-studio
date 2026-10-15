import {
  resolveResearch,
  contractDraft,
  EMPTY_CONTEXT,
} from "@/lib/research-workflow";
import { validateLeaps } from "@/lib/leaps";
import { UUID_PATTERN } from "@/lib/journal";
import { redirect } from "next/navigation";
import { currentUser, currentWorkspaceId } from "@/lib/workspace";
import { sql } from "@/lib/db";
import { JournalStore } from "@/lib/journal-store";
import JournalClient from "@/components/journal/JournalClient";
import { marketDateET } from "@/lib/earnings";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Trading journal",
  description:
    "Review your stock and purchased-options trades, theses and realized results.",
};
export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<{
    archived?: string;
    ticker?: string;
    study?: string;
    watch?: string;
    plan?: string;
    asset?: string;
    strike?: string;
    expiration?: string;
    quantity?: string;
  }>;
}) {
  if (!(await currentUser())) redirect("/login");
  const ws = await currentWorkspaceId();
  if (!ws) return <p role="alert">Your workspace is unavailable.</p>;
  const params = await searchParams,
    archived = params.archived === "1";
  try {
    const [rows, studies] = await Promise.all([
      new JournalStore((q, p) => sql.unsafe(q, p)).list(ws, archived),
      sql`SELECT id,ticker,variant FROM case_studies WHERE workspace_id=${ws} AND status='ready' ORDER BY id DESC LIMIT 100`,
    ]);
    let ticker = (params.ticker ?? "").toUpperCase(),
      initialDraft: Record<string, string> = {},
      context = EMPTY_CONTEXT,
      draftError = "";
    try {
      if (params.plan) {
        if (!UUID_PATTERN.test(params.plan)) throw new Error("Invalid plan");
        const [plan] =
          await sql`SELECT inputs FROM leaps_plans WHERE workspace_id=${ws} AND id=${params.plan}::uuid AND archived_at IS NULL`;
        if (!plan) throw new Error("Missing plan");
        const input = validateLeaps(plan.inputs);
        ticker = input.ticker;
        initialDraft = contractDraft({
          asset: input.type,
          strike: String(input.strike),
          expiration: input.expiration,
          quantity: String(input.contracts),
        });
        context = await resolveResearch(
          (q, p) => sql.unsafe(q, p),
          ws,
          ticker,
          plan.inputs.context,
        );
        if (plan.inputs.context?.thesis)
          context.thesis = String(plan.inputs.context.thesis).slice(0, 4000);
      } else {
        initialDraft = contractDraft(params);
        context = await resolveResearch(
          (q, p) => sql.unsafe(q, p),
          ws,
          ticker,
          { studyId: params.study, watchlistId: params.watch },
        );
      }
      initialDraft = {
        ...initialDraft,
        thesis: context.thesis,
        case_study_id: context.studyId ? String(context.studyId) : "",
      };
      if (
        context.studyId &&
        !studies.some((s) => Number(s.id) === context.studyId)
      ) {
        const [linked] =
          await sql`SELECT id,ticker,variant FROM case_studies WHERE workspace_id=${ws} AND id=${context.studyId} AND status='ready'`;
        if (linked) studies.push(linked);
      }
    } catch {
      initialDraft = {};
      context = EMPTY_CONTEXT;
      draftError =
        "This linked draft is unavailable or no longer matches your workspace. Start a fresh trade or reopen the original scenario.";
    }
    return (
      <JournalClient
        initialDraft={initialDraft}
        context={context}
        draftError={draftError}
        rows={rows}
        studies={studies.map((s) => ({
          id: Number(s.id),
          ticker: String(s.ticker),
          variant: String(s.variant),
        }))}
        today={marketDateET()}
        archived={archived}
        initialTicker={ticker}
        initialStudy={context.studyId ? String(context.studyId) : ""}
      />
    );
  } catch (e) {
    console.error("journal page failed", e);
    return (
      <div className="card p-6">
        <h1 className="text-2xl font-bold">Trading journal</h1>
        <p className="mt-3" role="alert">
          Your journal is unavailable right now. Please try again shortly.
        </p>
      </div>
    );
  }
}
