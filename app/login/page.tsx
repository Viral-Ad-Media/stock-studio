"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CandlestickChart } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-ink-950 p-4">
      <form onSubmit={submit} className="card p-8 w-full max-w-sm text-center">
        <CandlestickChart className="w-8 h-8 text-emerald-400 mx-auto mb-3" />
        <h1 className="text-slate-100 font-semibold mb-1">Stock Studio</h1>
        <p className="text-xs text-fg-subtle mb-5">Sign in to your workspace</p>
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
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
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
          disabled={busy || !email || !password}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="text-xs text-fg-subtle">
          No account?{" "}
          <Link href="/signup" className="text-emerald-400 underline underline-offset-2 hover:text-emerald-300">
            Start your free trial
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
