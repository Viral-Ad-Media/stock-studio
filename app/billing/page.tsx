import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { currentUser, currentWorkspaceId } from "@/lib/workspace";
import { getBillingState, CREDITS_PER_PACK } from "@/lib/billing";
import BillingActions from "@/components/BillingActions";
import AutoRefresh from "@/components/AutoRefresh";

export const dynamic = "force-dynamic";

const REASON_LABELS: Record<string, string> = {
  trial_grant: "Trial starter credits",
  grandfather: "Starter balance",
  purchase: "Credit pack purchase",
  purchase_refund: "Credit pack refunded",
  job_charge: "Report queued",
  job_refund: "Report refunded (failed or removed)",
  admin_adjust: "Adjustment",
};

function fmtDate(d: string | Date) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function BillingPage({ searchParams }: { searchParams: { checkout?: string } }) {
  const user = await currentUser();
  const ws = await currentWorkspaceId();
  if (!user || !ws) redirect("/login");

  const billing = await getBillingState(user.id, ws);
  const ledger = await sql`
    SELECT delta, reason, created_at FROM credits_ledger WHERE workspace_id = ${ws} ORDER BY id DESC LIMIT 20
  `;
  const payments = await sql`
    SELECT kind, amount_cents, credits, status, created_at FROM payments WHERE workspace_id = ${ws} ORDER BY id DESC
  `;

  const accessLine = billing.accessGranted
    ? "Unlocked — full access."
    : billing.trialActive
      ? `Free trial — ends ${fmtDate(billing.trialEndsAt!)}.`
      : "Your free trial has ended. Unlock Stock Studio to keep queuing reports.";

  return (
    <div className="max-w-2xl">
      {/* Webhook fulfilment lands a few seconds after the redirect back. */}
      {searchParams.checkout === "success" && <AutoRefresh />}
      <h1 className="text-2xl font-bold text-slate-100 mb-1">Billing</h1>
      <p className="text-sm text-slate-500 mb-6">
        Every report costs credits when you queue it (deep memos and comparisons cost 2, everything else 1).
        Failed or removed reports are refunded automatically.
      </p>

      {searchParams.checkout === "success" && (
        <div className="card p-4 mb-4 text-sm text-emerald-400">
          Payment received — it can take a few seconds to show up here.
        </div>
      )}

      <div className="card p-6 mb-6 space-y-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-slate-400">Credits</span>
          <span className={`text-3xl font-bold ${billing.balance > 0 ? "text-slate-100" : "text-red-400"}`}>
            {billing.balance}
          </span>
        </div>
        <p className={`text-sm ${billing.hasAccess ? "text-slate-400" : "text-amber-400"}`}>{accessLine}</p>
        <BillingActions showUnlock={!billing.accessGranted} creditsPerPack={CREDITS_PER_PACK} />
      </div>

      {payments.length > 0 && (
        <>
          <h2 className="text-sm font-semibold text-slate-300 mb-2">Payments</h2>
          <div className="card divide-y divide-ink-700 mb-6">
            {payments.map((p, i) => (
              <div key={i} className="flex justify-between px-4 py-2.5 text-sm">
                <span className="text-slate-300">
                  {p.kind === "access" ? "Access unlock" : `${p.credits} credits`}
                  {p.status === "refunded" && <span className="text-red-400"> · refunded</span>}
                </span>
                <span className="text-slate-500">
                  ${(p.amount_cents / 100).toFixed(2)} · {fmtDate(p.created_at)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <h2 className="text-sm font-semibold text-slate-300 mb-2">Credit activity</h2>
      <div className="card divide-y divide-ink-700">
        {ledger.length === 0 ? (
          <div className="px-4 py-3 text-sm text-slate-500">No activity yet.</div>
        ) : (
          ledger.map((l, i) => (
            <div key={i} className="flex justify-between px-4 py-2.5 text-sm">
              <span className="text-slate-400">{REASON_LABELS[l.reason] ?? l.reason}</span>
              <span className="flex gap-4">
                <span className={l.delta > 0 ? "text-emerald-400" : "text-slate-300"}>
                  {l.delta > 0 ? `+${l.delta}` : l.delta}
                </span>
                <span className="text-slate-600 w-24 text-right">{fmtDate(l.created_at)}</span>
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
