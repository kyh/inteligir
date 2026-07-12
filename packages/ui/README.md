# `@repo/ui` — shared UI components

The design system shared by the desktop renderer (`apps/desktop/src/renderer`)
and the marketing site (`apps/web`): **vendored stock shadcn** components on
**Base UI** (`@base-ui/react`), styled with Tailwind 4, plus two shared custom
pieces (`confirm-dialog`, the Three.js `geometric-orb`). Components stay
near-stock — app-specific styling and motion live in the consuming app.

## Layout

```
src/
  components/        vendored shadcn primitives (63) — button, dialog, dropdown-menu,
                     sidebar, command, chart, message/bubble/attachment (chat blocks), …
                     plus custom: confirm-dialog, geometric-orb
  hooks/
    use-mobile.ts    viewport breakpoint hook (used by sidebar)
  lib/
    utils.ts         cn()
    css-vars.ts      typed CSS custom-property style helper (the one sanctioned
                     widening — use instead of `as React.CSSProperties`)
    theme.tsx        controlled ThemeProvider/useTheme; apps own persistence
  styles/
    globals.css      Tailwind entry — shadcn theme tokens, shadow ladder,
                     typeset presets, @source globs
    typeset.css      document typography for markdown surfaces
postcss.config.mjs   shared PostCSS config (re-exported)
components.json      shadcn config — style "base-rhea", base color zinc
```

## Usage

Exports are path-based (see `package.json` `exports`):

```ts
import { Button } from "@repo/ui/components/button";
import { cn } from "@repo/ui/lib/utils";
import { useTheme } from "@repo/ui/lib/theme";
```

Note: the `./lib/*` export glob only matches `.ts` — a new `.tsx` lib module
needs its own explicit entry (see `./lib/theme`).

```css
/* in the consuming app's CSS entry */
@import "@repo/ui/globals.css";
```

```js
// postcss.config.mjs
export { default } from "@repo/ui/postcss.config";
```

`globals.css` uses `@source` globs to scan this package and `apps/**` for class
usage, so consuming apps don't re-declare content paths.

## Vendored components

Components come from the shadcn registry (preset `beqC8BzG`, same generation as
the reference app at `~/Desktop/vite-app`). Keep them near-stock so re-pulls
stay cheap. Deliberate local extensions to re-apply after a re-pull:

- `dropdown-menu` — `anchor` passthrough on Content; `modal={false}` default
  (editor menus must not scroll-lock the document)
- `popover` — `anchor` passthrough on Content
- `command` — `initialFocus`/`shouldFilter` on CommandDialog (wraps children
  in `<Command>`)
- `sonner` — themed via `@repo/ui/lib/theme`, not next-themes
- everywhere — `cssVars(...)` instead of `as React.CSSProperties` (repo bans
  type assertions; no lint overrides for vendored files)

## Adding a component

```bash
cd packages/ui
printf 'export default {};\n' > vite.config.ts   # stub for the CLI's framework check
pnpm dlx shadcn@latest add <component>
rm vite.config.ts
```

Components land in `src/components/`. Patch to the repo's strict rules (no
`any`/`as`/`!`; memoized context values) rather than adding lint overrides.

## Typecheck

```bash
pnpm --filter @repo/ui typecheck
```
