# Development guide

How to run, verify, and change inteligir. Written for humans and agents alike;
`CLAUDE.md` holds the architecture summary, this holds the dev loop.

## Prerequisites

- Node ≥ 24 (repo developed on 24.x), pnpm 10 (`corepack enable`)
- macOS for the Electron desktop app + voice (sherpa-onnx native module);
  the browser dev harness runs anywhere
- `pnpm install` at the repo root (workspace-wide)

## The two ways to run the app

Same renderer UI both times; they differ in what backs the Bridge. (The other
apps have their own loops: `apps/cloud` — `wrangler dev` + the Workers test
pool, see its README; `apps/mobile` — Expo, needs a device/simulator.)

### 1. Browser dev harness — fixture Bridge (fastest loop, no backend)

```bash
pnpm --filter @repo/desktop dev:harness        # vite on http://localhost:5173
```

An in-memory fixture Bridge (`apps/desktop/dev/fixture-bridge.ts`) seeds a
sample vault and runs the **real knowledge engine** over it; agent chat streams
a canned reply; the AI surface returns canned intents/completions; voice and
executor report unavailable. Edits persist until reload. Use this for all UI
and editor work — it needs no auth, no vault, no Electron.

### 2. Electron desktop — the real product

```bash
pnpm dev:desktop                   # electron-vite, HMR, CDP on :9222
```

`apps/desktop` (thin shell: window/menu/updater + the ws transport fold) boots
`@repo/server` (real vault, real pi agent, delegation, knowledge indexes) and
serves the Bridge over ONE local WebSocket server (`startWsHost`); the
renderer dials it with `createWsBridge` using the endpoint + per-boot token
the bootstrap-only preload exposes. Agent auth is provider OAuth (OpenAI or
Claude, switchable in Settings → AI), handled by pi on-device; if this
machine is logged in, chat/AI/delegation are fully live. Uses the
last-opened vault from `~/.inteligir`.

**Vault liveness is ephemeral, not watched (a deliberate decision — PR #411).** There is NO recursive
filesystem watcher. The file listing is an on-demand snapshot: it refreshes on
app-initiated structural writes (new file / delete / rename), on window focus
(debounced), on the "Refresh vault" command, and on delegation completion. The
ONLY watcher is a single non-recursive watch on the currently open note (armed
via `setWatchedNote`), so external edits to the file you're looking at still
reload/conflict live; the app's own autosaves are filtered out and generate no
`onVaultChanged` traffic. The trade (accepted): an external edit to a file that
is NOT open appears when the window regains focus — which is when you look.
`onVaultChanged` is still the renderer contract; only its SOURCES changed.

**The knowledge index persists** in `~/.inteligir/indexes/<hash>.sqlite`, one
DB per vault root. It is a pure cache of projected markdown: deleting it (or
any corruption/version mismatch) is always safe — the host rebuilds it from
the vault automatically. Never put durable state in it. Desktop search is
FTS5 bm25 (title/heading/body weighted 10/4/1) through this store; a refresh
burst (focus → renderer listing + knowledge diff + sync fingerprints) shares
one walk+stat snapshot inside VaultManager (~1s TTL).

## Ports & shared state

| What                                                                      | Where                                                                     |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| App dev harness (vite)                                                    | 5173 (auto-increments)                                                    |
| Marketing site (`pnpm dev:web`)                                           | 5174 (auto-increments)                                                    |
| Coordinator Worker (`wrangler dev`)                                       | 8787                                                                      |
| Electron CDP debugging                                                    | 9222                                                                      |
| Executor daemon                                                           | 47888                                                                     |
| App state (auth, sessions, ui-state, delegations, snapshots, `host.lock`) | `~/.inteligir`                                                            |
| Knowledge index cache (per-vault SQLite; delete-safe, auto-rebuilds)      | `~/.inteligir/indexes/`                                                   |
| Voice model (~140 MB)                                                     | per-OS user-data dir (`~/Library/Application Support/Inteligir` on macOS) |

**Only one real host at a time**: `~/.inteligir/host.lock` is a pidfile — a
second host refuses to start. Stale locks from dead pids are reclaimed
automatically. Kill leftovers between runs: anything holding 9222/47888 blocks
the next `pnpm dev:desktop`.

## Quality gates

```bash
pnpm format:fix && pnpm verify
```

`pnpm verify` = `typecheck && lint && knip && format && test && build`, the same
six steps CI runs. It is check-only on purpose — `format:fix` is a separate
first step, never folded in.

Rules that have bitten before:

- **Format before gates, commit after gates.** A `format:fix` run after green
  gates once corrupted test fixtures and shipped red (#362).
- **Never hand-edit or format round-trip fixtures**
  (`apps/desktop/src/renderer/__tests__/fixtures/`): their bytes ARE the test contract
  (trailing spaces, indentation, line endings). oxfmt ignores the directory;
  editors must too. Generate fixture bytes through the pipeline itself
  (`roundTrip`) — see the fixture tests for the pattern.
- CI runs every gate independently (each step runs even if an earlier one
  fails), so a red format no longer hides test regressions.

## Verifying UI changes

Type-checks passing isn't feature-correct. Drive the running app:

- **Browser harness**: `agent-browser` against `http://localhost:5173`
  (the agent-browser skill), or raw CDP if the daemon misbehaves (it has).
- **Electron**: `agent-browser connect 9222` attaches to the renderer.
- Byte-level checks: toggle Raw mode in the editor, or read the vault file —
  the byte-stability invariant (`roundTrip(raw) === raw` for canonical files)
  is the thing most UI regressions break.
- Privacy (`private: true`) changes: `docs/privacy.md` states the guarantee
  and its holes; the enforcement tests live in
  `packages/agent/src/__tests__/privacy-gate.test.ts` and
  `packages/server/src/__tests__/knowledge-privacy.test.ts`
  (outbound-payload assertions).

## Making changes — checklists

**Adding a Bridge channel** (the most common cross-cutting change):

1. Registry entry in `packages/bridge/src/ipc-registry.ts` (TypeBox payload +
   result/event type).
2. Host handler in `packages/server/src/handlers/` (grouped by domain;
   `collectHandlers` throws at boot on missing/duplicate).
3. Fixture implementation in `apps/desktop/dev/fixture-bridge.ts` (typed
   `: Bridge` — fails typecheck until covered).
   The ws transport dispatches from the host handler map automatically.

**Adding an editor node type**: Base + React halves in one
`apps/desktop/src/renderer/editor/kits/*-kit.tsx`; add the Base half to `base-kit.ts`
(kit-parity tests fail on drift); a markdown rule in
`editor/markdown/md-rules.ts` if the node has bytes; vocabulary allowlist in
`@repo/notes/markdown/vocabulary` (`packages/notes/src/markdown/vocabulary.ts`)
for MDX nodes; round-trip fixtures proving canonical/idempotent behavior.

## Tests

- `pnpm --filter @repo/notes test` — the pure domain: vault-sync engine +
  reconcile + wire contract, knowledge engine (link graph, search, rename),
  markdown parse/vocabulary.
- `pnpm --filter @repo/desktop test` — the renderer: editor pipeline (round-trip
  matrix, adversarial harness, kit parity, corpus classification), combobox,
  knowledge fixtures.
- `pnpm --filter @repo/bridge test` — the iso wire contract (parsers, schemas,
  ws protocol).
- `pnpm --filter @repo/agent test` — the pi capability (extensions, privacy
  gate, faux provider) + the pi-quarantine and bundle drift guards.
- `pnpm --filter @repo/server test` — the node backend (vault, delegation
  +snapshots, knowledge manager, sync adapters, handlers).
- `pnpm --filter @repo/cloud test` — the sync Worker against real in-process
  miniflare (DO + R2 + D1 + Better Auth), incl. the end-to-end sync test that
  drives @repo/notes's engine through the real backend.
- `pnpm --filter @repo/mobile test` — the Expo sync adapters on node (in-memory
  fakes; no simulator).

## Releasing the desktop app

Use the `release` skill (`.claude/skills/release/`) — bump, build, notarize,
publish to GitHub Releases (electron-updater). Note: the electron-builder
packaging path moved in the host split (extraResources now sources
`packages/agent/resources/agent`) — `pnpm verify:release` +
`pnpm verify:packaged` in `apps/desktop` are the guards.
