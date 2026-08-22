# @repo/ui

Shared UI components (web-only): **vendored stock shadcn** on **Base UI**
(`@base-ui/react`), styled with Tailwind 4, with the interactive core
(**button, dialog, dropdown-menu/menu-item, checkbox, switch, badge, tooltip**)
**vendored from the Fluid Functionalism registry**
(fluidfunctionalism.com, MIT) together with its system layer (`lib/` springs,
surface/shape/size/icon contexts; `hooks/` proximity-hover, merge-split), plus
one shared custom piece (`confirm-dialog`).

## Why it exists

The one visual system for its three consumers — the workspace
(`packages/workspace`), the editor (`packages/editor`) and the marketing site
(`apps/web`). Web-only and a leaf (no `@repo/*` deps): mobile never imports it.
Its own package so components stay near-stock and cheaply re-pullable from the
shadcn registry — app-specific styling and motion live in the consuming app, not
here.

## Layout

```
src/
  components/        the vendored primitives (fluid + stock shadcn: button,
                     dialog, dropdown-menu, sidebar, command, …) plus custom:
                     confirm-dialog
                     (components.provenance.json is the count of record —
                     `provenance:check` prints it)
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
    typeset.css      typeset-docs document typography
  __tests__/
    no-orphan-components.test.ts    see Testing
    components-provenance.test.ts   see Testing
scripts/
  provenance.mjs     regenerates / drift-checks the provenance manifest
components.json      shadcn config — style "base-rhea", base color zinc
components.provenance.json          see Provenance
```

Exports are path-based (`package.json` `exports`):
`@repo/ui/components/*`, `@repo/ui/lib/*`, `@repo/ui/hooks/*`, plus
`@import "@repo/ui/globals.css";` in the consuming app's CSS entry.

## Invariants

- **Near-stock vendored, from two registries**: shadcn (preset `beqC8BzG`)
  and Fluid Functionalism (`components.json` names it `@fluid`; upstream repo,
  commit pin and license live in `components.provenance.json`'s `fluid`
  block). Keep re-pulls cheap; deliberate local extensions to re-apply after a
  re-pull:
  - `dropdown-menu` — `anchor` passthrough on Content; `modal={false}`
    default (editor menus must not scroll-lock the document)
  - `popover` — `anchor` passthrough on Content
  - `command` — `initialFocus`/`shouldFilter` on CommandDialog (wraps
    children in `<Command>`); its `DialogTitle`/`DialogDescription` moved
    INSIDE `DialogContent` — stock renders them as siblings, i.e. outside the
    portal and outside Base UI's `Dialog.Popup`, and mounted even while the
    palette is closed
  - `sonner` — themed via `@repo/ui/lib/theme`, not next-themes
  - everywhere — `cssVars(...)` instead of `as React.CSSProperties` (repo
    bans type assertions; no lint overrides for vendored files)
- **Adding a component**: `cd packages/ui`, stub a `vite.config.ts`
  (`printf 'export default {};\n' > vite.config.ts` — the CLI's framework
  check), `pnpm dlx shadcn@latest add <component>`, remove the stub. Patch to
  the repo's strict rules (no `any`/`as`/`!`; memoized context values), never
  add lint overrides.
- The `./lib/*` / `./hooks/*` export globs match `.ts` only — a `.tsx` module
  needs its own explicit entry (see `./lib/theme` and the fluid context rows).
  An `[.ts, .tsx]` fallback array is NOT a substitute: tsc resolves through it
  but Node and Vite take the first pattern and fail on the missing file, so
  the divergence only surfaces at runtime.
- `globals.css` declares one `@source "../**/*.{ts,tsx}"` covering THIS
  package (Tailwind's auto-detection skips node_modules); each app's own
  class usage is auto-detected by `@tailwindcss/vite`.
- **`jsx: "react-jsx"`, diverging from the shared init template's
  `preserve`** — a deliberate deviation, keep it through a template re-sync.
  All three consumers are `react-jsx` and all three pull these sources into
  their own programs via the `@repo/ui/*` paths mapping, so `preserve`
  typechecks the same files twice under two JSX resolution rules.
- **`lib` stays at ES2023** (the repo-wide floor is also the ceiling here).
  These components ship in client bundles at Vite's default
  `baseline-widely-available` target; Vite transforms syntax, never stdlib, so
  an ES2024+ builtin would typecheck and then throw in a supported browser.
  Reasoning is inline in `tsconfig.json`.

## Provenance

`components.provenance.json` records, per file under `src/components`, where it
came from — a shadcn registry item (`origin: "registry"` + the upstream `item`
name), a Fluid Functionalism item (`origin: "fluid"` + its `item`; the `fluid`
block pins the upstream repo, commit and license), or written here
(`origin: "local"`, today `confirm-dialog`) — plus a
sha256 of the bytes last accepted for it. The registry block mirrors
`components.json` (the config the CLI reads) and carries the preset id, which
lives nowhere else. The fluid system layer under `src/lib` and `src/hooks` is
outside the manifest's walk (it covers `src/components` only) — those files'
provenance is this README plus the manifest's `fluid` block.

```bash
pnpm --filter @repo/ui provenance          # regenerate (rewrites hashes)
pnpm --filter @repo/ui provenance:check    # report drift, never fails
```

The recorded hash is the **last accepted** bytes, not pristine upstream —
these files were patched to the repo's rules before any record existed. So
drift means "changed since we last accepted it", which is the useful question
around a re-pull:

1. **Before** re-pulling, `provenance:check` should be clean. Anything it lists
   is a local edit nobody recorded — regenerate first, so the re-pull's damage
   is legible.
2. **After** `pnpm dlx shadcn@latest add <component>`, the components it lists
   are exactly the files the pull rewrote — i.e. the local extensions above
   that need re-applying and the patches back to the repo's strict rules.
3. Once those are back, regenerate and commit the manifest with the re-pull.

Origin and `item` are hand-curated: nothing on disk distinguishes a registry
copy from a file written here, so a regenerate carries them forward and only
refreshes hashes. New files default to `origin: "registry"` and the script says
so — set a hand-written one to `"local"`. Scope is `src/components` only:
`globals.css` started from the registry's theme but is now mostly local, and a
hash of it would report drift permanently.

Drift is **never a gate**. Local edits to vendored files are sanctioned (see
Invariants), so a failing drift check would fail on the intended state. What is
enforced is coverage — see Testing.

## Seams

`ThemeProvider` is **controlled**: it owns OS-preference resolution, the
`.dark` class on `<html>`, and the shared context; each app owns the state
source and passes `theme` + `setTheme`. There are TWO binders, and the workspace
does not inherit the site's:

- `apps/web/src/components/theme-provider.tsx` — the marketing site:
  localStorage plus an SSR no-flash script, defaulting dark.
- `packages/workspace/src/lib/use-theme.tsx::WorkspaceThemeProvider` — the
  workspace: persisted to the host's ui-state through the Bridge, defaulting
  light. `App` mounts it inside itself, so it wins for everything under `/app`.

Nesting a third would break both: the outer provider's effect runs last and
overwrites the inner one's `.dark` decision, which is why `__root.tsx` mounts
none.

## Testing

`pnpm --filter @repo/ui test` runs two source-walk suites, both load-bearing.

`src/__tests__/no-orphan-components.test.ts` walks the repo and fails when a
file under `src/components` has no importer anywhere. It exists because knip
structurally cannot check it — the `./components/*` exports wildcard makes
every component a public entry point, so an orphan reads as intentional API.
Without this suite nothing reports dead vendored components, and they pile up
in the thousands of lines — each dragging its own pinned npm deps along.

`src/__tests__/components-provenance.test.ts` fails when a component file has
no entry in `components.provenance.json` (or an entry has no file), and when
the manifest's registry block disagrees with `components.json`. Coverage only —
a component that escapes the record has no source identity, so a re-pull cannot
tell whether it is safe to overwrite. It asserts nothing about the hashes;
`provenance:check` reports those.

No component renders in-package: behavior is pinned by consumer tests, and
the type gate is `pnpm --filter @repo/ui typecheck`.
