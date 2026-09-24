"use client";

import { useState } from "react";

export default function BillingActions({
  showUnlock,
  creditsPerPack,
}: {
  showUnlock: boolean;
  creditsPerPack: number;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function checkout(kind: "access" | "credits") {
    setBusy(kind);
    setError(null);
    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.url) {
      window.location.href = data.url;
    } else {
      setError(data.error ?? "Couldn't start checkout");
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-3">
        {showUnlock && (
          <button
            onClick={() => checkout("access")}
            disabled={busy !== null}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium px-5 py-2.5 rounded-lg"
          >
            {busy === "access" ? "Redirecting…" : "Unlock Stock Studio"}
          </button>
        )}
        <button
          onClick={() => checkout("credits")}
          disabled={busy !== null}
          className="border border-ink-600 hover:border-ink-500 disabled:opacity-50 text-slate-200 text-sm font-medium px-5 py-2.5 rounded-lg"
        >
          {busy === "credits" ? "Redirecting…" : `Buy ${creditsPerPack} credits`}
        </button>
      </div>
      {error && <p className="text-sm text-red-400 mt-3">{error}</p>}
    </div>
  );
}
