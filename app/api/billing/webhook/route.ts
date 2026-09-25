import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { billingSql } from "@/lib/db";
import { stripe } from "@/lib/stripe";

// Stripe webhook — the ONLY path that grants access or credits. Signature
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

async function fulfil(session: Stripe.Checkout.Session) {
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
    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      const pi = paymentIntentId(charge.payment_intent);
      // Full refunds only reverse the grant; partial refunds are a manual
      // judgement call and are left for the operator.
      if (charge.refunded && pi) {
        const [row] = await billingSql`SELECT stocks.refund_payment(${pi}) AS reversed`;
        outcome = row.reversed ? "reversed" : "replay";
      } else {
        outcome = "partial_refund_ignored";
      }
      break;
    }
  }

  return NextResponse.json({ received: true, outcome });
}
