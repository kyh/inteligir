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
- Providers (`RadiusProvider`, `SurfaceProvider`, `ThemeProvider`, `SidebarProvider`,
  `TooltipProvider`) and imperative infra (`ConfirmDialogHost`, `GlobalAlertDialog`, `confirm()`,
  `toast()`) are in the bundle but not carded → document in conventions header.
- Contexts have **safe defaults** (`useRadius` → pill, `useSurface` → 1) so most components render
  provider-free.

## Verification

- **Playwright install declined by user.** Using Claude-in-Chrome browser automation +
  `.review.html` (served locally) for render verification and preview grading instead of the
  built-in playwright render check. `package-validate` run with `--no-render-check`;
  `package-capture` (playwright-based) unavailable — grade from browser screenshots.

## Previews, contracts, grouping (first sync — uploaded 2026-07-04)

- Authored previews (`.design-sync/previews/*.tsx`), all compiled to real cards (0 floor).
- Wrapper components with empty extracted `.d.ts` (Base UI-backed) get hand-written prop
  bodies in `cfg.dtsPropsFor` — the config is the list. Button/Badge/Switch/Dialog/Tabs
  extracted cleanly. If source props change, update the matching `dtsPropsFor` entry.
- Overlays + special render as `cardMode:single` with sized viewports (`cfg.overrides`) — Base UI
  overlays portal to body, so grid mode collides multiple open overlays in one iframe.
- Overlay triggers use the **`render` prop** (`<DialogTrigger render={<Button/>}/>`), NOT children.
- All cards are in ONE flat `general` group. To split into Actions/Forms/Overlays/… add
  `category` frontmatter via stub docs + `cfg.docsMap`, or `@category` JSDoc in source.

## No second React reconciler in the bundle

The DS bundle externalizes react-dom and **stubs `scheduler` with a throwing shim**
(`lib/bundle.mjs`, deliberate — assumes react-dom is the only scheduler user). A source file
that imports `@react-three/fiber` or `react-reconciler` bundles its own reconciler, which
imports `scheduler` directly; the throw blows up the whole IIFE at load, `window.InteligirUI`
never assigns, and every card comes up empty. No such file exists in `@repo/ui`. If one ever
appears, exclude it from the synth entry (a `.design-sync/overrides/source-kit.mjs` fork,
declared in `cfg.libOverrides`) — **don't fork `lib/bundle.mjs`** to "fix" scheduler.

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

## Re-sync 2026-08-22 — the fluid component layer

- Card set 19 → **21**: Tabs REMOVED (tabs.tsx deleted with the fluid swap; preview deleted,
  remote `components/general/Tabs/**` + `_preview/Tabs.js` must be deleted on upload), ADDED
  InputMessage (cardMode column), TabsSubtle, ScrollArea (previews authored). Every other
  existing preview still compiles against the fluid components — the swap kept prop compat
  (Button even keeps `leadingIcon`/`md`/`icon-sm` aliases).
- componentSrcMap nulls every export that is not a carded primary (fluid subparts, the
  system layer, the InputGroup/Separator family) — bundle-only until deliberately carded. A
  new export needs a null row or it cards (Popover's Header/Title/Description and
  SidebarInset leaked on the first run).
- dtsPropsFor: Sidebar/Tooltip/Checkbox/Menu entries DELETED — the fluid sources export real
  prop interfaces and extraction now beats the stale hand-written bodies (Sidebar's said
  `collapsible: icon` — pre-fluid API). The remaining entries cover still-stock components.
- Fonts rebuilt: the self-hosted InterVariable.ttf is GONE from the tree, so prepare.mjs now
  emits faces for the families the tokens NAME — "Inter Variable" + "Geist Variable" +
  "Geist Mono Variable" — from fontsource latin wght woff2s (geist pair are ui deps; inter is
  an ORPHAN pnpm-store entry, resolved by a store glob fallback; if a store prune drops it,
  add @fontsource-variable/inter somewhere real). Remote `fonts/InterVariable.ttf` is dead —
  delete on upload.
- Bundle 1848 KB (was ~1521) — framer-motion's cost; syntax OK, no scheduler regression.
- validate warnings accepted: TOKENS_MISSING for --scroll-area-thumb-* (runtime-set),
  --editor-* (app appearance provider), --tw (tailwind internal); RENDER_SKIPPED (browser-
  graded instead — all 21 cards mounted, overlays verified in screenshots).
- FOUND, out of scope here: the vendored fluid Switch hardcodes its checked track blue
  (#6B97FF/#5C89F2 inline) — unthemed against the monochrome palette, in the app AND the DS
  pane. Same family as the --focus-ring fix; wants a token (e.g. track → var(--focus-ring)).
- Remote anchor (.design-sync/.cache/remote-sync.json) was gone → full-scope upload.
