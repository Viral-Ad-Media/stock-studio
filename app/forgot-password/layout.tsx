import type { Metadata } from "next";

// The page itself is a client component; its title and description live here.
export const metadata: Metadata = {
  title: "Reset your password",
  description: "Get a link to reset your Stock Studio password.",
  alternates: { canonical: "/forgot-password" },
  robots: { index: false, follow: true },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
