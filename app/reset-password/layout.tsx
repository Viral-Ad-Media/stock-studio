import type { Metadata } from "next";

// The page itself is a client component; its title and description live here.
export const metadata: Metadata = {
  title: "Choose a new password",
  description: "Set a new password for your Stock Studio account.",
  alternates: { canonical: "/reset-password" },
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
