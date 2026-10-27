import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { billingSql } from "@/lib/db";
import { stripe, planForPrice } from "@/lib/stripe";
import { planCreditGrant } from "@/lib/plans";

// Stripe webhook — the ONLY path that grants plans or credits. Signature
// verified against STRIPE_WEBHOOK_SECRET; excluded from proxy.ts's
// session gate. Fulfilment is one Postgres RPC per event, idempotent on the
// Checkout Session id, so a replay only observes the completed result.
// Any DB failure returns 500 so Stripe retries. Runs as the stocks_billing
// role (BILLING_DATABASE_URL) — the only role allowed to grant.
export const dynamic = "force-dynamic";

function paymentIntentId(pi: string | Stripe.PaymentIntent | null): string | null {
  if (!pi) return null;
  return typeof pi === "string" ? pi : pi.id;
}

function idOf(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null;
  return typeof v === "string" ? v : v.id;
}

// Records a subscription's current state. Always re-read from Stripe, so an
// out-of-order or replayed event can only write the latest truth. Returns the
// stored plan, or null for a subscription that isn't one of ours.
async function syncSubscription(subscriptionId: string) {
  const sub = await stripe().subscriptions.retrieve(subscriptionId);
  const md = sub.metadata ?? {};
  const item = sub.items.data[0];
  const price = planForPrice(item?.price?.id);
  if (!md.workspace_id || !md.user_id || !price) {
    console.warn("stripe webhook: subscription without Stock Studio metadata or a known plan price", sub.id);
    return null;
  }
  const periodEnd = item?.current_period_end ? new Date(item.current_period_end * 1000) : null;
  const [row] = await billingSql`
    SELECT stocks.upsert_subscription(
      ${md.user_id}, ${md.workspace_id}, ${idOf(sub.customer)}, ${sub.id},
      ${price.plan}, ${price.interval}, ${sub.status}, ${periodEnd}, ${sub.cancel_at_period_end}
    ) AS stored
  `;
  return row.stored ? price : null;
}

// A paid subscription invoice grants the plan's credits once. The first
// invoice and each renewal start a new period (rollover + expiry); a
// prorated upgrade only tops up the difference.
async function grantInvoice(invoice: Stripe.Invoice) {
  const subscriptionId = idOf(invoice.parent?.subscription_details?.subscription);
  if (!subscriptionId) return "ignored";
  const price = await syncSubscription(subscriptionId);
  if (!price) return "ignored";
  const reason = invoice.billing_reason;
  const mode = reason === "subscription_create" || reason === "subscription_cycle" ? "renewal" : reason === "subscription_update" ? "upgrade" : null;
  if (!mode) return "ignored";
  const { credits, carryCap } = planCreditGrant(price.plan, price.interval);
  await billingSql`
    SELECT stocks.grant_plan_credits(${subscriptionId}, ${invoice.id}, ${mode}, ${credits}, ${carryCap})
  `;
  return "plan_credits_granted";
}

async function fulfil(session: Stripe.Checkout.Session) {
  if (session.mode === "subscription") {
    // The plan itself is recorded from the subscription; credits come with invoice.paid.
    const subscriptionId = idOf(session.subscription);
    return subscriptionId && (await syncSubscription(subscriptionId)) ? "subscription_recorded" : "ignored";
  }
  if (session.payment_status !== "paid") return "not_paid_yet"; // async methods finish later
  const md = session.metadata ?? {};
  if (!md.workspace_id || !md.user_id || (md.kind !== "access" && md.kind !== "credits")) {
    // Not one of ours (or created by hand in the dashboard) — acknowledge, don't grant.
    console.warn("stripe webhook: checkout session without Stock Studio metadata", session.id);
    return "ignored";
  }
  const [row] = await billingSql`
    SELECT stocks.fulfill_checkout(
      ${session.id}, ${paymentIntentId(session.payment_intent)}, ${md.workspace_id}, ${md.user_id},
      ${md.kind}, ${session.amount_total ?? 0}, ${Number(md.credits ?? 0)}
    ) AS fulfilled
  `;
  return row.fulfilled ? "fulfilled" : "replay";
}

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = req.headers.get("stripe-signature");
  if (!secret || !signature) return NextResponse.json({ error: "unauthorized" }, { status: 400 });

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(raw, signature, secret);
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  let outcome = "ignored";
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      outcome = await fulfil(event.data.object as Stripe.Checkout.Session);
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      outcome = (await syncSubscription((event.data.object as Stripe.Subscription).id)) ? "subscription_recorded" : "ignored";
      break;
    case "invoice.paid":
      outcome = await grantInvoice(event.data.object as Stripe.Invoice);
      break;
    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      const pi = paymentIntentId(charge.payment_intent);
      // Full refunds only reverse the grant; partial refunds are a manual
      // judgement call and are left for the operator. Plan invoices aren't in
      // stocks.payments, so their refunds are left for the operator too
      // (cancel the subscription in Stripe to end the plan).
      if (charge.refunded && pi) {
        const [row] = await billingSql`SELECT stocks.refund_payment(${pi}) AS reversed`;
        outcome = row.reversed ? "refund_recorded" : "replay";
      } else {
        outcome = "partial_refund_ignored";
      }
      break;
    }
  }

  return NextResponse.json({ received: true, outcome });
}
