import assert from "node:assert/strict";
import { test } from "node:test";
import { runRelayPass, type Delivery, type DiscordMessage, type RelayConfig, type RelayDiscord, type RelayStore } from "../lib/signal-relay";

const NOW = Date.parse("2026-10-30T15:00:00Z");
const cfg = (over: Partial<RelayConfig> = {}): RelayConfig => ({
  inputChannelId: "in", destinations: ["main", "gold"], tierLabel: { gold: "Gold weekly pick" },
  posters: new Set(["trader"]), footer: "Footer", disclaimer: "", now: () => NOW, ...over,
});
const msg = (id: string, content: string, over: Partial<DiscordMessage> = {}): DiscordMessage => ({
  id, content, timestamp: new Date(NOW - 60_000).toISOString(), author: { id: "trader", username: "t" }, ...over,
});

function fakes(messages: DiscordMessage[]) {
  const log: string[] = [];
  const queue: Delivery[] = [];
  const recorded = new Map<string, number>();
  const discord: RelayDiscord = {
    recentMessages: async () => messages,
    react: async (_c, id, emoji) => { log.push(`react ${id} ${emoji}`); },
    reply: async (_c, id) => { log.push(`reply ${id}`); },
    post: async (channel, embed, nonce) => { log.push(`post ${channel} ${embed.title} ${nonce}`); return `sent-${nonce}`; },
  };
  const store: RelayStore = {
    heartbeat: async () => { log.push("beat"); },
    record: async (sig, m) => {
      // Idempotent per source message, like stocks.record_signal.
      if (!recorded.has(m.id)) {
        const id = recorded.size + 1;
        recorded.set(m.id, id);
        for (const destination of id === 1 ? ["main", "gold"] : ["main"]) {
          queue.push({ signal: { ...sig, id, posted_at: new Date(NOW) }, destination, attempts: 1, lease_token: "lease" });
        }
      }
      return { id: recorded.get(m.id)! };
    },
    claim: async (destination) => {
      const i = queue.findIndex((d) => d.destination === destination);
      return i < 0 ? null : queue.splice(i, 1)[0];
    },
    finish: async (item, id) => { log.push(`finish ${item.signal.id} ${id}`); return true; },
    retry: async (item, error) => { log.push(`retry ${item.signal.id} ${error}`); },
  };
  return { discord, store, log, queue };
}

test("records approved calls oldest first, posts them, and marks each message", async (t) => {
  t.mock.method(console, "warn", () => {});
  // Discord returns newest first.
  const { discord, store, log } = fakes([msg("m2", "SELL AAPL @200"), msg("m1", "BUY GOOGL CALL @12.40 tp 15 sl 11")]);
  const result = await runRelayPass(cfg(), discord, store);
  assert.deepEqual(result, { handled: 2, recorded: 2, delivered: 3, failedDeliveries: 0 });
  assert.deepEqual(log, [
    "beat",
    "react m1 📥",
    "react m2 📥",
    "post main BUY GOOGL CALL ss:1",
    "finish 1 sent-ss:1",
    "post main SELL AAPL ss:2",
    "finish 2 sent-ss:2",
    "post gold BUY GOOGL CALL ss:1",
    "finish 1 sent-ss:1",
  ]);
});

test("skips handled, bot, and old messages; answers bad and unapproved ones", async (t) => {
  t.mock.method(console, "warn", () => {});
  const { discord, store, log } = fakes([
    msg("done", "BUY NVDA", { reactions: [{ me: true }] }),
    msg("bot", "BUY NVDA", { author: { id: "x", username: "bot", bot: true } }),
    msg("old", "BUY NVDA", { timestamp: new Date(NOW - 2 * 86_400_000).toISOString() }),
    msg("stranger", "BUY NVDA", { author: { id: "someone", username: "s" } }),
    msg("typo", "hello there"),
  ]);
  const result = await runRelayPass(cfg(), discord, store);
  assert.equal(result.handled, 2);
  assert.equal(result.recorded, 0);
  assert.deepEqual(log, ["beat", "react typo ❓", "reply typo", "react stranger ⛔", "reply stranger"]);
});

test("a failed reaction is retried next pass without a second record or post", async (t) => {
  t.mock.method(console, "error", () => {});
  const messages = [msg("m1", "BUY MSFT")];
  const { discord, store, log, queue } = fakes(messages);
  let failReact = true;
  const flaky: RelayDiscord = { ...discord, react: async (c, id, e) => { if (failReact) throw new Error("429"); return discord.react(c, id, e); } };

  await runRelayPass(cfg({ destinations: [] }), flaky, store);
  assert.equal(queue.length, 2); // recorded and queued even though the mark failed

  failReact = false;
  await runRelayPass(cfg(), flaky, store);
  assert.equal(log.filter((l) => l.startsWith("post")).length, 2); // main + gold, once each
  assert.ok(log.includes("react m1 📥"));
});

test("a failed send goes back to the database for retry", async (t) => {
  t.mock.method(console, "error", () => {});
  const { discord, store, log } = fakes([msg("m1", "BUY MSFT")]);
  const down: RelayDiscord = { ...discord, post: async () => { throw new Error("Discord POST -> 503"); } };
  const result = await runRelayPass(cfg({ destinations: ["main"] }), down, store);
  assert.equal(result.failedDeliveries, 1);
  assert.ok(log.includes("retry 1 Discord POST -> 503"));
});
