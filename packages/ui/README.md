# @repo/ui

Shared web UI. Stock shadcn on Base UI, Fluid Functionalism primitives and
system helpers, Beautiful UI AI surfaces, and a small local layer.

## Consumers

- `apps/app` — product UI
- `packages/editor` — note editor
- `apps/web` — marketing/auth site

The package stays a leaf: no `@repo/*` runtime dependencies. Consumers import
path exports such as `@repo/ui/components/button` and
`@repo/ui/globals.css`.

## Layout

```text
src/components/  shadcn, Fluid Functionalism, local confirm-dialog
src/ai/          Beautiful UI components
src/hooks/       shared hooks
src/lib/         UI system helpers and controlled theme provider
src/styles/      Tailwind theme, Geist fonts, typeset styles
components.json  shadcn config: base-rhea, zinc, preset beqC8BzG
```

## Invariants

- Keep vendored components near upstream. Reapply only documented adaptations.
- No `any`, type assertions, or non-null assertions.
- Use `cssVars(...)` instead of casting `React.CSSProperties`.
- `dropdown-menu` keeps `anchor` passthrough and `modal={false}`.
- `popover` keeps `anchor` passthrough.
- `command` keeps `initialFocus`/`shouldFilter`; title and description stay
  inside `DialogContent`.
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
and `apps/app/src/app/workspace-context.tsx`. Do not nest a third provider; its
document-class effect races the others.

## Verification

`pnpm --filter @repo/ui test` runs the no-orphan component guard. Knip cannot
find these orphans because the component export wildcard makes each file look
like intentional public API. Consumer tests cover behavior; package type safety
is `pnpm --filter @repo/ui typecheck`.
