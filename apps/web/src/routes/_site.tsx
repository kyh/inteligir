import { useEffect } from "react";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";

import { varyHeaders } from "#lib/markdown-route";
import { PAGES } from "#lib/page-meta";
import { siteConfig } from "#lib/site-config";
import { siteGraph } from "#lib/structured-data";
import { SiteProviders } from "#components/site-providers";

import appCss from "../styles/globals.css?url";

const ErrorBoundary = ({ error }: ErrorComponentProps) => {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div>
      <p>Oh no, something went wrong... maybe refresh?</p>
    </div>
  );
};

const NotFound = () => (
  <div className="flex min-h-dvh items-center justify-center">
    <p>404: This page could not be found.</p>
  </div>
);

const SiteLayout = () => (
  <SiteProviders>
    <Outlet />
  </SiteProviders>
);

// the pathname alone, so a query string never splits one page into several canonical URLs
const canonical = (pathname: string): string =>
  `${siteConfig.url}${pathname === "/" ? "" : pathname.replace(/\/+$/u, "")}`;

// The site's pages, under their providers, stylesheet and site-wide head, none of which the
// library's routes load. A page's own head (`#lib/page-head`) overrides these defaults, since
// HeadContent keeps the deepest match's tag for each name or property.
export const Route = createFileRoute("/_site")({
  head: ({ matches }) => ({
    meta: [
      { title: siteConfig.name },
      { name: "description", content: siteConfig.description },
      { name: "apple-mobile-web-app-title", content: siteConfig.shortName },
      { property: "og:title", content: siteConfig.name },
      { property: "og:description", content: siteConfig.description },
      { property: "og:url", content: siteConfig.url },
      { property: "og:site_name", content: siteConfig.name },
      { property: "og:locale", content: "en-US" },
      { property: "og:image", content: `${siteConfig.url}/og.jpg` },
      { property: "og:image:width", content: "1920" },
      { property: "og:image:height", content: "1080" },
      { property: "og:image:alt", content: PAGES.home.image.alt },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:creator", content: siteConfig.twitter },
      { name: "twitter:title", content: siteConfig.name },
      { name: "twitter:description", content: siteConfig.description },
      { name: "twitter:image", content: `${siteConfig.url}/og.jpg` },
      { name: "twitter:image:alt", content: PAGES.home.image.alt },
      { "script:ld+json": siteGraph() },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "canonical", href: canonical(matches.at(-1)?.pathname ?? "/") },
      { rel: "manifest", href: "/favicon/site.webmanifest" },
    ],
  }),
  // site-wide, so a cache keyed on the URL alone never reuses one Accept's response for another
  headers: varyHeaders,
  errorComponent: ErrorBoundary,
  notFoundComponent: NotFound,
  component: SiteLayout,
});
