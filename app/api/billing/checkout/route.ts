import { NextResponse } from "next/server";
import { currentUser, currentWorkspaceId } from "@/lib/workspace";
import { getMembership } from "@/lib/membership";
import { isPlanId, PLANS } from "@/lib/plans";
import { stripe, planPrice } from "@/lib/stripe";
import { appOrigin } from "@/lib/origin";

// Starts the monthly subscription for the coaching tier an admin enrolled the
// member in ({ kind: "plan", plan }), or moves a live subscription onto that
// tier after an upgrade ({ kind: "switch" }). The program's upfront fee is
// collected outside the app, so a member can't buy a tier they aren't
// enrolled in. Nothing is granted here: only the signature-verified webhook
// fulfils, from the metadata this route stamps on the subscription. Credit
// packs and the old one-time access unlock are no longer sold.
export async function POST(req: Request) {
  const user = await currentUser();
  const ws = await currentWorkspaceId();
  if (!user || !ws) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const origin = appOrigin(req);
  const { billing, tier, admin } = await getMembership(user.id, ws);
  const enrolled = billing.enrolledPlan;
  const sub = billing.subscription;

  if (body.kind !== "plan" && body.kind !== "switch") {
    return NextResponse.json({ error: "kind must be plan or switch" }, { status: 400 });
  }
  if (tier === "founding" && !admin) {
    return NextResponse.json({ error: "You're a Founding member and already have every feature." }, { status: 409 });
  }
  if (!enrolled) {
    return NextResponse.json(
      { error: "Your enrolment hasn't been confirmed yet. Once your program fee is received we'll switch your membership on here.", code: "not_enrolled" },
      { status: 403 }
    );
  }

  if (body.kind === "switch") {
    if (!sub?.live) return NextResponse.json({ error: "You don't have a plan to switch yet." }, { status: 409 });
    if (sub.plan === enrolled) return NextResponse.json({ error: `You're already on ${PLANS[enrolled].name}.` }, { status: 409 });
    const current = await stripe().subscriptions.retrieve(sub.stripeSubscriptionId);
    const item = current.items.data[0];
    if (!item) return NextResponse.json({ error: "We couldn't read your subscription. Contact support." }, { status: 409 });
    // Invoice the difference now so the webhook tops up the plan's credits
    // straight away (invoice.paid, billing_reason subscription_update).
    await stripe().subscriptions.update(sub.stripeSubscriptionId, {
      items: [{ id: item.id, price: planPrice(enrolled) }],
      proration_behavior: "always_invoice",
      cancel_at_period_end: false,
      metadata: { ...current.metadata, plan: enrolled },
    });
    return NextResponse.json({ url: `${origin}/billing?checkout=success` });
  }

  const plan = body.plan;
  if (!isPlanId(plan)) return NextResponse.json({ error: "Unknown plan" }, { status: 400 });
  if (plan !== enrolled) {
    return NextResponse.json(
      { error: `You're enrolled in ${PLANS[enrolled].name}. To move to ${PLANS[plan].name}, contact us to upgrade your program.`, code: "not_enrolled" },
      { status: 403 }
    );
  }
  // One subscription per member.
  if (sub?.live) {
    return NextResponse.json({ error: `You're already on ${PLANS[sub.plan].name}.`, code: "has_plan" }, { status: 409 });
  }
  const metadata = { workspace_id: ws, user_id: user.id, kind: "plan", plan };
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: planPrice(plan), quantity: 1 }],
    client_reference_id: ws,
    // Reuse the Stripe customer from an earlier (cancelled) plan.
    ...(sub?.stripeCustomerId ? { customer: sub.stripeCustomerId } : { customer_email: user.email ?? undefined }),
    metadata,
    subscription_data: { metadata },
    allow_promotion_codes: true,
    success_url: `${origin}/billing?checkout=success`,
    cancel_url: `${origin}/billing?checkout=cancelled`,
  });
  return NextResponse.json({ url: session.url });
}
