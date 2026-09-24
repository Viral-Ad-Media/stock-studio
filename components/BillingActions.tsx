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
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) {
        window.location.href = data.url; // leave busy on while the browser navigates
        return;
      }
      setError(data.error ?? "Couldn't start checkout");
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
    }
    setBusy(null);
  }

  return (
    <div>
      <div className="flex flex-wrap gap-3">
        {showUnlock && (
          <button
            onClick={() => checkout("access")}
            disabled={busy !== null}
            className="btn-primary text-sm px-5 py-2.5"
          >
            {busy === "access" ? "Redirecting…" : "Unlock Stock Studio"}
          </button>
        )}
        <button
          onClick={() => checkout("credits")}
          disabled={busy !== null}
          className="btn-secondary text-sm px-5 py-2.5"
        >
          {busy === "credits" ? "Redirecting…" : `Buy ${creditsPerPack} credits`}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-400 mt-3">
          {error}
        </p>
      )}
    </div>
  );
}
