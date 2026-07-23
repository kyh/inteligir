# @repo/ui

Shared UI components (web-only): **vendored stock shadcn** on **Base UI**
(`@base-ui/react`), styled with Tailwind 4, plus two shared custom pieces
(`confirm-dialog`, the Three.js `geometric-orb`).

## Why it exists

The one visual system for both frontends — the desktop renderer
(`apps/desktop/src/renderer`) and the marketing site (`apps/web`). Web-only
and a workspace leaf (no `@repo/*` deps): mobile (NativeWind) and the node
packages never import it. Its own package so components stay near-stock and
cheaply re-pullable from the shadcn registry — app-specific styling and
motion live in the consuming app, not here.

## Layout

```
src/
  components/        62 components — vendored shadcn primitives (button, dialog,
                     dropdown-menu, sidebar, command, chart, message/bubble/
                     attachment chat blocks, …) plus custom: confirm-dialog,
                     geometric-orb (r3f orb; DisplayStatus =
                     idle | error | starting | listening); three-fiber.d.ts
                     types the r3f JSX elements
  hooks/
    use-mobile.ts    viewport breakpoint hook (used by sidebar)
  lib/
    utils.ts         cn()
    css-vars.ts      cssVars() — typed CSS custom-property style helper (the one
                     sanctioned widening — use instead of `as React.CSSProperties`)
    theme.tsx        controlled ThemeProvider/useTheme; apps own persistence
  styles/
    globals.css      Tailwind entry — shadcn theme tokens, Inter/Geist Mono
                     fonts, shadow ladder, bloom menu motion (CSS port of
                     joshpuckett/bloom), typeset presets, @source
    typeset.css      typeset-docs / typeset-chat document typography
postcss.config.mjs   exported PostCSS config (apps actually wire Tailwind via
                     @tailwindcss/vite in their vite configs)
components.json      shadcn config — style "base-rhea", base color zinc
```

Exports are path-based (`package.json` `exports`):
`@repo/ui/components/*`, `@repo/ui/lib/*`, `@repo/ui/hooks/*`, plus
`@import "@repo/ui/globals.css";` in the consuming app's CSS entry.

## Invariants

- **Near-stock vendored** (registry preset `beqC8BzG`). Keep re-pulls cheap;
  deliberate local extensions to re-apply after a re-pull:
  - `dropdown-menu` — `anchor` passthrough on Content; `modal={false}`
    default (editor menus must not scroll-lock the document)
  - `popover` — `anchor` passthrough on Content
  - `command` — `initialFocus`/`shouldFilter` on CommandDialog (wraps
    children in `<Command>`)
  - `sonner` — themed via `@repo/ui/lib/theme`, not next-themes
  - everywhere — `cssVars(...)` instead of `as React.CSSProperties` (repo
    bans type assertions; no lint overrides for vendored files)
- **Adding a component**: `cd packages/ui`, stub a `vite.config.ts`
  (`printf 'export default {};\n' > vite.config.ts` — the CLI's framework
  check), `pnpm dlx shadcn@latest add <component>`, remove the stub. Patch to
  the repo's strict rules (no `any`/`as`/`!`; memoized context values), never
  add lint overrides.
- The `./lib/*` export glob matches `.ts` only — a new `.tsx` lib module
  needs its own explicit entry (see `./lib/theme`).
- `globals.css` declares one `@source "../**/*.{ts,tsx}"` covering THIS
  package (Tailwind's auto-detection skips node_modules); each app's own
  class usage is auto-detected by `@tailwindcss/vite`.

## Seams

`ThemeProvider` is **controlled**: it owns OS-preference resolution, the
`.dark` class on `<html>`, and the shared context; each app owns the state
source and passes `theme` + `setTheme`. Binders: desktop
`apps/desktop/src/renderer/lib/use-theme.tsx` (Bridge-persisted ui-state),
web `apps/web/src/components/theme-provider.tsx` (localStorage + SSR
no-flash script).

## Testing

No suites in-package — the gate is `pnpm --filter @repo/ui typecheck`.
Behavior is pinned by consumer tests (e.g. the desktop renderer's
`confirm-dialog.test.tsx` and `settings-panel.test.tsx` run against these
components).
