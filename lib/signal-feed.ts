import type { SignalAccess } from "@/lib/plans";

// Which trader calls a member may see, by plan (lib/plans.ts SignalAccess):
//   all      every call, live
//   weekly   Gold: the weekly picks and their follow-ups live, every call after the delay
//   monthly  Silver: the monthly pick and its follow-ups live, every call after the delay
// The pick rule is stocks.signal_live_tiers(). Parameters: $1 access,
// $2 delay in days, $3 row limit. Each row says whether it's the member's
// live pick (`pick`) or visible only because it's past the delay.
const VISIBLE = `
  ($1 = 'all'
   OR ($1 = 'weekly' AND t.gold) OR ($1 = 'monthly' AND t.silver)
   OR ($1 IN ('weekly', 'monthly') AND s.posted_at < now() - make_interval(days => $2::int)))`;

export const SIGNAL_FEED_SQL = `
  SELECT s.id, s.posted_at, s.action, s.ticker, s.instrument, s.entry::text, s.target::text, s.stop::text, s.detail,
    ($1 = 'weekly' AND t.gold) OR ($1 = 'monthly' AND t.silver) AS pick
  FROM signals s JOIN signal_live_tiers() t ON t.id = s.id
  WHERE ${VISIBLE}
  ORDER BY s.id DESC LIMIT $3`;

// Calls the member can't see yet (Diamond-only for now), for the upgrade
// note. Parameters: $1 access, $2 delay in days (signalHiddenParams).
export const SIGNAL_HIDDEN_SQL = `
  SELECT count(*)::int AS n FROM signals s JOIN signal_live_tiers() t ON t.id = s.id
  WHERE NOT ${VISIBLE}`;

export function canReadSignals(access: SignalAccess): boolean {
  return access !== "none";
}

export function signalFeedParams(access: SignalAccess, delayDays: number | null, limit: number) {
  return [access, delayDays ?? 0, limit];
}

export function signalHiddenParams(access: SignalAccess, delayDays: number | null) {
  return [access, delayDays ?? 0];
}
