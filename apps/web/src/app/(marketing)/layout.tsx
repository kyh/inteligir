import type { Metadata } from "next";

import { JsonLd } from "#components/json-ld";
import { SiteProviders } from "#components/site-providers";
import { siteConfig } from "#lib/site-config";
import { siteGraph } from "#lib/structured-data";

import "#styles/globals.css";

export const metadata: Metadata = {
  appleWebApp: { capable: false, title: siteConfig.shortName },
  manifest: "/favicon/site.webmanifest",
};

const SiteLayout = ({ children }: LayoutProps<"/">) => (
  <SiteProviders>
    <JsonLd graph={siteGraph()} />
    {children}
  </SiteProviders>
);

export default SiteLayout;
