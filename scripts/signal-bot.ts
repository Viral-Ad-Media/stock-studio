/**
 * Signal bot — reposts approved traders' one-line calls from a private Discord
 * channel to the member signals channel, and records each one in the
 * append-only, hash-chained track record (stocks.signals).
 *
 *   BUY GOOGL CALL @12.40 tp 15 sl 11 breakout over 285
 *
 * Recording and enqueueing happen in one transaction. Database leases and
 * retry scheduling recover failed sends and process crashes. A signal is never
 * posted without being recorded. 📥 means durably queued.
 *
 * Config (environment — never command-line arguments, never committed):
 *   DISCORD_TOKEN          bot token
 *   INPUT_CHANNEL_ID       private channel the trader types in
 *   SIGNALS_CHANNEL_ID     member channel the bot posts to
 *   SIGNAL_POSTER_IDS      comma-separated Discord user IDs allowed to post (required)
 *   SIGNALS_DATABASE_URL   pooler URL for the stocks_signals role (insert/read only)
 *   SIGNAL_FOOTER          optional embed footer (default "I Hate 9-5 Signals")
 *   SIGNAL_DISCLAIMER      optional risk line under each signal ("" to omit)
 * In production these come from a root-only EnvironmentFile (deploy/signal-bot);
 * locally, .env.local is read as a fallback.
 *
 * Run: npm run signal-bot
 */
import { drainDeliveries, type Delivery } from "../lib/signal-delivery";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import postgres from "postgres";
import {
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  Partials,
  type Message,
  type PartialMessage,
} from "discord.js";
import { parseSignal, isParseError, parsePosterIds, ACTION_STYLE, formatPrice, type ParsedSignal } from "../lib/signals";

const localEnv = path.join(__dirname, "../.env.local");
if (fs.existsSync(localEnv)) dotenv.config({ path: localEnv }); // never overrides real env

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`signal-bot: ${name} is not set. See deploy/signal-bot/README.md.`);
    process.exit(1);
  }
  return v;
}

const TOKEN = required("DISCORD_TOKEN");
const INPUT_CHANNEL_ID = required("INPUT_CHANNEL_ID");
const SIGNALS_CHANNEL_ID = required("SIGNALS_CHANNEL_ID");
const DATABASE_URL = required("SIGNALS_DATABASE_URL");
const POSTERS = parsePosterIds(process.env.SIGNAL_POSTER_IDS);
if (POSTERS.size === 0) {
  console.error("signal-bot: SIGNAL_POSTER_IDS must list at least one Discord user ID allowed to post signals.");
  process.exit(1);
}
const FOOTER = process.env.SIGNAL_FOOTER?.trim() || "I Hate 9-5 Signals";
const DISCLAIMER = process.env.SIGNAL_DISCLAIMER ?? "Trading involves risk of loss. Not personalized financial advice.";

// The dedicated role can only insert and read signals — even a leaked
// connection string can't rewrite the track record.
const sql = postgres(DATABASE_URL, { ssl: "require", prepare: false, max: 2, idle_timeout: 30 });

type Recorded = { id: number; posted_at: Date | string; hash?: string };

async function record(sig: ParsedSignal, msg: Message): Promise<Recorded | null> {
  const [row] = await sql<Recorded[]>`
    SELECT id, posted_at, hash FROM stocks.record_signal(
      ${sql.json(sig)}, ${msg.author.id}, ${msg.author.username.slice(0, 100)},
      ${msg.id}, ${SIGNALS_CHANNEL_ID})
  `;
  return row ?? null;
}

function embedFor(sig: ParsedSignal, rec: Recorded): EmbedBuilder {
  const style = ACTION_STYLE[sig.action];
  const embed = new EmbedBuilder()
    .setTitle(`${sig.action} ${sig.ticker}${sig.instrument ? ` ${sig.instrument}` : ""}`)
    .setDescription(sig.detail || "No details")
    .setColor(style.color)
    .setTimestamp(new Date(rec.posted_at))
    .setFooter({ text: `Signal #${rec.id} · ${FOOTER}${DISCLAIMER ? ` · ${DISCLAIMER}` : ""}`.slice(0, 2048) });
  const levels = [
    ["Entry", formatPrice(sig.entry)],
    ["Target", formatPrice(sig.target)],
    ["Stop", formatPrice(sig.stop)],
  ].filter((l): l is [string, string] => l[1] != null);
  for (const [name, value] of levels) embed.addFields({ name, value, inline: true });
  return embed;
}

async function reply(msg: Message, content: string) {
  // Never ping anyone from a bot reply.
  await msg.reply({ content, allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Message],
});

let deliveryTimer: ReturnType<typeof setInterval> | undefined;
let draining: Promise<void> | undefined;
function drain(): Promise<void> {
  if (draining) return draining;
  draining = drainDeliveries({
    claim: async () => (await sql<Delivery[]>`SELECT * FROM stocks.claim_signal_delivery(${SIGNALS_CHANNEL_ID})`)[0] ?? null,
    finish: async (item, id) => (await sql`SELECT stocks.finish_signal_delivery(${item.signal.id}, ${item.lease_token}::uuid, ${id}) AS done`)[0].done,
    retry: async (item, error) => { console.error(`signal-bot: delivery #${item.signal.id} attempt ${item.attempts} will retry: ${error}`); await sql`SELECT stocks.retry_signal_delivery(${item.signal.id}, ${item.lease_token}::uuid, ${error})`; },
  }, async (item) => {
    const channel = await client.channels.fetch(item.destination);
    if (!channel?.isSendable()) throw new Error("signals channel not found or not sendable");
    // Discord also deduplicates retries during its recent-nonce window.
    const sent = await channel.send({ embeds: [embedFor(item.signal, item.signal)],
      nonce: `ss:${item.signal.id}`, enforceNonce: true, allowedMentions: { parse: [] } });
    return sent.id;
  }).finally(() => { draining = undefined; });
  return draining;
}
function scheduleDrain() {
  void drain().catch((error) => console.error("signal-bot: delivery drain failed", error));
}

client.once(Events.ClientReady, (c) => {
  scheduleDrain();
  deliveryTimer = setInterval(scheduleDrain, 5000);
  console.log(`signal-bot: logged in as ${c.user.tag}; ${INPUT_CHANNEL_ID} -> ${SIGNALS_CHANNEL_ID}; ${POSTERS.size} approved poster(s)`);
});

client.on(Events.MessageCreate, async (msg) => {
  if (msg.author.bot || msg.channelId !== INPUT_CHANNEL_ID) return;

  if (!POSTERS.has(msg.author.id)) {
    console.warn(`signal-bot: ignored message ${msg.id} from unapproved user ${msg.author.id}`);
    await msg.react("⛔").catch(() => {});
    await reply(msg, "Only approved posters can publish signals. Ask an admin to add your Discord user ID.");
    return;
  }

  const parsed = parseSignal(msg.content);
  if (isParseError(parsed)) {
    await msg.react("❓").catch(() => {});
    await reply(msg, parsed.error);
    return;
  }

  let rec: Recorded | null;
  try {
    rec = await record(parsed, msg);
  } catch (err) {
    console.error(`signal-bot: couldn't record message ${msg.id}`, err);
    await msg.react("⚠️").catch(() => {});
    await reply(msg, "Couldn't save this signal to the track record, so it was NOT posted. Try again in a minute.");
    return;
  }
  if (!rec) return;
  scheduleDrain();
  await msg.react("📥").catch(() => {}); // durably queued, including a replay

});

// The track record is append-only, so an edit can't change a posted signal.
client.on(Events.MessageUpdate, async (_old, updated: Message | PartialMessage) => {
  if (updated.channelId !== INPUT_CHANNEL_ID) return;
  const msg = updated.partial ? await updated.fetch().catch(() => null) : updated;
  if (!msg || msg.author.bot || !POSTERS.has(msg.author.id)) return;
  const [row] = await sql<{ id: number }[]>`SELECT id FROM stocks.signals WHERE source_message_id = ${msg.id}`.catch(() => []);
  if (row) {
    await reply(msg, `Edits don't change signal #${row.id} — the track record is permanent. Post a CLOSE or ALERT to correct it.`);
  }
});

async function shutdown(signal: string) {
  console.log(`signal-bot: ${signal} received, shutting down`);
  if (deliveryTimer) clearInterval(deliveryTimer);
  if (draining) await draining.catch(() => {});
  await client.destroy();
  await sql.end({ timeout: 5 });
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

client.login(TOKEN).catch((err) => {
  console.error("signal-bot: Discord login failed — check DISCORD_TOKEN", err.message);
  process.exit(1);
});
