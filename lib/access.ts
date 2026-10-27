import { NextResponse } from "next/server";
import { currentUser, currentWorkspaceId } from "@/lib/workspace";
import { getMembership, type Membership } from "@/lib/membership";
import { PLANS, type PlanId } from "@/lib/plans";
import type { BillingState } from "@/lib/billing";

// Shared gate for every route that queues paid work: signed in, has a
// workspace, and has app access (a live plan, Founding access, or trial
// still running). The credit check itself happens atomically at charge
// time, not here; plan limits are checked by each route from `membership.ent`.
export async function requireAppAccess(): Promise<
  | { ok: true; userId: string; ws: string; billing: BillingState; membership: Membership }
  | { ok: false; response: NextResponse }
> {
  const user = await currentUser();
  const ws = await currentWorkspaceId();
  if (!user || !ws) {
    return { ok: false, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  const membership = await getMembership(user.id, ws);
  if (!membership.billing.hasAccess && !membership.admin) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "You don't have an active plan. Pick Silver, Gold or Diamond on the Billing page to keep queuing reports.", code: "no_access" },
        { status: 402 }
      ),
    };
  }
  return { ok: true, userId: user.id, ws, billing: membership.billing, membership };
}

export function insufficientCreditsResponse() {
  return NextResponse.json(
    { error: "Not enough credits for this report — buy a credit pack on the Billing page.", code: "no_credits" },
    { status: 402 }
  );
}

// A feature or limit the member's plan doesn't include.
export function planRequiredResponse(message: string, plan: PlanId) {
  return NextResponse.json(
    { error: `${message} Upgrade to ${PLANS[plan].name} on the Billing page.`, code: "plan_required", plan },
    { status: 403 }
  );
}
