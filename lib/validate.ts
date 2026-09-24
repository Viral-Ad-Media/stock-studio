import { VARIANTS } from "@/lib/shared";

// Request-body validation for routes that queue paid work. Every field here
// ends up in an engine prompt, so shape and size are bounded.

export const MAX_NOTES = 8_000;
export const MAX_COMPANY = 200;
const TICKER_RE = /^[A-Z0-9.^\-]{1,12}( VS [A-Z0-9.^\-]{1,12}){0,3}$/;
const VARIANT_VALUES = new Set(VARIANTS.map((v) => v.value));
export const STATUS_TAGS = ["watching", "building_conviction", "pass"] as const;

export type Invalid = { error: string };

export function parseTicker(raw: unknown): string | Invalid {
  const t = String(raw ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  if (!t) return { error: "Ticker is required" };
  if (!TICKER_RE.test(t)) return { error: "Ticker must look like NVDA, BRK.B, or 'AAPL vs MSFT'" };
  return t;
}

export function parseVariant(raw: unknown): string | Invalid {
  const v = String(raw ?? "full");
  return VARIANT_VALUES.has(v) ? v : { error: "Unknown format" };
}

export function parseOptionalText(raw: unknown, max: number, label: string): string | null | Invalid {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (s.length > max) return { error: `${label} is too long (max ${max} characters)` };
  return s;
}

export function isInvalid(x: unknown): x is Invalid {
  return typeof x === "object" && x !== null && "error" in x;
}
