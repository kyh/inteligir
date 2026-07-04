# `@repo/ui` — shared UI components

The design system shared by the desktop renderer (`apps/desktop/src/renderer`)
and the marketing site (`apps/web`). shadcn/ui built on **Base UI**
(`@base-ui/react`), styled with Tailwind 4, plus a couple of heavier shared
pieces (a Three.js orb, motion helpers). App-specific chat UI (the AI
`ai-elements`, message bubble, file thumbnail) lives in the renderer, not here.

## Layout

```
src/
  components/        shadcn-style primitives — button, dialog, alert/confirm-dialog,
                     menu, popover, command, sidebar, tabs, sonner, geometric-orb, …
  hooks/             use-proximity-hover, use-merge-refs
  lib/
    utils.ts         cn() and friends
    surface-context.tsx  Elevation ladder (1–8) for nested surfaces
    surface-classes.ts / css-vars.ts / shape.ts / springs.ts / motion-bridge.ts
    icon-map.tsx / icon-context.tsx / font-weight.ts / motion-style.ts / shape-context.tsx
  styles/
    globals.css      Tailwind entry — theme tokens, dark variant, @source globs
postcss.config.mjs   Shared PostCSS config (re-exported)
components.json      shadcn config — style "base-vega", base color zinc
```

## Usage

Exports are path-based (see `package.json` `exports`):

```ts
import { Button } from "@repo/ui/components/button";
import { cn } from "@repo/ui/lib/utils";
import { useSurface } from "@repo/ui/lib/surface-context";
```

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

## Surfaces

`surface-context` tracks an elevation level (1–8). Nested surfaces — dropdowns,
dialogs, floating layers — read the current level via `useSurface()` and pick a
background one or more steps above their substrate, so depth composes
automatically instead of being hand-tuned per component.

## Adding a component

```bash
cd packages/ui && pnpm dlx shadcn@latest add <component>
```

Components land in `src/components/`; adjust to the Base UI primitives and the
surface system as needed.

## Typecheck

```bash
pnpm --filter @repo/ui typecheck
```
