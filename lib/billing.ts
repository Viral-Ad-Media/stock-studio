import { cache } from "react";
import type { TransactionSql } from "postgres";
import { sql } from "@/lib/db";
import { isPlanId, type BillingInterval, type Entitlements, type PlanId } from "@/lib/plans";

// Billing state reads + the two job-lifecycle credit hooks. Every *write* to
// billing state goes through a SECURITY DEFINER RPC (stocks_billing
// migration) — the stocks_app role has no direct INSERT/UPDATE on the ledger,
// payments, or profiles.access_granted, so don't try to add one here.

export { creditCost } from "@/lib/shared";

// Credits granted per purchased pack (the pack's price lives in Stripe,
// STRIPE_PRICE_CREDIT_PACK). The count is stamped into the Checkout Session
// metadata by our own server, so the webhook never trusts a client number.
export const CREDITS_PER_PACK = Number(process.env.STRIPE_CREDITS_PER_PACK ?? 10);

// Credits in one pack for this member (Diamond packs carry 50% more).
export function packCreditsFor(ent: Entitlements): number {
  return Math.round(CREDITS_PER_PACK * ent.packMultiplier);
}

export type Subscription = {
  plan: PlanId;
  interval: BillingInterval;
  status: string;
  live: boolean; // active, trialing or past_due
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  stripeCustomerId: string;
};

export type BillingState = {
  accessGranted: boolean; // Founding member (old one-time unlock, or granted by an admin)
  trialEndsAt: string | null;
  trialActive: boolean;
  hasAccess: boolean;
  balance: number;
  subscription: Subscription | null;
};

export const getBillingState = cache(async (userId: string, workspaceId: string): Promise<BillingState> => {
  const [profile] = await sql`
    SELECT access_granted, trial_ends_at, trial_ends_at > now() AS trial_active
    FROM profiles WHERE id = ${userId}
  `;
  const [{ balance }] = await sql`
    SELECT COALESCE(SUM(delta), 0)::int AS balance FROM credits_ledger WHERE workspace_id = ${workspaceId}
  `;
  const [sub] = await sql`
    SELECT plan, billing_interval, status, subscription_is_live(status) AS live,
      current_period_end, cancel_at_period_end, stripe_customer_id
    FROM subscriptions WHERE user_id = ${userId}
  `;
  const accessGranted = Boolean(profile?.access_granted);
  const trialActive = Boolean(profile?.trial_active);
  const subscription: Subscription | null =
    sub && isPlanId(sub.plan)
      ? {
          plan: sub.plan,
          interval: sub.billing_interval === "year" ? "year" : "month",
          status: String(sub.status),
          live: Boolean(sub.live),
          currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end).toISOString() : null,
          cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
          stripeCustomerId: String(sub.stripe_customer_id),
        }
      : null;
  return {
    accessGranted,
    trialEndsAt: profile?.trial_ends_at ? new Date(profile.trial_ends_at).toISOString() : null,
    trialActive,
    hasAccess: accessGranted || trialActive || Boolean(subscription?.live),
    balance: Number(balance),
    subscription,
  };
});

// Raised by stocks.charge_job_credits when the balance is short.
export const INSUFFICIENT_CREDITS = "SS402";

export function isInsufficientCredits(err: unknown): boolean {
  return (err as { code?: string })?.code === INSUFFICIENT_CREDITS;
}

// Debit a just-inserted job's cost. Must run inside the same transaction as
// the job INSERT (pass the tx) so a short balance rolls the job back too.
export async function chargeJobCredits(tx: TransactionSql<{}>, jobId: number, cost: number) {
  await tx`SELECT charge_job_credits(${jobId}, ${cost})`;
}

// A second open job of a kind that allows only one (see the
// jobs_one_open_* partial unique indexes) — the whole insert rolls back, so
// nothing is charged.
export function isDuplicateOpenJob(err: unknown): boolean {
  return (err as { code?: string })?.code === "23505";
}

// Give a job's charge back (failed, or removed from the queue before it was
// built). Idempotent and a no-op for jobs that were never charged.
// Pass the tx to refund inside the same transaction as the delete that
// triggered it, so a crash between the two can't lose the refund.
export async function refundJobCredits(jobId: number, tx: TransactionSql<{}> | typeof sql = sql) {
  await tx`SELECT refund_job_credits(${jobId})`;
}
