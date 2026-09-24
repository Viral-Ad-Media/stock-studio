import { createHash, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { runWorkerLoop } from "@/lib/engine/worker";

// Called by a Supabase Postgres trigger (instant, on stocks.jobs INSERT via
// pg_net) and a pg_cron backstop (every ~1 min) — see the
// stocks_automated_worker migration. Not called by any client-facing code;
// authenticated by a shared secret, not a user session, so this route is
// excluded from middleware.ts's auth gate.
export const dynamic = "force-dynamic";
export const maxDuration = 300; // tune to the actual deploy host's limit once chosen

export async function POST(req: NextRequest) {
  if (!secretMatches(req.headers.get("x-engine-secret"), process.env.ENGINE_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runWorkerLoop();
  return NextResponse.json({ ok: true, ...result });
}

// Constant-time compare (hash first so lengths match). Fails closed when the
// env var is unset or empty.
function secretMatches(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
