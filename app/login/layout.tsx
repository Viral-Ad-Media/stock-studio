import type { Metadata } from "next";

// The page itself is a client component; its title and description live here.
export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Stock Studio workspace to queue case studies and track your watchlist.",
  alternates: { canonical: "/login" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
