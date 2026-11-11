/* Stock Studio Offline-First Service Worker + Web Push Handler */
/// <reference lib="webworker" />

const CACHE_VERSION = "v1";
const SHELL_CACHE = `ss-shell-${CACHE_VERSION}`;
const STATIC_CACHE = `ss-static-${CACHE_VERSION}`;
const ASSETS_CACHE = `ss-assets-${CACHE_VERSION}`;
const PAGES_CACHE = `ss-pages-${CACHE_VERSION}`;
const DATA_CACHE = `ss-data-${CACHE_VERSION}`;

const ALL_CACHES = [SHELL_CACHE, STATIC_CACHE, ASSETS_CACHE, PAGES_CACHE, DATA_CACHE];
const PRIVATE_CACHES = [PAGES_CACHE, DATA_CACHE];

const PRECACHE_URLS = [
  "/offline",
  "/manifest.webmanifest",
  "/icon.svg",
  "/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/badge-72.png",
];

// Auth, billing, and admin endpoints must never be served from SW cache.
const NEVER_CACHE_PREFIXES = [
  "/auth",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/admin",
  "/api/admin",
  "/api/billing",
  "/api/push",
  "/api/engine",
];

const CACHEABLE_DATA_PATHS = new Set([
  "/api/offline/snapshot",
  "/api/journal",
  "/api/leaps",
]);

const IDB_NAME = "stock-studio-pwa";
const IDB_VERSION = 1;
const OUTBOX_STORE = "outbox";

function isNeverCachedPath(pathname) {
  return NEVER_CACHE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function htmlCacheKey(url) {
  const clean = new URL(url.toString());
  clean.searchParams.delete("_rsc");
  return `${clean.origin}/__sw_html__${clean.pathname}${clean.search}`;
}

async function trimCache(cacheName, maxEntries) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length <= maxEntries) return;
    const extra = keys.length - maxEntries;
    for (let i = 0; i < extra; i++) {
      await cache.delete(keys[i]);
    }
  } catch {
    // Best effort cache eviction
  }
}

function fetchWithTimeout(request, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(request, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await Promise.allSettled(
        PRECACHE_URLS.map(async (url) => {
          const res = await fetch(url, { cache: "reload" });
          if (res.ok) {
            await cache.put(url, res.clone());
            if (url === "/offline") {
              await cache.put(htmlCacheKey(new URL(url, self.location.origin)), res);
            }
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const existing = await caches.keys();
      await Promise.all(
        existing
          .filter((name) => name.startsWith("ss-") && !ALL_CACHES.includes(name))
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === "/sw.js") return;

  // 1. Immutable hashed Next.js static chunks & fonts: Cache-First
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) {
          event.waitUntil(cache.put(request, response.clone()));
        }
        return response;
      })(),
    );
    return;
  }

  // 2. Icons, manifest, and static images: Stale-While-Revalidate
  if (
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/icon.svg" ||
    url.pathname === "/apple-touch-icon.png" ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/screenshots/")
  ) {
    event.respondWith(
      (async () => {
        const shellHit = await caches.match(request);
        const cache = await caches.open(ASSETS_CACHE);
        const assetHit = shellHit || (await cache.match(request));
        const networkPromise = fetch(request)
          .then((res) => {
            if (res.ok) {
              cache.put(request, res.clone());
              trimCache(ASSETS_CACHE, 60);
            }
            return res;
          })
          .catch(() => null);
        return assetHit || (await networkPromise) || Response.error();
      })(),
    );
    return;
  }

  // 3. Read-only workspace JSON endpoints: Network-First -> Cached JSON
  if (CACHEABLE_DATA_PATHS.has(url.pathname) && url.searchParams.get("format") !== "csv") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(DATA_CACHE);
        try {
          const response = await fetchWithTimeout(request, 6000);
          if (response.ok) {
            event.waitUntil(
              cache.put(request, response.clone()).then(() => trimCache(DATA_CACHE, 40)),
            );
          }
          return response;
        } catch {
          const cached = await cache.match(request);
          if (cached) {
            const headers = new Headers(cached.headers);
            headers.set("x-sw-offline", "1");
            return new Response(cached.body, {
              status: cached.status,
              statusText: cached.statusText,
              headers,
            });
          }
          return new Response(JSON.stringify({ error: "offline", offline: true }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          });
        }
      })(),
    );
    return;
  }

  // 4. Full HTML navigations: Network-First -> Cached HTML Page -> /offline shell.
  // Note: Next.js App Router RSC soft-navigations are intentionally NOT intercepted
  // here; when offline, a failed RSC fetch automatically falls back to a full HTML
  // navigation, which cleanly renders the cached document without Flight tree mismatches.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const key = htmlCacheKey(url);
        const cacheable = !isNeverCachedPath(url.pathname);
        try {
          const response = await fetchWithTimeout(request, 5000);
          const contentType = response.headers.get("content-type") || "";
          if (
            cacheable &&
            response.ok &&
            !response.redirected &&
            contentType.includes("text/html")
          ) {
            const pageCache = await caches.open(PAGES_CACHE);
            event.waitUntil(
              pageCache.put(key, response.clone()).then(() => trimCache(PAGES_CACHE, 80)),
            );
          }
          return response;
        } catch {
          if (cacheable) {
            const pageCache = await caches.open(PAGES_CACHE);
            const cachedPage = await pageCache.match(key);
            if (cachedPage) return cachedPage;
          }
          const shellCache = await caches.open(SHELL_CACHE);
          const offlineFallback =
            (await shellCache.match("/offline")) ||
            (await shellCache.match(htmlCacheKey(new URL("/offline", self.location.origin))));
          if (offlineFallback) return offlineFallback;
          return new Response(
            "<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Offline · Stock Studio</title><style>body{background:#08111d;color:#e2e8f0;font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center}</style></head><body><div><h1>You're offline</h1><p>Reconnect to load fresh Stock Studio data.</p></div></body></html>",
            { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
          );
        }
      })(),
    );
  }
});

// Messages from the client app: purge private caches on sign-out or warm key routes.
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (data.type === "CLEAR_PRIVATE_CACHE") {
    event.waitUntil(
      Promise.all(PRIVATE_CACHES.map((name) => caches.delete(name))).then(() => {
        event.ports?.[0]?.postMessage({ ok: true });
      }),
    );
    return;
  }
  if (data.type === "WARM_ROUTES" && Array.isArray(data.routes)) {
    event.waitUntil(
      (async () => {
        const pageCache = await caches.open(PAGES_CACHE);
        for (const path of data.routes.slice(0, 12)) {
          if (typeof path !== "string" || !path.startsWith("/") || isNeverCachedPath(path)) {
            continue;
          }
          const targetUrl = new URL(path, self.location.origin);
          const key = htmlCacheKey(targetUrl);
          const existing = await pageCache.match(key);
          if (existing) continue;
          try {
            const res = await fetch(targetUrl.toString(), {
              credentials: "same-origin",
              headers: { Accept: "text/html" },
            });
            const ct = res.headers.get("content-type") || "";
            if (res.ok && !res.redirected && ct.includes("text/html")) {
              await pageCache.put(key, res);
            }
          } catch {
            break;
          }
        }
        await trimCache(PAGES_CACHE, 80);
      })(),
    );
  }
});

// Background Sync: wake open tabs first, or replay queued IndexedDB mutations directly.
function openPwaDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("snapshots")) {
        db.createObjectStore("snapshots", { keyPath: "workspaceId" });
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

async function replayOutboxFromWorker() {
  let db;
  try {
    db = await openPwaDb();
    const items = await new Promise((resolve, reject) => {
      const tx = db.transaction(OUTBOX_STORE, "readonly");
      const req = tx.objectStore(OUTBOX_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });

    const pending = items
      .filter((item) => item && item.status === "pending")
      .sort((a, b) => a.createdAt - b.createdAt);

    for (const item of pending) {
      if (typeof item.endpoint !== "string" || !item.endpoint.startsWith("/api/")) continue;
      const res = await fetch(item.endpoint, {
        method: item.method || "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.body),
      });

      if (res.ok) {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(OUTBOX_STORE, "readwrite");
          tx.objectStore(OUTBOX_STORE).delete(item.id);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } else if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
        const payload = await res.json().catch(() => ({}));
        const errMsg = payload?.error || `Sync rejected (${res.status})`;
        await new Promise((resolve, reject) => {
          const tx = db.transaction(OUTBOX_STORE, "readwrite");
          tx.objectStore(OUTBOX_STORE).put({
            ...item,
            status: "failed",
            error: String(errMsg).slice(0, 300),
            attempts: (item.attempts || 0) + 1,
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } else {
        throw new Error(`Transient HTTP ${res.status}`);
      }
    }
  } finally {
    if (db) db.close();
  }
}

self.addEventListener("sync", (event) => {
  if (event.tag !== "ss-outbox-sync") return;
  event.waitUntil(
    (async () => {
      const windowClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: false,
      });
      if (windowClients.length > 0) {
        for (const client of windowClients) {
          client.postMessage({ type: "FLUSH_OUTBOX" });
        }
        return;
      }
      await replayOutboxFromWorker();
    })(),
  );
});

// Web Push Notifications
self.addEventListener("push", (event) => {
  let payload = {
    title: "Stock Studio",
    body: "You have a new update in Stock Studio.",
    url: "/today",
    tag: "stock-studio",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-72.png",
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      if (parsed && typeof parsed === "object") {
        payload = {
          ...payload,
          title: typeof parsed.title === "string" ? parsed.title : payload.title,
          body: typeof parsed.body === "string" ? parsed.body : payload.body,
          url:
            typeof parsed.url === "string" && parsed.url.startsWith("/")
              ? parsed.url
              : payload.url,
          tag: typeof parsed.tag === "string" ? parsed.tag : payload.tag,
          icon: typeof parsed.icon === "string" ? parsed.icon : payload.icon,
          badge: typeof parsed.badge === "string" ? parsed.badge : payload.badge,
          timestamp:
            typeof parsed.timestamp === "number" ? parsed.timestamp : Date.now(),
        };
      }
    } catch {
      const text = event.data.text();
      if (text) payload.body = text.slice(0, 240);
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: payload.icon,
      badge: payload.badge,
      tag: payload.tag,
      timestamp: payload.timestamp || Date.now(),
      data: { url: payload.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const rawUrl = event.notification?.data?.url;
  const safePath = typeof rawUrl === "string" && rawUrl.startsWith("/") ? rawUrl : "/today";
  const targetUrl = new URL(safePath, self.location.origin).toString();

  event.waitUntil(
    (async () => {
      const windowClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of windowClients) {
        if (new URL(client.url).origin === self.location.origin) {
          if ("navigate" in client) {
            await client.navigate(targetUrl).catch(() => {});
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })(),
  );
});
