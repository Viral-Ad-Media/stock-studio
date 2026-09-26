import Link from "next/link";
import { ChevronRight } from "lucide-react";
import JsonLd, { breadcrumbLd } from "@/components/seo/JsonLd";

// Visible trail plus matching BreadcrumbList structured data. The last item
// is the current page.
export default function Breadcrumbs({ items }: { items: { name: string; path: string }[] }) {
  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-6 text-sm">
        <ol className="flex flex-wrap items-center gap-1.5 text-fg-subtle">
          {items.map((it, i) => {
            const last = i === items.length - 1;
            return (
              <li key={it.path} className="flex items-center gap-1.5">
                {last ? (
                  <span aria-current="page" className="text-slate-300">
                    {it.name}
                  </span>
                ) : (
                  <>
                    <Link href={it.path} className="underline-offset-2 hover:text-slate-200 hover:underline">
                      {it.name}
                    </Link>
                    <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                  </>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      <JsonLd data={{ "@context": "https://schema.org", ...breadcrumbLd(items) }} />
    </>
  );
}
