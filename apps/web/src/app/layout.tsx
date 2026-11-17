import type { Metadata } from "next";

import { siteConfig } from "#lib/site-config";

import "#styles/globals.css";

export const metadata: Metadata = {
  description: siteConfig.description,
  title: siteConfig.name,
};

const RootLayout = ({ children }: LayoutProps<"/">) => (
  <html lang="en">
    <body className="bg-background text-foreground font-sans antialiased">{children}</body>
  </html>
);

export default RootLayout;
