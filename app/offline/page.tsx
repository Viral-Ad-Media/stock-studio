import type { Metadata } from "next";
import OfflineWorkspace from "@/components/pwa/OfflineWorkspace";

export const metadata: Metadata = {
  title: "Offline workspace",
  description: "Browse cached case studies, watchlist theses, and your trading journal while offline.",
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return <OfflineWorkspace />;
}
