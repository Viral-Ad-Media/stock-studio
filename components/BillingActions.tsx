"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { PLANS, PLAN_IDS, type BillingInterval, type PlanId } from "@/lib/plans";

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

// Credit pack + "Manage plan" (portal) buttons.
export default function BillingActions({ creditsPerPack, canManage }: { creditsPerPack: number; canManage: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (key: string, path: string, body: unknown) => {
    setBusy(key);
    if (!(await go(path, body, setError))) setBusy(null);
  };

  return (
    <div>
      <div className="flex flex-wrap gap-3">
        {canManage && (
          <button onClick={() => run("portal", "/api/billing/portal", {})} disabled={busy !== null} className="btn-primary text-sm px-5 py-2.5">
            {busy === "portal" ? "Redirecting…" : "Manage plan"}
          </button>
        )}
        <button onClick={() => run("credits", "/api/billing/checkout", { kind: "credits" })} disabled={busy !== null} className="btn-secondary text-sm px-5 py-2.5">
          {busy === "credits" ? "Redirecting…" : `Buy ${creditsPerPack} credits`}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-400 mt-3">
          {error}
        </p>
      )}
    </div>
  );
}

// The three plans with a monthly/yearly switch. `current` marks the member's
// live plan; with one, the other cards point to "Manage plan" instead of
// starting a second subscription.
export function PlanPicker({ current, highlight }: { current: PlanId | null; highlight: PlanId | null }) {
  const [interval, setBillingInterval] = useState<BillingInterval>("month");
  const [busy, setBusy] = useState<PlanId | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(plan: PlanId) {
    setBusy(plan);
    if (!(await go("/api/billing/checkout", { kind: "plan", plan, interval }, setError))) setBusy(null);
  }

  return (
    <section aria-labelledby="plans-heading" className="mb-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="plans-heading" className="text-sm font-semibold text-slate-300">Plans</h2>
        <div role="radiogroup" aria-label="Billing period" className="inline-flex rounded-lg border border-ink-600 p-0.5 text-xs">
          {(["month", "year"] as const).map((i) => (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={interval === i}
              onClick={() => setBillingInterval(i)}
              className={`rounded-md px-3 py-1.5 ${interval === i ? "bg-emerald-500/15 text-emerald-300" : "text-slate-300 hover:text-slate-100"}`}
            >
              {i === "month" ? "Monthly" : "Yearly · 2 months free"}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {PLAN_IDS.map((id) => {
          const p = PLANS[id];
          const isCurrent = current === id;
          const price = interval === "month" ? p.monthlyUsd : p.yearlyUsd;
          return (
            <div key={id} className={`card flex flex-col p-5 ${highlight === id || isCurrent ? "border-emerald-500/50" : ""}`}>
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-semibold text-slate-100">{p.name}</h3>
                {isCurrent && <span className="text-xs font-medium text-emerald-300">Your plan</span>}
              </div>
              <p className="mt-1 text-2xl font-bold text-slate-100">
                ${price.toLocaleString("en-US")}
                <span className="text-sm font-normal text-fg-subtle">/{interval === "month" ? "month" : "year"}</span>
              </p>
              <p className="mt-1 text-xs text-fg-subtle">{p.tagline}</p>
              <ul className="mt-3 mb-4 space-y-1.5 text-sm text-slate-300">
                {p.highlights.map((h) => (
                  <li key={h} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden /> {h}
                  </li>
                ))}
              </ul>
              {!current && (
                <button onClick={() => choose(id)} disabled={busy !== null} className={`${id === "gold" ? "btn-primary" : "btn-secondary"} mt-auto px-4 py-2 text-sm`}>
                  {busy === id ? "Redirecting…" : `Choose ${p.name}`}
                </button>
              )}
              {current && !isCurrent && (
                <p className="mt-auto text-xs text-fg-subtle">Switch with &ldquo;Manage plan&rdquo; above. Stripe prorates the difference.</p>
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
