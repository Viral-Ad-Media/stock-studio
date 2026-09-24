"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Re-fetches the page's server data on an interval. Skips ticks while the tab
// is hidden, and stops after `maxMs` if given. Callers render it only while
// something can still change.
export default function AutoRefresh({ interval = 5000, maxMs }: { interval?: number; maxMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const started = Date.now();
    const t = setInterval(() => {
      if (maxMs && Date.now() - started > maxMs) return clearInterval(t);
      if (document.hidden) return;
      router.refresh();
    }, interval);
    return () => clearInterval(t);
  }, [interval, maxMs, router]);
  return null;
}
