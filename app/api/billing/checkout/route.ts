import { NextResponse } from "next/server";
import { currentUser, currentWorkspaceId } from "@/lib/workspace";
import { packCreditsFor } from "@/lib/billing";
import { getMembership } from "@/lib/membership";
import { isPlanId, PLANS } from "@/lib/plans";
import { stripe, priceFor, planPrice } from "@/lib/stripe";
import { appOrigin } from "@/lib/origin";

// Starts a hosted Stripe Checkout (redirect) for a plan subscription
// ({ kind: "plan", plan, interval }) or a credit pack ({ kind: "credits" }).
// Nothing is granted here — only the signature-verified webhook fulfils, from
// the metadata this route stamps on the session/subscription. The old
// one-time access unlock is no longer sold.
export async function POST(req: Request) {
  const user = await currentUser();
  const ws = await currentWorkspaceId();
  if (!user || !ws) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const origin = appOrigin(req);
  const { billing, ent, tier } = await getMembership(user.id, ws);

  if (body.kind === "plan") {
    const plan = body.plan;
    const interval = body.interval === "year" ? "year" : "month";
    if (!isPlanId(plan)) return NextResponse.json({ error: "Unknown plan" }, { status: 400 });
    if (tier === "founding") {
      return NextResponse.json({ error: "You're a Founding member and already have every Diamond feature." }, { status: 409 });
    }
    // One subscription per member; switching plans happens in the Stripe
    // customer portal so Stripe prorates it.
    if (billing.subscription?.live) {
      return NextResponse.json(
        { error: `You're already on ${PLANS[billing.subscription.plan].name}. Use "Manage plan" to switch.`, code: "has_plan" },
        { status: 409 }
      );
    }
    const metadata = { workspace_id: ws, user_id: user.id, kind: "plan", plan };
    const session = await stripe().checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: planPrice(plan, interval), quantity: 1 }],
      client_reference_id: ws,
      // Reuse the Stripe customer from an earlier (cancelled) plan.
      ...(billing.subscription?.stripeCustomerId
        ? { customer: billing.subscription.stripeCustomerId }
        : { customer_email: user.email ?? undefined }),
      metadata,
      subscription_data: { metadata },
      allow_promotion_codes: true,
      success_url: `${origin}/billing?checkout=success`,
      cancel_url: `${origin}/billing?checkout=cancelled`,
    });
    return NextResponse.json({ url: session.url });
  }

  if (body.kind !== "credits") return NextResponse.json({ error: "kind must be plan or credits" }, { status: 400 });

  const metadata = {
    workspace_id: ws,
    user_id: user.id,
    kind: "credits",
    credits: String(packCreditsFor(ent)),
  };
  const session = await stripe().checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: priceFor("credits"), quantity: 1 }],
    client_reference_id: ws,
    customer_email: user.email ?? undefined,
    metadata,
    payment_intent_data: { metadata },
    success_url: `${origin}/billing?checkout=success`,
    cancel_url: `${origin}/billing?checkout=cancelled`,
  });

  return NextResponse.json({ url: session.url });
}
