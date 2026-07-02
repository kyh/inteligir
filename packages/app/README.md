# `@repo/app` — the portable UI

The whole Inteligir workspace — sidebar, tabbed editor, bottom composer, command palette, settings, voice — as a plain browser React app. It talks to its host exclusively through an injected `Bridge` (`src/lib/bridge.ts::installBridge`, called once before render); no electron, no node built-ins, no host imports — lint-enforced (`.oxlintrc.json` boundary override). Three hosts mount it: the Electron renderer (preload's `window.desktopBridge`), the browser via `@repo/server` (WS bridge), and the dev harness (in-memory fixture).

## Layout

```
src/
  app-root.tsx / app.tsx   phase gate (login / onboarding / workspace) over the app state machine
  lib/bridge.ts            installBridge/getBridge — the only transport seam
  workspace/               the single surface: vault-context (per-tab editor sessions), tabs, page
  editor/                  the Plate editor (see below)
  composer/  command/  sidebar/  settings/  delegation/  voice/  login/  onboarding/
  stores/  components/  layout/  styles.css
  __tests__/               round-trip matrix + fixtures (byte-pinned — never format), kit parity, tabs
dev/                       vite dev harness — index.html + fixture Bridge
web/                       browser build entry — WS bridge against the serving origin
```

## The three entries

- **Dev harness** (`pnpm --filter @repo/app dev`, vite on :5173): `dev/main.tsx` installs `dev/fixture-bridge.ts` — an in-memory vault seeded with sample notes running the **real knowledge engine** (`@repo/core/knowledge`); agent chat streams a canned reply, voice/executor report unavailable. Edits persist until reload. No auth, no backend — the fastest loop for UI and editor work. The fixture is typed `: Bridge`, so a new registry channel fails typecheck here until covered.
- **Web build** (`pnpm --filter @repo/app build` → `dist-web/`, non-default outDir wired in `vite.web.config.ts` + turbo): `web/main.tsx` installs `createWsBridge` (`@repo/core/bridge-ws-client`) against the origin that served the page, plus a connection-lost overlay. `@repo/server`/the cli resolve `dist-web/` at runtime via the package.
- **Electron renderer**: the desktop shell's shim (`apps/desktop/src/renderer/main.tsx`) installs `window.desktopBridge` and renders `App` — this package is source-consumed (every host aliases `@repo/app` to `./src`; there is no exports map by design).

## Editor — byte stability

`editor/markdown/` owns the unified parse (GFM + math + the locked MDX vocabulary + wiki-links + frontmatter) and the canonical gate: round-trip is normalizing but **idempotent**, so a canonical file (`roundTrip(raw) === raw`) re-serializes to a minimal diff. Canonical files open Rich; everything else opens Raw (byte-exact) with a one-click **Format**. Every node type is a Base (headless) + React kit pair in `editor/kits/`; `base-kit.ts` composes the Base halves for the headless serializer mirror, and kit-parity tests fail on drift. Editor AI (selection actions, accept/reject suggestions, ghost text) lives in `editor/ai/` and is transient-only — AI state never reaches disk.

Adding a node type or a Bridge channel: follow the checklists in [`docs/development.md`](../../docs/development.md).

## Test

```bash
pnpm --filter @repo/app test
```

Round-trip fixtures under `src/__tests__/fixtures/` are byte-pinned test contracts — oxfmt ignores the directory; generate fixture bytes through `roundTrip` itself, never by hand.
