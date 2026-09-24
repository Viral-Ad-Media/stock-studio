"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { VARIANTS, HIDDEN_FORM_VARIANTS } from "@/lib/shared";

export default function NewStudy() {
  const router = useRouter();
  const [ticker, setTicker] = useState("");
  const [company, setCompany] = useState("");
  const [variant, setVariant] = useState("full");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/case-studies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker, company, variant, notes }),
    });
    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      setError((await res.json()).error ?? "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-slate-100 mb-1">New case study</h1>
      <p className="text-sm text-slate-500 mb-6">
        Queues a job for the research engine. Costs 1 credit (deep memos and comparisons cost 2) —
        refunded automatically if the build fails.
      </p>

      <form onSubmit={submit} className="card p-6 space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm text-slate-400">Ticker *</span>
            <input
              required
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              placeholder="NVDA — or 'AAPL vs MSFT' for comparisons"
              className="mt-1 w-full bg-ink-800 border border-ink-600 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-emerald-500"
            />
          </label>
          <label className="block">
            <span className="text-sm text-slate-400">Company (optional)</span>
            <input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="NVIDIA Corporation"
              className="mt-1 w-full bg-ink-800 border border-ink-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
            />
          </label>
        </div>

        <div>
          <span className="text-sm text-slate-400 block mb-2">Format</span>
          <div className="grid grid-cols-2 gap-2">
            {VARIANTS.filter((v) => !HIDDEN_FORM_VARIANTS.includes(v.value)).map((v) => (
              <button
                type="button"
                key={v.value}
                onClick={() => setVariant(v.value)}
                className={`text-left p-3 rounded-lg border text-sm transition-colors ${
                  variant === v.value
                    ? "border-emerald-500 bg-emerald-500/10"
                    : "border-ink-600 bg-ink-800 hover:border-ink-500"
                }`}
              >
                <div className="font-medium text-slate-200">{v.label}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">{v.hint}</div>
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="text-sm text-slate-400">
            Raw notes (optional — the engine fact-checks these and flags corrections)
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={5}
            placeholder="e.g. Revenue accelerating 5 quarters straight, data center demand insane, moat = CUDA…"
            className="mt-1 w-full bg-ink-800 border border-ink-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
          />
        </label>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          disabled={busy || !ticker.trim()}
          className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium px-5 py-2.5 rounded-lg"
        >
          {busy ? "Queuing…" : "Queue for the engine"}
        </button>
      </form>
    </div>
  );
}
