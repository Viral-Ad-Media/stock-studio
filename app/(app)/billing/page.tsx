import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { currentUser, currentWorkspaceId } from "@/lib/workspace";
import { packCreditsFor } from "@/lib/billing";
import { getMembership } from "@/lib/membership";
import { TIER_LABEL, isPlanId, planCreditGrant } from "@/lib/plans";
import BillingActions, { PlanPicker } from "@/components/BillingActions";
import AutoRefresh from "@/components/AutoRefresh";
import PageHeader from "@/components/ui/PageHeader";

export const metadata = { title: "Billing", description: "Your plan and credit balance." };

export const dynamic = "force-dynamic";

const REASON_LABELS: Record<string, string> = {
  trial_grant: "Trial starter credits",
  grandfather: "Starter balance",
  purchase: "Credit pack purchase",
  purchase_refund: "Credit pack refunded",
  job_charge: "Report queued",
  job_refund: "Report refunded (failed or removed)",
  admin_adjust: "Adjustment",
  plan_grant: "Monthly plan credits",
  plan_expire: "Unused plan credits expired",
};

function fmtDate(d: string | Date) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string; plan?: string }> }) {
  const { checkout, plan: wanted } = await searchParams;
  const user = await currentUser();
  const ws = await currentWorkspaceId();
  if (!user || !ws) redirect("/login");

  const { billing, tier, ent, admin } = await getMembership(user.id, ws);
  const sub = billing.subscription;
  const ledger = await sql`
    SELECT delta, reason, created_at FROM credits_ledger WHERE workspace_id = ${ws} ORDER BY id DESC LIMIT 20
  `;
  const payments = await sql`
    SELECT kind, amount_cents, credits, status, created_at FROM payments WHERE workspace_id = ${ws} ORDER BY id DESC
  `;

  const accessLine = admin
    ? "Admin: every feature."
    : tier === "founding"
      ? "Founding member: you bought Stock Studio before plans existed, so you keep every Diamond feature for life."
      : sub?.live
        ? sub.status === "past_due"
          ? "Your last payment didn't go through. Update your card with Manage plan to keep your plan."
          : sub.cancelAtPeriodEnd
            ? `Cancelled: your plan stays on until ${fmtDate(sub.currentPeriodEnd!)}.`
            : `Renews ${sub.currentPeriodEnd ? fmtDate(sub.currentPeriodEnd) : "automatically"}, billed ${sub.interval === "year" ? "yearly" : "monthly"}. ${planCreditGrant(sub.plan, sub.interval).credits} plan credits arrive with each renewal.`
        : billing.trialActive
          ? `Free trial with Gold features (signals not included) — ends ${fmtDate(billing.trialEndsAt!)}. Pick a plan to keep going.`
          : "You don't have an active plan. Pick one below to keep queuing reports and see signals.";
  const showPlans = tier !== "founding" && !admin;

  return (
    <div className="max-w-5xl">
      {/* Webhook fulfilment lands a few seconds after the redirect back. */}
      {checkout === "success" && <AutoRefresh maxMs={60_000} />}
      <PageHeader
        title="Billing"
        description={
          <>
            Every report costs credits when you queue it — see{" "}
            <a href="/pricing" className="text-emerald-400 underline underline-offset-2 hover:text-emerald-300">pricing</a> for the per-format
            schedule. Failed or removed reports are refunded automatically.
          </>
        }
      />

      {checkout === "success" && (
        <div className="card p-4 mb-4 text-sm text-emerald-400">
          Payment received — it can take a few seconds to show up here.
        </div>
      )}

      <div className="card p-6 mb-6 max-w-2xl space-y-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-slate-400">Credits</span>
          <span className={`text-3xl font-bold ${billing.balance > 0 ? "text-slate-100" : "text-red-400"}`}>
            {billing.balance}
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-slate-400">Plan</span>
          <span className="text-lg font-semibold text-slate-100">{admin ? "Admin" : TIER_LABEL[tier]}</span>
        </div>
        <p className={`text-sm ${billing.hasAccess && sub?.status !== "past_due" ? "text-slate-400" : "text-amber-400"}`}>{accessLine}</p>
        <BillingActions creditsPerPack={packCreditsFor(ent)} canManage={Boolean(sub?.stripeCustomerId)} />
      </div>

      {showPlans && (
        <PlanPicker current={sub?.live ? sub.plan : null} highlight={isPlanId(wanted) ? wanted : null} />
      )}

      {payments.length > 0 && (
        <>
          <h2 className="text-sm font-semibold text-slate-300 mb-2">Payments</h2>
          <div className="card divide-y divide-ink-700 mb-6 max-w-2xl">
            {payments.map((p, i) => (
              <div key={i} className="flex justify-between px-4 py-2.5 text-sm">
                <span className="text-slate-300">
                  {p.kind === "access" ? "Founding access unlock" : `${p.credits} credits`}
                  {p.status === "refunded" && <span className="text-red-400"> · refunded</span>}
                </span>
                <span className="text-fg-subtle">
                  ${(p.amount_cents / 100).toFixed(2)} · {fmtDate(p.created_at)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <h2 className="text-sm font-semibold text-slate-300 mb-2">Credit activity</h2>
      <div className="card divide-y divide-ink-700 max-w-2xl">
        {ledger.length === 0 ? (
          <div className="px-4 py-3 text-sm text-fg-subtle">No activity yet.</div>
        ) : (
          ledger.map((l, i) => (
            <div key={i} className="flex justify-between px-4 py-2.5 text-sm">
              <span className="text-slate-400">{REASON_LABELS[l.reason] ?? l.reason}</span>
              <span className="flex gap-4">
                <span className={l.delta > 0 ? "text-emerald-400" : "text-slate-300"}>
                  {l.delta > 0 ? `+${l.delta}` : l.delta}
                </span>
                <span className="text-fg-subtle w-24 text-right">{fmtDate(l.created_at)}</span>
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
