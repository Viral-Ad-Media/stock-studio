"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function AutoRefresh({ interval = 5000 }: { interval?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), interval);
    return () => clearInterval(t);
  }, [interval, router]);
  return null;
}
