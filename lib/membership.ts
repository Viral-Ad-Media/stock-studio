import { cache } from "react";
import { getBillingState, type BillingState } from "@/lib/billing";
import { isSuperAdmin } from "@/lib/admin";
import { currentUser, currentWorkspaceId } from "@/lib/workspace";
import { effectiveTier, entitlementsFor, type Entitlements, type Tier } from "@/lib/plans";

export type Membership = { billing: BillingState; admin: boolean; tier: Tier; ent: Entitlements };

// Billing state + the member's effective tier and what it unlocks. Cached per
// request, like getBillingState and isSuperAdmin.
export const getMembership = cache(async (userId: string, workspaceId: string): Promise<Membership> => {
  const [billing, admin] = await Promise.all([getBillingState(userId, workspaceId), isSuperAdmin(userId)]);
  const tier = effectiveTier({
    accessGranted: billing.accessGranted,
    trialActive: billing.trialActive,
    plan: billing.subscription?.live ? billing.subscription.plan : null,
    admin,
  });
  return { billing, admin, tier, ent: entitlementsFor(tier) };
});

// For server components: the signed-in member's membership, or null.
export async function currentMembership(): Promise<Membership | null> {
  const user = await currentUser();
  const ws = user ? await currentWorkspaceId() : null;
  return user && ws ? getMembership(user.id, ws) : null;
}
