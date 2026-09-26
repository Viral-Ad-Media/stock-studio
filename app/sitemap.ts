import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";

// Public, indexable pages only — the signed-in app is noindex.
const PAGES: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/pricing", priority: 0.8, changeFrequency: "monthly" },
  { path: "/signup", priority: 0.7, changeFrequency: "yearly" },
  { path: "/login", priority: 0.4, changeFrequency: "yearly" },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly" },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date("2026-09-26");
  return PAGES.map((p) => ({ url: absoluteUrl(p.path), lastModified, changeFrequency: p.changeFrequency, priority: p.priority }));
}
