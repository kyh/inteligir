# `@repo/web` — Inteligir marketing site

Static Next.js 15 landing page. No backend, no database, no auth — just the
public-facing pitch for the product. Built with the App Router + Turbopack and
styled with Tailwind 4 via `@repo/ui`.

## Layout

```
src/
  app/
    page.tsx       Landing page
    layout.tsx     Root layout — fonts, theme provider, metadata
    error.tsx      Error boundary
    robots.ts      Generated robots.txt
  components/
    site-header.tsx
    hero-orb.tsx       Three.js orb (via @repo/ui)
    theme-provider.tsx next-themes wrapper
  lib/
    site-config.ts     Title, description, links — single source for metadata
public/                Static assets
```

Shared components and styles come from `@repo/ui` (`@repo/ui/globals.css`,
`@repo/ui/components/*`). Keep page-specific bits here; promote anything reused
across apps into `packages/ui`.

## Dev

```bash
pnpm dev:web      # next dev --turbopack
```

## Build

```bash
pnpm --filter @repo/web build   # next build --turbopack
pnpm --filter @repo/web start   # serve the production build
```

The site is fully static — the desktop app (`packages/desktop`) is the actual
product; this is the landing page only.
