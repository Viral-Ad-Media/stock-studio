import { NextResponse } from "next/server";
import { currentUser, currentWorkspaceId } from "@/lib/workspace";
import { getBillingState, BillingState } from "@/lib/billing";

// Shared gate for every route that queues paid work: signed in, has a
// workspace, and has app access (paid, or trial still running). The credit
// check itself happens atomically at charge time, not here.
export async function requireAppAccess(): Promise<
  | { ok: true; userId: string; ws: string; billing: BillingState }
  | { ok: false; response: NextResponse }
> {
  const user = await currentUser();
  const ws = await currentWorkspaceId();
  if (!user || !ws) {
    return { ok: false, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  const billing = await getBillingState(user.id, ws);
  if (!billing.hasAccess) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Your free trial has ended — unlock Stock Studio on the Billing page to keep queuing reports.", code: "no_access" },
        { status: 402 }
      ),
    };
  }
  return { ok: true, userId: user.id, ws, billing };
}

export function insufficientCreditsResponse() {
  return NextResponse.json(
    { error: "Not enough credits for this report — buy a credit pack on the Billing page.", code: "no_credits" },
    { status: 402 }
  );
}
