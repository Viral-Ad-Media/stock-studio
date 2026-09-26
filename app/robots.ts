import type { MetadataRoute } from "next";
import { SITE, absoluteUrl } from "@/lib/site";

// The signed-in app and APIs are private; everything else is crawlable.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/auth/",
          "/dashboard",
          "/new",
          "/study/",
          "/watchlist",
          "/market",
          "/setups",
          "/gamma",
          "/billing",
          "/reset-password",
        ],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: SITE.url,
  };
}
