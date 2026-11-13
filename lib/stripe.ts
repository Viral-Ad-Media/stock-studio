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

// Hosted-Checkout prices, created in the Stripe dashboard: one recurring
// monthly price per plan, e.g. STRIPE_PRICE_GOLD_MONTHLY. The program's
// upfront fee is collected outside the app and has no price here.
function planEnv(plan: PlanId, interval: BillingInterval): string {
  return `STRIPE_PRICE_${plan.toUpperCase()}_${interval === "year" ? "YEARLY" : "MONTHLY"}`;
}

export function planPrice(plan: PlanId): string {
  const name = planEnv(plan, "month");
  const id = process.env[name];
  if (!id) throw new Error(`${name} is not configured`);
  return id;
}

// Reverse lookup for the webhook: which plan a subscription's price is.
// Unknown prices return null and the webhook ignores them. The yearly
// variables are only read here, for subscriptions started before yearly
// billing was withdrawn.
export function planForPrice(priceId: string | null | undefined): { plan: PlanId; interval: BillingInterval } | null {
  if (!priceId) return null;
  for (const plan of PLAN_IDS) {
    for (const interval of ["month", "year"] as const) {
      if (process.env[planEnv(plan, interval)] === priceId) return { plan, interval };
    }
  }
  return null;
}
