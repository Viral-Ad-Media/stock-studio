"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { PLANS, PLAN_IDS, usd, type PlanId } from "@/lib/plans";

// Starts a Stripe redirect (Checkout or the customer portal).
async function go(path: string, body: unknown, setError: (e: string | null) => void): Promise<boolean> {
  setError(null);
  try {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.url) {
      window.location.href = data.url; // leave busy on while the browser navigates
      return true;
    }
    setError(data.error ?? "Couldn't reach Stripe. Try again in a minute.");
  } catch {
    setError("Couldn't reach the server — check your connection and try again.");
  }
  return false;
}

// "Manage plan" opens Stripe's customer portal: card, invoices, cancel.
export default function BillingActions({ canManage }: { canManage: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!canManage) return null;
  const open = async () => {
    setBusy(true);
    if (!(await go("/api/billing/portal", {}, setError))) setBusy(false);
  };

  return (
    <div>
      <button onClick={open} disabled={busy} className="btn-primary text-sm px-5 py-2.5">
        {busy ? "Redirecting…" : "Manage plan"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-400 mt-3">
          {error}
        </p>
      )}
    </div>
  );
}

// The three coaching tiers. The program fee is paid outside the app, so only
// the tier an admin enrolled the member in (`enrolled`) can be started here;
// the others point to the team. `current` is the member's live plan.
export function PlanPicker({
  current,
  enrolled,
  highlight,
  contactEmail,
}: {
  current: PlanId | null;
  enrolled: PlanId | null;
  highlight: PlanId | null;
  contactEmail: string;
}) {
  const [busy, setBusy] = useState<PlanId | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start(plan: PlanId, kind: "plan" | "switch") {
    setBusy(plan);
    if (!(await go("/api/billing/checkout", { kind, plan }, setError))) setBusy(null);
  }

  return (
    <section aria-labelledby="plans-heading" className="mb-6">
      <h2 id="plans-heading" className="text-sm font-semibold text-slate-300">Plans</h2>
      <p className="mb-3 mt-1 max-w-[72ch] text-xs text-fg-subtle">
        {enrolled
          ? `You're enrolled in ${PLANS[enrolled].name}. To move to another tier, contact us; once the upgrade is confirmed you can switch here.`
          : "Plans are tiers of the coaching program. Enrol with us first; once your program payment is received, your tier is switched on here and you start the monthly membership."}
      </p>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {PLAN_IDS.map((id) => {
          const p = PLANS[id];
          const isCurrent = current === id;
          const isEnrolled = enrolled === id;
          return (
            <div key={id} className={`card flex flex-col p-5 ${highlight === id || isCurrent || isEnrolled ? "border-emerald-500/50" : ""}`}>
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-semibold text-slate-100">{p.name}</h3>
                {isCurrent ? (
                  <span className="text-xs font-medium text-emerald-300">Your plan</span>
                ) : (
                  isEnrolled && <span className="text-xs font-medium text-emerald-300">Enrolled</span>
                )}
              </div>
              <p className="mt-1 text-2xl font-bold text-slate-100">
                ${p.monthlyUsd}
                <span className="text-sm font-normal text-fg-subtle">/month</span>
              </p>
              <p className="mt-1 text-xs text-fg-subtle">
                Program price: <s><span className="sr-only">originally </span>{usd(p.originalProgramUsd)}</s>{" "}
                <span className="text-slate-200">{usd(p.programUsd)}</span>
              </p>
              <p className="mt-1 text-xs text-fg-subtle">{p.tagline}</p>
              <ul className="mt-3 mb-4 space-y-1.5 text-sm text-slate-300">
                {p.highlights.map((h) => (
                  <li key={h} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden /> {h}
                  </li>
                ))}
              </ul>
              {isEnrolled && !isCurrent ? (
                <button onClick={() => start(id, current ? "switch" : "plan")} disabled={busy !== null} className="btn-primary mt-auto px-4 py-2 text-sm">
                  {busy === id ? "Working…" : current ? `Switch to ${p.name}` : `Start ${p.name} for $${p.monthlyUsd}/month`}
                </button>
              ) : (
                !isCurrent && (
                  <a
                    href={`mailto:${contactEmail}?subject=${encodeURIComponent(`${p.name} plan`)}`}
                    className="btn-secondary mt-auto px-4 py-2 text-center text-sm"
                  >
                    {enrolled || current ? `Ask about ${p.name}` : `Enrol in ${p.name}`}
                  </a>
                )
              )}
            </div>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-400 mt-3">
          {error}
        </p>
      )}
    </section>
  );
}
