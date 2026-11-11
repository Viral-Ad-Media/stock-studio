import assert from "node:assert/strict";
import { test } from "node:test";
import manifest from "../app/manifest";
import {
  clearAllOfflineData,
  enqueueOutboxItem,
  flushOutbox,
  listOutboxItems,
  loadLatestOfflineSnapshot,
  offlineMutate,
  removeOutboxItem,
  retryFailedOutboxItem,
  saveOfflineSnapshot,
  urlBase64ToUint8Array,
  type OfflineSnapshot,
} from "../lib/offline/store";

test("Web App Manifest defines standalone installability, icons, and shortcuts", () => {
  const m = manifest();
  assert.equal(m.display, "standalone");
  assert.equal(m.start_url, "/dashboard");
  assert.equal(m.scope, "/");
  assert.ok(Array.isArray(m.icons) && m.icons.length >= 3);
  assert.ok(m.icons.some((i) => i.sizes === "192x192" && i.type === "image/png"));
  assert.ok(m.icons.some((i) => i.sizes === "512x512" && i.purpose === "maskable"));
  assert.ok(Array.isArray(m.shortcuts) && m.shortcuts.length >= 3);
});

test("snapshot store isolates accounts and clears cleanly on sign-out", async () => {
  await clearAllOfflineData();

  const snapUserA: OfflineSnapshot = {
    userId: "user-a",
    workspaceId: "ws-a",
    syncedAt: "2026-11-11T00:00:00.000Z",
    studies: [
      {
        id: 10,
        ticker: "AAPL",
        company: "Apple Inc.",
        variant: "full",
        status: "ready",
        asOfDate: "November 10, 2026",
        summaryLine: "Services mix lifting margins.",
        gradeLetter: "B+",
        renderedHtml: "<p>As of November 10, 2026</p>",
        correctionsHtml: null,
        sources: [{ title: "Apple 10-K", url: "https://investor.apple.com" }],
        createdAt: "2026-11-10T12:00:00.000Z",
        updatedAt: "2026-11-10T12:05:00.000Z",
      },
    ],
    watchlist: [],
    journal: [],
    leapsPlans: [],
    signals: [],
  };

  await saveOfflineSnapshot(snapUserA);
  const loadedA = await loadLatestOfflineSnapshot();
  assert.equal(loadedA?.workspaceId, "ws-a");
  assert.equal(loadedA?.studies[0]?.ticker, "AAPL");

  // Saving a snapshot for a different user purges the previous user's cached workspace.
  const snapUserB: OfflineSnapshot = {
    ...snapUserA,
    userId: "user-b",
    workspaceId: "ws-b",
    syncedAt: "2026-11-11T01:00:00.000Z",
    studies: [],
  };
  await saveOfflineSnapshot(snapUserB);
  const loadedB = await loadLatestOfflineSnapshot();
  assert.equal(loadedB?.userId, "user-b");
  assert.equal(loadedB?.workspaceId, "ws-b");
  assert.equal(loadedB?.studies.length, 0);

  await clearAllOfflineData();
  assert.equal(await loadLatestOfflineSnapshot(), null);
});

test("offlineMutate queues on network failure and flushOutbox replays in strict FIFO order", async () => {
  await clearAllOfflineData();

  await assert.rejects(
    enqueueOutboxItem({
      kind: "watchlist_add",
      label: "Invalid external URL",
      endpoint: "https://evil.example.com/api",
      method: "POST",
      body: {},
    }),
    /internal \/api\/ endpoints/,
  );

  // Online call passes straight through without touching the outbox.
  const onlineRes = await offlineMutate({
    kind: "watchlist_add",
    label: "Track MSFT",
    endpoint: "/api/watchlist",
    body: { ticker: "MSFT" },
    fetchImpl: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
  });
  assert.equal(onlineRes.mode, "online");
  assert.equal((await listOutboxItems()).length, 0);

  // Mid-flight network failure (TypeError) transparently queues into the outbox.
  const q1 = await offlineMutate({
    kind: "watchlist_add",
    label: "Track NVDA",
    endpoint: "/api/watchlist",
    body: { ticker: "NVDA" },
    fetchImpl: async () => {
      throw new TypeError("Failed to fetch");
    },
  });
  assert.equal(q1.mode, "queued");

  const q2 = await enqueueOutboxItem({
    kind: "journal_create",
    label: "Bad journal entry",
    endpoint: "/api/journal",
    method: "POST",
    body: { symbol: "BAD" },
  });
  const q3 = await enqueueOutboxItem({
    kind: "leaps_save",
    label: "Save AAPL Jan 2028 scenario",
    endpoint: "/api/leaps/plans",
    method: "POST",
    body: { name: "AAPL base", ticker: "AAPL", inputs: {} },
  });

  const calls: string[] = [];
  const flushResult = await flushOutbox(async (input) => {
    const url = String(input);
    calls.push(url);
    if (url === "/api/watchlist") {
      return new Response(JSON.stringify({ id: 1 }), { status: 200 });
    }
    if (url === "/api/journal") {
      return new Response(JSON.stringify({ error: "Entry price must be positive." }), {
        status: 400,
      });
    }
    return new Response(JSON.stringify({ plan: { id: "p1" } }), { status: 201 });
  });

  // FIFO order preserved; 400 marks item failed with server reason without blocking item #3.
  assert.deepEqual(calls, ["/api/watchlist", "/api/journal", "/api/leaps/plans"]);
  assert.deepEqual(flushResult, { synced: 2, failed: 1, remaining: 0 });

  const remaining = await listOutboxItems();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, q2.id);
  assert.equal(remaining[0].status, "failed");
  assert.match(remaining[0].error ?? "", /Entry price must be positive/);
  assert.notEqual(remaining[0].id, q3.id);

  // Retrying the failed item after server/data fix flushes and removes it.
  await retryFailedOutboxItem(q2.id, async () => {
    return new Response(JSON.stringify({ trade: { id: "t1" } }), { status: 201 });
  });
  assert.equal((await listOutboxItems()).length, 0);
});

test("flushOutbox halts in-order on transient 5xx errors so dependent mutations never reorder", async () => {
  await clearAllOfflineData();

  const first = await enqueueOutboxItem({
    kind: "journal_create",
    label: "Log AMZN trade",
    endpoint: "/api/journal",
    method: "POST",
    body: { symbol: "AMZN" },
  });
  await enqueueOutboxItem({
    kind: "journal_archive",
    label: "Archive AMZN trade",
    endpoint: "/api/journal/123",
    method: "DELETE",
    body: { revision: 1 },
  });

  const attempted: string[] = [];
  const res = await flushOutbox(async (input) => {
    attempted.push(String(input));
    return new Response("Gateway Timeout", { status: 504 });
  });

  assert.deepEqual(attempted, ["/api/journal"]);
  assert.deepEqual(res, { synced: 0, failed: 0, remaining: 2 });

  await removeOutboxItem(first.id);
  assert.equal((await listOutboxItems()).length, 1);
  await clearAllOfflineData();

  const decoded = urlBase64ToUint8Array("BAc_");
  assert.equal(decoded.byteLength, 3);
});
