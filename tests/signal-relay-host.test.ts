import assert from "node:assert/strict";
import { test } from "node:test";
import { relaySettings, runSignalRelayOnce, signalRelayConfigured, type RelayDeps, type RelaySettings } from "../lib/signal-relay-host";
import { secretMatches } from "../lib/secret";
import type { Delivery, DiscordMessage, RelayDiscord, RelayStore } from "../lib/signal-relay";

const ENV = {
  DISCORD_TOKEN: "bot-token",
  INPUT_CHANNEL_ID: "100",
  SIGNALS_CHANNEL_ID: "200",
  SIGNAL_POSTER_IDS: "12345678901234567",
  SIGNALS_DATABASE_URL: "postgres://stocks_signals@example.test/db",
};

test("the relay is off unless every required setting is present", () => {
  assert.equal(signalRelayConfigured({}), false);
  for (const missing of Object.keys(ENV)) {
    assert.equal(relaySettings({ ...ENV, [missing]: " " }), null, `${missing} is required`);
  }
  // Poster IDs that aren't Discord IDs don't count as configured.
  assert.equal(relaySettings({ ...ENV, SIGNAL_POSTER_IDS: "nobody" }), null);

  const s = relaySettings(ENV)!;
  assert.equal(s.token, "bot-token");
  assert.equal(s.config.inputChannelId, "100");
  assert.deepEqual(s.config.destinations, ["200"]);
  assert.deepEqual(s.config.tierLabel, {});
  assert.deepEqual([...s.config.posters], ["12345678901234567"]);
  assert.match(s.config.disclaimer, /risk of loss/);

  const tiers = relaySettings({ ...ENV, GOLD_SIGNALS_CHANNEL_ID: "300", SILVER_SIGNALS_CHANNEL_ID: "400", SIGNAL_DISCLAIMER: "", SIGNAL_FOOTER: "Desk" })!;
  assert.deepEqual(tiers.config.destinations, ["200", "300", "400"]);
  assert.deepEqual(tiers.config.tierLabel, { "300": "Gold weekly pick", "400": "Silver weekly pick" });
  assert.equal(tiers.config.disclaimer, ""); // an explicit empty disclaimer is respected
  assert.equal(tiers.config.footer, "Desk");
  assert.deepEqual([tiers.main, tiers.gold, tiers.silver], ["200", "300", "400"]);
});

function fakes(messages: DiscordMessage[], gate?: Promise<void>) {
  const log: string[] = [];
  const queue: Delivery[] = [];
  const discord: RelayDiscord = {
    recentMessages: async () => { await gate; return messages; },
    react: async (_c, id, emoji) => { log.push(`react ${id} ${emoji}`); },
    reply: async (_c, id) => { log.push(`reply ${id}`); },
    post: async (channel, embed) => { log.push(`post ${channel} ${embed.title}`); return "sent-1"; },
  };
  const store: RelayStore = {
    heartbeat: async () => { log.push("beat"); },
    record: async (sig, m) => {
      queue.push({ signal: { ...sig, id: 1, posted_at: m.timestamp }, destination: "200", attempts: 1, lease_token: "lease" });
      return { id: 1 };
    },
    claim: async (destination) => {
      const i = queue.findIndex((q) => q.destination === destination);
      return i < 0 ? null : queue.splice(i, 1)[0];
    },
    finish: async () => true,
    retry: async () => {},
  };
  const deps = (settings: RelaySettings | null): RelayDeps => ({ settings: () => settings, discord: () => discord, store: () => store });
  return { log, deps };
}

test("a pass records an approved call and posts it; with no settings it does nothing", async () => {
  const message: DiscordMessage = {
    id: "m1", content: "BUY AAPL @190 tp 200 sl 185 breakout", timestamp: new Date(Date.now() - 30_000).toISOString(),
    author: { id: "12345678901234567", username: "trader" },
  };
  const off = fakes([message]);
  assert.deepEqual(await runSignalRelayOnce(off.deps(null)), { status: "not_configured" });
  assert.deepEqual(off.log, []);

  const on = fakes([message]);
  const run = await runSignalRelayOnce(on.deps(relaySettings(ENV)));
  assert.deepEqual(run, { status: "ok", handled: 1, recorded: 1, delivered: 1, failedDeliveries: 0 });
  assert.deepEqual(on.log, ["beat", "react m1 📥", "post 200 BUY AAPL"]);
});

test("a ping that arrives mid-pass is told the relay is busy, and the next one runs", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const { deps } = fakes([], gate);
  const settings = relaySettings(ENV);
  const first = runSignalRelayOnce(deps(settings));
  assert.deepEqual(await runSignalRelayOnce(deps(settings)), { status: "busy" });
  release();
  assert.equal((await first).status, "ok");
  assert.equal((await runSignalRelayOnce(fakes([]).deps(settings))).status, "ok");
});

test("a failed pass releases the busy flag", async () => {
  const { deps } = fakes([]);
  const settings = relaySettings(ENV);
  const broken: RelayDeps = { ...deps(settings), discord: () => ({ ...({} as RelayDiscord), recentMessages: async () => { throw new Error("Discord GET /channels/100/messages -> 401"); } }) };
  await assert.rejects(runSignalRelayOnce(broken), /401/);
  assert.equal((await runSignalRelayOnce(deps(settings))).status, "ok");
});

test("shared-secret check fails closed", () => {
  assert.equal(secretMatches("s3cret", "s3cret"), true);
  assert.equal(secretMatches("s3cret ", "s3cret"), false);
  assert.equal(secretMatches("short", "a-much-longer-secret"), false);
  assert.equal(secretMatches(null, "s3cret"), false);
  assert.equal(secretMatches("", ""), false);
  assert.equal(secretMatches("anything", undefined), false);
});
