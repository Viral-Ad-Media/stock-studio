import type { Metadata, Viewport } from "next";
import { SITE } from "@/lib/site";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { PwaProvider } from "@/components/pwa/PwaProvider";
import ConnectivityBanner from "@/components/pwa/ConnectivityBanner";
import PwaSettingsModal from "@/components/pwa/PushAndOfflinePanel";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  manifest: "/manifest.webmanifest",
  title: {
    default: `${SITE.name}: research-led LEAPS planning`,
    template: `%s | ${SITE.name}`,
  },
  description: SITE.description,
  applicationName: SITE.name,
  authors: [{ name: SITE.operator }],
  creator: SITE.operator,
  publisher: SITE.operator,
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: SITE.name,
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    siteName: SITE.name,
    locale: "en_US",
    url: "/",
    title: `${SITE.name}: research-led LEAPS planning`,
    description: SITE.description,
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE.name}: research-led LEAPS planning`,
    description: SITE.description,
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#08111d" },
    { media: "(prefers-color-scheme: light)", color: "#f2f6fa" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // data-theme is set before paint by the inline script (saved preference),
    // so the server's default can legitimately differ from the client's.
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <PwaProvider>
          <ConnectivityBanner />
          {children}
          <PwaSettingsModal />
        </PwaProvider>
      </body>
    </html>
  );
}
