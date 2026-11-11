// Offline-first local storage (IndexedDB, with an in-memory fallback for Node tests)
// for workspace snapshots and the FIFO offline mutation outbox.

import type { JournalTrade } from "@/lib/journal";

export type OfflineStudy = {
  id: number;
  ticker: string;
  company: string | null;
  variant: string;
  status: string;
  asOfDate: string | null;
  summaryLine: string | null;
  gradeLetter: string | null;
  renderedHtml: string | null;
  correctionsHtml: string | null;
  sources: { title: string; url: string }[];
  createdAt: string;
  updatedAt: string;
};

export type OfflineWatchlistEntry = {
  id: number;
  ticker: string;
  company: string | null;
  statusTag: string;
  thesis: string | null;
  thesisStatus: string;
  thesisStatusNote: string | null;
  triggers: string[];
  snapshot: string | null;
  asOfDate: string | null;
  updatedAt: string;
};

export type OfflineLeapsPlan = {
  id: string;
  name: string;
  ticker: string;
  inputs: Record<string, unknown>;
  updatedAt: string;
};

export type OfflineSignal = {
  id: number;
  postedAt: string;
  action: string;
  ticker: string;
  instrument: string | null;
  entry: string | null;
  target: string | null;
  stop: string | null;
  detail: string;
  pick: boolean;
};

export type OfflineSnapshot = {
  userId: string;
  workspaceId: string;
  syncedAt: string;
  studies: OfflineStudy[];
  watchlist: OfflineWatchlistEntry[];
  journal: JournalTrade[];
  leapsPlans: OfflineLeapsPlan[];
  signals: OfflineSignal[];
};

export type OutboxKind =
  | "journal_create"
  | "journal_update"
  | "journal_archive"
  | "watchlist_add"
  | "watchlist_tag"
  | "study_queue"
  | "leaps_save";

export type OutboxItem = {
  id: string;
  createdAt: number;
  kind: OutboxKind;
  label: string;
  endpoint: string;
  method: "POST" | "PATCH" | "DELETE";
  body: unknown;
  status: "pending" | "failed";
  attempts: number;
  error: string | null;
};

export const PWA_STATE_EVENT = "ss:pwa-state";
export const OUTBOX_SYNCED_EVENT = "ss:outbox-synced";

const IDB_NAME = "stock-studio-pwa";
const IDB_VERSION = 1;
const SNAPSHOTS_STORE = "snapshots";
const OUTBOX_STORE = "outbox";
const MAX_OUTBOX_ITEMS = 100;

// In-memory store when IndexedDB is unavailable (SSR, Node tests, private browsing edge cases).
const memorySnapshots = new Map<string, OfflineSnapshot>();
const memoryOutbox = new Map<string, OutboxItem>();

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function emitEvent(name: string, detail?: unknown) {
  if (typeof window !== "undefined" && typeof CustomEvent !== "undefined") {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SNAPSHOTS_STORE)) {
        db.createObjectStore(SNAPSHOTS_STORE, { keyPath: "workspaceId" });
      }
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        const store = db.createObjectStore(OUTBOX_STORE, { keyPath: "id" });
        store.createIndex("by_created", "createdAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveOfflineSnapshot(snapshot: OfflineSnapshot): Promise<void> {
  if (!hasIndexedDb()) {
    for (const [key, existing] of memorySnapshots.entries()) {
      if (existing.userId !== snapshot.userId) memorySnapshots.delete(key);
    }
    memorySnapshots.set(snapshot.workspaceId, snapshot);
    emitEvent(PWA_STATE_EVENT);
    return;
  }

  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SNAPSHOTS_STORE, "readwrite");
      const store = tx.objectStore(SNAPSHOTS_STORE);
      const getAllReq = store.getAll();
      getAllReq.onsuccess = () => {
        const all = (getAllReq.result ?? []) as OfflineSnapshot[];
        for (const existing of all) {
          if (existing.userId !== snapshot.userId) {
            store.delete(existing.workspaceId);
          }
        }
        store.put(snapshot);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
  emitEvent(PWA_STATE_EVENT);
}

export async function loadLatestOfflineSnapshot(): Promise<OfflineSnapshot | null> {
  if (!hasIndexedDb()) {
    const all = [...memorySnapshots.values()].sort((a, b) =>
      b.syncedAt.localeCompare(a.syncedAt),
    );
    return all[0] ?? null;
  }

  const db = await openDb();
  try {
    const all = await new Promise<OfflineSnapshot[]>((resolve, reject) => {
      const tx = db.transaction(SNAPSHOTS_STORE, "readonly");
      const req = tx.objectStore(SNAPSHOTS_STORE).getAll();
      req.onsuccess = () => resolve((req.result ?? []) as OfflineSnapshot[]);
      req.onerror = () => reject(req.error);
    });
    all.sort((a, b) => b.syncedAt.localeCompare(a.syncedAt));
    return all[0] ?? null;
  } finally {
    db.close();
  }
}

export async function listOutboxItems(): Promise<OutboxItem[]> {
  if (!hasIndexedDb()) {
    return [...memoryOutbox.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  const db = await openDb();
  try {
    const items = await new Promise<OutboxItem[]>((resolve, reject) => {
      const tx = db.transaction(OUTBOX_STORE, "readonly");
      const req = tx.objectStore(OUTBOX_STORE).getAll();
      req.onsuccess = () => resolve((req.result ?? []) as OutboxItem[]);
      req.onerror = () => reject(req.error);
    });
    return items.sort((a, b) => a.createdAt - b.createdAt);
  } finally {
    db.close();
  }
}

async function putOutboxItem(item: OutboxItem): Promise<void> {
  if (!hasIndexedDb()) {
    memoryOutbox.set(item.id, item);
    return;
  }
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(OUTBOX_STORE, "readwrite");
      tx.objectStore(OUTBOX_STORE).put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function removeOutboxItem(id: string): Promise<void> {
  if (!hasIndexedDb()) {
    memoryOutbox.delete(id);
    emitEvent(PWA_STATE_EVENT);
    return;
  }
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(OUTBOX_STORE, "readwrite");
      tx.objectStore(OUTBOX_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
  emitEvent(PWA_STATE_EVENT);
}

export async function retryFailedOutboxItem(
  id: string,
  fetchImpl?: typeof fetch,
): Promise<void> {
  const items = await listOutboxItems();
  const target = items.find((i) => i.id === id);
  if (!target) return;
  await putOutboxItem({ ...target, status: "pending", error: null });
  emitEvent(PWA_STATE_EVENT);
  await flushOutbox(fetchImpl);
}

async function requestBackgroundSync() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const syncReg = reg as ServiceWorkerRegistration & {
      sync?: { register(tag: string): Promise<void> };
    };
    await syncReg.sync?.register("ss-outbox-sync");
  } catch {
    // Background Sync is progressive enhancement; online event listener also flushes.
  }
}

let monotonicCounter = 0;

export async function enqueueOutboxItem(input: {
  kind: OutboxKind;
  label: string;
  endpoint: string;
  method: "POST" | "PATCH" | "DELETE";
  body: unknown;
}): Promise<OutboxItem> {
  if (!input.endpoint.startsWith("/api/")) {
    throw new Error("Offline outbox only accepts internal /api/ endpoints.");
  }
  const existing = await listOutboxItems();
  if (existing.length >= MAX_OUTBOX_ITEMS) {
    throw new Error(
      `Offline queue is full (${MAX_OUTBOX_ITEMS} items). Reconnect to sync pending changes first.`,
    );
  }

  // Strictly monotonic timestamp preserves FIFO order even within the same millisecond.
  const now = Date.now() * 1000 + (++monotonicCounter % 1000);
  const item: OutboxItem = {
    id: crypto.randomUUID(),
    createdAt: now,
    kind: input.kind,
    label: input.label.slice(0, 140),
    endpoint: input.endpoint,
    method: input.method,
    body: input.body,
    status: "pending",
    attempts: 0,
    error: null,
  };

  await putOutboxItem(item);
  emitEvent(PWA_STATE_EVENT);
  void requestBackgroundSync();
  return item;
}

let activeFlush: Promise<{ synced: number; failed: number; remaining: number }> | null = null;

export function flushOutbox(
  fetchImpl: typeof fetch = fetch,
): Promise<{ synced: number; failed: number; remaining: number }> {
  if (activeFlush) return activeFlush;
  activeFlush = (async () => {
    let synced = 0;
    let failed = 0;
    const items = await listOutboxItems();
    const pending = items.filter((item) => item.status === "pending");

    for (const item of pending) {
      try {
        const res = await fetchImpl(item.endpoint, {
          method: item.method,
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item.body),
        });

        if (res.ok) {
          await removeOutboxItem(item.id);
          synced++;
          continue;
        }

        if (res.status === 401) {
          await putOutboxItem({
            ...item,
            status: "failed",
            attempts: item.attempts + 1,
            error: "Session expired — sign in again to sync this change.",
          });
          failed++;
          break;
        }

        // Permanent validation/plan/conflict failure: surface to user without blocking later items.
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
            errors?: string[];
          };
          const msg =
            data.errors?.join("; ") ||
            data.error ||
            `Rejected by server (HTTP ${res.status}).`;
          await putOutboxItem({
            ...item,
            status: "failed",
            attempts: item.attempts + 1,
            error: msg.slice(0, 300),
          });
          failed++;
          continue;
        }

        // Transient server/rate-limit error: stop and retry later in order.
        break;
      } catch {
        // Network still unreachable: keep pending in FIFO order.
        break;
      }
    }

    const after = await listOutboxItems();
    const remaining = after.filter((i) => i.status === "pending").length;
    emitEvent(PWA_STATE_EVENT);
    if (synced > 0) {
      emitEvent(OUTBOX_SYNCED_EVENT, { synced });
    }
    return { synced, failed, remaining };
  })().finally(() => {
    activeFlush = null;
  });

  return activeFlush;
}

// Called on sign-out so a shared browser never retains private studies, journal lots, or push hooks.
export async function clearAllOfflineData(): Promise<void> {
  if (!hasIndexedDb()) {
    memorySnapshots.clear();
    memoryOutbox.clear();
  } else {
    const db = await openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([SNAPSHOTS_STORE, OUTBOX_STORE], "readwrite");
        tx.objectStore(SNAPSHOTS_STORE).clear();
        tx.objectStore(OUTBOX_STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }

  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager?.getSubscription();
      if (sub) {
        await fetch("/api/push", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {});
        await sub.unsubscribe().catch(() => {});
      }
      reg?.active?.postMessage({ type: "CLEAR_PRIVATE_CACHE" });
    } catch {
      // Best effort cleanup
    }
  }
  emitEvent(PWA_STATE_EVENT);
}

// Performs an API mutation online, or transparently queues it into the local
// IndexedDB outbox when the device is offline / loses connectivity mid-flight.
export async function offlineMutate(options: {
  kind: OutboxKind;
  label: string;
  endpoint: string;
  method?: "POST" | "PATCH" | "DELETE";
  body: unknown;
  fetchImpl?: typeof fetch;
}): Promise<
  | { mode: "online"; response: Response }
  | { mode: "queued"; item: OutboxItem }
> {
  const method = options.method ?? "POST";
  const fetchFn = options.fetchImpl ?? fetch;
  const browserOffline =
    typeof navigator !== "undefined" && navigator.onLine === false;

  if (browserOffline) {
    const item = await enqueueOutboxItem({
      kind: options.kind,
      label: options.label,
      endpoint: options.endpoint,
      method,
      body: options.body,
    });
    return { mode: "queued", item };
  }

  try {
    const response = await fetchFn(options.endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options.body),
    });
    return { mode: "online", response };
  } catch (err) {
    // Fetch network failure (TypeError) queues offline instead of losing the user's input.
    if (err instanceof TypeError || (typeof navigator !== "undefined" && !navigator.onLine)) {
      const item = await enqueueOutboxItem({
        kind: options.kind,
        label: options.label,
        endpoint: options.endpoint,
        method,
        body: options.body,
      });
      return { mode: "queued", item };
    }
    throw err;
  }
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
