import type { Metadata } from "next";

import { JsonLd } from "#components/json-ld";
import { SiteProviders } from "#components/site-providers";
import { PAGES } from "#lib/page-meta";
import { absoluteUrl } from "#lib/page-metadata";
import { siteConfig } from "#lib/site-config";
import { siteGraph } from "#lib/structured-data";

import "#styles/globals.css";

const homeCard = {
  alt: PAGES.home.image.alt,
  height: PAGES.home.image.height,
  url: absoluteUrl(PAGES.home.image.path),
  width: PAGES.home.image.width,
};

// the site-wide defaults, which a page's own metadata (#lib/page-metadata) replaces key by key
export const metadata: Metadata = {
  // the home-screen title alone; `capable` would default to true and add `mobile-web-app-capable`
  appleWebApp: { capable: false, title: siteConfig.shortName },
  manifest: "/favicon/site.webmanifest",
  openGraph: {
    description: siteConfig.description,
    images: [homeCard],
    locale: "en_US",
    siteName: siteConfig.name,
    title: siteConfig.name,
    type: "website",
    url: siteConfig.url,
  },
  twitter: {
    card: "summary_large_image",
    creator: siteConfig.twitter,
    description: siteConfig.description,
    images: [homeCard],
    title: siteConfig.name,
  },
};

const SiteLayout = ({ children }: LayoutProps<"/">) => (
  <SiteProviders>
    <JsonLd graph={siteGraph()} />
    {children}
  </SiteProviders>
);

export default SiteLayout;
