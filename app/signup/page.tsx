"use client";

import { useState } from "react";
import Link from "next/link";
import { CandlestickChart, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    setSent(true);
    setBusy(false);
  }

  if (sent) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-ink-950 p-4">
        <div className="card p-8 w-full max-w-sm text-center">
          <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-3" />
          <h1 className="text-slate-100 font-semibold mb-1">Check your email</h1>
          <p className="text-sm text-slate-400">
            We sent a confirmation link to <span className="text-slate-200">{email}</span>. Click
            it to activate your 30-day free trial.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-ink-950 p-4">
      <form onSubmit={submit} className="card p-8 w-full max-w-sm text-center">
        <CandlestickChart className="w-8 h-8 text-emerald-400 mx-auto mb-3" />
        <h1 className="text-slate-100 font-semibold mb-1">Start your free trial</h1>
        <p className="text-xs text-fg-subtle mb-5">30 days free, no card required to start</p>
        <label htmlFor="email" className="field-label text-left">
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
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "auth-error" : undefined}
          className="input mb-3"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError(null);
          }}
        />
        <label htmlFor="password" className="field-label text-left">
          Password (min 8 characters)
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "auth-error" : undefined}
          className="input mb-3"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(null);
          }}
        />
        {error && (
          <p id="auth-error" role="alert" className="text-sm text-red-400 mb-3">
            {error}
          </p>
        )}
        <button
          className="w-full btn-primary text-sm px-4 py-2.5 mb-3"
          type="submit"
          disabled={busy || !email || password.length < 8}
        >
          {busy ? "Creating account…" : "Create account"}
        </button>
        <p className="text-xs text-fg-subtle">
          Already have an account?{" "}
          <Link href="/login" className="text-emerald-400 underline underline-offset-2 hover:text-emerald-300">
            Sign in
          </Link>
        </p>
        <p className="text-xs text-fg-subtle mt-3">
          <Link href="/" className="hover:underline">
            ← Back to home
          </Link>
        </p>
      </form>
    </main>
  );
}
