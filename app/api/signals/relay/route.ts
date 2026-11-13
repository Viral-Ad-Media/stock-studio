import { NextRequest, NextResponse } from "next/server";
import { secretMatches } from "@/lib/secret";
import { runSignalRelayOnce } from "@/lib/signal-relay-host";

// One pass of the Discord signal relay (lib/signal-relay-host.ts). Called
// once a minute by an outside scheduler, which also keeps a sleeping host
// awake; the host's own minute scheduler runs the same pass. Authenticated by
// a shared secret (SIGNAL_RELAY_SECRET in the x-relay-secret header), not a
// user session, so this route is not in proxy.ts's auth gate. It returns
// counts only: no signal text, channel ids or configuration.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!secretMatches(req.headers.get("x-relay-secret"), process.env.SIGNAL_RELAY_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const run = await runSignalRelayOnce();
    if (run.status === "not_configured") return NextResponse.json({ error: "not configured" }, { status: 503 });
    return NextResponse.json({ ok: true, ...run });
  } catch (error) {
    console.error("signal-relay: pass failed", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: "pass failed" }, { status: 500 });
  }
}
