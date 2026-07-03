# `@repo/app` — the portable UI

The whole Inteligir workspace — sidebar, single-document editor, bottom composer, command palette, settings, voice — as a React app. It talks to its host exclusively through an injected `Bridge` (`src/lib/bridge.ts::installBridge`, called once before render); no electron, no node built-ins, no host imports — lint-enforced (`.oxlintrc.json` boundary override). Two surfaces mount it: the Electron renderer (preload's `window.desktopBridge`) and the dev harness (in-memory fixture).

## Layout

```
src/
  app-root.tsx / app.tsx   phase gate (login / onboarding / workspace) over the app state machine
  lib/bridge.ts            installBridge/getBridge — the only transport seam
  workspace/               the single surface: vault-context (the open note's editor session), page
  editor/                  the Plate editor (see below)
  composer/  command/  sidebar/  settings/  delegation/  voice/  login/  onboarding/
  stores/  components/  layout/  styles.css
  __tests__/               round-trip matrix + fixtures (byte-pinned — never format), kit parity
dev/                       vite dev harness — index.html + fixture Bridge
```

## The two entries

- **Dev harness** (`pnpm --filter @repo/app dev`, vite on :5173): `dev/main.tsx` installs `dev/fixture-bridge.ts` — an in-memory vault seeded with sample notes running the **real knowledge engine** (`@repo/features/knowledge`); agent chat streams a canned reply, voice/executor report unavailable. Edits persist until reload. No auth, no backend — the fastest loop for UI and editor work. The fixture is typed `: Bridge`, so a new registry channel fails typecheck here until covered.
- **Electron renderer**: the desktop shell's shim (`apps/desktop/src/renderer/main.tsx`) installs `window.desktopBridge` and renders `App` — this package is source-consumed (every host aliases `@repo/app` to `./src`; there is no exports map by design).

## Editor — byte stability

`editor/markdown/` owns the unified parse (GFM + math + the locked MDX vocabulary + wiki-links + frontmatter); round-trip is normalizing but **idempotent** (bounded fixpoint). Rich is the default surface: any file that parses within the vocabulary opens Rich and normalizes on the first real edit; only unrepresentable content (unknown JSX, parse errors) opens Raw (byte-exact) with the badge. Every node type is a Base (headless) + React kit pair in `editor/kits/`; `base-kit.ts` composes the Base halves for the headless serializer mirror, and kit-parity tests fail on drift. Editor AI (⌘J menu, selection actions, accept/reject suggestions, default-on ghost text) lives in `editor/ai/` and is transient-only — AI state never reaches disk.

Adding a node type or a Bridge channel: follow the checklists in [`docs/development.md`](../../docs/development.md).

## Test

```bash
pnpm --filter @repo/app test
```

Round-trip fixtures under `src/__tests__/fixtures/` are byte-pinned test contracts — oxfmt ignores the directory; generate fixture bytes through `roundTrip` itself, never by hand.
