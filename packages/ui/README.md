# @repo/ui

Shared web UI on Base UI: the shadcn components, the Fluid Functionalism
sidebar and system helpers, and the Beautiful UI surfaces in `ai/`, vendored
once and this repo's own now. The library tab, the editor, the phone's editor
page, the site and the extension's pages draw it. It stays a leaf, with no
`@repo/*` runtime dependency, and consumers import path exports such as
`@repo/ui/components/button` and `@repo/ui/globals.css`. Its decisions are this
package's [`CLAUDE.md`](CLAUDE.md).

## Layout

```text
src/components/  shadcn, Fluid Functionalism, the local confirm-dialog
src/ai/          Beautiful UI components
src/hooks/       shared hooks
src/lib/         UI system helpers and the controlled theme provider
src/styles/      Tailwind theme, Inter, typeset styles
components.json  shadcn config: base-rhea, zinc, the @fluid registry
```

## Seams and rules a change keeps

- `ThemeProvider` is controlled: an app owns persistence and binds it once at
  its root, and a second provider's document-class effect races the first.
  `sonner` reads `@repo/ui/lib/theme`.
- `cssVars(...)` sets a custom property, never a cast `React.CSSProperties`.
- `dropdown-menu` and `popover` pass `anchor` through, and a menu is
  non-modal by default.
- `command` keeps `initialFocus` and never filters: each palette page filters
  its own rows.
- `SidebarProvider` listens for no key: the app's shortcut table owns the
  toggle.
- "Added" and "done" draw the `success` tokens, never a raw hue.
- `globals.css` keeps `@source "../**/*.{ts,tsx}"`, so Tailwind sees this
  package through workspace imports.

To add a shadcn component, run its CLI from this package with a temporary
`vite.config.ts`, then remove the stub and adapt the output to the repo's
rules.

## Testing

`pnpm --filter @repo/ui test` runs the suites, the jsdom ones compiled by the
React Compiler as the shipped page is (`components/compiled-under-test.test.tsx`
pins it); an export nothing imports is knip's to find.
