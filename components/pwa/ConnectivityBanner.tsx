"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertTriangle, CloudOff, RefreshCw, Database } from "lucide-react";
import { usePwa } from "./PwaProvider";

export default function ConnectivityBanner() {
  const pathname = usePathname();
  const {
    isOffline,
    pendingCount,
    failedCount,
    syncing,
    syncNow,
    setSettingsOpen,
  } = usePwa();

  if (!isOffline && pendingCount === 0 && failedCount === 0 && !syncing) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={`border-b px-4 py-2 text-xs sm:text-sm ${
        isOffline
          ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
          : failedCount > 0
            ? "border-red-500/30 bg-red-500/10 text-red-300"
            : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
      }`}
    >
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {isOffline ? (
            <CloudOff className="h-4 w-4 shrink-0 text-amber-400" aria-hidden />
          ) : failedCount > 0 ? (
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" aria-hidden />
          ) : (
            <RefreshCw
              className={`h-4 w-4 shrink-0 text-emerald-400 ${syncing ? "animate-spin" : ""}`}
              aria-hidden
            />
          )}
          <span>
            {isOffline ? (
              <>
                <strong className="font-semibold">Offline mode.</strong>{" "}
                Viewing cached data on this device
                {pendingCount > 0
                  ? ` · ${pendingCount} ${pendingCount === 1 ? "change" : "changes"} queued to sync automatically`
                  : "."}
              </>
            ) : failedCount > 0 ? (
              <>
                <strong className="font-semibold">
                  {failedCount} offline {failedCount === 1 ? "change" : "changes"} couldn&apos;t sync.
                </strong>{" "}
                Review or retry in Sync &amp; Alerts.
              </>
            ) : (
              <>
                {syncing
                  ? `Syncing ${pendingCount} offline ${pendingCount === 1 ? "change" : "changes"}…`
                  : `${pendingCount} offline ${pendingCount === 1 ? "change" : "changes"} ready to sync.`}
              </>
            )}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {isOffline && pathname !== "/offline" && (
            <Link
              href="/offline"
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-400/40 bg-ink-900/80 px-2.5 py-1 text-xs font-medium text-slate-100 hover:border-amber-300"
            >
              <Database className="h-3.5 w-3.5" aria-hidden />
              Offline library
            </Link>
          )}
          {!isOffline && pendingCount > 0 && (
            <button
              type="button"
              disabled={syncing}
              onClick={() => void syncNow()}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-400/40 bg-ink-900/80 px-2.5 py-1 text-xs font-medium text-slate-100 hover:border-emerald-300 disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} aria-hidden />
              {syncing ? "Syncing…" : "Sync now"}
            </button>
          )}
          {failedCount > 0 && (
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="inline-flex items-center gap-1 rounded-md border border-red-400/40 bg-ink-900/80 px-2.5 py-1 text-xs font-medium text-slate-100 hover:border-red-300"
            >
              Review queue
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
