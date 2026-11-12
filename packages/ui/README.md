# @repo/ui

Shared web UI on Base UI: the shadcn components, the Fluid Functionalism
sidebar and system helpers, and the Beautiful UI surfaces in `ai/`. Every
origin was vendored once and the code is this repo's own now — it obeys this
repo's rules, not upstream's shape; what survives of the origin is the MIT
attribution header on each file.

## Consumers

- `apps/web/src/library` — the library tab
- `packages/editor` — note editor
- `apps/mobile/src/editor/page` — the phone's DOM component, its note's editor
- `apps/web` — the site and the auth pages
- `apps/extension` — the extension's popup and welcome page

The package stays a leaf: no `@repo/*` runtime dependencies. Consumers import
path exports such as `@repo/ui/components/button` and
`@repo/ui/globals.css`.

## Layout

```text
src/components/  shadcn, Fluid Functionalism, local confirm-dialog
src/ai/          Beautiful UI components
src/hooks/       shared hooks
src/lib/         UI system helpers and controlled theme provider
src/styles/      Tailwind theme, Inter, typeset styles
components.json  shadcn config: base-rhea, zinc, the @fluid registry
```

## Invariants

- These components are this repo's own. Rename, restructure and delete freely;
  the only thing a vendored file must keep is its MIT attribution header.
- No `any`, type assertions, or non-null assertions.
- Use `cssVars(...)` instead of casting `React.CSSProperties`.
- `dropdown-menu` keeps `anchor` passthrough and `modal={false}`.
- `popover` keeps `anchor` passthrough.
- "Added" and "done" draw the `success` / `success-foreground` tokens
  (`styles/globals.css`), never a raw hue: each mode's `--success` reads as
  text on a 15% tint of itself.
- `command` keeps `initialFocus` and never filters (each palette page filters
  its own rows); title and description stay inside `DialogContent`.
- `SidebarProvider` listens for no key: the app's own shortcut table owns the
  toggle, and the provider only shows the `shortcut` it is handed.
- `sonner` uses `@repo/ui/lib/theme`, not `next-themes`.
- `globals.css` keeps `@source "../**/*.{ts,tsx}"` so Tailwind sees this
  package through workspace imports.
- `jsx` stays `react-jsx`; `lib` stays ES2023.

To add a shadcn component, run its CLI from this package with a temporary
`vite.config.ts`, then remove the stub and adapt the output to repo rules.

## Third-party source

Vendored files keep short attribution headers. License texts live under
`tools/licenses`. `confirm-dialog.tsx` is local.

## Theme seam

`ThemeProvider` is controlled. Apps own persistence and pass `theme` plus
`setTheme`, each binding it once at its root. Do not nest a second provider; its
document-class effect races the first.

## Verification

`pnpm --filter @repo/ui test` runs the package's suites; the jsdom ones run
the sources through the React Compiler as the shipped page does, which
`components/compiled-under-test.test.tsx` pins. Type safety is
`pnpm --filter @repo/ui typecheck`; an export nothing
imports is knip's to find (`knip.json`, `packages/ui/CLAUDE.md`).
