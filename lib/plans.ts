// Membership plans and what each one unlocks. Single source of truth for
// the gates (pages and API routes), the Stripe webhook's credit grants, and
// the pricing/billing pages. Client-safe: no database or Stripe imports.
//
// The signal pick rule itself (first 2 BUY calls a week for Gold, first BUY
// of the month for Silver, plus follow-ups) lives in SQL,
// stocks.signal_live_tiers(), so the web app and the Discord bot agree.

export const PLAN_IDS = ["silver", "gold", "diamond"] as const;
export type PlanId = (typeof PLAN_IDS)[number];
export type BillingInterval = "month" | "year";

// founding: bought the old one-time unlock (or was granted access by an
// admin) and keeps every Diamond feature. trial: free trial, Gold features
// without live signals. none: trial over and no plan.
export type Tier = PlanId | "founding" | "trial" | "none";

export type SignalAccess = "all" | "weekly" | "monthly" | "none";

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
  // Delay after which every signal is visible in the track record (Gold, Silver).
  signalDelayDays: number | null;
  packMultiplier: number; // credits per pack = base pack size x this (Diamond 1.5: 15 per $10)
};

export type Plan = {
  id: PlanId;
  name: string;
  monthlyUsd: number;
  yearlyUsd: number;
  monthlyCredits: number;
  // Unused plan credits carried into the next period, in months of allowance.
  carryOverMonths: number;
  tagline: string;
  highlights: string[];
};

export const PLANS: Record<PlanId, Plan> = {
  silver: {
    id: "silver",
    name: "Silver",
    monthlyUsd: 29,
    yearlyUsd: 290,
    monthlyCredits: 10,
    carryOverMonths: 0,
    tagline: "The research core, with one live pick a month.",
    highlights: [
      "10 credits every month",
      "Quick takes, full studies and comparisons",
      "Watchlist of up to 10 tickers",
      "Today, Market and earnings calendar",
      "Setup bot track record and a basic trading journal",
      "The trader's pick of the month, live",
      "Every other signal after 30 days",
    ],
  },
  gold: {
    id: "gold",
    name: "Gold",
    monthlyUsd: 59,
    yearlyUsd: 590,
    monthlyCredits: 30,
    carryOverMonths: 1,
    tagline: "Almost everything, with the trader's weekly picks live.",
    highlights: [
      "30 credits every month, unused credits roll over a month",
      "Every study format",
      "Watchlist of up to 50 tickers",
      "Live setup bots, gamma exposure and the LEAPS workspace",
      "Trading journal with decision analysis",
      "The trader's 2 weekly picks, live, with their follow-ups",
      "Every other signal after 7 days",
    ],
  },
  diamond: {
    id: "diamond",
    name: "Diamond",
    monthlyUsd: 129,
    yearlyUsd: 1290,
    monthlyCredits: 75,
    carryOverMonths: 1,
    tagline: "Everything, with every signal the moment it's posted.",
    highlights: [
      "75 credits every month, unused credits roll over a month",
      "15 credits in every $10 pack",
      "Every study format and an unlimited watchlist",
      "Everything in Gold, plus the Sweep Scanner",
      "Every signal, live, the moment it's posted",
      "Up to 10 reports in progress at once",
    ],
  },
};

// Silver's study formats. Every other tier with access gets all of them.
export const SILVER_VARIANTS = ["quick_take", "full", "comparison", "earnings_update", "movers_digest", "watchlist_entry"] as const;

const DIAMOND: Entitlements = {
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
  signalDelayDays: null,
  packMultiplier: 1.5,
};

const GOLD: Entitlements = {
  ...DIAMOND,
  watchlistMax: 50,
  maxOpenJobs: 5,
  sweeps: false,
  signals: "weekly",
  signalDelayDays: 7,
  packMultiplier: 1,
};

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
  signals: "monthly",
  signalDelayDays: 30,
  packMultiplier: 1,
};

export function entitlementsFor(tier: Tier): Entitlements {
  switch (tier) {
    case "diamond":
    case "founding":
      return DIAMOND;
    case "gold":
      return GOLD;
    case "trial":
      // Gold features, but the trader's calls never go out for free.
      return { ...GOLD, signals: "none", signalDelayDays: null };
    case "silver":
      return SILVER;
    case "none":
      return { ...SILVER, signals: "none", signalDelayDays: null };
  }
}

// Super admins see everything; otherwise founding beats a subscription
// (they keep Diamond even if they also subscribe), a live subscription
// beats the trial.
export function effectiveTier(input: {
  accessGranted: boolean;
  trialActive: boolean;
  plan: PlanId | null; // a live subscription's plan, or null
  admin?: boolean;
}): Tier {
  if (input.admin || input.accessGranted) return "founding";
  if (input.plan) return input.plan;
  return input.trialActive ? "trial" : "none";
}

export const TIER_LABEL: Record<Tier, string> = {
  silver: "Silver",
  gold: "Gold",
  diamond: "Diamond",
  founding: "Founding Diamond",
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
  sweeps: "diamond",
  signalsLive: "diamond",
};

export function canQueueVariant(ent: Entitlements, variant: string): boolean {
  return ent.variants == null || ent.variants.includes(variant);
}

// Credits granted for one paid invoice, and how many unused plan credits may
// carry into the new period. Yearly plans grant the year's credits up front.
export function planCreditGrant(plan: PlanId, interval: BillingInterval): { credits: number; carryCap: number } {
  const p = PLANS[plan];
  const months = interval === "year" ? 12 : 1;
  return { credits: p.monthlyCredits * months, carryCap: p.monthlyCredits * months * p.carryOverMonths };
}

export function isPlanId(v: unknown): v is PlanId {
  return typeof v === "string" && (PLAN_IDS as readonly string[]).includes(v);
}
