// Supabase Edge Function: one pass of the Discord signal relay per call.
// pg_cron calls it every minute (supabase/signal-relay.sql). It replaces the
// always-on gateway bot, which Vercel billed for a reserved vCPU around the
// clock. See supabase/functions/signal-relay/README.md for setup.
//
// Secrets (supabase secrets set, never committed): SIGNAL_RELAY_SECRET,
// DISCORD_TOKEN, SIGNALS_DATABASE_URL, INPUT_CHANNEL_ID, SIGNALS_CHANNEL_ID,
// SIGNAL_POSTER_IDS, and optionally GOLD_SIGNALS_CHANNEL_ID,
// SILVER_SIGNALS_CHANNEL_ID, SIGNAL_FOOTER, SIGNAL_DISCLAIMER.
import postgres from "npm:postgres@3.4.9";
import { parsePosterIds, type ParsedSignal } from "../../../lib/signals.ts";
import { runRelayPass, type Delivery, type DiscordMessage, type RelayDiscord, type RelayStore } from "../../../lib/signal-relay.ts";

const env = (name: string) => Deno.env.get(name)?.trim() || "";
const API = "https://discord.com/api/v10";

let sql: ReturnType<typeof postgres> | undefined;

Deno.serve(async (req) => {
  const secret = env("SIGNAL_RELAY_SECRET");
  if (req.method !== "POST" || !secret || !await sameSecret(req.headers.get("x-relay-secret"), secret)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const token = env("DISCORD_TOKEN");
  const input = env("INPUT_CHANNEL_ID");
  const main = env("SIGNALS_CHANNEL_ID");
  const dbUrl = env("SIGNALS_DATABASE_URL");
  const posters = parsePosterIds(env("SIGNAL_POSTER_IDS"));
  if (!token || !input || !main || !dbUrl || posters.size === 0) {
    console.error("signal-relay: missing secrets; see supabase/functions/signal-relay/README.md");
    return Response.json({ error: "not configured" }, { status: 500 });
  }
  const gold = env("GOLD_SIGNALS_CHANNEL_ID") || null;
  const silver = env("SILVER_SIGNALS_CHANNEL_ID") || null;

  // The stocks_signals role can only record and read signals, so even a leaked
  // URL can't rewrite the track record.
  sql ??= postgres(dbUrl, { ssl: "require", prepare: false, max: 1, idle_timeout: 20 });
  const db = sql;

  const discord = discordClient(token);
  const store: RelayStore = {
    heartbeat: async () => { await db`SELECT stocks.signal_bot_heartbeat(${db.json({ via: "edge-relay" })})`; },
    record: async (sig: ParsedSignal, msg: DiscordMessage) => {
      const name = msg.author.username.slice(0, 100);
      const [row] = gold || silver
        ? await db<{ id: number }[]>`SELECT id FROM stocks.record_signal(${db.json(sig)}, ${msg.author.id}, ${name}, ${msg.id}, ${main}, ${gold}, ${silver})`
        : await db<{ id: number }[]>`SELECT id FROM stocks.record_signal(${db.json(sig)}, ${msg.author.id}, ${name}, ${msg.id}, ${main})`;
      return row ?? null;
    },
    claim: async (destination) => (await db<Delivery[]>`SELECT * FROM stocks.claim_signal_delivery(${destination})`)[0] ?? null,
    finish: async (item, id) => (await db`SELECT stocks.finish_signal_delivery(${item.signal.id}, ${item.lease_token}::uuid, ${id}) AS done`)[0].done,
    retry: async (item, error) => { await db`SELECT stocks.retry_signal_delivery(${item.signal.id}, ${item.lease_token}::uuid, ${error})`; },
  };

  try {
    const result = await runRelayPass({
      inputChannelId: input,
      destinations: [main, gold, silver].filter((d): d is string => Boolean(d)),
      tierLabel: { ...(gold ? { [gold]: "Gold weekly pick" } : {}), ...(silver ? { [silver]: "Silver monthly pick" } : {}) },
      posters,
      footer: env("SIGNAL_FOOTER") || "I Hate 9-5 Signals",
      disclaimer: Deno.env.get("SIGNAL_DISCLAIMER") ?? "Trading involves risk of loss. Not personalized financial advice.",
    }, discord, store);
    if (result.handled || result.delivered || result.failedDeliveries) console.log("signal-relay:", JSON.stringify(result));
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error("signal-relay: pass failed", error instanceof Error ? error.message : String(error));
    return Response.json({ error: "pass failed" }, { status: 500 });
  }
});

function discordClient(token: string): RelayDiscord {
  async function call(method: string, path: string, body?: unknown): Promise<Response> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json", "User-Agent": "StockStudioSignalRelay (https://stock-studio.onrender.com, 1)" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Discord ${method} ${path.split("?")[0]} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res;
  }
  const noPings = { parse: [], replied_user: false };
  return {
    recentMessages: async (channel) => await (await call("GET", `/channels/${channel}/messages?limit=50`)).json(),
    react: async (channel, id, emoji) => { await call("PUT", `/channels/${channel}/messages/${id}/reactions/${encodeURIComponent(emoji)}/@me`); },
    reply: async (channel, id, content) => {
      await call("POST", `/channels/${channel}/messages`, { content, message_reference: { message_id: id, fail_if_not_exists: false }, allowed_mentions: noPings });
    },
    // Discord also deduplicates a retried send inside its recent-nonce window.
    post: async (channel, embed, nonce) =>
      (await (await call("POST", `/channels/${channel}/messages`, { embeds: [embed], nonce, enforce_nonce: true, allowed_mentions: { parse: [] } })).json()).id,
  };
}

// Constant-time compare (hash first so lengths match).
async function sameSecret(given: string | null, expected: string): Promise<boolean> {
  if (!given) return false;
  const digest = async (s: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
