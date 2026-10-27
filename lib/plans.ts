// An account's plan as the admin console shows it. Today that's derived from
// the one-time access flag and the trial; membership tiers will add their own
// keys here, so screens should go through accountPlan rather than reading
// access_granted / trial_ends_at themselves.

export type PlanKey = "paid" | "trial" | "expired";

export type PlanFields = {
  access_granted: boolean;
  trial_ends_at: string | Date | null;
};

export type AccountPlan = { key: PlanKey; label: string; detail: string | null };

export function accountPlan(p: PlanFields, now = Date.now()): AccountPlan {
  if (p.access_granted) return { key: "paid", label: "Paid access", detail: null };
  const ends = p.trial_ends_at ? new Date(p.trial_ends_at).getTime() : null;
  const daysLeft = ends === null ? null : Math.ceil((ends - now) / 86_400_000);
  if (daysLeft !== null && daysLeft > 0) {
    return { key: "trial", label: "Trial", detail: `${daysLeft} ${daysLeft === 1 ? "day" : "days"} left` };
  }
  return { key: "expired", label: "Trial expired", detail: null };
}
