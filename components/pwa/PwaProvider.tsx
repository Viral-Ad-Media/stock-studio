"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  flushOutbox,
  listOutboxItems,
  loadLatestOfflineSnapshot,
  OUTBOX_SYNCED_EVENT,
  PWA_STATE_EVENT,
  removeOutboxItem,
  retryFailedOutboxItem,
  saveOfflineSnapshot,
  type OfflineSnapshot,
  type OutboxItem,
} from "@/lib/offline/store";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

type PwaContextValue = {
  isOffline: boolean;
  swReady: boolean;
  isStandalone: boolean;
  isIOS: boolean;
  canInstall: boolean;
  promptInstall: () => Promise<boolean>;
  outbox: OutboxItem[];
  pendingCount: number;
  failedCount: number;
  syncing: boolean;
  snapshot: OfflineSnapshot | null;
  syncNow: () => Promise<void>;
  refreshSnapshot: () => Promise<boolean>;
  discardOutboxItem: (id: string) => Promise<void>;
  retryOutboxItem: (id: string) => Promise<void>;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
};

const PwaContext = createContext<PwaContextValue | null>(null);

const CORE_WARM_ROUTES = [
  "/offline",
  "/dashboard",
  "/today",
  "/watchlist",
  "/journal",
  "/leaps",
  "/signals",
  "/new",
];

export function PwaProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [isOffline, setIsOffline] = useState(false);
  const [swReady, setSwReady] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [snapshot, setSnapshot] = useState<OfflineSnapshot | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const reloadLocalState = useCallback(async () => {
    const [items, snap] = await Promise.all([
      listOutboxItems().catch(() => []),
      loadLatestOfflineSnapshot().catch(() => null),
    ]);
    setOutbox(items);
    setSnapshot(snap);
  }, []);

  const refreshSnapshot = useCallback(async (): Promise<boolean> => {
    if (typeof navigator !== "undefined" && !navigator.onLine) return false;
    try {
      const res = await fetch("/api/offline/snapshot", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!res.ok) return false;
      if (res.headers.get("x-sw-offline") === "1") return false;
      const data = (await res.json()) as OfflineSnapshot;
      if (data && data.workspaceId && data.userId) {
        await saveOfflineSnapshot(data);
        setSnapshot(data);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  const syncNow = useCallback(async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    setSyncing(true);
    try {
      const result = await flushOutbox();
      await reloadLocalState();
      if (result.synced > 0) {
        await refreshSnapshot();
        router.refresh();
      }
    } finally {
      setSyncing(false);
    }
  }, [refreshSnapshot, reloadLocalState, router]);

  const discardOutboxItem = useCallback(
    async (id: string) => {
      await removeOutboxItem(id);
      await reloadLocalState();
    },
    [reloadLocalState],
  );

  const retryOutboxItem = useCallback(
    async (id: string) => {
      setSyncing(true);
      try {
        await retryFailedOutboxItem(id);
        await reloadLocalState();
      } finally {
        setSyncing(false);
      }
    },
    [reloadLocalState],
  );

  const promptInstall = useCallback(async (): Promise<boolean> => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setDeferredPrompt(null);
      return true;
    }
    return false;
  }, [deferredPrompt]);

  // Register Service Worker, detect platform/standalone mode, and wire online/offline listeners.
  useEffect(() => {
    setIsOffline(!navigator.onLine);
    const ios =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    setIsIOS(ios);

    const media = window.matchMedia("(display-mode: standalone)");
    const updateStandalone = () => {
      const navStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
      setIsStandalone(media.matches || navStandalone);
    };
    updateStandalone();
    media.addEventListener?.("change", updateStandalone);

    void reloadLocalState();

    let onControllerMessage: ((e: MessageEvent) => void) | null = null;
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then(() => setSwReady(true))
        .catch((err) => console.warn("pwa: service worker registration failed", err));

      onControllerMessage = (e: MessageEvent) => {
        if (e.data?.type === "FLUSH_OUTBOX") {
          void syncNow();
        }
      };
      navigator.serviceWorker.addEventListener("message", onControllerMessage);
    }

    const handleOnline = () => {
      setIsOffline(false);
      void syncNow();
    };
    const handleOffline = () => setIsOffline(true);
    const handlePwaState = () => void reloadLocalState();
    const handleOutboxSynced = () => {
      void reloadLocalState();
      router.refresh();
    };
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener(PWA_STATE_EVENT, handlePwaState);
    window.addEventListener(OUTBOX_SYNCED_EVENT, handleOutboxSynced);
    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      media.removeEventListener?.("change", updateStandalone);
      if (onControllerMessage && "serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("message", onControllerMessage);
      }
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener(PWA_STATE_EVENT, handlePwaState);
      window.removeEventListener(OUTBOX_SYNCED_EVENT, handleOutboxSynced);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, [reloadLocalState, router, syncNow]);

  const pendingCount = useMemo(
    () => outbox.filter((i) => i.status === "pending").length,
    [outbox],
  );
  const failedCount = useMemo(
    () => outbox.filter((i) => i.status === "failed").length,
    [outbox],
  );

  const value = useMemo<PwaContextValue>(
    () => ({
      isOffline,
      swReady,
      isStandalone,
      isIOS,
      canInstall: Boolean(deferredPrompt) && !isStandalone,
      promptInstall,
      outbox,
      pendingCount,
      failedCount,
      syncing,
      snapshot,
      syncNow,
      refreshSnapshot,
      discardOutboxItem,
      retryOutboxItem,
      settingsOpen,
      setSettingsOpen,
    }),
    [
      deferredPrompt,
      discardOutboxItem,
      failedCount,
      isIOS,
      isOffline,
      isStandalone,
      outbox,
      pendingCount,
      promptInstall,
      refreshSnapshot,
      retryOutboxItem,
      settingsOpen,
      snapshot,
      swReady,
      syncNow,
      syncing,
    ],
  );

  return <PwaContext.Provider value={value}>{children}</PwaContext.Provider>;
}

// Mounted inside authenticated app layout so signed-in sessions keep an up-to-date
// offline snapshot in IndexedDB and warm core app HTML shells in the Service Worker.
export function AuthenticatedOfflineSync({ enabled }: { enabled: boolean }) {
  const { refreshSnapshot, syncNow } = usePwa();
  const lastSyncRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    const runSync = async () => {
      if (!navigator.onLine) return;
      const now = Date.now();
      if (now - lastSyncRef.current < 120_000) return;
      lastSyncRef.current = now;
      await syncNow();
      const ok = await refreshSnapshot();
      if (ok && "serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.ready.catch(() => null);
        reg?.active?.postMessage({ type: "WARM_ROUTES", routes: CORE_WARM_ROUTES });
      }
    };

    const timer = window.setTimeout(() => void runSync(), 1200);
    const onVisible = () => {
      if (document.visibilityState === "visible") void runSync();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, refreshSnapshot, syncNow]);

  return null;
}

export function usePwa(): PwaContextValue {
  const ctx = useContext(PwaContext);
  if (!ctx) {
    return {
      isOffline: false,
      swReady: false,
      isStandalone: false,
      isIOS: false,
      canInstall: false,
      promptInstall: async () => false,
      outbox: [],
      pendingCount: 0,
      failedCount: 0,
      syncing: false,
      snapshot: null,
      syncNow: async () => {},
      refreshSnapshot: async () => false,
      discardOutboxItem: async () => {},
      retryOutboxItem: async () => {},
      settingsOpen: false,
      setSettingsOpen: () => {},
    };
  }
  return ctx;
}
