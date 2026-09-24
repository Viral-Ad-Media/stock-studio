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
    <div className="fixed inset-0 flex items-center justify-center bg-ink-950">
      <form onSubmit={submit} className="card p-8 w-80 text-center">
        <CandlestickChart className="w-8 h-8 text-emerald-400 mx-auto mb-3" />
        <h1 className="text-slate-100 font-semibold mb-1">Stock Studio</h1>
        <p className="text-[12px] text-slate-500 mb-5">Sign in to your workspace</p>
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
          placeholder="Password"
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
          disabled={busy || !email || !password}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="text-[12px] text-slate-500">
          No account?{" "}
          <Link href="/signup" className="text-emerald-400 hover:underline">
            Start your free trial
          </Link>
        </p>
      </form>
    </div>
  );
}
