import { createRootRoute, HeadContent, Outlet, ScriptOnce, Scripts } from "@tanstack/react-router";
import bodyFontLatin from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";
import { noFlashThemeScript } from "@repo/ui/lib/theme";

import { PREFS } from "#library/prefs";

// The document every page shares, the site's and the library's: what each draws in its <head>
// beyond this is its own layout's (`_site.tsx`, `library.tsx`), so the library loads none of the
// site's.

// suppressHydrationWarning: the theme script sets the theme class before hydration. The
// theme-color metas are plain tags because HeadContent dedupes meta by name and would drop one of
// the pair. isolate: the document's own stacking context, so a popup Base UI portals into body
// stays above it (https://base-ui.com/react/overview/quick-start).
const RootDocument = ({ children }: { children: React.ReactNode }) => (
  <html lang="en" suppressHydrationWarning>
    <head>
      <ScriptOnce>{noFlashThemeScript(PREFS.theme.key, PREFS.theme.fallback)}</ScriptOnce>
      <HeadContent />
      <meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff" />
      <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#09090b" />
    </head>
    <body className="bg-background text-foreground font-sans antialiased">
      <div className="isolate">{children}</div>
      <Scripts />
    </body>
  </html>
);

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
    ],
    links: [
      { rel: "icon", type: "image/png", sizes: "96x96", href: "/favicon/favicon-96x96.png" },
      { rel: "icon", type: "image/svg+xml", href: "/favicon/favicon.svg" },
      { rel: "shortcut icon", href: "/favicon/favicon.ico" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/favicon/apple-touch-icon.png" },
      // fetched beside the stylesheet, so Latin text usually has Inter for the first paint, which
      // its `font-display: optional` (@repo/ui's inter.css) requires to use it on this page at all
      {
        rel: "preload",
        href: bodyFontLatin,
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
    ],
  }),
  // shellComponent wraps every layout's errorComponent and notFoundComponent too, so a 404 renders
  // with its <html> and scripts
  shellComponent: RootDocument,
  component: Outlet,
});
