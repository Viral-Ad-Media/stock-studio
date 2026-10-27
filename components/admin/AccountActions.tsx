"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiError } from "@/lib/shared";

type Props = {
  userId: string;
  email: string;
  disabled: boolean;
  isAdmin: boolean;
  isSelf: boolean;
  hasPayments: boolean;
  writesEnabled: boolean;
};

// Account-level changes: disable, the super admin role, and removal. Each
// needs a reason for the audit log; removal also needs the email typed back.
export default function AccountActions({
  userId,
  email,
  disabled,
  isAdmin,
  isSelf,
  hasPayments,
  writesEnabled,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function send(key: string, method: "POST" | "DELETE", body: Record<string, unknown>) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(await apiError(res, "The change couldn't be saved."));
        return false;
      }
      return true;
    } catch {
      setError("Couldn't reach the server.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function onDisabled(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const next = !disabled;
    const ok = await send("disabled", "POST", {
      action: "disabled",
      disabled: next,
      note: new FormData(form).get("note"),
    });
    if (ok) {
      setNotice(next ? "Account disabled." : "Account enabled.");
      form.reset();
      router.refresh();
    }
  }
  async function onAdmin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const next = !isAdmin;
    const ok = await send("admin", "POST", {
      action: "admin",
      admin: next,
      note: new FormData(form).get("note"),
    });
    if (ok) {
      setNotice(next ? "Now a super admin." : "Super admin role removed.");
      form.reset();
      router.refresh();
    }
  }
  async function onRemove(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (!window.confirm(`Remove ${email} from Stock Studio? Their studies, watchlist, journal and credits are deleted. This can't be undone.`))
      return;
    const ok = await send("remove", "DELETE", {
      confirmEmail: f.get("confirmEmail"),
      note: f.get("note"),
    });
    if (ok) {
      router.push("/admin/users");
      router.refresh();
    }
  }

  const off = !writesEnabled || busy !== null;

  return (
    <section aria-labelledby="account-heading" className="card p-4">
      <h2 id="account-heading" className="text-sm font-semibold text-slate-100">
        Account
      </h2>
      {isSelf && (
        <p className="mt-1 text-xs text-fg-subtle">
          This is your own account, so it can&apos;t be disabled, removed or lose its admin role from here.
        </p>
      )}
      <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <form onSubmit={onDisabled} className="space-y-3">
          <h3 className="text-sm font-medium text-slate-200">{disabled ? "Enable account" : "Disable account"}</h3>
          <p className="text-xs text-fg-subtle">
            {disabled
              ? "They can sign in and use the app again, with everything as they left it."
              : "They're signed out of the app and can't queue studies. Their data and credits are kept."}
          </p>
          <div>
            <label htmlFor="dis-note" className="field-label">
              Reason
            </label>
            <input id="dis-note" name="note" required minLength={3} maxLength={500} className="input" />
          </div>
          <button
            type="submit"
            disabled={off || (isSelf && !disabled)}
            className={`${disabled ? "btn-primary" : "btn-secondary"} w-full px-4 py-2 text-sm`}
          >
            {busy === "disabled" ? "Saving…" : disabled ? "Enable account" : "Disable account"}
          </button>
        </form>
        <form onSubmit={onAdmin} className="space-y-3">
          <h3 className="text-sm font-medium text-slate-200">Role: {isAdmin ? "Super admin" : "Member"}</h3>
          <p className="text-xs text-fg-subtle">
            {isAdmin
              ? "Takes away the admin console. Their own account is unchanged."
              : "Super admins can see every account and make any change on this page."}
          </p>
          <div>
            <label htmlFor="role-note" className="field-label">
              Reason
            </label>
            <input id="role-note" name="note" required minLength={3} maxLength={500} className="input" />
          </div>
          <button type="submit" disabled={off || isSelf || (disabled && !isAdmin)} className="btn-secondary w-full px-4 py-2 text-sm">
            {busy === "admin" ? "Saving…" : isAdmin ? "Remove super admin" : "Make super admin"}
          </button>
        </form>
        <form onSubmit={onRemove} className="space-y-3">
          <h3 className="text-sm font-medium text-red-300">Remove from Stock Studio</h3>
          <p className="text-xs text-fg-subtle">
            {hasPayments
              ? "This account has payments, so it can't be removed (the Stripe history would go with it). Disable it instead."
              : "Deletes their account and data here. Their login stays, since other apps share it; if they sign in again they start over as a new account."}
          </p>
          <div>
            <label htmlFor="rm-email" className="field-label">
              Type {email} to confirm
            </label>
            <input id="rm-email" name="confirmEmail" required autoComplete="off" className="input" />
          </div>
          <div>
            <label htmlFor="rm-note" className="field-label">
              Reason
            </label>
            <input id="rm-note" name="note" required minLength={3} maxLength={500} className="input" />
          </div>
          <button
            type="submit"
            disabled={off || isSelf || hasPayments || isAdmin}
            className="inline-flex min-h-[2.5rem] w-full items-center justify-center rounded-lg border border-red-500/50 px-4 py-2 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy === "remove" ? "Removing…" : "Remove account"}
          </button>
          {isAdmin && !isSelf && <p className="text-xs text-fg-subtle">Remove the super admin role first.</p>}
        </form>
      </div>
      <div className="mt-4 min-h-[1.25rem]">
        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm text-emerald-400">
            {notice}
          </p>
        )}
      </div>
    </section>
  );
}
