import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "Stock Studio",
  description:
    "Queue tickers, let the Claude Code engine research them, and get fact-checked investment case studies",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen">
          <Nav />
          <main className="flex-1 p-8 max-w-5xl mx-auto w-full">{children}</main>
        </div>
      </body>
    </html>
  );
}
