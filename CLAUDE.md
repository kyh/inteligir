# Agent Instructions

## Project Overview

**inteligir** — an AI-native notes app (Obsidian-with-an-agent). You pick a
directory (a _vault_); your content is local markdown files on disk. It's
AI-native two ways: chat to an agent that edits those files, and highlight a
checkbox to _delegate_ it to a background agent that does the task and writes the
result back.

Turborepo monorepo: an Electron desktop app (the product) + an Expo mobile
companion + a Cloudflare Worker vault-sync/auth backend + a TanStack Start
marketing site + shared packages.

## Tech Stack

- **Monorepo**: Turborepo + pnpm workspaces
- **Desktop**: Electron + electron-vite (@repo/desktop) — the product
- **Editor**: Plate (platejs) rich markdown + a raw textarea fallback
- **UI**: shadcn/ui (Base UI), lucide-react, sonner, zustand
- **Web**: TanStack Start + React 19 + Tailwind CSS 4 on Cloudflare Workers (marketing site, no backend)
- **Mobile**: Expo SDK 56 + Expo Router + NativeWind (@repo/mobile) — sync/read/light-edit companion, no agent
- **Cloud**: Cloudflare Worker (@repo/cloud) — Better Auth on D1 + a Durable Object per vault + R2
- **AI Agent**: pi coding agent framework (@mariozechner/pi-coding-agent)

The agent runs locally in the desktop app; agent auth is provider OAuth
(OpenAI), handled by pi on-device. The vault is a folder of markdown the user
owns; the agent reaches it through a `./vault` symlink in its workspace and
edits files with its native file tools. The only server-side surface is the
**opt-in vault sync** (apps/cloud: Better Auth sessions + file bytes in R2 +
per-vault manifests in a Durable Object) — **off by default**, and it syncs
vault FILES only; notes never live in a server database.

## Workspace Structure

```
apps/            # shippable artifacts
  web/           # Marketing site (@repo/web) — landing page only
  desktop/       # Electron shell — the notes product (@repo/desktop)
  mobile/        # Expo companion (@repo/mobile) — sync + read + light-edit, no agent
  cloud/         # CF Worker (@repo/cloud) — /api/auth/* (Better Auth/D1) + /v1/vault/* (DO+R2)
packages/        # libraries
  core/          # PURE platform-neutral domain (@repo/core) — runs in Worker/RN/renderer:
                 #   sync/      — vault-sync engine + protocol (reconcile, wire, HttpSyncPort)
                 #   knowledge/ — link graph, backlinks, lexical search, rename byte-surgery
                 #   markdown/  — remark parse pipeline, MDX vocabulary gate, wiki-links
  features/      # Contract + backend (@repo/features):
                 #   src/        — iso: Bridge/IPC registry, schemas (loads in the renderer)
                 #   src/server/ — node: vault, pi agent, delegation, executor, voice, sync
                 #                 adapters, handlers, createHost, HostPlatform
  ui/            # Shared UI components (@repo/ui) — web-only (Base UI + Tailwind)
```

`@repo/core` is the sharing seam: no node/electron/react/workspace imports
(lint- and tsconfig-enforced); platforms inject capabilities (hasher, IO,
clock) — see `core/src/sync/engine.ts`. Desktop and mobile drive the SAME sync
engine and knowledge/markdown code through thin adapters.

The product's UI lives in the desktop renderer (`apps/desktop/src/renderer`).
The product is the **Electron desktop** app (`pnpm dev:desktop`) over the
`@repo/features/server` backend, communicating through Electron IPC. For
UI work there is also a backend-free browser dev harness
(`pnpm --filter @repo/desktop dev:harness`) that drives the real UI over an in-memory
fixture Bridge.

## Common Commands

```bash
pnpm dev              # Dev all workspaces
pnpm dev:web          # Dev web app only
pnpm dev:desktop      # Dev desktop app only
pnpm build            # Build all
pnpm typecheck        # Type check all
pnpm lint             # Lint all   (oxlint)
pnpm format:fix       # Format     (oxfmt) — run BEFORE gates, never after
```

**`docs/development.md` is the full dev guide**: the two run modes (fixture
harness / Electron), ports + `~/.inteligir` shared state +
`host.lock`, the fixture byte-pinning rule, verification patterns, and the
add-a-Bridge-channel / add-a-node-type checklists.

## Verifying Changes

Use the **agent-browser** skill to drive a running app — both the web app
(browser) and the desktop app (Electron). Don't claim a UI change works without
driving it; type/test passing isn't feature-correct.

- Desktop dev exposes a remote-debugging port: `pnpm dev:desktop` runs
  electron-vite with `--remoteDebuggingPort 9222`. `agent-browser connect 9222`
  attaches to the Electron renderer.
- Kill stale instances between runs — a leftover Electron/executor process holds
  ports 9222 and 47888 and the next launch can't bind them.

## Quality Gates

Before committing:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm knip && pnpm build
```

## Desktop architecture (@repo/desktop)

Three processes: **main** (Electron), **preload**, **renderer**. The renderer
(`src/renderer/`) is the whole product UI: `main.tsx` installs
`window.desktopBridge` and renders `App`. Renderer code is host-agnostic —
it reaches the backend only through the injected Bridge (`@renderer/lib/bridge`),
never electron/node/host (lint-enforced). The `agent/` boundary never imports
`main/` — also lint-enforced; main composes capabilities and hands the agent an
injected `AgentPorts` (`{ executor }`).

### Data model — the vault

`packages/features/src/server/vault/` (`VaultManager`) owns the vault: a user-chosen
folder whose markdown files are canonical. It reads through to disk (never
quarantines user files), writes atomically, watches for changes (broadcasts
`onVaultChanged`), and maintains a `./vault` symlink in the agent workspace so
the agent's file tools find it regardless of where the user put it.
`~/.inteligir` holds only app state (auth, sessions, ui-state, delegations,
pre-delegation snapshots) via versioned `JsonStore`s — never note content.

Notes are **markdown with a fixed MDX vocabulary**: GFM plus `[[wiki-links]]`
(aliases, `![[transclusion]]`), `$$` math, mermaid fences, `> [!NOTE]` alerts,
and the MDX components `<toggle>`, `<column_group>/<column>`, `<video>`,
`<media_embed>`, `<file>`, `<date>`. Anything outside the vocabulary (unknown
JSX, expressions, HTML comments) sends the file to Raw mode rather than being
mangled. Files stay `.md`.

The derived indexes (wiki/md link graph, backlinks, lexical search,
wiki-target list) are `@repo/core/knowledge/*` — pure, platform-neutral.
`packages/features/src/server/knowledge/` is the node host shell around them:
incremental refresh from vault events, and renames that rewrite `[[links]]`
across the vault byte-surgically (shadow-protection qualifies links the new
name would steal). Derived indexes are rebuilt per device and NEVER synced.

### UI — `apps/desktop/src/renderer`, one fixed workspace

The renderer UI consumes an injected `Bridge`
(`lib/bridge.ts::installBridge`) — never electron/node (lint-enforced). It
runs standalone in a plain browser via `pnpm --filter @repo/desktop dev:harness` (a vite
harness with an in-memory fixture Bridge in `apps/desktop/dev/` that runs the
real knowledge engine over sample notes). `workspace/workspace-page.tsx` is the only surface:
**Sidebar (file tree) | single-document Editor | BottomComposer** (chat pinned
bottom — no side chat panel, no tabs: opening a note replaces the open one),
settings behind a dialog; backlinks collapse under the editor column; a
right-edge TOC minimap expands on hover; the graph view (lazy d3-force canvas)
and full-text search live in the command palette.

- `workspace/vault-context.tsx` — a `VaultProvider` owning ONE editor
  controller/autosave/vanish-watcher for the open note (`openPath`, persisted
  in ui-state under `workspace.openNote`), the file listing, and all vault
  actions. Sidebar + editor + composer consume `useVault()`.
- The markdown parse pipeline (remark-gfm + math + MDX vocabulary +
  wiki-links + frontmatter) lives in `@repo/core/markdown/*`;
  `editor/markdown/` is the Plate-coupled byte-stability brain over it — the
  Slate↔mdast rules and the idempotent round-trip (bounded fixpoint). **Rich
  is the default surface**:
  any file that parses within the vocabulary opens Rich and normalizes on the
  first real edit; only unrepresentable content (unknown JSX, parse errors)
  opens Raw (byte-exact) with the badge. Every node type lives in
  `editor/kits/*` as a Base (headless) + React pair; `base-kit.ts` composes
  the Base halves for the headless serializer mirror — kit-parity tests make
  drift impossible. The round-trip fixture matrix under
  `src/__tests__/fixtures/` is byte-pinned (oxfmt ignores it — formatting
  fixtures is corruption).
- **Editor AI** (pi-backed, transient-only — AI state never reaches disk):
  ⌘J AI menu (cursor vs selection command sets + Translate page, host-side
  intent classification for free-form prompts; generate streams under an `ai`
  mark; edit lands as accept/reject suggestions), reachable from the selection
  toolbar, slash menu, block menu, and space-in-empty-paragraph; ghost-text
  completions on a fast model, on by default (Settings › Editor AI opts out).

### Delegation — `packages/features/src/server/delegation/`

A checkbox's "Delegate" → `delegation-manager.ts` (versioned `JsonStore` +
event-driven serialized queue) runs it on `background-agent.ts` (a second pi
session on `BACKGROUND_SESSION_DIR`). Before the agent dispatches, the host
**snapshots the file** (bytes under `~/.inteligir`, newest 50 kept) — the dock's
"Restore original" undoes an agent edit byte-exactly. The agent edits the file
via `./vault`, checks the box, and appends a result; the watcher refreshes the
editor. Status streams to inline badges (`onDelegationsUpdated`).
`find-task-line.ts` is the pure, content-addressed locator.

### Vault sync — `@repo/core/sync` + `apps/cloud` + platform adapters

**Off by default** (runtime `sync-config` store; Settings → Sync). One pure
engine — `core/sync/engine.ts` (3-way last-write-wins `reconcile`, conflicts
preserved as sibling copies, never lost) — with injected platform ports:
desktop binds node crypto/VaultManager/JsonStore
(`features/src/server/sync/sync-manager.ts`, lifecycle in
`sync-coordinator.ts`), mobile binds expo-crypto/expo-file-system
(`apps/mobile/src/lib/sync/`). The coordinator (`apps/cloud`) is ONE Worker:
`/api/auth/*` = Better Auth (email+password, bearer tokens) over Drizzle + D1,
`/v1/vault/*` = per-vault `VaultCoordinator` Durable Object (SQLite manifest,
optimistic concurrency — a version conflict is an HTTP-200 `{ok:false}` VALUE,
never a throw) with bytes in R2. First authenticated user to touch a vaultId
owns it. D1 schema ships via `drizzle-kit push` (no migration files);
`test/e2e-sync.test.ts` drives the real engine against the real Worker
in-process. Deploy is owner-only (see `apps/cloud/README.md`).

### Agent surface — `packages/features/src/server/agent/`

Extension bundles are listed in `agent/bundles.ts` (static registry + disk-drift
test) and receive `AgentPorts` at register time — adding/removing a capability
is one folder + one line. `executor/` is the MCP/connectors capability.
`validateToolParametersSchema` rejects tool schemas that aren't a top-level
`Type.Object` (OpenAI silently rejects `anyOf`-rooted schemas). The chat agent
edits notes with pi's native file tools pointed at `./vault` — no custom edit
tool. Chat is a single persistent thread; the open note is auto-attached as
context (agent-side only). `Cmd+K` rolls a fresh thread. Two more no-tools pi
sessions serve the editor: inline-AI/intent classification, and an ephemeral
in-memory session for ghost-text on a fast model.

### IPC / Bridge

`packages/features/src/ipc-registry.ts` is the single source of truth: each channel
pairs a TypeBox payload schema with a result/event type, and the
transport-agnostic `Bridge` type is derived from it. `createHost` returns a
schema-validated handler map (`packages/features/src/server/handlers/`) that the desktop
shell folds over Electron `ipcMain` (the preload derives the typed
`window.desktopBridge` automatically). Add a channel = registry entry + host
handler + one line in the dev-harness fixture Bridge
(`apps/desktop/dev/fixture-bridge.ts`), which fails typecheck until covered.
