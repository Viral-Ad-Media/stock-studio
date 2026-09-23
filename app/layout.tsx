import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";
import { currentUser } from "@/lib/workspace";

export const metadata: Metadata = {
  title: "Stock Studio",
  description:
    "Queue tickers, let the research engine work, and get fact-checked investment case studies",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser().catch(() => null);
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen">
          <Nav userEmail={user?.email ?? null} />
          <main className="flex-1 p-8 max-w-5xl mx-auto w-full">{children}</main>
        </div>
      </body>
    </html>
  );
}
