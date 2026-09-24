import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

// Study markdown is LLM output built from web research and user notes, so it
// is untrusted: a prompt-injected page could ask for `<img onerror=…>` or a
// `javascript:` link. marked does not sanitize — every render goes through
// the allowlist below. Never pass marked output to dangerouslySetInnerHTML
// directly.

marked.use({ breaks: true });

const ALLOWED_TAGS = [
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "hr",
  "strong", "b", "em", "i", "del", "s", "code", "pre", "blockquote",
  "ul", "ol", "li", "a",
  "table", "thead", "tbody", "tr", "th", "td",
];

export function renderMarkdown(md: string): string {
  const html = marked.parse(md, { async: false }) as string;
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { a: ["href", "title", "target", "rel"], th: ["align"], td: ["align"] },
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer nofollow" }),
    },
  });
}

// For URLs rendered straight into href (e.g. sources_json) — React 18 does
// not block `javascript:` hrefs.
export function safeHttpUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}
