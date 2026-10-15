"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
export default function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
      className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-sm"
    >
      <RefreshCw
        aria-hidden
        className={`h-4 w-4 ${pending ? "animate-spin" : ""}`}
      />
      {pending ? "Refreshing…" : "Refresh data"}
    </button>
  );
}
