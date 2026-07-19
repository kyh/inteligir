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
(OpenAI or Claude — the selection lives in the `provider-config` store under
`~/.inteligir`, switchable in Settings → AI; pi-ai's `faux` provider joins the
menu under `INTELIGIR_FAUX_AGENT=1` for deterministic login-free testing),
handled by pi on-device. The vault is a folder of markdown the user
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
                 #   src/server/ — node: vault, pi agent, delegation, connectors, voice,
                 #                 sync adapters, handlers, boot/ (createHost), HostPlatform
  ui/            # Shared UI components (@repo/ui) — web-only (Base UI + Tailwind)
```

`@repo/core` is the sharing seam: no node/electron/react/workspace imports
(lint- and tsconfig-enforced); platforms inject capabilities (hasher, IO,
clock) — see `core/src/sync/engine.ts`. Desktop and mobile drive the SAME sync
engine and knowledge/markdown code through thin adapters.

The product's UI lives in the desktop renderer (`apps/desktop/src/renderer`).
The product is the **Electron desktop** app (`pnpm dev:desktop`) over the
`@repo/features/server` backend, communicating over a local WebSocket
transport (one server, loopback by default). For UI work there is also a
backend-free browser dev harness
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
pnpm format:fix   # FIRST — never after gates
pnpm typecheck && pnpm lint && pnpm knip && pnpm format && pnpm test && pnpm build
```

## Desktop architecture (@repo/desktop)

Three processes: **main** (Electron), **preload**, **renderer**. The renderer
(`src/renderer/`) is the whole product UI: the preload is bootstrap-only
(it exposes the ws endpoint + per-boot local token as
`window.bridgeBootstrap` over one sendSync channel), and `main.tsx` dials it
with `createWsBridge`, installs the Bridge, and renders `App`. Renderer code
is host-agnostic — it reaches the backend only through the injected Bridge
(`@renderer/lib/bridge`), never electron/node/host (lint-enforced). The
`agent/` boundary never imports the rest of `@repo/features/server` — also
lint-enforced; the host composes capabilities and hands the agent an
injected `AgentPorts` (`{ executor, knowledge }`).

### Data model — the vault

`packages/features/src/server/vault/` (`VaultManager`) owns the vault: a user-chosen
folder whose markdown files are canonical. It reads through to disk (never
quarantines user files) and writes atomically. Liveness is the **ephemeral
listing** (a deliberate decision — PR #411, § Decisions): NO recursive watcher — the listing is a one-shot crawl
(respects `.gitignore`, uncapped) refreshed on window focus, app writes,
delegation completion, and a "Refresh vault" palette command; only the OPEN
note gets a (non-recursive) watcher, driven by a pure change classifier with
self-save filtering, so autosaves generate zero vault-changed traffic. It also
maintains a `./vault` symlink in the agent workspace so the agent's file tools
find it regardless of where the user put it. User-initiated deletes go to the
**OS trash** (`HostPlatform.trashItem`); sync-applied remote deletes are
permanent (§ Decisions).
`~/.inteligir` is app state, NOT the vault — but **note content does reach
it**: session transcripts record every note the agent read, and
pre-delegation snapshots are raw note bytes. The dir is therefore owner-only
(0700 dirs / 0600 data files — json-store's default write mode plus a
boot-time `hardenAppDir` sweep that heals pre-existing installs). Versioned
`JsonStore`s hold the rest (ui-state, delegations, sync config); pi's
auth.json is pi-owned — plaintext-but-0600 by design.

Notes are **markdown with a fixed MDX vocabulary**: GFM plus `[[wiki-links]]`
(aliases, `![[transclusion]]`), `$$` math, mermaid fences, `> [!NOTE]` alerts,
and the MDX components `<toggle>`, `<column_group>/<column>`, `<video>`,
`<media_embed>`, `<file>`, `<date>`. Anything outside the vocabulary (unknown
JSX, expressions, HTML comments) sends the file to Raw mode rather than being
mangled. Files stay `.md`.

The derived indexes (wiki/md link graph, backlinks, full-text search,
wiki-target list) are `@repo/core/knowledge/*` — pure, platform-neutral:
`projectDoc()` is the ONE parse per doc, `LinkGraphIndex` resolves links over
projections, and the SQL `KnowledgeStore` (schema + FTS5 bm25 search, written
once in core over an injected `SqlDriver`) persists projections per vault in
`~/.inteligir/indexes/<hash>.sqlite`. Markdown stays the only source of
truth — the DB is a wipe-and-rebuild CACHE (any corruption/version mismatch
deletes and rebuilds; **nothing durable may ever live in index.sqlite** —
durable state belongs in the `~/.inteligir` JsonStores).
`packages/features/src/server/knowledge/` is the node host shell: boot
hydrates the in-memory graph from persisted rows (no first-query full parse),
an async time-budgeted reconcile diffs stat fingerprints (content hash is the
write authority) from vault events, and renames rewrite `[[links]]` across
the vault byte-surgically (shadow-protection qualifies links the new name
would steal) and record the old stem in the moved doc's frontmatter
`aliases:` — wiki targets resolve through aliases after every path tier (a
real filename always beats an alias). Derived indexes are rebuilt per device
and NEVER synced.

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

- `workspace/vault-context.tsx` — a `VaultProvider` owning the open note
  (`openPath`, persisted in ui-state under `workspace.openNote`), the file
  listing, and all vault actions; the note's live machinery (controller +
  autosave debounce + vanish watcher) is the extracted, unit-tested
  `workspace/note-runtime.ts`. Sidebar + editor + composer consume
  `useVault()`. Links + Backlinks panels (`workspace/links-panel.tsx`)
  collapse under the editor column. The sidebar file tree is VS Code-style
  (full-width rows, depth as in-row padding, roving-tabindex keyboard nav —
  `sidebar/tree-navigation.ts`).
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
- **File Properties**: a typed panel over YAML frontmatter, edited via the
  header's "Page details" popover (plus Raw mode) — the file is the ONLY
  store (`@repo/core/markdown/frontmatter` typing rules: true/false→checkbox,
  yes/no stay text, dates only YYYY-MM-DD; unsupported/invalid YAML preserved
  byte-exactly). The page-title <h1> above the doc IS the filename — editing
  it renames the file. Pasting/dropping an image writes bytes to `assets/`
  via `writeVaultAsset` and inserts bare `![](assets/…)`.
- **Palette extras**: `#` lists tags (inline `#tags` + frontmatter tags,
  case-unified in the core tag index) → notes with that tag; "New note from
  template…" applies `templates/*.md` with `{{date}}`/`{{title}}`
  substitution; ⌘D opens/creates today's `journal/YYYY-MM-DD.md` (Settings →
  Notes configures folder/format).
- **Deep links / capture**: the world-invokable `inteligir://` scheme has
  exactly five verbs (`packages/features/src/deep-link.ts`, pure parser +
  sanitizer): `append`/`task` capture ONE sanitized plain-text line onto
  TODAY's daily note — durable inbox + exactly-once apply (the open note's
  live buffer via `onCaptureApply`, else the host-side CAS drain in
  `server/capture/`) — and `today` / `note/<target>` / `search?q=` navigate.
  Target paths are computed host-side, never taken from the URL.
- **Tasks view**: a palette-launched alternate main surface like the graph
  ("Open tasks view") over the projection's per-doc task extraction (every
  GFM `- [ ]` is a task; per-note `tasks: false` opts out). Scheduling is
  association — first date-shaped `[[link]]` in the item, else the note's
  daily-note date — computed renderer-side via `@repo/core/knowledge/task-schedule`.
  Toggling goes through the guarded `toggleVaultTask` channel
  (`@repo/core/knowledge/guarded-line-edit`: ordinal-locate + raw-byte
  equality, refusal values kick an index self-heal); rows delegate through
  the same (sourceFile, ordinal) delegation store the editor uses.

### HTML Apps — vault `.html` as sandboxed views

A vault `.html` file opens as an app in the content panel: served by the
`vault-app://` protocol (per-open token, confined through `VaultManager`,
revoked on close) into an iframe with `sandbox="allow-scripts allow-forms"`
and NO `allow-same-origin` — the frame can never reach the Bridge. Deps
(vanilla runtime + Tailwind browser + Alpine + theme) are host-injected at
serve time; agents author ONE self-contained file, no build step. Vault
access only via the async postMessage broker `window.inteligir.files`
(`list({query, tag, withProperties, limit})`, `read` → body+properties,
patch-like `update`, `backlinks`, confirmed `remove`; all with `safe*`
variants). The injected-deps + broker contract is append-only. Vaults are
single-user today; if sharing ever ships, foreign `.html` is untrusted code
on open — re-audit the broker's capability set before that lands.

### Delegation — `packages/features/src/server/delegation/`

A checkbox's "Delegate" → `delegation-manager.ts` (versioned `JsonStore` +
event-driven serialized queue) runs it on `background-agent.ts` (a second pi
session on `BACKGROUND_SESSION_DIR`). Before the agent dispatches, the host
**snapshots the file** (bytes under `~/.inteligir`, newest 50 kept) — the dock's
"Restore original" undoes an agent edit byte-exactly. The agent edits the file
via `./vault`, checks the box, and appends a result; completion kicks a vault
refresh (the ephemeral-index rule). Status streams to inline badges (`onDelegationsUpdated`).
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
in-process. Deploy is owner-only (see `apps/cloud/README.md`). Every engine
pass (explicit, debounced, periodic) reports through `onOutcome`; unresolved
conflict copies are listed in Settings → Sync with Open / Dismiss-copy.

### Agent surface — `packages/features/src/server/agent/`

Extension bundles are listed in `agent/bundles.ts` (static registry + disk-drift
test) and receive `AgentPorts` at register time — adding/removing a capability
is one folder + one line. `code-mode/` is the MCP/connectors capability
(over the `server/connectors/` daemon); `knowledge-tools/` exposes
`search_vault` (lexical, optional `tag` filter) and `get_backlinks` over the
knowledge engine.
`validateToolParametersSchema` rejects tool schemas that aren't a top-level
`Type.Object` (OpenAI silently rejects `anyOf`-rooted schemas). The chat agent
edits notes with pi's native file tools pointed at `./vault` — no custom edit
tool. Chat is a single persistent thread; the open note is auto-attached as
context (agent-side only). `Cmd+K` rolls a fresh thread. Two more no-tools pi
sessions serve the editor: inline-AI/intent classification, and an ephemeral
in-memory session for ghost-text on a fast model.
**Private notes** (`private: true` frontmatter, `docs/privacy.md` is the
contract): excluded from every AI surface on this device, fail-closed — the
agent's file tools refuse them (per-call live-disk probe in pi's `tool_call`
hook, `agent/privacy/`, path-normalization parity with pi's own tools),
`search_vault`/`get_backlinks` drop them entirely, editor AI + ghost text go
hard-off, the chat context hint withholds even the path, and delegation
refuses. Unparseable frontmatter counts as private. A leak-prevention
boundary for AI features, NOT a security boundary.

### IPC / Bridge

`packages/features/src/ipc-registry.ts` is the single source of truth: each channel
pairs a TypeBox payload schema with a result/event type, and the
transport-agnostic `Bridge` type is derived from it. `createHost` returns a
schema-validated handler map (`packages/features/src/server/handlers/`) that the desktop
shell serves over ONE local WebSocket server (`startWsHost`,
`packages/features/src/server/transport/ws-host.ts`); the renderer dials it with
`createWsBridge` using the endpoint + per-boot token the bootstrap-only
preload exposes as `window.bridgeBootstrap`. Add a channel = registry entry +
host handler + one line in the dev-harness fixture Bridge
(`apps/desktop/dev/fixture-bridge.ts`), which fails typecheck until covered.
The fixture stub must do something real against the in-memory state or throw
an error naming the gap — never silently return `[]`/undefined.

## Decisions

Durable architecture decisions code comments cite (plan files and ADR docs
are deleted on purpose — this section + PRs are the record):

- **Vault liveness: ephemeral listing + one open-note watcher** (PR #411).
  NO recursive filesystem watcher, ever. The vault LISTING is an on-demand
  crawl (TTL-shared snapshot) refreshed on window focus, app structural
  writes, delegation completion, and "Refresh vault"; the only watcher is a
  single non-recursive watch on the open note, filtered through a pure change
  classifier with self-save suppression, so the app's own autosaves generate
  zero vault-changed traffic. External edits to other files surface on the
  next refresh — that trade is the design. The persistent SQLite knowledge
  projection did NOT reverse this: it changed where DERIVED knowledge lives,
  not how disk changes are discovered; "ephemeral snapshot" comments refer to
  this on-disk crawl cadence.
- **The knowledge index is a wipe-and-rebuild cache.** The SQL KnowledgeStore
  persists projections (`~/.inteligir/indexes/<hash>.sqlite`) purely to make
  boot cheap; corruption or a version mismatch deletes and rebuilds from the
  vault. Nothing durable may ever live in index.sqlite — durable state
  belongs in the `~/.inteligir` JsonStores. Per-device, never synced.
- **Frontmatter is the ONLY property store.** No metadata DB, ever. Typed
  properties parse/serialize against the file's own YAML
  (`@repo/core/markdown/frontmatter`); YAML the typing rules can't represent
  is preserved byte-exactly, never coerced or dropped.
- **Delete = OS trash.** User-initiated deletes (`deleteVaultEntry`: sidebar,
  header, HTML-app broker, conflict dismiss) move the file to the OS trash
  via `HostPlatform.trashItem` (Electron `shell.trashItem`; permanent-remove
  fallback where the OS has none). The OS is the trash UI — no in-app trash
  view. Sync-applied remote deletes stay permanent (`VaultManager.delete`):
  the originating device already trashed, core's `SyncIo.remove` is
  synchronous by contract, and reconcile preserves conflicting local edits as
  sibling copies.
- **No tag rename/delete UI, ever.** Tags are projections over note bodies
  (inline `#tags` + frontmatter `tags:`); a "rename/delete tag" affordance is
  a bulk content mutation disguised as a filter-chip action. Edit the notes
  (or ask the agent).
- **`~/.inteligir` is owner-only** (0700 dirs / 0600 data files) because
  session transcripts and snapshots carry note content; `hardenAppDir`
  re-asserts it on every boot for files third parties (pi) create 0644.
  pi's auth.json stays pi-owned: plaintext-but-0600 by design — pi reads it
  directly during OAuth refresh, so there is no cipher-injection seam.
