import type { Metadata } from "next";

// The page itself is a client component; its title and description live here.
export const metadata: Metadata = {
  title: "Start your free trial",
  description: "Create a Stock Studio account: a 30-day free trial with 5 starter credits, no card required.",
  alternates: { canonical: "/signup" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
