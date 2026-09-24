import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

// Per-workspace queue limits, counted from the jobs table itself — no extra
// infrastructure. They cap how much API spend one account (e.g. a throwaway
// trial signup) can trigger, on top of credits. Soft limits: two requests
// racing the last slot can both pass, which is fine at these sizes.
export const MAX_OPEN_JOBS = 10;
export const MAX_JOBS_PER_HOUR = 30;

export async function queueLimitResponse(ws: string): Promise<NextResponse | null> {
  const [r] = await sql`
    SELECT
      count(*) FILTER (WHERE status IN ('pending', 'running'))::int AS open,
      count(*) FILTER (WHERE created_at > now() - interval '1 hour')::int AS recent
    FROM jobs WHERE workspace_id = ${ws}
  `;
  if (r.open >= MAX_OPEN_JOBS) {
    return NextResponse.json(
      { error: `You have ${r.open} reports in progress — wait for some to finish before queuing more.`, code: "too_many_open" },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }
  if (r.recent >= MAX_JOBS_PER_HOUR) {
    return NextResponse.json(
      { error: `You've queued ${r.recent} reports in the last hour — please try again later.`, code: "rate_limited" },
      { status: 429, headers: { "Retry-After": "600" } }
    );
  }
  return null;
}
