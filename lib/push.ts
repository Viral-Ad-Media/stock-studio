// Pure Web Crypto implementation of Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID ES256).
// Zero external runtime dependencies; works identically in Node.js 20+/24 and Deno Edge Functions.

export type PushSubscriptionKeys = {
  p256dh: string;
  auth: string;
};

export type PushSubscriptionRecord = {
  endpoint: string;
  keys: PushSubscriptionKeys;
};

export type VapidConfig = {
  subject: string;
  publicKey: string;
  privateKey: string;
};

export type WebPushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  category?: "studies" | "watchlist" | "signals" | "test";
  icon?: string;
  badge?: string;
  timestamp?: number;
};

export type SendPushOptions = {
  ttlSeconds?: number;
  urgency?: "very-low" | "low" | "normal" | "high";
  topic?: string;
  fetchImpl?: typeof fetch;
  nowMs?: number;
};

export type SendPushResult =
  | { ok: true; status: number }
  | { ok: false; expired: boolean; status: number; error: string };

export class PushValidationError extends Error {}

// Official browser Web Push service domains (Chrome/Brave/Android FCM, Firefox
// Autopush, Apple Safari macOS/iOS Web Push, Microsoft Edge WNS). Restricting
// endpoints to legitimate push services eliminates SSRF to internal or arbitrary hosts.
const DEFAULT_PUSH_HOST_SUFFIXES = [
  ".googleapis.com",
  ".google.com",
  ".push.services.mozilla.com",
  ".mozaws.net",
  ".push.apple.com",
  ".notify.windows.com",
] as const;

const MAX_PAYLOAD_BYTES = 3800;
const RECORD_SIZE = 4096;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function toBase64Url(bytes: Uint8Array): string {
  const bin = Buffer.from(bytes).toString("base64");
  return bin.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function fromBase64Url(input: string): Uint8Array {
  if (typeof input !== "string" || input.length === 0) {
    throw new PushValidationError("Missing base64 value.");
  }
  const trimmed = input.trim();
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed)) {
    throw new PushValidationError("Malformed base64 value.");
  }
  const normalized = trimmed.replace(/-/g, "+").replace(/_/g, "/");
  const pad = (4 - (normalized.length % 4)) % 4;
  return new Uint8Array(Buffer.from(normalized + "=".repeat(pad), "base64"));
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function isIpLiteral(hostname: string): boolean {
  if (hostname.startsWith("[") || hostname.includes(":")) return true;
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}

export function validatePushEndpoint(
  rawEndpoint: unknown,
  extraAllowedSuffixes: readonly string[] = [],
): string {
  if (typeof rawEndpoint !== "string") {
    throw new PushValidationError("Push endpoint is required.");
  }
  const trimmed = rawEndpoint.trim();
  if (!trimmed || trimmed.length > 2048) {
    throw new PushValidationError("Push endpoint URL is invalid.");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new PushValidationError("Push endpoint must be a valid URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new PushValidationError("Push endpoint must use HTTPS.");
  }
  if (parsed.username || parsed.password) {
    throw new PushValidationError("Push endpoint must not include credentials.");
  }
  if (parsed.port && parsed.port !== "443") {
    throw new PushValidationError("Push endpoint must use standard HTTPS port.");
  }
  const host = parsed.hostname.toLowerCase();
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    !host.includes(".") ||
    isIpLiteral(host)
  ) {
    throw new PushValidationError("Push endpoint host is not permitted.");
  }

  const suffixes = [...DEFAULT_PUSH_HOST_SUFFIXES, ...extraAllowedSuffixes];
  const allowed = suffixes.some((suffix) => {
    const clean = suffix.toLowerCase();
    const root = clean.startsWith(".") ? clean.slice(1) : clean;
    return host === root || host.endsWith(`.${root}`);
  });
  if (!allowed) {
    throw new PushValidationError("Unrecognized browser push service host.");
  }
  return parsed.toString();
}

export async function validatePushSubscriptionInput(
  raw: unknown,
  extraAllowedSuffixes: readonly string[] = [],
): Promise<PushSubscriptionRecord> {
  if (!raw || typeof raw !== "object") {
    throw new PushValidationError("Invalid push subscription payload.");
  }
  const obj = raw as Record<string, unknown>;
  const endpoint = validatePushEndpoint(obj.endpoint, extraAllowedSuffixes);
  const keys = obj.keys as Record<string, unknown> | undefined;
  if (!keys || typeof keys !== "object") {
    throw new PushValidationError("Push subscription keys are required.");
  }
  if (typeof keys.p256dh !== "string" || typeof keys.auth !== "string") {
    throw new PushValidationError("Push subscription p256dh and auth keys are required.");
  }

  const p256dhBytes = fromBase64Url(keys.p256dh);
  if (p256dhBytes.byteLength !== 65 || p256dhBytes[0] !== 0x04) {
    throw new PushValidationError("Invalid p256dh ECDH public key.");
  }
  // Verify the point actually lies on P-256.
  try {
    await crypto.subtle.importKey(
      "raw",
      toArrayBuffer(p256dhBytes),
      { name: "ECDH", namedCurve: "P-256" },
      false,
      [],
    );
  } catch {
    throw new PushValidationError("p256dh key is not a valid P-256 point.");
  }

  const authBytes = fromBase64Url(keys.auth);
  if (authBytes.byteLength < 16 || authBytes.byteLength > 64) {
    throw new PushValidationError("Invalid push auth secret length.");
  }

  return {
    endpoint,
    keys: {
      p256dh: toBase64Url(p256dhBytes),
      auth: toBase64Url(authBytes),
    },
  };
}

export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const rawPub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const jwkPriv = await crypto.subtle.exportKey("jwk", pair.privateKey);
  if (!jwkPriv.d) throw new Error("Failed to export VAPID private key.");
  return {
    publicKey: toBase64Url(rawPub),
    privateKey: jwkPriv.d,
  };
}

export async function createVapidAuthHeader(
  endpoint: string,
  vapid: VapidConfig,
  nowMs = Date.now(),
): Promise<string> {
  if (!vapid.subject.startsWith("mailto:") && !vapid.subject.startsWith("https://")) {
    throw new PushValidationError("VAPID subject must start with mailto: or https://.");
  }
  const rawPub = fromBase64Url(vapid.publicKey);
  const rawPriv = fromBase64Url(vapid.privateKey);
  if (rawPub.byteLength !== 65 || rawPub[0] !== 0x04) {
    throw new PushValidationError("VAPID public key must be a 65-byte uncompressed P-256 key.");
  }
  if (rawPriv.byteLength !== 32) {
    throw new PushValidationError("VAPID private key must be a 32-byte P-256 scalar.");
  }

  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x: toBase64Url(rawPub.subarray(1, 33)),
    y: toBase64Url(rawPub.subarray(33, 65)),
    d: toBase64Url(rawPriv),
    ext: false,
  };
  const signingKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );

  const audience = new URL(endpoint).origin;
  const exp = Math.floor(nowMs / 1000) + 12 * 3600;
  const headerPart = toBase64Url(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payloadPart = toBase64Url(
    encoder.encode(JSON.stringify({ aud: audience, exp, sub: vapid.subject })),
  );
  const unsigned = `${headerPart}.${payloadPart}`;
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      signingKey,
      toArrayBuffer(encoder.encode(unsigned)),
    ),
  );
  const jwt = `${unsigned}.${toBase64Url(sig)}`;
  return `vapid t=${jwt}, k=${toBase64Url(rawPub)}`;
}

async function hkdfDerive(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  byteLength: number,
): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(ikm),
    "HKDF",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: toArrayBuffer(salt),
      info: toArrayBuffer(info),
    },
    baseKey,
    byteLength * 8,
  );
  return new Uint8Array(bits);
}

// Encrypts a UTF-8 push payload per RFC 8291 (aes128gcm) + RFC 8188.
export async function encryptPushPayload(
  plaintext: string,
  p256dhBase64Url: string,
  authBase64Url: string,
): Promise<Uint8Array> {
  const payloadBytes = encoder.encode(plaintext);
  if (payloadBytes.byteLength > MAX_PAYLOAD_BYTES) {
    throw new PushValidationError(`Push payload exceeds ${MAX_PAYLOAD_BYTES} bytes.`);
  }
  const uaPublicBytes = fromBase64Url(p256dhBase64Url);
  const authSecret = fromBase64Url(authBase64Url);
  if (uaPublicBytes.byteLength !== 65 || uaPublicBytes[0] !== 0x04) {
    throw new PushValidationError("Invalid subscriber p256dh key.");
  }
  if (authSecret.byteLength < 16) {
    throw new PushValidationError("Invalid subscriber auth secret.");
  }

  const uaPublicKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(uaPublicBytes),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const asKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const asPublicBytes = new Uint8Array(await crypto.subtle.exportKey("raw", asKeyPair.publicKey));
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: uaPublicKey },
      asKeyPair.privateKey,
      256,
    ),
  );

  // RFC 8291 §3.3: key_info = "WebPush: info\0" || ua_public || as_public
  const keyInfo = concatBytes(
    encoder.encode("WebPush: info\0"),
    uaPublicBytes,
    asPublicBytes,
  );
  const ikm = await hkdfDerive(ecdhSecret, authSecret, keyInfo, 32);

  // RFC 8291 §3.4 / RFC 8188 §2.2-2.3: derive 16-byte CEK and 12-byte nonce.
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdfDerive(
    ikm,
    salt,
    encoder.encode("Content-Encoding: aes128gcm\0"),
    16,
  );
  const nonce = await hkdfDerive(
    ikm,
    salt,
    encoder.encode("Content-Encoding: nonce\0"),
    12,
  );

  const aesKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(cek),
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  // Single final record: payload || 0x02 delimiter.
  const recordPlaintext = concatBytes(payloadBytes, Uint8Array.of(0x02));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: toArrayBuffer(nonce), tagLength: 128 },
      aesKey,
      toArrayBuffer(recordPlaintext),
    ),
  );

  // RFC 8188 header: salt(16) || rs(uint32BE=4096) || idlen(uint8=65) || keyid(65)
  const header = new Uint8Array(16 + 4 + 1 + asPublicBytes.byteLength);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE, false);
  header[20] = asPublicBytes.byteLength;
  header.set(asPublicBytes, 21);

  return concatBytes(header, ciphertext);
}

// Inverse of encryptPushPayload — used by tests to prove RFC 8291 compliance.
export async function decryptPushPayload(
  encryptedBody: Uint8Array,
  uaPrivateKey: CryptoKey,
  uaPublicBytes: Uint8Array,
  authSecret: Uint8Array,
): Promise<string> {
  if (encryptedBody.byteLength < 21 + 65 + 17) {
    throw new Error("Encrypted push body too short.");
  }
  const salt = encryptedBody.subarray(0, 16);
  const idlen = encryptedBody[20];
  const asPublicBytes = encryptedBody.subarray(21, 21 + idlen);
  const ciphertext = encryptedBody.subarray(21 + idlen);

  const asPublicKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(asPublicBytes),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: asPublicKey },
      uaPrivateKey,
      256,
    ),
  );
  const keyInfo = concatBytes(
    encoder.encode("WebPush: info\0"),
    uaPublicBytes,
    asPublicBytes,
  );
  const ikm = await hkdfDerive(ecdhSecret, authSecret, keyInfo, 32);
  const cek = await hkdfDerive(
    ikm,
    salt,
    encoder.encode("Content-Encoding: aes128gcm\0"),
    16,
  );
  const nonce = await hkdfDerive(
    ikm,
    salt,
    encoder.encode("Content-Encoding: nonce\0"),
    12,
  );
  const aesKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(cek),
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const decrypted = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toArrayBuffer(nonce), tagLength: 128 },
      aesKey,
      toArrayBuffer(ciphertext),
    ),
  );
  let end = decrypted.byteLength - 1;
  while (end >= 0 && decrypted[end] === 0x00) end--;
  if (end < 0 || decrypted[end] !== 0x02) {
    throw new Error("Missing RFC 8188 final-record delimiter.");
  }
  return decoder.decode(decrypted.subarray(0, end));
}

export async function sendWebPush(
  subscription: PushSubscriptionRecord,
  payload: WebPushPayload,
  vapid: VapidConfig,
  options: SendPushOptions = {},
): Promise<SendPushResult> {
  const fetchFn = options.fetchImpl ?? fetch;
  const endpoint = validatePushEndpoint(subscription.endpoint);
  const serialized = JSON.stringify({
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-72.png",
    timestamp: Date.now(),
    ...payload,
  });
  const body = await encryptPushPayload(
    serialized,
    subscription.keys.p256dh,
    subscription.keys.auth,
  );
  const authorization = await createVapidAuthHeader(endpoint, vapid, options.nowMs);

  const headers: Record<string, string> = {
    Authorization: authorization,
    "Content-Type": "application/octet-stream",
    "Content-Encoding": "aes128gcm",
    "Content-Length": String(body.byteLength),
    TTL: String(options.ttlSeconds ?? 86_400),
    Urgency: options.urgency ?? "normal",
  };
  if (options.topic && /^[A-Za-z0-9_-]{1,32}$/.test(options.topic)) {
    headers.Topic = options.topic;
  }

  try {
    const res = await fetchFn(endpoint, {
      method: "POST",
      headers,
      body: toArrayBuffer(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status >= 200 && res.status < 300) {
      return { ok: true, status: res.status };
    }
    const text = (await res.text().catch(() => "")).slice(0, 300);
    const expired = res.status === 404 || res.status === 410;
    return {
      ok: false,
      expired,
      status: res.status,
      error: `Push HTTP ${res.status}${text ? `: ${text}` : ""}`,
    };
  } catch (err) {
    return {
      ok: false,
      expired: false,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
