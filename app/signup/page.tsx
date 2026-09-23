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
      <div className="fixed inset-0 flex items-center justify-center bg-ink-950">
        <div className="card p-8 w-80 text-center">
          <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-3" />
          <h1 className="text-slate-100 font-semibold mb-1">Check your email</h1>
          <p className="text-[13px] text-slate-400">
            We sent a confirmation link to <span className="text-slate-200">{email}</span>. Click
            it to activate your 30-day free trial.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-ink-950">
      <form onSubmit={submit} className="card p-8 w-80 text-center">
        <CandlestickChart className="w-8 h-8 text-emerald-400 mx-auto mb-3" />
        <h1 className="text-slate-100 font-semibold mb-1">Start your free trial</h1>
        <p className="text-[12px] text-slate-500 mb-5">30 days free, no card required to start</p>
        <input
          type="email"
          autoFocus
          placeholder="you@example.com"
          className="w-full bg-ink-800 border border-ink-600 rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none focus:border-emerald-500"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError(null);
          }}
        />
        <input
          type="password"
          placeholder="Password (min 8 characters)"
          minLength={8}
          className="w-full bg-ink-800 border border-ink-600 rounded-lg px-3 py-2 text-sm text-center mb-3 focus:outline-none focus:border-emerald-500"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(null);
          }}
        />
        {error && <p className="text-[12px] text-red-400 mb-3">{error}</p>}
        <button
          className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg mb-3"
          type="submit"
          disabled={busy || !email || password.length < 8}
        >
          {busy ? "Creating account…" : "Create account"}
        </button>
        <p className="text-[12px] text-slate-500">
          Already have an account?{" "}
          <Link href="/login" className="text-emerald-400 hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
