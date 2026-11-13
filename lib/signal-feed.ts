import type { SignalAccess } from "@/lib/plans";

// The trader's calls, newest first. Every paid tier sees every call live
// (lib/plans.ts); trial and lapsed accounts see none, which callers check
// with canReadSignals before querying. Parameter: $1 row limit.
export const SIGNAL_FEED_SQL = `
  SELECT s.id, s.posted_at, s.action, s.ticker, s.instrument, s.entry::text, s.target::text, s.stop::text, s.detail
  FROM signals s
  ORDER BY s.id DESC LIMIT $1`;

export function canReadSignals(access: SignalAccess): boolean {
  return access !== "none";
}

export function signalFeedParams(limit: number) {
  return [limit];
}
