# Development guide

How to run, verify, and change inteligir. Written for humans and agents alike;
`CLAUDE.md` holds the architecture summary, this holds the dev loop.

## Prerequisites

- Node ≥ 24 (repo developed on 24.x), pnpm 10 (`corepack enable`)
- macOS for the Electron desktop app + voice (sherpa-onnx native module);
  the browser host runs anywhere node does
- `pnpm install` at the repo root (workspace-wide)

## The two ways to run the app

Same `@repo/app` UI both times; they differ in what backs the Bridge.

### 1. Browser dev harness — fixture Bridge (fastest loop, no backend)

```bash
pnpm --filter @repo/app dev        # vite on http://localhost:5173
```

An in-memory fixture Bridge (`packages/app/dev/fixture-bridge.ts`) seeds a
sample vault and runs the **real knowledge engine** over it; agent chat streams
a canned reply; the AI surface returns canned intents/completions; voice and
executor report unavailable. Edits persist until reload. Use this for all UI
and editor work — it needs no auth, no vault, no Electron.

### 2. Electron desktop — the real product

```bash
pnpm dev:desktop                   # electron-vite, HMR, CDP on :9222
```

`apps/desktop` (thin shell: window/menu/updater + the IPC Bridge fold) boots
`@repo/host` (real vault, real pi agent, delegation, knowledge indexes) and
talks to the renderer over Electron IPC. pi auth (OpenAI OAuth) is on-device; if
this machine is logged in, chat/AI/delegation are fully live. Uses the
last-opened vault from `~/.inteligir`.

## Ports & shared state

| What                                                                      | Where                                                                     |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| App dev harness (vite)                                                    | 5173 (auto-increments)                                                    |
| Electron CDP debugging                                                    | 9222                                                                      |
| Executor daemon                                                           | 47888                                                                     |
| App state (auth, sessions, ui-state, delegations, snapshots, `host.lock`) | `~/.inteligir`                                                            |
| Voice model (~140 MB)                                                     | per-OS user-data dir (`~/Library/Application Support/Inteligir` on macOS) |

**Only one real host at a time**: `~/.inteligir/host.lock` is a pidfile — a
second host refuses to start. Stale locks from dead pids are reclaimed
automatically. Kill leftovers between runs: anything holding 9222/47888 blocks
the next `pnpm dev:desktop`.

## Quality gates

```bash
pnpm format:fix   # FIRST — never after gates (see fixture rule below)
pnpm typecheck && pnpm lint && pnpm format && pnpm test && pnpm knip && pnpm build
```

Rules that have bitten before:

- **Format before gates, commit after gates.** A `format:fix` run after green
  gates once corrupted test fixtures and shipped red (#362).
- **Never hand-edit or format round-trip fixtures**
  (`packages/app/src/__tests__/fixtures/`): their bytes ARE the test contract
  (trailing spaces, indentation, line endings). oxfmt ignores the directory;
  editors must too. Generate fixture bytes through the pipeline itself
  (`roundTrip`) — see the fixture tests for the pattern.
- Turbo caches test results — pass `--force` when you need proof over speed.
- CI runs the same gates; format-check failures **skip the test step**, so a
  red format silently hides test regressions. Keep format green.

## Verifying UI changes

Type-checks passing isn't feature-correct. Drive the running app:

- **Browser harness**: `agent-browser` against `http://localhost:5173`
  (the agent-browser skill), or raw CDP if the daemon misbehaves (it has).
- **Electron**: `agent-browser connect 9222` attaches to the renderer.
- Byte-level checks: toggle Raw mode in the editor, or read the vault file —
  the byte-stability invariant (`roundTrip(raw) === raw` for canonical files)
  is the thing most UI regressions break.

## Making changes — checklists

**Adding a Bridge channel** (the most common cross-cutting change):

1. Registry entry in `packages/features/src/ipc-registry.ts` (TypeBox payload +
   result/event type).
2. Host handler in `packages/host/src/handlers/` (grouped by domain;
   `collectHandlers` throws at boot on missing/duplicate).
3. Fixture implementation in `packages/app/dev/fixture-bridge.ts` (typed
   `: Bridge` — fails typecheck until covered).
   The Electron preload derives automatically.

**Adding an editor node type**: Base + React halves in one
`packages/app/src/editor/kits/*-kit.tsx`; add the Base half to `base-kit.ts`
(kit-parity tests fail on drift); a markdown rule in
`editor/markdown/md-rules.ts` if the node has bytes; vocabulary allowlist in
`editor/markdown/vocabulary.ts` for MDX nodes; round-trip fixtures proving
canonical/idempotent behavior.

## Tests

- `pnpm --filter @repo/app test` — editor pipeline (round-trip matrix,
  adversarial harness, kit parity, corpus classification), combobox,
  knowledge fixtures.
- `pnpm --filter @repo/host test` — vault, delegation (+snapshots), knowledge
  manager, handlers, secrets.
- `pnpm --filter @repo/features test` — knowledge engine, parsers, schemas.

## Releasing the desktop app

Use the `release` skill (`.claude/skills/release/`) — bump, build, notarize,
publish to GitHub Releases (electron-updater). Note: the electron-builder
packaging path moved in the host split (extraResources now sources
`packages/host/resources/agent`) — `pnpm verify:release` +
`pnpm verify:packaged` in `apps/desktop` are the guards.
