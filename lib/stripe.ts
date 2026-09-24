import Stripe from "stripe";

let _stripe: Stripe | null = null;
export function stripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  _stripe = new Stripe(key);
  return _stripe;
}

// Hosted-Checkout prices, created in the Stripe dashboard (one-time payments).
export function priceFor(kind: "access" | "credits"): string {
  const id = kind === "access" ? process.env.STRIPE_PRICE_ACCESS : process.env.STRIPE_PRICE_CREDIT_PACK;
  if (!id) throw new Error(`Stripe price for "${kind}" is not configured`);
  return id;
}
