"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiError } from "@/lib/shared";

type Props = { userId: string; accessGranted: boolean; writesEnabled: boolean };

// Admin changes to one account. Every change needs a note; it goes to the
// audit log with the change itself.
export default function UserActions({ userId, accessGranted, writesEnabled }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function send(key: string, body: Record<string, unknown>, done: (res: Record<string, unknown>) => string) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(await apiError(res, "The change couldn't be saved."));
        return false;
      }
      setNotice(done(await res.json()));
      router.refresh();
      return true;
    } catch {
      setError("Couldn't reach the server.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function onCredits(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const form = e.currentTarget;
    const delta = Number(f.get("delta"));
    if (await send("credits", { action: "credits", delta, note: f.get("note") }, (r) => `Credits ${delta > 0 ? "added" : "removed"}. New balance: ${r.balance}.`)) form.reset();
  }
  async function onTrial(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const form = e.currentTarget;
    if (await send("trial", { action: "trial", days: Number(f.get("days")), note: f.get("note") }, () => "Trial extended.")) form.reset();
  }
  async function onAccess(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const form = e.currentTarget;
    const granted = !accessGranted;
    if (await send("access", { action: "access", granted, note: f.get("note") }, () => (granted ? "Access granted." : "Access removed."))) form.reset();
  }

  const disabled = !writesEnabled || busy !== null;

  return (
    <section aria-labelledby="actions-heading" className="card p-4">
      <h2 id="actions-heading" className="text-sm font-semibold text-slate-100">Admin actions</h2>
      {!writesEnabled && (
        <p role="alert" className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-200">
          Changes are disabled until ADMIN_DATABASE_URL is set on the server (the stocks_admin role&apos;s connection string).
        </p>
      )}
      <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <form onSubmit={onCredits} className="space-y-3">
          <h3 className="text-sm font-medium text-slate-200">Adjust credits</h3>
          <div>
            <label htmlFor="adj-delta" className="field-label">Credits to add (negative to remove)</label>
            <input id="adj-delta" name="delta" type="number" step={1} min={-10000} max={10000} required className="input" />
          </div>
          <div>
            <label htmlFor="adj-note" className="field-label">Reason</label>
            <input id="adj-note" name="note" required minLength={3} maxLength={500} className="input" />
          </div>
          <button type="submit" disabled={disabled} className="btn-primary w-full px-4 py-2 text-sm">
            {busy === "credits" ? "Saving…" : "Adjust credits"}
          </button>
        </form>
        <form onSubmit={onTrial} className="space-y-3">
          <h3 className="text-sm font-medium text-slate-200">Extend trial</h3>
          <div>
            <label htmlFor="trial-days" className="field-label">Days to add</label>
            <input id="trial-days" name="days" type="number" step={1} min={1} max={365} required className="input" />
          </div>
          <div>
            <label htmlFor="trial-note" className="field-label">Reason</label>
            <input id="trial-note" name="note" required minLength={3} maxLength={500} className="input" />
          </div>
          <button type="submit" disabled={disabled} className="btn-primary w-full px-4 py-2 text-sm">
            {busy === "trial" ? "Saving…" : "Extend trial"}
          </button>
        </form>
        <form onSubmit={onAccess} className="space-y-3">
          <h3 className="text-sm font-medium text-slate-200">{accessGranted ? "Remove access" : "Grant access"}</h3>
          <p className="text-xs text-fg-subtle">
            {accessGranted
              ? "The account keeps any trial time left, then loses access. Stripe isn't refunded by this."
              : "Unlocks the app without a payment, as if the one-time fee had been paid."}
          </p>
          <div>
            <label htmlFor="access-note" className="field-label">Reason</label>
            <input id="access-note" name="note" required minLength={3} maxLength={500} className="input" />
          </div>
          <button type="submit" disabled={disabled} className={`${accessGranted ? "btn-secondary" : "btn-primary"} w-full px-4 py-2 text-sm`}>
            {busy === "access" ? "Saving…" : accessGranted ? "Remove access" : "Grant access"}
          </button>
        </form>
      </div>
      <div className="mt-4 min-h-[1.25rem]">
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        {notice && <p role="status" className="text-sm text-emerald-400">{notice}</p>}
      </div>
    </section>
  );
}
