// Runs the Discord signal relay inside the web app, for hosts whose database
// has no scheduler of its own (Neon has no pg_cron). One pass is started by
// the host's minute scheduler (lib/host-scheduler.ts) and by
// POST /api/signals/relay, which an outside once-a-minute ping calls so the
// relay keeps running while the web host would otherwise sleep.
//
// The pass itself is lib/signal-relay.ts, the same logic the Supabase edge
// function ran. Recording is idempotent per Discord message and deliveries
// are leased in the database, so two hosts running a pass at once can't
// double-post.
//
// Needs DISCORD_TOKEN, INPUT_CHANNEL_ID, SIGNALS_CHANNEL_ID, SIGNAL_POSTER_IDS
// and SIGNALS_DATABASE_URL (the stocks_signals role, which can only record
// and read signals). Without them the relay is off and a pass does nothing.
import { signalsSql } from "./db";
import { parsePosterIds, type ParsedSignal } from "./signals";
import {
  discordRestClient, runRelayPass,
  type Delivery, type DiscordMessage, type RelayConfig, type RelayDiscord, type RelayResult, type RelayStore,
} from "./signal-relay";

export type RelaySettings = {
  token: string;
  config: RelayConfig;
  main: string;
  gold: string | null;
  silver: string | null;
};

type Env = Record<string, string | undefined>;

// The relay's settings from the environment, or null when a required one is
// missing (the relay is then simply off).
export function relaySettings(env: Env = process.env): RelaySettings | null {
  const get = (name: string) => env[name]?.trim() || "";
  const token = get("DISCORD_TOKEN");
  const input = get("INPUT_CHANNEL_ID");
  const main = get("SIGNALS_CHANNEL_ID");
  const posters = parsePosterIds(get("SIGNAL_POSTER_IDS"));
  if (!token || !input || !main || !get("SIGNALS_DATABASE_URL") || posters.size === 0) return null;
  const gold = get("GOLD_SIGNALS_CHANNEL_ID") || null;
  const silver = get("SILVER_SIGNALS_CHANNEL_ID") || null;
  return {
    token,
    main,
    gold,
    silver,
    config: {
      inputChannelId: input,
      destinations: [main, gold, silver].filter((d): d is string => Boolean(d)),
      tierLabel: { ...(gold ? { [gold]: "Gold weekly pick" } : {}), ...(silver ? { [silver]: "Silver weekly pick" } : {}) },
      posters,
      footer: get("SIGNAL_FOOTER") || "I Hate 9-5 Signals",
      disclaimer: env.SIGNAL_DISCLAIMER ?? "Trading involves risk of loss. Not personalized financial advice.",
    },
  };
}

export function signalRelayConfigured(env: Env = process.env): boolean {
  return relaySettings(env) !== null;
}

// The track record and delivery queue, as the stocks_signals role.
function databaseStore(s: RelaySettings): RelayStore {
  const db = signalsSql;
  return {
    heartbeat: async () => { await db`SELECT stocks.signal_bot_heartbeat(${db.json({ via: "app-relay" })})`; },
    record: async (sig: ParsedSignal, msg: DiscordMessage) => {
      const name = msg.author.username.slice(0, 100);
      const [row] = s.gold || s.silver
        ? await db<{ id: number }[]>`SELECT id FROM stocks.record_signal(${db.json(sig)}, ${msg.author.id}, ${name}, ${msg.id}, ${s.main}, ${s.gold}, ${s.silver})`
        : await db<{ id: number }[]>`SELECT id FROM stocks.record_signal(${db.json(sig)}, ${msg.author.id}, ${name}, ${msg.id}, ${s.main})`;
      return row ?? null;
    },
    claim: async (destination) => (await db<Delivery[]>`SELECT * FROM stocks.claim_signal_delivery(${destination})`)[0] ?? null,
    finish: async (item, id) => (await db`SELECT stocks.finish_signal_delivery(${item.signal.id}, ${item.lease_token}::uuid, ${id}) AS done`)[0].done,
    retry: async (item, error) => { await db`SELECT stocks.retry_signal_delivery(${item.signal.id}, ${item.lease_token}::uuid, ${error})`; },
  };
}

export type RelayRun =
  | ({ status: "ok" } & RelayResult)
  | { status: "not_configured" }
  | { status: "busy" };

export type RelayDeps = {
  settings: () => RelaySettings | null;
  discord: (s: RelaySettings) => RelayDiscord;
  store: (s: RelaySettings) => RelayStore;
};

const defaultDeps: RelayDeps = {
  settings: () => relaySettings(),
  discord: (s) => discordRestClient(s.token),
  store: databaseStore,
};

declare global {
  // eslint-disable-next-line no-var
  var __stocksSignalRelayRunning: boolean | undefined;
}

// One relay pass. The scheduler and the endpoint share one in-process flag,
// so a ping that arrives mid-pass returns "busy" instead of starting a second.
export async function runSignalRelayOnce(deps: RelayDeps = defaultDeps): Promise<RelayRun> {
  const settings = deps.settings();
  if (!settings) return { status: "not_configured" };
  if (globalThis.__stocksSignalRelayRunning) return { status: "busy" };
  globalThis.__stocksSignalRelayRunning = true;
  try {
    const result = await runRelayPass(settings.config, deps.discord(settings), deps.store(settings));
    if (result.handled || result.delivered || result.failedDeliveries) console.log("signal-relay:", JSON.stringify(result));
    return { status: "ok", ...result };
  } finally {
    globalThis.__stocksSignalRelayRunning = false;
  }
}
