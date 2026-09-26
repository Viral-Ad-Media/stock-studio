"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { getSupabase } from "@/lib/supabase/lazy";
import AuthShell from "@/components/auth/AuthShell";
import PasswordInput from "@/components/auth/PasswordInput";

const RULES = [
  { label: "At least 8 characters", test: (p: string) => p.length >= 8 },
  { label: "A letter and a number", test: (p: string) => /[a-z]/i.test(p) && /\d/.test(p) },
];

// Reached from the emailed reset link via /auth/callback, which has already
// exchanged the link's code for a recovery session. Without that session the
// link was used, expired, or opened in another browser.
export default function ResetPasswordPage() {
  const router = useRouter();
  const [state, setState] = useState<"checking" | "ready" | "no-session">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSupabase()
      .then((sb) => sb.auth.getUser())
      .then(({ data }) => setState(data.user ? "ready" : "no-session"))
      .catch(() => setState("no-session"));
  }, []);

  const rulesOk = RULES.every((r) => r.test(password));
  const matches = password === confirm;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!rulesOk || !matches) return;
    setBusy(true);
    setError(null);
    try {
      const { error } = await (await getSupabase()).auth.updateUser({ password });
      if (error) {
        setError(/different from the old/i.test(error.message) ? "Choose a password you haven't used before." : error.message);
        setBusy(false);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
      setBusy(false);
    }
  }

  if (state === "checking") {
    return (
      <AuthShell title="Reset your password">
        <p role="status" className="text-sm text-slate-400">
          Checking your reset link…
        </p>
      </AuthShell>
    );
  }

  if (state === "no-session") {
    return (
      <AuthShell title="This link has expired" subtitle="Reset links work once, for an hour, in the browser that requested them.">
        <Link href="/forgot-password" className="btn-primary w-full py-2.5 text-sm">
          Send a new link
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Choose a new password">
      <form onSubmit={submit}>
        <label htmlFor="password" className="field-label">
          New password
        </label>
        <PasswordInput
          id="password"
          name="new-password"
          autoComplete="new-password"
          autoFocus
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby="password-rules"
        />
        <ul id="password-rules" className="mb-4 mt-2 space-y-1 text-xs">
          {RULES.map((r) => {
            const ok = r.test(password);
            return (
              <li key={r.label} className={`flex items-center gap-1.5 ${ok ? "text-emerald-400" : "text-fg-subtle"}`}>
                <Check className={`h-3.5 w-3.5 ${ok ? "" : "opacity-40"}`} aria-hidden />
                {r.label}
                <span className="sr-only">{ok ? "(met)" : "(not met yet)"}</span>
              </li>
            );
          })}
        </ul>

        <label htmlFor="confirm" className="field-label">
          Confirm new password
        </label>
        <PasswordInput
          id="confirm"
          name="confirm-password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          aria-invalid={confirm && !matches ? true : undefined}
          aria-describedby={confirm && !matches ? "confirm-error" : undefined}
        />
        {confirm && !matches && (
          <p id="confirm-error" className="mt-2 text-xs text-red-400">
            Passwords don&apos;t match.
          </p>
        )}

        {error && (
          <p role="alert" className="mt-4 text-sm text-red-400">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy || !rulesOk || !matches} className="btn-primary mt-5 w-full py-2.5 text-sm">
          {busy ? "Saving…" : "Update password"}
        </button>
      </form>
    </AuthShell>
  );
}
