// Membership plans and what each one unlocks. Single source of truth for
// the gates (pages and API routes), the Stripe webhook's credit grants, and
// the pricing/billing pages. Client-safe: no database or Stripe imports.
//
// The plans are tiers of the coaching program. The upfront program fee is
// collected outside the app; an admin then enrols the member in a tier
// (profiles.enrolled_plan) and the app bills only the monthly fee.
// Silver gets the trader's signals and the research core; Gold and Diamond
// unlock everything in the app and differ only in coaching time.

export const PLAN_IDS = ["silver", "gold", "diamond"] as const;
export type PlanId = (typeof PLAN_IDS)[number];
// Plans are sold monthly. "year" remains for subscriptions started before
// yearly billing was withdrawn.
export type BillingInterval = "month" | "year";

// founding: bought the old one-time unlock (or was granted access by an
// admin) and keeps every feature. trial: free trial, every feature except
// live signals. none: trial over and no plan.
export type Tier = PlanId | "founding" | "trial" | "none";

// Every paid tier sees every call live; the trial and lapsed accounts see none.
export type SignalAccess = "all" | "none";

export type Entitlements = {
  // Study formats this tier may queue; null = every format.
  variants: readonly string[] | null;
  watchlistMax: number | null; // null = unlimited
  maxOpenJobs: number;
  // Minimum hours between free live-data refreshes of the same study or
  // watchlist row; 0 = no limit.
  liveRefreshCooldownHours: number;
  setupsLive: boolean; // today's setup-bot matches (the track record is open to all)
  gamma: boolean;
  sweeps: boolean;
  leaps: boolean;
  journalAnalysis: boolean;
  signals: SignalAccess;
};

export type Plan = {
  id: PlanId;
  name: string;
  monthlyUsd: number;
  // The program fee paid outside the app before an admin enrols the member.
  upfront: string;
  // Live sessions with the trader that come with the tier, if any.
  coaching: string | null;
  monthlyCredits: number;
  // Unused plan credits carried into the next period, in months of allowance.
  carryOverMonths: number;
  tagline: string;
  highlights: string[];
};

// The trader who posts the signals and runs the coaching sessions.
export const COACH_NAME = "Luqman";

export const PLANS: Record<PlanId, Plan> = {
  silver: {
    id: "silver",
    name: "Silver",
    monthlyUsd: 97,
    upfront: "$497 one-time",
    coaching: null,
    monthlyCredits: 10,
    carryOverMonths: 0,
    tagline: "Every signal live, with the research core.",
    highlights: [
      "Every signal, live, the moment it's posted",
      "10 research credits every month",
      "Quick takes, full studies and comparisons",
      "Watchlist of up to 10 tickers",
      "Today, Market and earnings calendar",
      "Setup bot track record and a basic trading journal",
    ],
  },
  gold: {
    id: "gold",
    name: "Gold",
    monthlyUsd: 47,
    upfront: "$5,000 program, $2,497 to start",
    coaching: `Weekly session with ${COACH_NAME} every Thursday`,
    monthlyCredits: 30,
    carryOverMonths: 1,
    tagline: `Everything in the app, plus a weekly session with ${COACH_NAME}.`,
    highlights: [
      `A session with ${COACH_NAME} every Thursday`,
      "Every signal, live, the moment it's posted",
      "30 research credits every month, unused credits roll over a month",
      "Every study format and an unlimited watchlist",
      "Live setup bots, gamma exposure and the LEAPS workspace",
      "Trading journal with decision analysis",
      "The Sweep Scanner",
    ],
  },
  diamond: {
    id: "diamond",
    name: "Diamond",
    monthlyUsd: 47,
    upfront: "$4,997 upfront",
    coaching: `Sessions with ${COACH_NAME} Monday to Friday`,
    monthlyCredits: 75,
    carryOverMonths: 1,
    tagline: `Everything in the app, plus ${COACH_NAME} every weekday.`,
    highlights: [
      `Sessions with ${COACH_NAME} Monday to Friday`,
      "Everything in Silver and Gold",
      "75 research credits every month, unused credits roll over a month",
      "Every signal, live, the moment it's posted",
    ],
  },
};

// Silver's study formats. Every other tier with access gets all of them.
export const SILVER_VARIANTS = ["quick_take", "full", "comparison", "earnings_update", "movers_digest", "watchlist_entry"] as const;

// Everything in the app: Gold, Diamond and Founding members.
const FULL: Entitlements = {
  variants: null,
  watchlistMax: null,
  maxOpenJobs: 10,
  liveRefreshCooldownHours: 0,
  setupsLive: true,
  gamma: true,
  sweeps: true,
  leaps: true,
  journalAnalysis: true,
  signals: "all",
};

// Signals and the research core; the rest is locked until an upgrade.
const SILVER: Entitlements = {
  variants: SILVER_VARIANTS,
  watchlistMax: 10,
  maxOpenJobs: 3,
  liveRefreshCooldownHours: 24,
  setupsLive: false,
  gamma: false,
  sweeps: false,
  leaps: false,
  journalAnalysis: false,
  signals: "all",
};

export function entitlementsFor(tier: Tier): Entitlements {
  switch (tier) {
    case "diamond":
    case "gold":
    case "founding":
      return FULL;
    case "trial":
      // Every feature, but the trader's calls never go out for free.
      return { ...FULL, signals: "none" };
    case "silver":
      return SILVER;
    case "none":
      return { ...SILVER, signals: "none" };
  }
}

const PLAN_RANK: Record<PlanId, number> = { silver: 0, gold: 1, diamond: 2 };

// Super admins see everything; otherwise founding beats a subscription
// (they keep every feature even if they also subscribe), a live subscription
// beats the trial. A subscription never unlocks more than the tier an admin
// enrolled the member in, so switching price in Stripe can't skip the
// program fee.
export function effectiveTier(input: {
  accessGranted: boolean;
  trialActive: boolean;
  plan: PlanId | null; // a live subscription's plan, or null
  enrolledPlan?: PlanId | null;
  admin?: boolean;
}): Tier {
  if (input.admin || input.accessGranted) return "founding";
  if (input.plan) {
    const enrolled = input.enrolledPlan;
    return enrolled && PLAN_RANK[enrolled] < PLAN_RANK[input.plan] ? enrolled : input.plan;
  }
  return input.trialActive ? "trial" : "none";
}

export const TIER_LABEL: Record<Tier, string> = {
  silver: "Silver",
  gold: "Gold",
  diamond: "Diamond",
  founding: "Founding member",
  trial: "Free trial",
  none: "No plan",
};

// The cheapest plan that unlocks a feature, for upgrade prompts.
export type Feature = "gamma" | "sweeps" | "leaps" | "setupsLive" | "journalAnalysis" | "allVariants" | "signalsLive";
export const FEATURE_PLAN: Record<Feature, PlanId> = {
  gamma: "gold",
  leaps: "gold",
  setupsLive: "gold",
  journalAnalysis: "gold",
  allVariants: "gold",
  sweeps: "gold",
  signalsLive: "silver",
};

export function canQueueVariant(ent: Entitlements, variant: string): boolean {
  return ent.variants == null || ent.variants.includes(variant);
}

// Credits granted for one paid invoice, and how many unused plan credits may
// carry into the new period. A legacy yearly subscription gets the year's
// credits up front.
export function planCreditGrant(plan: PlanId, interval: BillingInterval): { credits: number; carryCap: number } {
  const p = PLANS[plan];
  const months = interval === "year" ? 12 : 1;
  return { credits: p.monthlyCredits * months, carryCap: p.monthlyCredits * months * p.carryOverMonths };
}

export function isPlanId(v: unknown): v is PlanId {
  return typeof v === "string" && (PLAN_IDS as readonly string[]).includes(v);
}

// An account's plan as the admin console shows it, from the raw profile and
// subscription columns. Screens go through accountPlan rather than reading
// access_granted / trial_ends_at / subscriptions themselves.
export type PlanKey = PlanId | "founding" | "trial" | "expired";

export type PlanFields = {
  access_granted: boolean;
  trial_ends_at: string | Date | null;
  // The member's subscription, if any (stocks.subscriptions).
  sub_plan?: string | null;
  sub_status?: string | null;
  // The tier an admin enrolled the member in (profiles.enrolled_plan).
  enrolled_plan?: string | null;
};

export type AccountPlan = { key: PlanKey; label: string; detail: string | null };

const LIVE_STATUSES = ["active", "trialing", "past_due"];

export function accountPlan(p: PlanFields, now = Date.now()): AccountPlan {
  if (p.access_granted) return { key: "founding", label: "Founding member", detail: null };
  const enrolled = isPlanId(p.enrolled_plan) ? p.enrolled_plan : null;
  if (isPlanId(p.sub_plan) && p.sub_status && LIVE_STATUSES.includes(p.sub_status)) {
    const detail =
      p.sub_status === "past_due" ? "payment past due" : enrolled && enrolled !== p.sub_plan ? `enrolled in ${PLANS[enrolled].name}` : null;
    return { key: p.sub_plan, label: PLANS[p.sub_plan].name, detail };
  }
  // Enrolled by an admin but hasn't started the monthly subscription yet.
  const pending = enrolled ? `enrolled in ${PLANS[enrolled].name}, not subscribed` : null;
  const ends = p.trial_ends_at ? new Date(p.trial_ends_at).getTime() : null;
  const daysLeft = ends === null ? null : Math.ceil((ends - now) / 86_400_000);
  if (daysLeft !== null && daysLeft > 0) {
    const left = `${daysLeft} ${daysLeft === 1 ? "day" : "days"} left`;
    return { key: "trial", label: "Trial", detail: pending ? `${left} · ${pending}` : left };
  }
  return { key: "expired", label: "Trial expired", detail: pending };
}
