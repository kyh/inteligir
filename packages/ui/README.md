# @repo/ui

Shared web UI on Base UI: the shadcn components, the Fluid Functionalism
sidebar and system helpers, and the Beautiful UI surfaces in `ai/`. Every
origin was vendored once and the code is this repo's own now — it obeys this
repo's rules, not upstream's shape; what survives of the origin is the MIT
attribution header on each file.

## Consumers

- `apps/desktop` — the product's renderer
- `packages/editor` — note editor
- `apps/web` — the site, the auth pages and the gallery (`pnpm dev:gallery`)

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
- A framer popup renders its Base UI Popup as the motion element and wraps it
  in `PopupExit`; Base UI waits on that element's own animations, never a
  wrapper's.
- `MotionPolicy` is mounted once at each app root; nothing else configures
  reduced motion for framer.
- `popover` keeps `anchor` passthrough.
- "Added" and "done" draw the `success` / `success-foreground` tokens
  (`styles/globals.css`), never a raw hue: each mode's `--success` reads as
  text on a 15% tint of itself.
- `command` keeps `initialFocus` and never filters (each palette page filters
  its own rows); title and description stay inside `DialogContent`.
- `SidebarProvider` listens for no key: the app's own shortcut table owns the
  toggle, and the provider only shows the `shortcut` it is handed.
- `dialog`'s `DialogPopup` is the bare popup — no card, no backdrop — with
  `container`, `initialFocus` and `finalFocus` passthrough, for a non-modal
  dialog that floats inside the region it serves (the ⌘K composer).
- `sonner` uses `@repo/ui/lib/theme`, not `next-themes`.
- `globals.css` keeps `@source "../**/*.{ts,tsx}"` so Tailwind sees this
  package through workspace imports.
- `jsx` stays `react-jsx`; `lib` stays ES2023.

To add a shadcn component, run its CLI from this package with a temporary
`vite.config.ts`, then remove the stub and adapt the output to repo rules.

## Third-party source

Vendored files keep short attribution headers. License texts live under
`tools/licenses` and ship with the published artifact. `confirm-dialog.tsx` is
local.

## Theme seam

`ThemeProvider` is controlled. Apps own persistence and pass `theme` plus
`setTheme`. Current binders are `apps/web/src/components/theme-provider.tsx`
and `apps/desktop/src/renderer/app/workspace-context.tsx`. Do not nest a third provider; its
document-class effect races the others.

## Verification

`pnpm --filter @repo/ui test` runs the package's suites; the jsdom ones run
the sources through the React Compiler as the shipped renderer does, which
`components/__tests__/compiled-under-test.test.tsx` pins. The orphan
invariant lives in `tools/repo-guards/src/ui-orphan-exports.test.ts`, PER
EXPORT: every named export under the wildcard-exported directories needs a
consumer outside the gallery or a reasoned allowance row. Knip alone cannot
ask that — the export wildcard makes each file look like intentional public
API. Consumer tests cover behavior; package type safety is
`pnpm --filter @repo/ui typecheck`.
