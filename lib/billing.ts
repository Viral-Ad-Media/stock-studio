import { cache } from "react";
import type { TransactionSql } from "postgres";
import { sql } from "@/lib/db";

// Billing state reads + the two job-lifecycle credit hooks. Every *write* to
// billing state goes through a SECURITY DEFINER RPC (stocks_billing
// migration) — the stocks_app role has no direct INSERT/UPDATE on the ledger,
// payments, or profiles.access_granted, so don't try to add one here.

export { creditCost } from "@/lib/shared";

// Credits granted per purchased pack (the pack's price lives in Stripe,
// STRIPE_PRICE_CREDIT_PACK). The count is stamped into the Checkout Session
// metadata by our own server, so the webhook never trusts a client number.
export const CREDITS_PER_PACK = Number(process.env.STRIPE_CREDITS_PER_PACK ?? 10);

export type BillingState = {
  accessGranted: boolean;
  trialEndsAt: string | null;
  trialActive: boolean;
  hasAccess: boolean;
  balance: number;
};

export const getBillingState = cache(async (userId: string, workspaceId: string): Promise<BillingState> => {
  const [profile] = await sql`
    SELECT access_granted, trial_ends_at, trial_ends_at > now() AS trial_active
    FROM profiles WHERE id = ${userId}
  `;
  const [{ balance }] = await sql`
    SELECT COALESCE(SUM(delta), 0)::int AS balance FROM credits_ledger WHERE workspace_id = ${workspaceId}
  `;
  const accessGranted = Boolean(profile?.access_granted);
  const trialActive = Boolean(profile?.trial_active);
  return {
    accessGranted,
    trialEndsAt: profile?.trial_ends_at ? new Date(profile.trial_ends_at).toISOString() : null,
    trialActive,
    hasAccess: accessGranted || trialActive,
    balance: Number(balance),
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

// Give a job's charge back (failed, or removed from the queue before it was
// built). Idempotent and a no-op for jobs that were never charged.
export async function refundJobCredits(jobId: number) {
  await sql`SELECT refund_job_credits(${jobId})`;
}
