"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiError } from "@/lib/shared";

type Props = { writesEnabled: boolean; signupUrl: string };

type Result =
  | { kind: "provisioned"; email: string; userId: string }
  | { kind: "invited"; email: string };

// Add a user by email. Someone with no login yet gets an invite that's
// applied when they sign up with that email; the console doesn't send email,
// so share the signup link with them.
export default function AddUserForm({ writesEnabled, signupUrl }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const email = String(f.get("email") ?? "").trim().toLowerCase();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          credits: f.get("credits") === "" ? 0 : Number(f.get("credits")),
          trialDays: f.get("trialDays") === "" ? null : Number(f.get("trialDays")),
          access: f.get("access") === "on",
          note: f.get("note"),
        }),
      });
      if (!res.ok) {
        setError(await apiError(res, "The user couldn't be added."));
        return;
      }
      const body = await res.json();
      setResult(
        body.status === "provisioned"
          ? { kind: "provisioned", email, userId: body.userId }
          : { kind: "invited", email },
      );
      form.reset();
      router.refresh();
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="add-user-heading" className="card p-4">
      <h2 id="add-user-heading" className="text-sm font-semibold text-slate-100">
        Add a user
      </h2>
      <p className="mt-1 text-xs text-fg-subtle">
        Every account starts with the standard 30-day trial and 5 credits.
        Anything set here is added on top when they sign up with this email.
      </p>
      <form onSubmit={onSubmit} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <label htmlFor="new-email" className="field-label">
            Email
          </label>
          <input id="new-email" name="email" type="email" required maxLength={254} autoComplete="off" className="input" />
        </div>
        <div>
          <label htmlFor="new-credits" className="field-label">
            Extra credits
          </label>
          <input id="new-credits" name="credits" type="number" step={1} min={0} max={10000} placeholder="0" className="input" />
        </div>
        <div>
          <label htmlFor="new-trial" className="field-label">
            Trial length (days)
          </label>
          <input id="new-trial" name="trialDays" type="number" step={1} min={1} max={365} placeholder="30" className="input" />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="new-note" className="field-label">
            Reason
          </label>
          <input id="new-note" name="note" required minLength={3} maxLength={500} className="input" />
        </div>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-300">
          <input name="access" type="checkbox" className="h-4 w-4 accent-emerald-500" />
          Grant paid access
        </label>
        <button type="submit" disabled={!writesEnabled || busy} className="btn-primary self-end px-4 py-2 text-sm">
          {busy ? "Adding…" : "Add user"}
        </button>
      </form>
      <div className="mt-3 min-h-[1.25rem] text-sm">
        {error && (
          <p role="alert" className="text-red-400">
            {error}
          </p>
        )}
        {result?.kind === "provisioned" && (
          <p role="status" className="text-emerald-400">
            {result.email} already had a login, so their account is ready.{" "}
            <Link href={`/admin/users/${result.userId}`} className="underline underline-offset-2">
              Open it
            </Link>
          </p>
        )}
        {result?.kind === "invited" && (
          <p role="status" className="text-emerald-400">
            Invite saved for {result.email}. Send them{" "}
            <span className="break-all font-mono text-slate-200">{signupUrl}</span> and ask them to sign up with
            that email.
          </p>
        )}
      </div>
    </section>
  );
}
