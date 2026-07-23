"use client";

import { useState } from "react";
import { CandlestickChart } from "lucide-react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) window.location.href = "/";
    else setError(true);
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-ink-950">
      <form onSubmit={submit} className="card p-8 w-80 text-center">
        <CandlestickChart className="w-8 h-8 text-emerald-400 mx-auto mb-3" />
        <h1 className="text-slate-100 font-semibold mb-1">Stock Studio</h1>
        <p className="text-[12px] text-slate-500 mb-5">Enter the access password</p>
        <input
          type="password"
          autoFocus
          className="w-full bg-ink-800 border border-ink-600 rounded-lg px-3 py-2 text-sm text-center mb-3 focus:outline-none focus:border-emerald-500"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(false);
          }}
        />
        {error && <p className="text-[12px] text-red-400 mb-3">Wrong password</p>}
        <button
          className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
          type="submit"
          disabled={!password}
        >
          Unlock
        </button>
      </form>
    </div>
  );
}
