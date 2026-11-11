"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Bell,
  BellOff,
  CheckCircle2,
  Download,
  RefreshCw,
  Send,
  Smartphone,
  Trash2,
  X,
  Database,
} from "lucide-react";
import { apiError } from "@/lib/shared";
import { urlBase64ToUint8Array } from "@/lib/offline/store";
import { usePwa } from "./PwaProvider";

type ServerPushSub = {
  id: string;
  endpoint: string;
  notifyStudies: boolean;
  notifyWatchlist: boolean;
  notifySignals: boolean;
  lastSentAt?: string | null;
};

type PushConfigResponse = {
  configured: boolean;
  publicKey: string | null;
  signalsEntitled: boolean;
  subscriptions: ServerPushSub[];
};

export function PushAndOfflinePanel({ onClose }: { onClose?: () => void }) {
  const {
    isOffline,
    isStandalone,
    isIOS,
    canInstall,
    promptInstall,
    outbox,
    syncing,
    snapshot,
    syncNow,
    refreshSnapshot,
    discardOutboxItem,
    retryOutboxItem,
  } = usePwa();

  const [pushSupported, setPushSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [config, setConfig] = useState<PushConfigResponse | null>(null);
  const [localEndpoint, setLocalEndpoint] = useState<string | null>(null);
  const [prefs, setPrefs] = useState({
    notifyStudies: true,
    notifyWatchlist: true,
    notifySignals: true,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadPushState = useCallback(async () => {
    const supported =
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;
    setPushSupported(supported);
    if (supported) {
      setPermission(Notification.permission);
    }

    let browserSub: PushSubscription | null = null;
    if (supported) {
      const reg = await navigator.serviceWorker.ready.catch(() => null);
      browserSub = (await reg?.pushManager?.getSubscription().catch(() => null)) ?? null;
      setLocalEndpoint(browserSub?.endpoint ?? null);
    }

    try {
      const res = await fetch("/api/push", { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as PushConfigResponse;
      setConfig(data);
      if (browserSub) {
        const match = data.subscriptions.find((s) => s.endpoint === browserSub!.endpoint);
        if (match) {
          setPrefs({
            notifyStudies: match.notifyStudies,
            notifyWatchlist: match.notifyWatchlist,
            notifySignals: match.notifySignals,
          });
        } else {
          // Browser has an orphaned subscription not saved for this account yet.
          setLocalEndpoint(null);
        }
      }
    } catch {
      // Offline or unauthenticated
    }
  }, []);

  useEffect(() => {
    void loadPushState();
  }, [loadPushState]);

  const subscribed = Boolean(localEndpoint);

  async function subscribe() {
    setBusy("subscribe");
    setError(null);
    setNotice(null);
    try {
      if (!config?.configured || !config.publicKey) {
        setError("Server VAPID keys aren't configured yet (run npm run vapid-keys).");
        return;
      }
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") {
        setError("Allow browser notifications in your site settings to enable alerts.");
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(config.publicKey),
        });
      }

      const res = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscription: sub.toJSON(),
          preferences: prefs,
        }),
      });
      if (!res.ok) {
        setError(await apiError(res, "Couldn't register push subscription."));
        return;
      }
      setLocalEndpoint(sub.endpoint);
      setNotice("Push notifications enabled on this device.");
      await loadPushState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't enable push notifications.");
    } finally {
      setBusy(null);
    }
  }

  async function unsubscribe() {
    setBusy("unsubscribe");
    setError(null);
    setNotice(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      const endpoint = sub?.endpoint ?? localEndpoint;
      if (endpoint) {
        await fetch("/api/push", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint }),
        }).catch(() => {});
      }
      await sub?.unsubscribe().catch(() => {});
      setLocalEndpoint(null);
      setNotice("Push notifications turned off for this device.");
      await loadPushState();
    } catch {
      setError("Couldn't unsubscribe cleanly.");
    } finally {
      setBusy(null);
    }
  }

  async function togglePref(key: keyof typeof prefs) {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    if (!localEndpoint) return;
    setBusy(key);
    setError(null);
    try {
      const res = await fetch("/api/push", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: localEndpoint, ...next }),
      });
      if (!res.ok) {
        setPrefs(prefs);
        setError(await apiError(res, "Couldn't save notification preference."));
      }
    } catch {
      setPrefs(prefs);
      setError("Reconnect to update notification preferences.");
    } finally {
      setBusy(null);
    }
  }

  async function sendTest() {
    if (!localEndpoint) return;
    setBusy("test");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test", endpoint: localEndpoint }),
      });
      if (!res.ok) {
        setError(await apiError(res, "Couldn't send test notification."));
        return;
      }
      setNotice("Test push sent — check your system notifications.");
    } catch {
      setError("Couldn't reach the server to send a test push.");
    } finally {
      setBusy(null);
    }
  }

  async function handleManualOfflineSync() {
    setBusy("sync");
    setError(null);
    setNotice(null);
    try {
      await syncNow();
      const ok = await refreshSnapshot();
      setNotice(
        ok
          ? "Offline workspace copy refreshed."
          : "Queued changes checked; couldn't refresh snapshot right now.",
      );
    } finally {
      setBusy(null);
    }
  }

  const iosNeedsInstall = isIOS && !isStandalone;

  return (
    <div className="space-y-6">
      {/* Push Notifications */}
      <section className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-base font-semibold text-slate-100">
              <Bell className="h-4 w-4 text-emerald-400" aria-hidden />
              Push notifications
            </h3>
            <p className="mt-0.5 text-xs text-fg-subtle">
              Instant device alerts when queued research finishes, watchlist theses shift, or live trader signals post.
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
              subscribed
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                : permission === "denied"
                  ? "border-red-500/30 bg-red-500/10 text-red-400"
                  : "border-ink-600 bg-ink-800 text-slate-400"
            }`}
          >
            {subscribed ? "Enabled" : permission === "denied" ? "Blocked" : "Off"}
          </span>
        </div>

        {iosNeedsInstall ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-slate-200">
            On iPhone and iPad, Safari enables Web Push after you install Stock Studio to your Home Screen: tap{" "}
            <strong>Share</strong> and choose <strong>Add to Home Screen</strong>, then open the app icon.
          </div>
        ) : !pushSupported ? (
          <p className="rounded-lg border border-ink-700 bg-ink-800 p-3 text-xs text-fg-subtle">
            Web Push notifications aren&apos;t supported in this browser environment.
          </p>
        ) : config && !config.configured ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-slate-300">
            Push server keys are not configured on this deployment yet. Set{" "}
            <code className="font-mono text-amber-300">NEXT_PUBLIC_VAPID_PUBLIC_KEY</code> and{" "}
            <code className="font-mono text-amber-300">VAPID_PRIVATE_KEY</code> (generate with{" "}
            <code className="font-mono">npm run vapid-keys</code>).
          </p>
        ) : (
          <>
            <div className="space-y-2 rounded-lg border border-ink-700 bg-ink-800/60 p-3">
              {(
                [
                  {
                    key: "notifyStudies",
                    title: "Research reports",
                    desc: "When a queued case study, comparison, or earnings update is ready (or refunded).",
                  },
                  {
                    key: "notifyWatchlist",
                    title: "Watchlist thesis updates",
                    desc: "When a tracked ticker refreshes or its thesis becomes weakening or broken.",
                  },
                  {
                    key: "notifySignals",
                    title: "Live trade signals",
                    desc: config?.signalsEntitled
                      ? "Immediate push for live trader calls included in your membership plan."
                      : "Requires Silver, Gold, or Diamond (trial accounts don't include live signal alerts).",
                  },
                ] as const
              ).map(({ key, title, desc }) => (
                <label
                  key={key}
                  className="flex cursor-pointer items-start gap-3 rounded-md p-1.5 hover:bg-ink-800"
                >
                  <input
                    type="checkbox"
                    checked={prefs[key]}
                    disabled={busy !== null}
                    onChange={() => void togglePref(key)}
                    className="mt-0.5 h-4 w-4 accent-emerald-500"
                  />
                  <span className="min-w-0 flex-1 text-xs">
                    <span className="block font-medium text-slate-200">{title}</span>
                    <span className="block text-fg-subtle">{desc}</span>
                  </span>
                </label>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {subscribed ? (
                <>
                  <button
                    type="button"
                    disabled={busy !== null || isOffline}
                    onClick={() => void sendTest()}
                    className="btn-secondary px-3 py-2 text-xs"
                  >
                    <Send className="h-3.5 w-3.5" aria-hidden />
                    {busy === "test" ? "Sending…" : "Send test alert"}
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void unsubscribe()}
                    className="btn-secondary px-3 py-2 text-xs text-red-300 hover:text-red-200"
                  >
                    <BellOff className="h-3.5 w-3.5" aria-hidden />
                    {busy === "unsubscribe" ? "Turning off…" : "Disable on this device"}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={busy !== null || isOffline || permission === "denied"}
                  onClick={() => void subscribe()}
                  className="btn-primary px-4 py-2 text-xs"
                >
                  <Bell className="h-3.5 w-3.5" aria-hidden />
                  {busy === "subscribe" ? "Enabling…" : "Enable notifications on this device"}
                </button>
              )}
            </div>
          </>
        )}
      </section>

      {/* Offline-First Workspace & Outbox */}
      <section className="space-y-3 border-t border-ink-700 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-base font-semibold text-slate-100">
              <Database className="h-4 w-4 text-emerald-400" aria-hidden />
              Offline-first workspace
            </h3>
            <p className="mt-0.5 text-xs text-fg-subtle">
              Studies, watchlist theses, journal entries, and LEAPS scenarios are cached locally on this device and cleared automatically on sign-out.
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-ink-700 bg-ink-800/60 p-3 text-xs text-slate-300">
          {snapshot ? (
            <div className="space-y-1">
              <p className="font-medium text-slate-100">
                Last synced:{" "}
                {new Date(snapshot.syncedAt).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </p>
              <p className="text-fg-subtle">
                Saved locally: {snapshot.studies.length} studies · {snapshot.watchlist.length} watchlist{" "}
                {snapshot.watchlist.length === 1 ? "ticker" : "tickers"} · {snapshot.journal.length} journal{" "}
                {snapshot.journal.length === 1 ? "lot" : "lots"} · {snapshot.leapsPlans.length} LEAPS{" "}
                {snapshot.leapsPlans.length === 1 ? "plan" : "plans"}
              </p>
            </div>
          ) : (
            <p className="text-fg-subtle">No offline workspace snapshot saved yet on this device.</p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isOffline || busy !== null || syncing}
            onClick={() => void handleManualOfflineSync()}
            className="btn-secondary px-3 py-2 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${busy === "sync" || syncing ? "animate-spin" : ""}`} aria-hidden />
            {busy === "sync" || syncing ? "Syncing…" : "Sync offline copy now"}
          </button>
          <Link
            href="/offline"
            onClick={onClose}
            className="btn-secondary px-3 py-2 text-xs"
          >
            Open offline library
          </Link>
        </div>

        {outbox.length > 0 && (
          <div className="space-y-2 pt-1">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">
              Queued offline changes ({outbox.length})
            </h4>
            <div className="divide-y divide-ink-700 rounded-lg border border-ink-700 bg-ink-800/50">
              {outbox.map((item) => (
                <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-xs">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-slate-200">{item.label}</div>
                    {item.status === "failed" && item.error ? (
                      <div className="mt-0.5 text-red-400">{item.error}</div>
                    ) : (
                      <div className="mt-0.5 text-fg-subtle">Waiting for connection…</div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {item.status === "failed" && !isOffline && (
                      <button
                        type="button"
                        onClick={() => void retryOutboxItem(item.id)}
                        className="btn-secondary px-2.5 py-1 text-xs"
                      >
                        Retry
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={`Discard ${item.label}`}
                      onClick={() => void discardOutboxItem(item.id)}
                      className="icon-btn text-slate-400 hover:text-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Install App */}
      <section className="space-y-3 border-t border-ink-700 pt-5">
        <h3 className="flex items-center gap-2 text-base font-semibold text-slate-100">
          <Smartphone className="h-4 w-4 text-emerald-400" aria-hidden />
          Install Stock Studio app
        </h3>
        {isStandalone ? (
          <p className="flex items-center gap-2 text-xs text-emerald-400">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
            Running as an installed standalone app.
          </p>
        ) : canInstall ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink-700 bg-ink-800/60 p-3">
            <p className="text-xs text-slate-300">
              Install Stock Studio on your home screen or dock for full-screen launch and offline access.
            </p>
            <button
              type="button"
              onClick={() => void promptInstall()}
              className="btn-primary px-3.5 py-2 text-xs"
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              Install app
            </button>
          </div>
        ) : isIOS ? (
          <p className="text-xs text-fg-subtle">
            In Safari on iOS, tap <strong>Share</strong> and select <strong>Add to Home Screen</strong> to install Stock Studio.
          </p>
        ) : (
          <p className="text-xs text-fg-subtle">
            Use your browser&apos;s address bar install icon or menu (<strong>Install Stock Studio</strong> / <strong>Add to Home Screen</strong>) to pin the app.
          </p>
        )}
      </section>

      {(error || notice) && (
        <div
          role={error ? "alert" : "status"}
          className={`rounded-lg border p-3 text-xs ${
            error
              ? "border-red-500/30 bg-red-500/10 text-red-300"
              : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
          }`}
        >
          {error || notice}
        </div>
      )}
    </div>
  );
}

export default function PwaSettingsModal() {
  const { settingsOpen, setSettingsOpen } = usePwa();

  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSettingsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsOpen, setSettingsOpen]);

  if (!settingsOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 p-4"
      onClick={() => setSettingsOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pwa-modal-title"
        className="card max-h-[90vh] w-full max-w-xl overflow-y-auto p-5 sm:p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between border-b border-ink-700 pb-3">
          <h2 id="pwa-modal-title" className="text-lg font-bold text-slate-100">
            Notifications &amp; Offline App
          </h2>
          <button
            type="button"
            aria-label="Close settings"
            onClick={() => setSettingsOpen(false)}
            className="icon-btn"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <PushAndOfflinePanel onClose={() => setSettingsOpen(false)} />
      </div>
    </div>
  );
}
