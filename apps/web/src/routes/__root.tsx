import { useEffect } from "react";
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { noFlashThemeScript } from "@repo/ui/lib/theme";
import { RadiusProvider } from "@repo/ui/lib/radius-context";
import { SizeProvider } from "@repo/ui/lib/size-context";

import { siteConfig } from "@/lib/site-config";
import { THEME_FALLBACK, THEME_STORAGE_KEY } from "@/components/theme-provider";

import appCss from "../styles/globals.css?url";

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
  // The shell wraps component, errorComponent and notFoundComponent alike, so
  // a 404 or a root error still ships as a full document — without it those
  // views render with no <html>, no stylesheet and no scripts.
  shellComponent: RootDocument,
  errorComponent: ErrorBoundary,
  notFoundComponent: NotFound,
  component: RootComponent,
});

function ErrorBoundary({ error }: { error: Error }) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error(error);
  }, [error]);

  return (
    <div>
      <p>Oh no, something went wrong... maybe refresh?</p>
    </div>
  );
}

function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <p>404: This page could not be found.</p>
    </div>
  );
}

function RootComponent() {
  return (
    <RadiusProvider defaultRadius="rounded">
      <SizeProvider defaultSize="compact">
        <Outlet />
      </SizeProvider>
    </RadiusProvider>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  // The DOCUMENT and nothing else. There is no theme provider here: `@repo/ui`'s
  // provider writes the `.dark` class on <html>, and two of them nested means
  // the outer one's effect runs last and overwrites the inner one's decision —
  // so each surface owns exactly one, and the marketing page's lives on that
  // page.
  //
  // suppressHydrationWarning: the inline script below sets the theme class on
  // <html> before hydration, so the server markup and client differ by design.
  // The inline theme script applies the saved/system theme before first paint
  // — no flash.
  // Both theme-color metas render as plain tags: HeadContent's meta dedupes
  // by name, which would drop one of the media-queried pair.
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: noFlashThemeScript(THEME_STORAGE_KEY, THEME_FALLBACK),
          }}
        />
        <HeadContent />
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#09090b" />
      </head>
      <body className="bg-background text-foreground font-sans antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
