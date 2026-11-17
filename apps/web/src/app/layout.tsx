import type { Metadata, Viewport } from "next";

import { siteConfig } from "#lib/site-config";
import { noFlashThemeScript } from "#library/no-flash-theme";

import "#styles/globals.css";

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

// The document every page shares, the site's and the library's: what each draws beyond this is its
// own group's layout's. React writes a script's text verbatim, so the theme script runs before the
// first paint, and the library's policy allows it by its hash (lib/document-policy.ts): this layout
// reads no request, and the marketing pages stay prerendered. suppressHydrationWarning: that script
// sets the theme class before hydration. isolate: the document's own stacking context, so a popup
// Base UI portals into body stays above it (https://base-ui.com/react/overview/quick-start).
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
