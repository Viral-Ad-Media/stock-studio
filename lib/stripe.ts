import Stripe from "stripe";
import { PLAN_IDS, type BillingInterval, type PlanId } from "@/lib/plans";

let _stripe: Stripe | null = null;
export function stripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  _stripe = new Stripe(key);
  return _stripe;
}

// Hosted-Checkout prices, created in the Stripe dashboard. The credit pack
// is a one-time payment; the plans are recurring prices, one monthly and
// one yearly per plan, e.g. STRIPE_PRICE_GOLD_MONTHLY.
export function priceFor(kind: "credits"): string {
  const id = process.env.STRIPE_PRICE_CREDIT_PACK;
  if (!id) throw new Error(`Stripe price for "${kind}" is not configured`);
  return id;
}

function planEnv(plan: PlanId, interval: BillingInterval): string {
  return `STRIPE_PRICE_${plan.toUpperCase()}_${interval === "year" ? "YEARLY" : "MONTHLY"}`;
}

export function planPrice(plan: PlanId, interval: BillingInterval): string {
  const name = planEnv(plan, interval);
  const id = process.env[name];
  if (!id) throw new Error(`${name} is not configured`);
  return id;
}

// Reverse lookup for the webhook: which plan a subscription's price is.
// Unknown prices return null and the webhook ignores them.
export function planForPrice(priceId: string | null | undefined): { plan: PlanId; interval: BillingInterval } | null {
  if (!priceId) return null;
  for (const plan of PLAN_IDS) {
    for (const interval of ["month", "year"] as const) {
      if (process.env[planEnv(plan, interval)] === priceId) return { plan, interval };
    }
  }
  return null;
}
