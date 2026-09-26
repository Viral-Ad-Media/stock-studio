import { SITE, absoluteUrl } from "@/lib/site";

// Structured data as a JSON-LD script. `<` is escaped so no string value can
// close the script tag.
export default function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}

export const ORGANIZATION_ID = `${SITE.url}/#organization`;

export function organizationLd() {
  return {
    "@type": "Organization",
    "@id": ORGANIZATION_ID,
    name: SITE.operator,
    url: SITE.url,
    logo: absoluteUrl("/icon.svg"),
    email: SITE.email,
    contactPoint: { "@type": "ContactPoint", contactType: "customer support", email: SITE.email, availableLanguage: "English" },
  };
}

export function breadcrumbLd(items: { name: string; path: string }[]) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: absoluteUrl(it.path) })),
  };
}
