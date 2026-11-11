import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PushValidationError,
  createVapidAuthHeader,
  decryptPushPayload,
  encryptPushPayload,
  fromBase64Url,
  generateVapidKeys,
  sendWebPush,
  toBase64Url,
  validatePushEndpoint,
  validatePushSubscriptionInput,
} from "../lib/push";

async function makeBrowserSubscriber() {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const pubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  const authRaw = crypto.getRandomValues(new Uint8Array(16));
  return {
    privateKey: keyPair.privateKey,
    publicBytes: pubRaw,
    authBytes: authRaw,
    p256dh: toBase64Url(pubRaw),
    auth: toBase64Url(authRaw),
  };
}

test("VAPID key generation and ES256 JWT header signature verification", async () => {
  const keys = await generateVapidKeys();
  const rawPub = fromBase64Url(keys.publicKey);
  const rawPriv = fromBase64Url(keys.privateKey);
  assert.equal(rawPub.byteLength, 65);
  assert.equal(rawPub[0], 0x04);
  assert.equal(rawPriv.byteLength, 32);

  const nowMs = 1_760_000_000_000;
  const endpoint = "https://fcm.googleapis.com/fcm/send/device-token-123";
  const authHeader = await createVapidAuthHeader(
    endpoint,
    { subject: "mailto:ops@stockstudio.test", ...keys },
    nowMs,
  );

  const match = /^vapid t=([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+), k=([A-Za-z0-9_-]+)$/.exec(
    authHeader,
  );
  assert.ok(match, "Authorization header follows RFC 8292 vapid t=..., k=... format");
  assert.equal(match[2], keys.publicKey);

  const [hB64, pB64, sB64] = match[1].split(".");
  const headerJson = JSON.parse(Buffer.from(fromBase64Url(hB64)).toString("utf8"));
  const payloadJson = JSON.parse(Buffer.from(fromBase64Url(pB64)).toString("utf8"));
  assert.deepEqual(headerJson, { typ: "JWT", alg: "ES256" });
  assert.equal(payloadJson.aud, "https://fcm.googleapis.com");
  assert.equal(payloadJson.sub, "mailto:ops@stockstudio.test");
  assert.equal(payloadJson.exp, Math.floor(nowMs / 1000) + 12 * 3600);

  const verifyKey = await crypto.subtle.importKey(
    "raw",
    rawPub.buffer.slice(rawPub.byteOffset, rawPub.byteOffset + rawPub.byteLength) as ArrayBuffer,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const sigBytes = fromBase64Url(sB64);
  const signedInput = new TextEncoder().encode(`${hB64}.${pB64}`);
  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    verifyKey,
    sigBytes.buffer.slice(sigBytes.byteOffset, sigBytes.byteOffset + sigBytes.byteLength) as ArrayBuffer,
    signedInput,
  );
  assert.equal(valid, true, "VAPID JWT signature verifies with exported public key");

  await assert.rejects(
    createVapidAuthHeader(endpoint, { subject: "http://insecure.example.com", ...keys }),
    PushValidationError,
  );
});

test("RFC 8291 aes128gcm push payload encryption and decryption round-trip", async () => {
  const ua = await makeBrowserSubscriber();
  const message = JSON.stringify({
    title: "NVDA · Deep Memo ready (A-)",
    body: "Revenue +94% YoY — margin expansion intact · Not personalized advice.",
    url: "/study/42",
    category: "studies",
  });

  const encrypted = await encryptPushPayload(message, ua.p256dh, ua.auth);
  assert.ok(encrypted.byteLength > 86, "includes 86-byte RFC 8188 header + GCM tag");
  const rs = new DataView(encrypted.buffer, encrypted.byteOffset, encrypted.byteLength).getUint32(
    16,
    false,
  );
  assert.equal(rs, 4096);
  assert.equal(encrypted[20], 65);

  const decrypted = await decryptPushPayload(
    encrypted,
    ua.privateKey,
    ua.publicBytes,
    ua.authBytes,
  );
  assert.equal(decrypted, message);

  await assert.rejects(
    encryptPushPayload("x".repeat(4000), ua.p256dh, ua.auth),
    PushValidationError,
  );
});

test("endpoint SSRF allowlist and P-256 curve validation", async () => {
  const ua = await makeBrowserSubscriber();

  for (const good of [
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/abc",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
  ]) {
    assert.ok(validatePushEndpoint(good).startsWith("https://"));
    const sub = await validatePushSubscriptionInput({
      endpoint: good,
      keys: { p256dh: ua.p256dh, auth: ua.auth },
    });
    assert.equal(sub.keys.p256dh, ua.p256dh);
  }

  for (const bad of [
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://localhost/push",
    "https://127.0.0.1/push",
    "https://[::1]/push",
    "https://169.254.169.254/latest/meta-data",
    "https://user:secret@fcm.googleapis.com/fcm/send/abc",
    "https://fcm.googleapis.com:8443/fcm/send/abc",
    "https://attacker.example.com/webhook",
  ]) {
    assert.throws(() => validatePushEndpoint(bad), PushValidationError, `rejected ${bad}`);
  }

  // 65 bytes starting with 0x04, but (0, 0) is not on P-256.
  const bogusPoint = new Uint8Array(65);
  bogusPoint[0] = 0x04;
  await assert.rejects(
    validatePushSubscriptionInput({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      keys: { p256dh: toBase64Url(bogusPoint), auth: ua.auth },
    }),
    PushValidationError,
  );
});

test("sendWebPush handles 201 delivery, 410 expired subscription, and 503 transient failure", async () => {
  const vapid = { subject: "mailto:ops@stockstudio.test", ...(await generateVapidKeys()) };
  const ua = await makeBrowserSubscriber();
  const sub = {
    endpoint: "https://fcm.googleapis.com/fcm/send/sub-1",
    keys: { p256dh: ua.p256dh, auth: ua.auth },
  };

  let capturedInit: RequestInit | undefined;
  const okRes = await sendWebPush(
    sub,
    { title: "Signal: BUY AAPL", body: "Entry $225 · Not personalized advice.", url: "/signals" },
    vapid,
    {
      ttlSeconds: 3600,
      urgency: "high",
      topic: "sig-99",
      fetchImpl: async (_input, init) => {
        capturedInit = init;
        return new Response("", { status: 201 });
      },
    },
  );
  assert.deepEqual(okRes, { ok: true, status: 201 });
  const headers = capturedInit?.headers as Record<string, string>;
  assert.equal(headers["Content-Encoding"], "aes128gcm");
  assert.equal(headers.Urgency, "high");
  assert.equal(headers.Topic, "sig-99");
  const sentBytes = new Uint8Array(capturedInit?.body as ArrayBuffer);
  const decoded = JSON.parse(
    await decryptPushPayload(sentBytes, ua.privateKey, ua.publicBytes, ua.authBytes),
  );
  assert.equal(decoded.title, "Signal: BUY AAPL");
  assert.equal(decoded.icon, "/icons/icon-192.png");

  const goneRes = await sendWebPush(
    sub,
    { title: "Expired", body: "test" },
    vapid,
    { fetchImpl: async () => new Response("Gone", { status: 410 }) },
  );
  assert.equal(goneRes.ok, false);
  if (!goneRes.ok) assert.equal(goneRes.expired, true);

  const transientRes = await sendWebPush(
    sub,
    { title: "Retry", body: "test" },
    vapid,
    { fetchImpl: async () => new Response("Unavailable", { status: 503 }) },
  );
  assert.equal(transientRes.ok, false);
  if (!transientRes.ok) assert.equal(transientRes.expired, false);
});

test("database push migration: ACLs, signal queue trigger, workspace isolation, and plan-tier recipients", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE auth.users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),email text,raw_user_meta_data jsonb,raw_app_meta_data jsonb,created_at timestamptz DEFAULT now(),last_sign_in_at timestamptz);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT null::uuid $$;`);
    const migrations = (await readdir("supabase/migrations"))
      .filter((n) => n.endsWith(".sql") && !n.startsWith("._"))
      .sort();
    for (const name of migrations) {
      await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
    }

    // Verify strict role separation: anon, authenticated, and stocks_signals have no access to push tables or RPCs.
    for (const role of ["anon", "authenticated", "stocks_signals"]) {
      assert.equal(
        (
          await db.query<{ ok: boolean }>(
            "SELECT has_table_privilege($1, 'stocks.push_subscriptions', 'SELECT') AS ok",
            [role],
          )
        ).rows[0].ok,
        false,
        `${role} cannot read push_subscriptions`,
      );
      assert.equal(
        (
          await db.query<{ ok: boolean }>(
            "SELECT has_function_privilege($1, 'stocks.signal_push_recipients(boolean,boolean)', 'EXECUTE') AS ok",
            [role],
          )
        ).rows[0].ok,
        false,
        `${role} cannot execute signal_push_recipients`,
      );
    }
    assert.equal(
      (
        await db.query<{ ok: boolean }>(
          "SELECT has_table_privilege('stocks_app', 'stocks.push_subscriptions', 'INSERT') AS ok",
        )
      ).rows[0].ok,
      true,
    );

    // Create test accounts across all membership tiers + states.
    const users = {
      diamond: "00000000-0000-0000-0000-000000000101",
      gold: "00000000-0000-0000-0000-000000000102",
      silver: "00000000-0000-0000-0000-000000000103",
      founding: "00000000-0000-0000-0000-000000000104",
      admin: "00000000-0000-0000-0000-000000000105",
      trial: "00000000-0000-0000-0000-000000000106",
      canceled: "00000000-0000-0000-0000-000000000107",
      disabled: "00000000-0000-0000-0000-000000000108",
      muted: "00000000-0000-0000-0000-000000000109",
    };

    const workspaces: Record<string, string> = {};
    const dummyP256dh = "B" + "A".repeat(86);
    const dummyAuth = "C".repeat(22);

    for (const [label, uid] of Object.entries(users)) {
      await db.query("INSERT INTO auth.users(id, email) VALUES ($1, $2)", [
        uid,
        `${label}@push.test`,
      ]);
      const ws = (
        await db.query<{ ws: string }>(
          "SELECT active_workspace_id AS ws FROM stocks.profiles WHERE id = $1",
          [uid],
        )
      ).rows[0].ws;
      workspaces[label] = ws;
      await db.query(
        `INSERT INTO stocks.push_subscriptions
          (user_id, workspace_id, endpoint, p256dh, auth, notify_studies, notify_watchlist, notify_signals)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          uid,
          ws,
          `https://fcm.googleapis.com/fcm/send/${label}`,
          dummyP256dh,
          dummyAuth,
          label !== "muted",
          true,
          label !== "muted",
        ],
      );
    }

    const upsertPlan = (uid: string, ws: string, subId: string, plan: string, status: string) =>
      db.query(
        "SELECT stocks.upsert_subscription($1,$2,'cus_x',$3,$4,'month',$5,now()+interval '30 days',false)",
        [uid, ws, subId, plan, status],
      );

    await upsertPlan(users.diamond, workspaces.diamond, "sub_d", "diamond", "active");
    await upsertPlan(users.gold, workspaces.gold, "sub_g", "gold", "active");
    await upsertPlan(users.silver, workspaces.silver, "sub_s", "silver", "active");
    await upsertPlan(users.canceled, workspaces.canceled, "sub_c", "diamond", "canceled");
    await upsertPlan(users.disabled, workspaces.disabled, "sub_dis", "diamond", "active");
    await upsertPlan(users.muted, workspaces.muted, "sub_m", "diamond", "active");
    await db.query("UPDATE stocks.profiles SET access_granted = true WHERE id = $1", [
      users.founding,
    ]);
    await db.query("INSERT INTO stocks.platform_admins(user_id) VALUES ($1)", [users.admin]);
    await db.query("UPDATE stocks.profiles SET disabled_at = now() WHERE id = $1", [
      users.disabled,
    ]);

    const recipientsFor = async (gold: boolean, silver: boolean) =>
      (
        await db.query<{ endpoint: string }>(
          "SELECT endpoint FROM stocks.signal_push_recipients($1, $2) ORDER BY endpoint",
          [gold, silver],
        )
      ).rows.map((r) => r.endpoint.replace("https://fcm.googleapis.com/fcm/send/", ""));

    // Non-pick signal: only admin, diamond, and founding receive it (never trial, canceled, disabled, muted, gold, silver).
    assert.deepEqual(await recipientsFor(false, false), ["admin", "diamond", "founding"]);
    // Weekly pick (Gold): adds gold.
    assert.deepEqual(await recipientsFor(true, false), ["admin", "diamond", "founding", "gold"]);
    // Monthly + weekly pick (Gold + Silver): adds gold and silver.
    assert.deepEqual(await recipientsFor(true, true), [
      "admin",
      "diamond",
      "founding",
      "gold",
      "silver",
    ]);

    // Workspace isolation & category flags + disabled check.
    const wsRecipients = async (ws: string, category: string) =>
      (
        await db.query<{ user_id: string }>(
          "SELECT user_id FROM stocks.workspace_push_recipients($1, $2)",
          [ws, category],
        )
      ).rows.map((r) => r.user_id);

    assert.deepEqual(await wsRecipients(workspaces.gold, "studies"), [users.gold]);
    assert.deepEqual(await wsRecipients(workspaces.muted, "studies"), []);
    assert.deepEqual(await wsRecipients(workspaces.muted, "watchlist"), [users.muted]);
    assert.deepEqual(await wsRecipients(workspaces.disabled, "watchlist"), []);

    // Recording a signal automatically enqueues a push job and preserves hash chain integrity.
    await db.query(
      "SELECT stocks.record_signal($1::jsonb,'123456','tester','777001','111111','222222','333333')",
      [JSON.stringify({ action: "BUY", ticker: "MSFT", entry: 420, detail: "breakout" })],
    );
    assert.equal(
      (await db.query<{ broken_at: null }>("SELECT * FROM stocks.verify_signal_chain()")).rows[0]
        .broken_at,
      null,
    );

    const claimed = (await db.query<any>("SELECT * FROM stocks.claim_signal_push()")).rows[0];
    assert.ok(claimed, "trigger enqueued signal into signal_push_queue");
    assert.equal(claimed.ticker, "MSFT");
    assert.equal(claimed.gold, true);
    assert.equal(claimed.silver, true);
    assert.equal(claimed.attempts, 1);

    // Locked item isn't claimed twice concurrently.
    assert.equal((await db.query("SELECT * FROM stocks.claim_signal_push()")).rows.length, 0);

    // Retry backs off next_attempt_at; once elapsed, item is reclaimed and finished cleanly.
    await db.query("SELECT stocks.retry_signal_push($1, 'temporary 503')", [claimed.signal_id]);
    assert.equal((await db.query("SELECT * FROM stocks.claim_signal_push()")).rows.length, 0);
    await db.exec("UPDATE stocks.signal_push_queue SET next_attempt_at = now() - interval '1 minute'");
    const reclaimed = (await db.query<any>("SELECT * FROM stocks.claim_signal_push()")).rows[0];
    assert.equal(reclaimed.signal_id, claimed.signal_id);
    assert.equal(reclaimed.attempts, 2);

    await db.query("SELECT stocks.finish_signal_push($1, 5)", [reclaimed.signal_id]);
    assert.equal((await db.query("SELECT * FROM stocks.claim_signal_push()")).rows.length, 0);
    const finalRow = (
      await db.query<{ sent_count: number; dispatched_at: string | null }>(
        "SELECT sent_count, dispatched_at FROM stocks.signal_push_queue WHERE signal_id = $1",
        [reclaimed.signal_id],
      )
    ).rows[0];
    assert.equal(finalRow.sent_count, 5);
    assert.ok(finalRow.dispatched_at);
  } finally {
    await db.close();
  }
});
