// Membership plans and what each one unlocks. Single source of truth for
// the gates (pages and API routes), the Stripe webhook's credit grants, and
// the pricing/billing pages. Client-safe: no database or Stripe imports.
//
// The plans are tiers of the coaching program. The program price is
// collected outside the app; an admin then enrols the member in a tier
// (profiles.enrolled_plan) and the app bills only the monthly fee.
// Silver gets the research core with the rest locked; Gold and Diamond
// unlock every feature. Signals are limited per week on Silver and Gold.
//
// The signal pick rule itself (the first N BUY calls of each week, plus
// their follow-ups) lives in SQL, stocks.signal_live_tiers(), so the web
// app, push delivery and the Discord bot agree.

export const PLAN_IDS = ["silver", "gold", "diamond"] as const;
export type PlanId = (typeof PLAN_IDS)[number];
// Plans are sold monthly. "year" remains for subscriptions started before
// yearly billing was withdrawn.
export type BillingInterval = "month" | "year";

// founding: bought the old one-time unlock (or was granted access by an
// admin) and keeps every feature. trial: free trial, every feature except
// live signals. none: trial over and no plan.
export type Tier = PlanId | "founding" | "trial" | "none";

// all: every call live. gold / silver: that tier's weekly picks live, every
// other call after the delay. none: no signals (trial and lapsed accounts).
export type SignalAccess = "all" | "gold" | "silver" | "none";

// Live BUY calls per week. Must match stocks.signal_live_tiers().
export const SIGNALS_PER_WEEK = { silver: 3, gold: 5 } as const;
// Days after which a call outside the weekly picks shows in the track record.
export const SIGNAL_DELAY_DAYS = 7;

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
  // Live BUY calls a week (Silver, Gold); null = unlimited or no signals.
  signalsPerWeek: number | null;
  // Delay after which every signal is visible in the track record (Silver, Gold).
  signalDelayDays: number | null;
};

export type Plan = {
  id: PlanId;
  name: string;
  monthlyUsd: number;
  // The program price paid outside the app before an admin enrols the
  // member, and the original price it is shown crossed out against.
  programUsd: number;
  originalProgramUsd: number;
  monthlyCredits: number;
  // Unused plan credits carried into the next period, in months of allowance.
  carryOverMonths: number;
  tagline: string;
  highlights: string[];
};

export function usd(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

export const QA_SESSIONS = "Q&A sessions Thursday evenings at 7pm CST";
export const LIVE_SESSIONS = "Live sessions 8:30am to 10:30am CST, Monday to Friday";

export const PLANS: Record<PlanId, Plan> = {
  silver: {
    id: "silver",
    name: "Silver",
    monthlyUsd: 97,
    programUsd: 497,
    originalProgramUsd: 2497,
    monthlyCredits: 10,
    carryOverMonths: 0,
    tagline: "The course, up to 3 signals a week and the research core.",
    highlights: [
      `Up to ${SIGNALS_PER_WEEK.silver} signals a week, live, with their follow-ups`,
      "Access to the course",
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
    programUsd: 2497,
    originalProgramUsd: 7497,
    monthlyCredits: 30,
    carryOverMonths: 1,
    tagline: "Every feature in the app, up to 5 signals a week and weekly Q&A.",
    highlights: [
      `Up to ${SIGNALS_PER_WEEK.gold} signals a week, live, with their follow-ups`,
      QA_SESSIONS,
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
    programUsd: 4997,
    originalProgramUsd: 11497,
    monthlyCredits: 75,
    carryOverMonths: 1,
    tagline: "Unlimited signals, daily live sessions and a free account review.",
    highlights: [
      "Unlimited signals, live, the moment they're posted",
      LIVE_SESSIONS,
      QA_SESSIONS,
      "Free account review",
      "75 research credits every month, unused credits roll over a month",
      "Every feature in Gold",
    ],
  },
};

// Silver's study formats. Every other tier with access gets all of them.
export const SILVER_VARIANTS = ["quick_take", "full", "comparison", "earnings_update", "movers_digest", "watchlist_entry"] as const;

// Every feature and every signal: Diamond and Founding members.
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
  signalsPerWeek: null,
  signalDelayDays: null,
};

// Every feature, with the weekly signal picks.
const GOLD: Entitlements = {
  ...FULL,
  signals: "gold",
  signalsPerWeek: SIGNALS_PER_WEEK.gold,
  signalDelayDays: SIGNAL_DELAY_DAYS,
};

// The research core and the weekly signal picks; the rest is locked until an upgrade.
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
  signals: "silver",
  signalsPerWeek: SIGNALS_PER_WEEK.silver,
  signalDelayDays: SIGNAL_DELAY_DAYS,
};

const NO_SIGNALS = { signals: "none", signalsPerWeek: null, signalDelayDays: null } as const;

export function entitlementsFor(tier: Tier): Entitlements {
  switch (tier) {
    case "diamond":
    case "founding":
      return FULL;
    case "gold":
      return GOLD;
    case "trial":
      // Every feature, but the trader's calls never go out for free.
      return { ...FULL, ...NO_SIGNALS };
    case "silver":
      return SILVER;
    case "none":
      return { ...SILVER, ...NO_SIGNALS };
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
  signalsLive: "diamond",
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
