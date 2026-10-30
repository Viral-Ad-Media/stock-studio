// One pass of the Discord signal relay: read new messages in the input channel,
// record approved calls, then post queued signals to the member channels. It
// runs once a minute (supabase/functions/signal-relay, scheduled by pg_cron), so
// nothing has to stay online between passes.
//
// The bot's own reaction marks a message as handled (📥 queued, ❓ bad format,
// ⛔ unapproved, ⚠️ not saved), so a pass that dies halfway is picked up by the
// next one. record_signal is idempotent per source message, and deliveries keep
// their leases and retries in the database, so a replay never double-posts.
//
// No Discord or database imports: the edge function passes both in, and the
// tests pass fakes. Imports use .ts extensions because Deno requires them.
import { parseSignal, isParseError, ACTION_STYLE, formatPrice, type ParsedSignal } from "./signals.ts";

export type DiscordMessage = {
  id: string;
  content: string;
  timestamp: string;
  author: { id: string; username: string; bot?: boolean };
  reactions?: { me: boolean }[];
};

export type Delivery = {
  signal: ParsedSignal & { id: number; posted_at: string | Date };
  destination: string;
  attempts: number;
  lease_token: string;
};

export type DiscordEmbed = {
  title: string;
  description: string;
  color: number;
  timestamp: string;
  footer: { text: string };
  fields: { name: string; value: string; inline: boolean }[];
};

export type RelayDiscord = {
  // Newest first, as Discord returns them.
  recentMessages(channelId: string): Promise<DiscordMessage[]>;
  react(channelId: string, messageId: string, emoji: string): Promise<void>;
  reply(channelId: string, messageId: string, content: string): Promise<void>;
  // Returns the posted message ID.
  post(channelId: string, embed: DiscordEmbed, nonce: string): Promise<string>;
};

export type RelayStore = {
  heartbeat(): Promise<void>;
  record(sig: ParsedSignal, msg: DiscordMessage): Promise<{ id: number } | null>;
  claim(destination: string): Promise<Delivery | null>;
  finish(item: Delivery, externalId: string): Promise<boolean>;
  retry(item: Delivery, error: string): Promise<void>;
};

export type RelayConfig = {
  inputChannelId: string;
  destinations: string[]; // main channel first, then Gold and Silver if set
  tierLabel: Record<string, string>;
  posters: Set<string>;
  footer: string;
  disclaimer: string;
  // Messages older than this are left alone, so turning the relay on doesn't
  // answer weeks of old chat.
  maxMessageAgeMs?: number;
  // Stop starting new work after this long, so passes don't overlap.
  budgetMs?: number;
  now?: () => number;
};

export type RelayResult = { handled: number; recorded: number; delivered: number; failedDeliveries: number };

export function embedFor(sig: Delivery["signal"], tier: string | undefined, footer: string, disclaimer: string): DiscordEmbed {
  const style = ACTION_STYLE[sig.action];
  const levels = [
    ["Entry", formatPrice(sig.entry)],
    ["Target", formatPrice(sig.target)],
    ["Stop", formatPrice(sig.stop)],
  ].filter((l): l is [string, string] => l[1] != null);
  return {
    title: `${sig.action} ${sig.ticker}${sig.instrument ? ` ${sig.instrument}` : ""}`.slice(0, 256),
    description: (sig.detail || "No details").slice(0, 4096),
    color: style.color,
    timestamp: new Date(sig.posted_at).toISOString(),
    footer: { text: `Signal #${sig.id}${tier ? ` · ${tier}` : ""} · ${footer}${disclaimer ? ` · ${disclaimer}` : ""}`.slice(0, 2048) },
    fields: levels.map(([name, value]) => ({ name, value, inline: true })),
  };
}

export async function runRelayPass(cfg: RelayConfig, discord: RelayDiscord, store: RelayStore): Promise<RelayResult> {
  const now = cfg.now ?? Date.now;
  const started = now();
  const budget = cfg.budgetMs ?? 40_000;
  const maxAge = cfg.maxMessageAgeMs ?? 24 * 60 * 60_000;
  const outOfTime = () => now() - started > budget;
  const result: RelayResult = { handled: 0, recorded: 0, delivered: 0, failedDeliveries: 0 };

  await store.heartbeat().catch((error) => console.error("signal-relay: heartbeat failed", errorText(error)));

  // Oldest first, so calls are recorded in the order they were typed.
  const messages = (await discord.recentMessages(cfg.inputChannelId)).slice().reverse();
  for (const msg of messages) {
    if (outOfTime()) break;
    if (msg.author.bot) continue;
    if (msg.reactions?.some((r) => r.me)) continue;
    if (started - Date.parse(msg.timestamp) > maxAge) continue;
    result.handled++;
    try {
      if (await handleMessage(cfg, discord, store, msg)) result.recorded++;
    } catch (error) {
      // Usually a failed reaction; no mark means the next pass tries again.
      console.error(`signal-relay: message ${msg.id} will be retried: ${errorText(error)}`);
    }
  }

  // Each channel keeps its own order; one stuck channel doesn't block the others.
  for (const destination of cfg.destinations) {
    for (let i = 0; i < 20 && !outOfTime(); i++) {
      const item = await store.claim(destination);
      if (!item) break;
      try {
        const sentId = await discord.post(item.destination,
          embedFor(item.signal, cfg.tierLabel[item.destination], cfg.footer, cfg.disclaimer), `ss:${item.signal.id}`);
        if (!await store.finish(item, sentId)) throw new Error("Delivery lease expired before completion");
        result.delivered++;
      } catch (error) {
        result.failedDeliveries++;
        console.error(`signal-relay: delivery #${item.signal.id} to ${destination} attempt ${item.attempts} will retry: ${errorText(error)}`);
        await store.retry(item, errorText(error));
      }
    }
  }
  return result;
}

async function handleMessage(cfg: RelayConfig, discord: RelayDiscord, store: RelayStore, msg: DiscordMessage): Promise<boolean> {
  const channel = cfg.inputChannelId;
  if (!cfg.posters.has(msg.author.id)) {
    console.warn(`signal-relay: ignored message ${msg.id} from unapproved user ${msg.author.id}`);
    await discord.react(channel, msg.id, "⛔");
    await discord.reply(channel, msg.id, "Only approved posters can publish signals. Ask an admin to add your Discord user ID.").catch(() => {});
    return false;
  }

  const parsed = parseSignal(msg.content);
  if (isParseError(parsed)) {
    await discord.react(channel, msg.id, "❓");
    await discord.reply(channel, msg.id, parsed.error).catch(() => {});
    return false;
  }

  let rec: { id: number } | null;
  try {
    rec = await store.record(parsed, msg);
  } catch (error) {
    console.error(`signal-relay: couldn't record message ${msg.id}`, errorText(error));
    await discord.react(channel, msg.id, "⚠️");
    await discord.reply(channel, msg.id, "Couldn't save this signal to the track record, so it was NOT posted. Try again in a minute.").catch(() => {});
    return false;
  }
  // Reacting last: if it fails, the next pass replays the message, and the
  // replay returns the same record instead of making a new one.
  await discord.react(channel, msg.id, "📥");
  return rec != null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
