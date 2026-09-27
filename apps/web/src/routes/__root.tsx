import { useEffect } from "react";
import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { noFlashThemeScript } from "@repo/ui/lib/theme";

import { varyHeaders } from "@/lib/markdown-route";
import { siteConfig } from "@/lib/site-config";
import { serializeJsonLd, siteGraph } from "@/lib/structured-data";
import { SiteProviders } from "@/components/site-providers";
import { THEME_FALLBACK, THEME_STORAGE_KEY } from "@/components/theme-provider";

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

const RootComponent = () => (
  <SiteProviders>
    <Outlet />
  </SiteProviders>
);

// the pathname alone, so a query string never splits one page into several canonical URLs
const useCanonical = () => {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return `${siteConfig.url}${pathname === "/" ? "" : pathname.replace(/\/+$/u, "")}`;
};

const jsonLd = serializeJsonLd(siteGraph());

const RootDocument = ({ children }: { children: React.ReactNode }) => {
  const canonical = useCanonical();

  return (
    // suppressHydrationWarning: the inline script sets the theme class before hydration
    // the theme-color metas are plain tags because HeadContent dedupes meta by name and would drop one of the pair
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          // oxlint-disable-next-line react/no-danger -- the theme must be on <html> before paint, which only an inline script can do; the payload is a constant this module builds
          dangerouslySetInnerHTML={{
            __html: noFlashThemeScript(THEME_STORAGE_KEY, THEME_FALLBACK),
          }}
        />
        <HeadContent />
        <link rel="canonical" href={canonical} />
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#09090b" />
        <script
          type="application/ld+json"
          // oxlint-disable-next-line react/no-danger -- a crawler reads JSON-LD only as inline text; serializeJsonLd escapes `<` so nothing in it can close the tag
          dangerouslySetInnerHTML={{ __html: jsonLd }}
        />
      </head>
      <body className="bg-background text-foreground font-sans antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  );
};

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
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
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:creator", content: siteConfig.twitter },
      { name: "twitter:title", content: siteConfig.name },
      { name: "twitter:description", content: siteConfig.description },
      { name: "twitter:image", content: `${siteConfig.url}/og.jpg` },
      { name: "twitter:image:width", content: "1920" },
      { name: "twitter:image:height", content: "1080" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/png", sizes: "96x96", href: "/favicon/favicon-96x96.png" },
      { rel: "icon", type: "image/svg+xml", href: "/favicon/favicon.svg" },
      { rel: "shortcut icon", href: "/favicon/favicon.ico" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/favicon/apple-touch-icon.png" },
      { rel: "manifest", href: "/favicon/site.webmanifest" },
    ],
  }),
  // shellComponent wraps errorComponent and notFoundComponent too; without it a 404 renders with no <html>, stylesheet or scripts
  // site-wide, so a cache keyed on the URL alone never reuses one Accept's response for another
  headers: varyHeaders,
  shellComponent: RootDocument,
  errorComponent: ErrorBoundary,
  notFoundComponent: NotFound,
  component: RootComponent,
});
