import { sql } from "@/lib/db";
import { SITE } from "@/lib/site";
import { variantLabel } from "@/lib/shared";
import { ACTION_STYLE, formatPrice, type SignalAction } from "@/lib/signals";
import {
  sendWebPush,
  type SendPushOptions,
  type VapidConfig,
  type WebPushPayload,
} from "@/lib/push";

type RecipientRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type ClaimedSignalPush = {
  signal_id: number;
  action: SignalAction;
  ticker: string;
  instrument: string | null;
  entry: string | null;
  target: string | null;
  stop: string | null;
  detail: string;
  posted_at: Date | string;
  gold: boolean;
  silver: boolean;
  attempts: number;
};

const MAX_SIGNAL_PUSH_AGE_MS = 30 * 60_000;
const BATCH_CONCURRENCY = 10;

export function getVapidConfig(): VapidConfig | null {
  const env = process.env as Record<string, string | undefined>;
  const publicKey = (env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || env.VAPID_PUBLIC_KEY || "").trim();
  const privateKey = (env.VAPID_PRIVATE_KEY || "").trim();
  if (!publicKey || !privateKey) return null;
  const rawSubject = env.VAPID_SUBJECT?.trim();
  const subject =
    rawSubject && (rawSubject.startsWith("mailto:") || rawSubject.startsWith("https://"))
      ? rawSubject
      : `mailto:${SITE.email}`;
  return { subject, publicKey, privateKey };
}

export function pushConfigured(): boolean {
  return getVapidConfig() !== null;
}

export async function deliverPushBatch(
  recipients: RecipientRow[],
  payload: WebPushPayload,
  options: SendPushOptions = {},
): Promise<{ sent: number; expired: number; failed: number }> {
  const vapid = getVapidConfig();
  if (!vapid || recipients.length === 0) {
    return { sent: 0, expired: 0, failed: 0 };
  }

  let sent = 0;
  let expired = 0;
  let failed = 0;
  const expiredIds: string[] = [];
  const deliveredIds: string[] = [];

  for (let i = 0; i < recipients.length; i += BATCH_CONCURRENCY) {
    const slice = recipients.slice(i, i + BATCH_CONCURRENCY);
    const results = await Promise.all(
      slice.map(async (r) => {
        const res = await sendWebPush(
          { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } },
          payload,
          vapid,
          options,
        );
        return { recipient: r, res };
      }),
    );

    for (const { recipient, res } of results) {
      if (res.ok) {
        sent++;
        deliveredIds.push(recipient.id);
      } else if (res.expired) {
        expired++;
        expiredIds.push(recipient.id);
      } else {
        failed++;
        await sql`
          UPDATE push_subscriptions
          SET last_error = ${res.error.slice(0, 500)}, updated_at = now()
          WHERE id = ${recipient.id}::uuid
        `.catch(() => {});
      }
    }
  }

  if (expiredIds.length > 0) {
    await sql`
      DELETE FROM push_subscriptions WHERE id = ANY(${expiredIds}::uuid[])
    `.catch((err) => console.error("push: failed pruning expired endpoints", err));
  }
  if (deliveredIds.length > 0) {
    await sql`
      UPDATE push_subscriptions
      SET last_sent_at = now(), last_error = NULL, updated_at = now()
      WHERE id = ANY(${deliveredIds}::uuid[])
    `.catch(() => {});
  }

  return { sent, expired, failed };
}

export async function notifyStudyFinished(params: {
  workspaceId: string;
  studyId: number;
  ticker: string;
  variant: string;
  status: "ready" | "error";
  gradeLetter?: string | null;
  summaryLine?: string | null;
}): Promise<void> {
  if (!pushConfigured()) return;
  try {
    const recipients = (await sql`
      SELECT * FROM workspace_push_recipients(${params.workspaceId}::uuid, 'studies')
    `) as unknown as RecipientRow[];
    if (recipients.length === 0) return;

    const label = variantLabel(params.variant);
    const payload: WebPushPayload =
      params.status === "ready"
        ? {
            title: `${params.ticker} · ${label} ready${params.gradeLetter ? ` (${params.gradeLetter})` : ""}`,
            body:
              params.summaryLine?.trim() ||
              "Your source-cited case study is ready to review.",
            url: `/study/${params.studyId}`,
            tag: `study-${params.studyId}`,
            category: "studies",
          }
        : {
            title: `${params.ticker} report couldn't be built`,
            body: "Your credits were refunded automatically. Open Dashboard to retry.",
            url: "/dashboard",
            tag: `study-${params.studyId}`,
            category: "studies",
          };

    await deliverPushBatch(recipients, payload, {
      ttlSeconds: 86_400,
      urgency: "normal",
      topic: `study-${params.studyId}`.slice(0, 32),
    });
  } catch (err) {
    console.error("push: study notification failed", err);
  }
}

export async function notifyWatchlistUpdated(params: {
  workspaceId: string;
  watchlistId: number;
  ticker: string;
  thesisStatus: string;
  note?: string | null;
}): Promise<void> {
  if (!pushConfigured()) return;
  try {
    const recipients = (await sql`
      SELECT * FROM workspace_push_recipients(${params.workspaceId}::uuid, 'watchlist')
    `) as unknown as RecipientRow[];
    if (recipients.length === 0) return;

    const urgent = params.thesisStatus === "weakening" || params.thesisStatus === "broken";
    const statusLabel =
      params.thesisStatus && params.thesisStatus !== "unknown"
        ? ` — thesis ${params.thesisStatus}`
        : " refreshed";

    await deliverPushBatch(
      recipients,
      {
        title: `${params.ticker} watchlist${statusLabel}`,
        body:
          params.note?.trim() ||
          "Open your watchlist to review the latest thesis and triggers.",
        url: "/watchlist",
        tag: `watchlist-${params.watchlistId}`,
        category: "watchlist",
      },
      {
        ttlSeconds: 86_400,
        urgency: urgent ? "high" : "normal",
        topic: `watch-${params.watchlistId}`.slice(0, 32),
      },
    );
  } catch (err) {
    console.error("push: watchlist notification failed", err);
  }
}

function formatSignalNotification(row: ClaimedSignalPush): WebPushPayload {
  const style = ACTION_STYLE[row.action] ?? { label: row.action };
  const head = `${style.label.toUpperCase()} ${row.ticker}${row.instrument ? ` ${row.instrument}` : ""}`;
  const levels = [
    row.entry ? `Entry ${formatPrice(row.entry)}` : null,
    row.target ? `TP ${formatPrice(row.target)}` : null,
    row.stop ? `SL ${formatPrice(row.stop)}` : null,
  ].filter(Boolean);
  const summaryParts = [...levels, row.detail?.trim()].filter(Boolean);
  const body =
    (summaryParts.join(" · ") || "New live call posted.").slice(0, 200) +
    " · Not personalized advice.";
  return {
    title: `Signal: ${head}`,
    body,
    url: "/signals",
    tag: `signal-${row.signal_id}`,
    category: "signals",
  };
}

export async function drainSignalPushQueue(options: {
  deadline?: number;
  maxItems?: number;
} = {}): Promise<{ processed: number; sent: number }> {
  const maxItems = options.maxItems ?? 25;
  const deadline = options.deadline ?? Date.now() + 20_000;
  let processed = 0;
  let totalSent = 0;

  for (let i = 0; i < maxItems && Date.now() < deadline; i++) {
    let claimed: ClaimedSignalPush | undefined;
    try {
      const rows = (await sql`SELECT * FROM claim_signal_push()`) as unknown as ClaimedSignalPush[];
      claimed = rows[0];
    } catch (err) {
      // Graceful no-op if migration hasn't been applied yet.
      if ((err as { code?: string })?.code === "42883") return { processed, sent: totalSent };
      console.error("push: claim_signal_push failed", err);
      break;
    }
    if (!claimed || claimed.signal_id == null) break;
    processed++;

    // Never blast stale trade calls if push keys weren't configured or after an outage.
    const ageMs = Date.now() - new Date(claimed.posted_at).getTime();
    if (!pushConfigured() || ageMs > MAX_SIGNAL_PUSH_AGE_MS) {
      await sql`SELECT finish_signal_push(${claimed.signal_id}, 0)`.catch(() => {});
      continue;
    }

    try {
      const recipients = (await sql`
        SELECT * FROM signal_push_recipients(${claimed.gold}, ${claimed.silver})
      `) as unknown as RecipientRow[];

      if (recipients.length === 0) {
        await sql`SELECT finish_signal_push(${claimed.signal_id}, 0)`;
        continue;
      }

      const payload = formatSignalNotification(claimed);
      const stats = await deliverPushBatch(recipients, payload, {
        ttlSeconds: 3600,
        urgency: "high",
        topic: `sig-${claimed.signal_id}`.slice(0, 32),
      });
      totalSent += stats.sent;

      if (stats.sent === 0 && stats.failed > 0 && stats.expired === 0) {
        await sql`SELECT retry_signal_push(${claimed.signal_id}, 'all push deliveries failed transiently')`;
      } else {
        await sql`SELECT finish_signal_push(${claimed.signal_id}, ${stats.sent})`;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`push: signal #${claimed.signal_id} dispatch error`, msg);
      await sql`SELECT retry_signal_push(${claimed.signal_id}, ${msg})`.catch(() => {});
    }
  }

  return { processed, sent: totalSent };
}
