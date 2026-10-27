import { EMPTY_CONTEXT, resolveResearch } from "@/lib/research-workflow";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { currentUser, currentWorkspaceId } from "@/lib/workspace";
import { marketDateET } from "@/lib/earnings";
import LeapsClient from "@/components/leaps/LeapsClient";
import PageHeader from "@/components/ui/PageHeader";
import UpgradeCard from "@/components/billing/UpgradeCard";
import { currentMembership } from "@/lib/membership";
import { FEATURE_PLAN } from "@/lib/plans";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "LEAPS workspace",
  description:
    "Compare long-dated option expirations, liquidity and hypothetical early-exit scenarios.",
};
export default async function LeapsPage({
  searchParams,
}: {
  searchParams: Promise<{
    ticker?: string;
    archived?: string;
    study?: string;
    watch?: string;
    plan?: string;
  }>;
}) {
  if (!(await currentUser())) redirect("/login");
  const membership = await currentMembership();
  if (membership && !membership.ent.leaps) {
    return (
      <div>
        <PageHeader title="LEAPS workspace" />
        <UpgradeCard
          title="The LEAPS workspace is part of Gold and Diamond"
          body="Compare long-dated option expirations, liquidity and early-exit scenarios, linked to your studies and journal."
          plan={FEATURE_PLAN.leaps}
        />
      </div>
    );
  }
  const ws = await currentWorkspaceId();
  if (!ws) return <p role="alert">Your workspace is unavailable.</p>;
  const params = await searchParams,
    archived = params.archived === "1";
  let plans: any[] = [];
  let savedUnavailable = false;
  try {
    plans =
      await sql`SELECT id,name,ticker,inputs,archived_at FROM leaps_plans WHERE workspace_id=${ws} AND (archived_at IS NOT NULL)=${archived} ORDER BY updated_at DESC LIMIT 100`;
  } catch (e) {
    console.error("leaps saved plans unavailable", e);
    savedUnavailable = true;
  }
  let initialContext = EMPTY_CONTEXT,
    contextError = "";
  try {
    initialContext = await resolveResearch(
      (q, p) => sql.unsafe(q, p),
      ws,
      (params.ticker ?? "").toUpperCase(),
      { studyId: params.study, watchlistId: params.watch },
    );
  } catch {
    contextError =
      "The linked research could not be loaded. Reopen this workspace from a study or tracked thesis.";
  }
  return (
    <LeapsClient
      initialContext={initialContext}
      contextError={contextError}
      today={marketDateET()}
      initialTicker={params.ticker ?? ""}
      plans={plans.map((p) => ({
        id: String(p.id),
        name: String(p.name),
        ticker: String(p.ticker),
        inputs: p.inputs,
      }))}
      savedUnavailable={savedUnavailable}
      archived={archived}
    />
  );
}
