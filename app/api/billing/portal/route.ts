import { NextResponse } from "next/server";
import { currentUser, currentWorkspaceId } from "@/lib/workspace";
import { getBillingState } from "@/lib/billing";
import { stripe } from "@/lib/stripe";
import { appOrigin } from "@/lib/origin";

// Opens Stripe's customer portal: update the card, see invoices, cancel.
// Plan switching must be off in the portal's settings: tiers change only
// after an admin confirms the upgrade (checkout route, kind "switch").
export async function POST(req: Request) {
  const user = await currentUser();
  const ws = await currentWorkspaceId();
  if (!user || !ws) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const billing = await getBillingState(user.id, ws);
  const customer = billing.subscription?.stripeCustomerId;
  if (!customer) return NextResponse.json({ error: "You don't have a plan to manage yet." }, { status: 404 });

  const session = await stripe().billingPortal.sessions.create({
    customer,
    return_url: `${appOrigin(req)}/billing`,
  });
  return NextResponse.json({ url: session.url });
}
