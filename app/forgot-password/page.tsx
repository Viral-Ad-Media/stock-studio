"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { getSupabase } from "@/lib/supabase/lazy";
import AuthShell from "@/components/auth/AuthShell";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const e = new URLSearchParams(window.location.search).get("email");
    if (e) setEmail(e);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error } = await (await getSupabase()).auth.resetPasswordForEmail(email.trim(), {
        // The emailed link lands on /auth/callback, which exchanges the code for
        // a short-lived recovery session and forwards to /reset-password.
        redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
      });
      // Same response whether or not the account exists — no email enumeration.
      if (error && !/not found|no user/i.test(error.message)) {
        setError(/rate limit/i.test(error.message) ? "Too many requests — wait a minute and try again." : error.message);
      } else {
        setSent(true);
      }
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
    }
    setBusy(false);
  }

  if (sent) {
    return (
      <AuthShell title="Check your email">
        <div className="flex flex-col items-center text-center">
          <MailCheck className="mb-3 h-10 w-10 text-emerald-400" aria-hidden />
          <p className="text-sm text-slate-300" role="status">
            If an account exists for <span className="text-slate-100">{email.trim()}</span>, we&apos;ve sent a link to
            reset your password. It expires in an hour.
          </p>
          <Link href="/login" className="mt-5 text-sm text-emerald-400 underline underline-offset-2 hover:text-emerald-300">
            Back to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter your account email and we'll send you a reset link."
      footer={
        <Link href="/login" className="text-emerald-400 underline underline-offset-2 hover:text-emerald-300">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={submit}>
        <label htmlFor="email" className="field-label">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          autoFocus
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-describedby={error ? "auth-error" : undefined}
          className="input"
        />
        {error && (
          <p id="auth-error" role="alert" className="mt-4 text-sm text-red-400">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy || !email.trim()} className="btn-primary mt-5 w-full py-2.5 text-sm">
          {busy ? "Sending…" : "Send reset link"}
        </button>
      </form>
    </AuthShell>
  );
}
