import type { Metadata, Viewport } from "next";

import { siteConfig } from "#lib/site-config";
import { noFlashThemeScript } from "#library/no-flash-theme";

export const metadata: Metadata = {
  description: siteConfig.description,
  icons: {
    apple: { sizes: "180x180", url: "/favicon/apple-touch-icon.png" },
    icon: [
      { sizes: "96x96", type: "image/png", url: "/favicon/favicon-96x96.png" },
      { type: "image/svg+xml", url: "/favicon/favicon.svg" },
    ],
    shortcut: "/favicon/favicon.ico",
  },
  title: siteConfig.name,
};

export const viewport: Viewport = {
  themeColor: [
    { color: "#ffffff", media: "(prefers-color-scheme: light)" },
    { color: "#09090b", media: "(prefers-color-scheme: dark)" },
  ],
};

const RootLayout = ({ children }: LayoutProps<"/">) => (
  <html lang="en" suppressHydrationWarning>
    <head>
      <script>{noFlashThemeScript}</script>
    </head>
    <body className="bg-background text-foreground font-sans antialiased">
      <div className="isolate">{children}</div>
    </body>
  </html>
);

export default RootLayout;
