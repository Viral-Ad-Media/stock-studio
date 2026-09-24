import { NextResponse } from "next/server";
import { currentUser, currentWorkspaceId } from "@/lib/workspace";
import { getBillingState, CREDITS_PER_PACK } from "@/lib/billing";
import { stripe, priceFor } from "@/lib/stripe";

// Starts a hosted Stripe Checkout (redirect) for the one-time access fee or
// a credit pack. Nothing is granted here — only the signature-verified
// webhook fulfils, from the metadata this route stamps on the session.
export async function POST(req: Request) {
  const user = await currentUser();
  const ws = await currentWorkspaceId();
  if (!user || !ws) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const kind = body.kind === "access" ? "access" : body.kind === "credits" ? "credits" : null;
  if (!kind) return NextResponse.json({ error: "kind must be access or credits" }, { status: 400 });

  if (kind === "access") {
    const billing = await getBillingState(user.id, ws);
    if (billing.accessGranted) {
      return NextResponse.json({ error: "Stock Studio is already unlocked on this account" }, { status: 409 });
    }
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;
  const metadata = {
    workspace_id: ws,
    user_id: user.id,
    kind,
    credits: kind === "credits" ? String(CREDITS_PER_PACK) : "0",
  };

  const session = await stripe().checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: priceFor(kind), quantity: 1 }],
    client_reference_id: ws,
    customer_email: user.email ?? undefined,
    metadata,
    payment_intent_data: { metadata },
    success_url: `${origin}/billing?checkout=success`,
    cancel_url: `${origin}/billing?checkout=cancelled`,
  });

  return NextResponse.json({ url: session.url });
}
