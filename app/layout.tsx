import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stock Studio",
  description:
    "Fact-checked, source-cited investment case studies — queue a ticker, get a business-quality report in minutes.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
