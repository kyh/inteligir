# design-sync notes — @repo/ui → "inteligir UI" (Claude Design)

Package shape. First sync on branch `kyh/codebase-cleanup`.

## ⚡ One-command prep (run before EVERY converter/driver run)

```
node .design-sync/prepare.mjs      # idempotent; recorded as cfg.buildCmd
```

This single committed script regenerates the three derived artifacts the converter needs — none
of which are (or should be) committed. **The driver does NOT auto-run `cfg.buildCmd`**, so a
re-sync must run this line itself first (then `resync.mjs`). It self-heals a fresh clone
(installs `@tailwindcss/cli` into `.ds-sync` on demand). What it does, and why:

1. **Self-symlink** `packages/ui/node_modules/@repo/ui -> packages/ui`. `PKG_DIR` must resolve to
   `packages/ui`; this ALSO resolves the self-referential `@repo/ui/*` imports via the package
   exports map (no tsconfig-paths plugin — `cfg.tsconfig` intentionally unset).
2. **Fresh `.d.ts`** into `packages/ui/dist` via the repo's own `tsc` (props source of truth —
   there's no JS build). Wipes `dist` first (a STALE dist tree silently poisons prop extraction
   with wrong props — this actually happened on first sync) and clears the incremental
   `tsBuildInfoFile` (else tsc skips emit after the wipe).
3. **Compiled Tailwind CSS** `dist/ds-compiled.css` (via `@tailwindcss/cli` on
   `.design-sync/tailwind-entry.css`, which imports `globals.css` + `@source`s the ui src, the
   consuming apps, and the previews) with inlined `@font-face` stripped; and **`dist/inter-latin.css`**
   (Inter Latin @font-face — content lives IN prepare.mjs so nothing authored sits in gitignored
   `dist/`). `cfg.cssEntry`/`cfg.extraFonts` point at these two.

The bundle itself is **synth-entry** (`export * from` each src file; deps inlined, react vendored).
Font family token: `"Inter"` — the self-hosted `packages/ui/src/fonts/InterVariable.ttf`
(full wght + opsz axes), same as the app. (Was fontsource wght-only "Inter Variable", which
dropped optical sizing; app + design system now both self-host the full ttf.)

## Component curation

- src exports ~80 PascalCase names (compound subparts + providers). Card set curated to the
  **20 primaries** via `componentSrcMap` nulls. Nulled subparts/providers **stay in the bundle**
  (synth `export *` is independent of the card list) — the design agent can still use
  `window.InteligirUI.DialogContent` etc.; they just have no card/.d.ts. Compound composition is
  taught by each primary's authored preview + prompt.md and the conventions header.
- Providers (`ShapeProvider`, `SurfaceProvider`, `ThemeProvider`, `SidebarProvider`,
  `TooltipProvider`) and imperative infra (`ConfirmDialogHost`, `GlobalAlertDialog`, `confirm()`,
  `toast()`) are in the bundle but not carded → document in conventions header.
- Contexts have **safe defaults** (`useShape` → pill, `useSurface` → 1) so most components render
  provider-free.

## Verification

- **Playwright install declined by user.** Using Claude-in-Chrome browser automation +
  `.review.html` (served locally) for render verification and preview grading instead of the
  built-in playwright render check. `package-validate` run with `--no-render-check`;
  `package-capture` (playwright-based) unavailable — grade from browser screenshots.

## Previews, contracts, grouping (first sync — uploaded 2026-07-04)

- 20 authored previews (`.design-sync/previews/*.tsx`), all compiled to real cards (0 floor).
- 15 wrapper components had empty extracted `.d.ts` (Base UI-backed) → hand-written prop bodies
  in `cfg.dtsPropsFor` (Input/Textarea/Label/Checkbox/Spinner/Breadcrumb/Collapsible/Command/
  AlertDialog/Popover/Menu/Tooltip/Sidebar/GeometricOrb/Toaster). Button/Badge/Switch/Dialog/Tabs
  extracted cleanly. If source props change, update the matching `dtsPropsFor` entry.
- Overlays + special render as `cardMode:single` with sized viewports (`cfg.overrides`) — Base UI
  overlays portal to body, so grid mode collides multiple open overlays in one iframe.
- Overlay triggers use the **`render` prop** (`<DialogTrigger render={<Button/>}/>`), NOT children.
- All 20 cards are in ONE flat `general` group. To split into Actions/Forms/Overlays/… add
  `category` frontmatter via stub docs + `cfg.docsMap`, or `@category` JSDoc in source.

## GeometricOrb DROPPED (scheduler crash — the bug that broke the first upload)

First upload rendered NOTHING in the live pane: `[BUNDLE_EXPORT] not a component on
window.InteligirUI` for all 20, root cause `[SCHEDULER_MISSING]`. `geometric-orb.tsx` is the
only file importing `@react-three/fiber` → it bundles its own `react-reconciler` which imports
`scheduler` directly; the DS bundle externalizes react-dom and **stubs `scheduler` with a
throwing shim** (`lib/bundle.mjs`, deliberate — assumes react-dom is the only scheduler user).
That throw blew up the whole IIFE at load, so `window.InteligirUI` was never assigned and every
component (and every preview importing them) came up empty.

**Fix:** exclude react-three-fiber files from the synth entry via a committed fork
`.design-sync/overrides/source-kit.mjs` (declared in `cfg.libOverrides`; the fork's bare
`ts-morph` import resolves through the `.design-sync/node_modules` symlink prepare.mjs creates).
`GeometricOrb` is also nulled in `componentSrcMap` (no card). Result: 19 components, bundle
3768 KB → ~1521 KB, no scheduler. **Don't fork `lib/bundle.mjs`** to "fix" scheduler — the guidance
forbids it and keeping the WebGL orb (which won't render in the 2D pane anyway) isn't worth the
3 MB. If the orb is ever wanted, it needs a real scheduler bundled — a separate effort.

## Known render warns
- **AlertDialog** `[RENDER_THIN]` (rendered height 0px): BENIGN — the dialog portals/fixed-positions
  so the measured root height is 0, but the screenshot renders the full dialog correctly. Don't rework.
- **Toaster**: imperative — toasts fire via `useEffect` on mount. VERIFIED renders (3 toasts show in
  the capture); `duration: Infinity` keeps them up for the snapshot.
- **Command** was `[GRID_OVERFLOW]` (palette wider than grid cell) → fixed with
  `cfg.overrides.Command = {"cardMode":"column"}`.

## Re-sync — the whole flow

```
pnpm i                                        # if fresh clone
cp -r <skill-base>/{package-*.mjs,resync.mjs,lib,storybook} .ds-sync/   # re-stage
(cd .ds-sync && npm i esbuild ts-morph @types/react)                    # if fresh clone
node .design-sync/prepare.mjs                 # <-- THE prep (symlink + .d.ts + css)
node .ds-sync/resync.mjs --config .design-sync/config.json \
  --node-modules ./packages/ui/node_modules --out ./ds-bundle \
  --remote .design-sync/.cache/remote-sync.json
```
`prepare.mjs` removes the old manual fragility (it's the single point that can go stale).

## Re-sync risks

- The only real risk is **forgetting `node .design-sync/prepare.mjs`** before the converter/driver
  (the driver won't run it for you) — then `.d.ts`/CSS fall back to stale/empty. It's `cfg.buildCmd`
  and documented above so it's hard to miss.
- `iconLeft`/`iconRight` leak into `ButtonProps` (internal cva variant flags) — cosmetic; prune
  via `cfg.dtsPropsFor.Button` if it matters.
- The font is the self-hosted `packages/ui/src/fonts/InterVariable.ttf` (referenced by
  `prepare.mjs` `INTER_LATIN_CSS`). If that file moves/renames, update the `../src/fonts/…` path.
