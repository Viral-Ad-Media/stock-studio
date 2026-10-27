import { NextResponse } from "next/server";
import { currentWorkspaceId } from "@/lib/workspace";
import { liveTargets, refreshTargets } from "@/lib/live-data";

export const maxDuration = 60;

// Free, read-only refresh of live market data for finished studies and
// watchlist rows: { scope: "study" | "watchlist", id } for one row, or
// { scope: "all" } for every ready study and watchlist row in the workspace.
// No credits and no research run; the study text itself is never changed.
export async function POST(req: Request) {
  const ws = await currentWorkspaceId();
  if (!ws) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const id = Number(body.id);
  let scope: Parameters<typeof liveTargets>[1];
  if (body.scope === "all") scope = { kind: "all" };
  else if ((body.scope === "study" || body.scope === "watchlist") && Number.isInteger(id) && id > 0) scope = { kind: body.scope, id };
  else return NextResponse.json({ error: "Unknown refresh scope" }, { status: 400 });

  const targets = await liveTargets(ws, scope);
  if (!targets.length) return NextResponse.json({ refreshed: 0, failed: [], upToDate: true });
  const result = await refreshTargets(ws, targets);
  if (result.refreshed === 0 && result.failed.length) {
    return NextResponse.json(
      { error: "Market data is unavailable right now. Try again in a few minutes.", ...result },
      { status: 503 },
    );
  }
  return NextResponse.json(result);
}
