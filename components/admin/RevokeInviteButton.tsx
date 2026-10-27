"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiError } from "@/lib/shared";

export default function RevokeInviteButton({ id, email, disabled }: { id: number; email: string; disabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    const note = window.prompt(`Cancel the invite for ${email}? Add a short reason.`);
    if (note === null) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/invites/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      if (!res.ok) {
        window.alert(await apiError(res, "The invite couldn't be cancelled."));
        return;
      }
      router.refresh();
    } catch {
      window.alert("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={onClick} disabled={disabled || busy} className="btn-secondary px-3 py-1 text-xs">
      {busy ? "Cancelling…" : "Cancel invite"}
    </button>
  );
}
