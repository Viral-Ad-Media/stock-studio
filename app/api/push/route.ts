import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { currentUser, currentWorkspaceId } from "@/lib/workspace";
import { getMembership } from "@/lib/membership";
import { canReadSignals } from "@/lib/signal-feed";
import { readJsonLimited, InputError } from "@/lib/journal";
import {
  PushValidationError,
  sendWebPush,
  validatePushEndpoint,
  validatePushSubscriptionInput,
} from "@/lib/push";
import { getVapidConfig, pushConfigured } from "@/lib/push-dispatch";

const MAX_SUBSCRIPTIONS_PER_USER = 10;

type StoredSub = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  notify_studies: boolean;
  notify_watchlist: boolean;
  notify_signals: boolean;
  last_sent_at: string | null;
  created_at: string;
};

function boolOr(val: unknown, fallback: boolean): boolean {
  return typeof val === "boolean" ? val : fallback;
}

function handleError(error: unknown) {
  if (error instanceof PushValidationError || error instanceof InputError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  // Graceful message if the push migration hasn't been applied to Postgres yet.
  if ((error as { code?: string })?.code === "42P01") {
    return NextResponse.json(
      { error: "Push notifications table is not initialized yet. Apply the latest Supabase migration." },
      { status: 503 },
    );
  }
  console.error("push route failed", error);
  return NextResponse.json(
    { error: "Push notification service is temporarily unavailable." },
    { status: 503 },
  );
}

export async function GET() {
  const user = await currentUser();
  const ws = await currentWorkspaceId();
  if (!user || !ws) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const membership = await getMembership(user.id, ws);
    const vapid = getVapidConfig();
    let rows: StoredSub[] = [];
    try {
      rows = (await sql`
        SELECT id, endpoint, notify_studies, notify_watchlist, notify_signals, last_sent_at, created_at
        FROM push_subscriptions
        WHERE user_id = ${user.id}::uuid
        ORDER BY updated_at DESC
        LIMIT ${MAX_SUBSCRIPTIONS_PER_USER}
      `) as unknown as StoredSub[];
    } catch (err) {
      if ((err as { code?: string })?.code !== "42P01") throw err;
    }

    return NextResponse.json(
      {
        configured: Boolean(vapid),
        publicKey: vapid?.publicKey ?? null,
        signalsEntitled: canReadSignals(membership.ent.signals),
        subscriptions: rows.map((r) => ({
          id: r.id,
          endpoint: r.endpoint,
          notifyStudies: r.notify_studies,
          notifyWatchlist: r.notify_watchlist,
          notifySignals: r.notify_signals,
          lastSentAt: r.last_sent_at,
          createdAt: r.created_at,
        })),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(req: Request) {
  const user = await currentUser();
  const ws = await currentWorkspaceId();
  if (!user || !ws) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const body = (await readJsonLimited(req, 32_768)) as Record<string, unknown>;
    if (!body || typeof body !== "object") {
      throw new PushValidationError("Invalid request body.");
    }

    // Action: send an encrypted test Web Push notification to this device.
    if (body.action === "test") {
      const vapid = getVapidConfig();
      if (!vapid) {
        return NextResponse.json(
          { error: "Web Push VAPID keys are not configured on this server." },
          { status: 503 },
        );
      }
      const endpointFilter =
        typeof body.endpoint === "string" && body.endpoint.trim()
          ? validatePushEndpoint(body.endpoint)
          : null;

      const subs = (endpointFilter
        ? await sql`
            SELECT id, endpoint, p256dh, auth FROM push_subscriptions
            WHERE user_id = ${user.id}::uuid AND endpoint = ${endpointFilter}
            LIMIT 1
          `
        : await sql`
            SELECT id, endpoint, p256dh, auth FROM push_subscriptions
            WHERE user_id = ${user.id}::uuid
            ORDER BY updated_at DESC
            LIMIT 3
          `) as unknown as StoredSub[];

      if (subs.length === 0) {
        return NextResponse.json(
          { error: "Enable notifications on this device before sending a test alert." },
          { status: 404 },
        );
      }

      let sent = 0;
      for (const sub of subs) {
        const res = await sendWebPush(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          {
            title: "Stock Studio notifications active",
            body: "You'll receive alerts here for ready research reports, watchlist updates and live signals.",
            url: "/today",
            tag: "ss-test-push",
            category: "test",
          },
          vapid,
          { ttlSeconds: 300, urgency: "high" },
        );
        if (res.ok) {
          sent++;
          await sql`
            UPDATE push_subscriptions SET last_sent_at = now(), last_error = NULL, updated_at = now()
            WHERE id = ${sub.id}::uuid
          `.catch(() => {});
        } else if (res.expired) {
          await sql`DELETE FROM push_subscriptions WHERE id = ${sub.id}::uuid`.catch(() => {});
        }
      }

      if (sent === 0) {
        return NextResponse.json(
          { error: "Browser push service rejected the test alert. Re-enable notifications on this device." },
          { status: 502 },
        );
      }
      return NextResponse.json({ ok: true, sent });
    }

    if (!pushConfigured()) {
      return NextResponse.json(
        { error: "Web Push VAPID keys are not configured on this server." },
        { status: 503 },
      );
    }

    const validated = await validatePushSubscriptionInput(body.subscription ?? body);
    const prefs = (body.preferences ?? {}) as Record<string, unknown>;
    const notifyStudies = boolOr(prefs.notifyStudies, true);
    const notifyWatchlist = boolOr(prefs.notifyWatchlist, true);
    const notifySignals = boolOr(prefs.notifySignals, true);
    const ua = req.headers.get("user-agent")?.slice(0, 512) ?? null;

    const saved = await sql.begin(async (tx) => {
      // Only update an existing endpoint row if owned by the same user OR
      // presenting the same browser ECDH public key (device account switch).
      const [row] = await tx`
        INSERT INTO push_subscriptions (
          user_id, workspace_id, endpoint, p256dh, auth, user_agent,
          notify_studies, notify_watchlist, notify_signals
        )
        VALUES (
          ${user.id}::uuid, ${ws}::uuid, ${validated.endpoint},
          ${validated.keys.p256dh}, ${validated.keys.auth}, ${ua},
          ${notifyStudies}, ${notifyWatchlist}, ${notifySignals}
        )
        ON CONFLICT (endpoint) DO UPDATE SET
          user_id = excluded.user_id,
          workspace_id = excluded.workspace_id,
          p256dh = excluded.p256dh,
          auth = excluded.auth,
          user_agent = excluded.user_agent,
          notify_studies = excluded.notify_studies,
          notify_watchlist = excluded.notify_watchlist,
          notify_signals = excluded.notify_signals,
          last_error = NULL,
          updated_at = now()
        WHERE push_subscriptions.user_id = excluded.user_id
           OR push_subscriptions.p256dh = excluded.p256dh
        RETURNING id, endpoint, notify_studies, notify_watchlist, notify_signals
      `;
      if (!row) {
        throw new PushValidationError("Push endpoint conflict.");
      }

      // Trim oldest subscriptions beyond per-user device cap.
      await tx`
        DELETE FROM push_subscriptions
        WHERE user_id = ${user.id}::uuid
          AND id NOT IN (
            SELECT id FROM push_subscriptions
            WHERE user_id = ${user.id}::uuid
            ORDER BY updated_at DESC
            LIMIT ${MAX_SUBSCRIPTIONS_PER_USER}
          )
      `;
      return row;
    });

    return NextResponse.json(
      {
        ok: true,
        subscription: {
          id: saved.id,
          endpoint: saved.endpoint,
          notifyStudies: saved.notify_studies,
          notifyWatchlist: saved.notify_watchlist,
          notifySignals: saved.notify_signals,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(req: Request) {
  const user = await currentUser();
  const ws = await currentWorkspaceId();
  if (!user || !ws) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const body = (await readJsonLimited(req, 16_384)) as Record<string, unknown>;
    const endpoint = validatePushEndpoint(body?.endpoint);
    const rows = await sql`
      UPDATE push_subscriptions SET
        notify_studies = COALESCE(${typeof body.notifyStudies === "boolean" ? body.notifyStudies : null}, notify_studies),
        notify_watchlist = COALESCE(${typeof body.notifyWatchlist === "boolean" ? body.notifyWatchlist : null}, notify_watchlist),
        notify_signals = COALESCE(${typeof body.notifySignals === "boolean" ? body.notifySignals : null}, notify_signals),
        workspace_id = ${ws}::uuid,
        updated_at = now()
      WHERE user_id = ${user.id}::uuid AND endpoint = ${endpoint}
      RETURNING id, endpoint, notify_studies, notify_watchlist, notify_signals
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: "Subscription not found." }, { status: 404 });
    }
    const updated = rows[0];
    return NextResponse.json({
      ok: true,
      subscription: {
        id: updated.id,
        endpoint: updated.endpoint,
        notifyStudies: updated.notify_studies,
        notifyWatchlist: updated.notify_watchlist,
        notifySignals: updated.notify_signals,
      },
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(req: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const body = (await readJsonLimited(req, 16_384).catch(() => ({}))) as Record<string, unknown>;
    const urlEndpoint = new URL(req.url).searchParams.get("endpoint");
    const rawEndpoint = typeof body?.endpoint === "string" ? body.endpoint : urlEndpoint;

    if (rawEndpoint) {
      const endpoint = validatePushEndpoint(rawEndpoint);
      await sql`
        DELETE FROM push_subscriptions
        WHERE user_id = ${user.id}::uuid AND endpoint = ${endpoint}
      `;
    } else if (body?.all === true) {
      await sql`DELETE FROM push_subscriptions WHERE user_id = ${user.id}::uuid`;
    } else {
      throw new PushValidationError("Specify endpoint or { all: true } to unsubscribe.");
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}
