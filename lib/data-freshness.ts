// Only accept source timestamps with an explicit timezone. A timezone-less
// vendor string must never become a fabricated UTC market timestamp.
export function sourceTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !/T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.trim())) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function timestampET(value: string | Date): string {
  return new Date(value).toLocaleString("en-US", {
    timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  }) + " ET";
}

export function dataAge(value: string | null, now = Date.now()): string {
  const at = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(at)) return "Source time unavailable";
  if (at > now + 60_000) return "Source time is in the future";
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return "Less than a minute old";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} old`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} old`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} old`;
}

export function marketDay(value: string): string {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric",
  });
}
