import type { Metadata } from "next";

// The page itself is a client component; its title lives here.
export const metadata: Metadata = { title: "New study", description: "Queue a fact-checked case study for any ticker." };

export default function NewStudyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
