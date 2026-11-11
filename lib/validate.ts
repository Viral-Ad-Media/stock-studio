import { VARIANTS, MAX_NOTES } from "@/lib/shared";

// Request-body validation for routes that queue paid work. Every field here
// ends up in an engine prompt, so shape and size are bounded.

export { MAX_NOTES };
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

const EMAIL_PII_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const SSN_PII_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
// Payment card sequences: 13-19 digits in 4-digit separated groups or contiguous digits
// (avoids $-prefixed currency figures and comma-grouped share/market-cap counts).
const CARD_PII_RE = /(?<![$\d,])(?:\d{4}[ -]){3}\d{1,7}\b|(?<![$\d,.-])\b\d{13,19}\b(?![.,\d%BMK])/g;
// Formatted phone numbers: requires separators/parens or +country prefix so plain
// 10-digit share counts or unix timestamps are not mangled.
const PHONE_PII_RE = /(?<!\w)(?:\+\d{1,3}[\s.-]?)?\(\d{3}\)[\s.-]?\d{3}[\s.-]\d{4}\b|(?<!\w)(?:\+\d{1,3}[\s.-])?\b\d{3}[\s.-]\d{3}[\s.-]\d{4}\b/g;

// Redacts common customer PII (emails, SSNs, payment cards, phone numbers)
// before user-supplied notes are assembled into third-party LLM prompts (R12).
export function scrubPii(text: string): string {
  return text
    .replace(EMAIL_PII_RE, "[EMAIL REDACTED]")
    .replace(SSN_PII_RE, "[SSN REDACTED]")
    .replace(CARD_PII_RE, "[CARD REDACTED]")
    .replace(PHONE_PII_RE, "[PHONE REDACTED]");
}
