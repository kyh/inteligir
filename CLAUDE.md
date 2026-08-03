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
- **Mobile**: Expo + Expo Router + NativeWind (@repo/mobile) — sync/read/light-edit companion, no agent
  (the Expo SDK major is pinned in `pnpm-workspace.yaml`'s catalog; naming it here only rots)
- **Cloud**: Cloudflare Worker (@repo/cloud) — Better Auth on D1 + a Durable Object per vault + R2
- **AI Agent**: pi coding agent framework (@earendil-works/pi-coding-agent)

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
packages/        # libraries — boundaries are PACKAGE facts (deps + exports maps)
  notes/         # PURE platform-neutral domain (@repo/notes) — runs in Worker/RN/renderer:
                 #   sync/      — vault-sync engine + protocol (reconcile, wire, HttpSyncPort)
                 #   knowledge/ — link graph, backlinks, lexical search, rename byte-surgery
                 #   markdown/  — remark parse pipeline, MDX vocabulary gate, wiki-links
  bridge/        # Iso wire contract (@repo/bridge) — Bridge/IPC registry, ws client +
                 # protocol, shared schemas; loads in renderer/RN/node (deps: notes only)
  installer/     # Generic CLI provisioning (@repo/installer) — checksum-verified
                 # GitHub-release binary install, seeding, execFile runner; leaf, no deps
  agent/         # The pi capability (@repo/agent) — Agent lifecycle, extension bundles,
                 # setup/auth, faux provider, and pi/ (the harness quarantine: the ONLY
                 # place @earendil-works/pi* may be imported). The server injects AgentPorts.
  storage/       # Node fs/json substrate (@repo/storage) — versioned JsonStore over
                 # ~/.inteligir, atomic-write, host lock, hardenAppDir sweep, agent.log
                 # tee, encrypted SecretStore (cipher injected by the host)
  vault/         # VaultManager (@repo/vault) — the user's markdown folder: confined IO,
                 # ephemeral listing + open-note watcher, pure change classifier; host
                 # callbacks (notifier, workspace link dir, OS trash) injected
  voice/         # Voice capability (@repo/voice) — sherpa-onnx STT + model download,
                 # ElevenLabs TTS proxy, voice secret; host seams injected at register
  connectors/    # MCP/connectors capability (@repo/connectors) — executor daemon
                 # lifecycle + typed client, connector install orchestration (ports-
                 # injected), Google OAuth client, emulate-connectors dev override
  sync/          # Desktop vault-sync adapters (@repo/sync) — node SyncManager over the
                 # notes engine, SyncAccount (Better Auth client), SyncCoordinator
                 # lifecycle; event emission + vault access injected
                 # (setSyncEventSink, setSyncVaultAccessor)
  server/        # Node backend (@repo/server) — the composition root: boot/ (createHost),
                 # handlers, transport (ws host), app machine, provider, knowledge shell,
                 # delegation, capture, restore (AI-edit undo), HostPlatform. Exports
                 # are NARROW: only the entrypoints desktop main composes.
  ui/            # Shared UI components (@repo/ui) — web-only (Base UI + Tailwind)
```

Dep DAG (every edge between `packages/`, pinned against the manifests by
`dep-dag.test.ts`): notes, installer, storage, ui are leaves; bridge→notes;
vault→storage+notes+bridge; agent→bridge+installer+notes;
voice→storage+bridge; connectors→installer+storage+bridge (agent never
imports connectors: code-mode reaches the daemon through the injected
ExecutorPort; the boot-computed fail-closed dev-flag gate is single-source
in @repo/bridge/dev-flags); sync→vault+storage+notes+bridge;
server→agent+bridge+connectors+notes+storage+sync+vault+voice.
The renderer and mobile reach the backend through @repo/bridge (+notes/ui)
ONLY — never @repo/server — but "no node in the UI's contract" is enforced
differently per app. For mobile it is an unresolvable-import fact: @repo/mobile
depends on bridge+notes and nothing else. Desktop cannot claim that — the app
package DOES depend on @repo/server because main composes the host — so the
renderer's freedom from it is `no-restricted-imports` over `renderer/**` +
`dev/**`, plus `dep-dag.test.ts` for `renderer/__tests__/**`, where that lint
override is switched off. The extracted host packages (storage, vault, voice,
connectors, sync) sit BELOW server: they never import @repo/server (that
would be a package cycle) or electron — upward needs cross module-scoped
install seams the composition root fills (setSecretCipherProvider,
setVaultTrashItem, configureVoiceModelHost/configureTts,
setSyncEventSink/setSyncVaultAccessor; ConnectorInstallOps binds openExternal
per call).

`@repo/notes` is the sharing seam: no node/electron/react/workspace imports
(lint- and tsconfig-enforced); platforms inject capabilities (hasher, IO,
clock) — see `notes/src/sync/engine.ts`. Desktop and mobile drive the SAME sync
engine and knowledge/markdown code through thin adapters.

The product's UI lives in the desktop renderer (`apps/desktop/src/renderer`).
The product is the **Electron desktop** app (`pnpm dev:desktop`) over the
`@repo/server` host, communicating over a local WebSocket
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
pnpm verify           # The whole gate, mirroring CI (see Quality Gates)
```

**`docs/development.md` is the full dev guide**: the two run modes (fixture
harness / Electron), ports + `~/.inteligir` shared state +
`host.lock`, the fixture byte-pinning rule, and verification patterns. The
two change checklists are skills, not prose — `.claude/skills/add-bridge-channel`
and `.claude/skills/add-editor-node` carry the worked recipes.

## Agent-driven development

`AGENTS.md` is the tool-agnostic guide meant to be **run** — read it before
touching anything. The essentials:

- **Provision**: `pnpm install`. That's all — there is no bootstrap script and
  the desktop app is guest by default (sync is off), so most flows need no
  account at all.
- **Fastest loop**: `pnpm --filter @repo/desktop dev:harness` — the real
  renderer UI in a plain browser over the fixture Bridge, no Electron, no
  backend.
- **Verify**: `pnpm format:fix && pnpm verify` for the static gate, then drive
  the running app. Every surface except mobile is headlessly verifiable —
  harness and web via `agent-browser open`, the real Electron app via
  `agent-browser connect 9222`, the Worker via curl.
- **No seeded login.** If you need an account, stand up the local Worker —
  `AGENTS.md` § "There is no seeded login" has the verified four-command
  recipe. Never run `db:push`: it hits production D1.
- **Login-free agent flows**: `INTELIGIR_FAUX_AGENT=1` /
  `INTELIGIR_EMULATE_CONNECTORS=1` (both fail closed) drive chat, delegation
  and a connector connect with zero OAuth — `.claude/skills/e2e-drive` and
  `docs/e2e-driving.md`.

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
pnpm format:fix && pnpm verify
```

`verify` is `typecheck && lint && knip && format && test && build` — the same
six steps CI runs, in one command so no caller can drift from CI. It is
check-only on purpose: `format:fix` runs FIRST and never after the gates,
because formatting the byte-pinned fixtures corrupts them and ships red.

## Desktop architecture (@repo/desktop)

Three processes: **main** (Electron), **preload**, **renderer**. The renderer
(`src/renderer/`) is the whole product UI: the preload is bootstrap-only
(it exposes the ws endpoint + per-boot local token as
`window.bridgeBootstrap` over one sendSync channel), and `main.tsx` dials it
with `createWsBridge`, installs the Bridge, and renders `App`. Renderer code
is host-agnostic — it reaches the backend only through the injected Bridge
(`@renderer/lib/bridge`), never electron/node/host (lint-enforced, and
@repo/server isn't even a renderer dep). `@repo/agent` never imports
`@repo/server` — a package fact (no dep edge); the host composes
capabilities and hands the agent an injected `AgentPorts`
(`{ executor, knowledge }`).

### Data model — the vault

`packages/vault/src/` (`VaultManager`, @repo/vault) owns the vault: a user-chosen
folder whose markdown files are canonical. It reads through to disk (never
quarantines user files) and writes atomically. Liveness is the **ephemeral
listing** (§ Decisions): NO recursive watcher — the listing is a one-shot crawl
(uncapped; `.gitignore` filters the VIEW at read time, never the crawl or the
sync manifest — absence from the manifest is a DELETE) refreshed on window
focus, app writes,
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
wiki-target list) are `@repo/notes/knowledge/*` — pure, platform-neutral:
`projectDoc()` is the ONE parse per doc, `LinkGraphIndex` resolves links over
projections, and the SQL `KnowledgeStore` (schema + FTS5 bm25 search, written
once in core over an injected `SqlDriver`) persists projections per vault in
`~/.inteligir/indexes/<hash>.sqlite`. Markdown stays the only source of
truth — the DB is a wipe-and-rebuild CACHE (any corruption/version mismatch
deletes and rebuilds; **nothing durable may ever live in index.sqlite** —
durable state belongs in the `~/.inteligir` JsonStores).
`packages/server/src/knowledge/` is the node host shell: boot
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

- `workspace/vault-context.tsx` — a `VaultProvider` that PRODUCES all vault
  state but exposes it through three cadence-split seams: the stable
  `VaultActionsContext` callbacks (`useVaultActions` — identity fixed, so
  action-only consumers never re-render), `VaultListingContext`
  (`useVaultListing`: entries + folderName + wiki resolver, changes only on
  a structural refresh), and the high-cadence open-note slice in a zustand
  store (`workspace/open-note-store.ts`, `useOpenNote` via selectors —
  `openPath` persisted in ui-state under `workspace.openNote`) so a
  keystroke re-renders only the editor. The note's live machinery
  (controller + autosave debounce + vanish watcher) is the extracted,
  unit-tested `workspace/note-runtime.ts`. ONE Connections panel
  (`workspace/connections-panel.tsx`) — the notes that link INTO this one —
  collapses under the editor column; outgoing links are already on screen in
  the document (unresolved ones dashed, with a create affordance) and counted
  in Page details, so they are not restated below it. The sidebar file tree is VS Code-style
  (full-width rows, depth as in-row padding, roving-tabindex keyboard nav —
  `sidebar/tree-navigation.ts`).
- The markdown parse pipeline (remark-gfm + math + MDX vocabulary +
  wiki-links + frontmatter) lives in `@repo/notes/markdown/*`;
  `editor/markdown/` is the Plate-coupled byte-stability brain over it — the
  Slate↔mdast rules and the idempotent round-trip (bounded fixpoint). **Rich
  is the default surface**:
  any file that parses within the vocabulary opens Rich and normalizes on the
  first real edit; only unrepresentable content (unknown JSX, parse errors)
  opens Raw (byte-exact) with the badge. Every node type lives in
  `editor/kits/*` as a Base (headless) + React pair; `base-kit.ts` composes
  the Base halves for the headless serializer mirror — kit-parity tests make
  drift impossible. The round-trip fixture matrix under
  `src/renderer/__tests__/fixtures/` is byte-pinned (oxfmt ignores it — formatting
  fixtures is corruption).
- **Editor AI** (pi-backed, transient-only — AI state never reaches disk):
  ⌘J AI menu (cursor vs selection command sets + Translate page, host-side
  intent classification for free-form prompts; generate streams under an `ai`
  mark; edit lands as accept/reject suggestions), reachable from the selection
  toolbar, slash menu, block menu, and space-in-empty-paragraph; ghost-text
  completions on a fast model, on by default (Settings › Editor AI opts out).
- **File Properties**: a typed panel over YAML frontmatter, edited via the
  header's "Page details" popover (plus Raw mode) — the file is the ONLY
  store (`@repo/notes/markdown/frontmatter` typing rules: true/false→checkbox,
  yes/no stay text, dates only YYYY-MM-DD; unsupported/invalid YAML preserved
  byte-exactly). The page-title <h1> above the doc IS the filename — editing
  it renames the file. Pasting/dropping an image writes bytes to `assets/`
  via `writeVaultAsset` and inserts bare `![](assets/…)`.
- **Palette extras**: ONE search box — a `tag:<name>` term narrows the search
  to that tag (inline `#tags` + frontmatter tags, case-unified in the core tag
  index); clicking an inline `#tag` chip seeds it. The text ∧ tag composition
  is `@repo/notes/knowledge/vault-search`, shared verbatim with the agent's
  `search_vault`, so there is no separate tag browser to drift from it.
  "New note from template…" applies `templates/*.md` with `{{date}}`/`{{title}}`
  substitution; ⌘D opens/creates today's `journal/YYYY-MM-DD.md` (Settings →
  Notes configures folder/format); "Read page aloud"/"Stop reading" speaks
  the open note over the ElevenLabs TTS path (`renderer/voice/read-aloud.ts`
  — chunked into the one tts client; hidden for private notes, fail-closed
  re-check before sending; stops on note switch / voice-chat start).
- **Deep links / capture**: the world-invokable `inteligir://` scheme has
  exactly six verbs (`packages/bridge/src/deep-link.ts`, pure parser +
  sanitizer): `append`/`task` capture ONE sanitized plain-text line onto
  TODAY's daily note — durable inbox + exactly-once apply (the open note's
  live buffer via `onCaptureApply`, else the host-side CAS drain in
  `server/capture/`) — `today` / `note/<target>` / `search?q=` navigate, and
  `session?code=…&state=…` completes a social sign-in (an opaque single-use
  exchange code + the state nonce this device minted at initiation — NEVER a
  raw token; the host state-checks and exchanges it over HTTPS, see
  `packages/sync/src/sync-account.ts` + `apps/cloud/src/auth/desktop-session.ts`).
  Target paths are computed host-side, never taken from the URL.
- **Tasks view**: a palette-launched alternate main surface like the graph
  ("Open tasks view") over the projection's per-doc task extraction (every
  GFM `- [ ]` is a task; per-note `tasks: false` opts out). Scheduling is
  association — first date-shaped `[[link]]` in the item, else the note's
  daily-note date — computed renderer-side via `@repo/notes/knowledge/task-schedule`.
  Toggling goes through the guarded `toggleVaultTask` channel
  (`@repo/notes/knowledge/guarded-line-edit`: ordinal-locate + raw-byte
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

### Delegation — `packages/server/src/delegation/`

A checkbox's "Delegate" → `delegation-manager.ts` (versioned `JsonStore` +
event-driven serialized queue) runs it on `background-agent.ts` (a second pi
session on `BACKGROUND_SESSION_DIR`). Before the agent dispatches, the host
**snapshots the file** (bytes under `~/.inteligir`, newest 50 kept) — the dock's
"Restore original" undoes an agent edit byte-exactly. The agent edits the file
via `./vault`, checks the box, and appends a result; completion kicks a vault
refresh (the ephemeral-index rule). Status streams to inline badges (`onDelegationsUpdated`).
`find-task-line.ts` is the pure, content-addressed locator.
`server/restore/` (`RestoreManager` over the `SnapshotStore`) is the ONE
AI-edit-undo module both surfaces call in through: the chat tool gate captures
per allowed write (fail-closed — a capture failure blocks the tool) behind the
post-turn undo toast, and delegation captures pre-run behind the dock's
"Restore original".

### Routines — `packages/server/src/routines/`

Delegation's sibling, on the SAME background pi session and the shared
`background-turn-lock`: a routine is a saved prompt plus a schedule (cadence +
time-of-day), run UNPROMPTED by a timer. `routine-schedule.ts` in
`@repo/bridge` is the pure due-computation; `routines-manager.ts` owns the
versioned store, the serialized run queue and the pre-run snapshot. The risk
shape differs from delegation on purpose and the code leans on it: nobody is
watching when a routine fires, so the write path is HOST-owned (the manager
appends the result) rather than agent-owned, and an epoch guard bails mid-run
if the routine was disabled or deleted while the turn was in flight. Surfaced
in Settings → Routines (list, add/edit, enable, Run now, Restore last run).

### Remote access — `packages/server/src/transport/`

Off by default. When enabled (Settings → Remote access) the ws host binds
0.0.0.0 instead of loopback and a phone pairs with a one-time token, minting a
revocable device token; `remote-access-manager.ts` owns the device roster, and
a revoke closes the live socket, not just future auths.

A paired device is NOT the renderer. It reaches only
`REMOTE_ALLOWED_METHODS` / `REMOTE_ALLOWED_EVENTS`
(`@repo/bridge/ipc-registry`) — today the chat + delegation-dock channels the
Expo companion drives, and nothing else. These are ALLOWLISTS on purpose: a new
channel is unreachable from a remote device until named. The ws host enforces
them at three points, all three required — invoke/send dispatch, event
broadcast, AND the reconnect hydration push (which resolves a getter host-side
and would otherwise volunteer state the method gate forbids asking for).

### Vault sync — `@repo/notes/sync` + `apps/cloud` + platform adapters

**Off by default** (runtime `sync-config` store; Settings → Sync). One pure
engine — `notes/src/sync/engine.ts` (3-way last-write-wins `reconcile`, conflicts
preserved as sibling copies, never lost) — with injected platform ports:
desktop binds node crypto/VaultManager/JsonStore
(`packages/sync/src/sync-manager.ts`, lifecycle in
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

### Agent surface — `packages/agent` (@repo/agent)

Extension bundles are listed in `packages/agent/src/bundles.ts` (static registry + disk-drift
test) and receive `AgentPorts` at register time — adding/removing a capability
is one folder + one line. `code-mode/` is the MCP/connectors capability
(over the @repo/connectors daemon); `knowledge-tools/` exposes
`search_vault` (lexical, optional `tag` filter), `get_backlinks`,
`get_links` (resolved forward links; a dangling one surfaces as
`{target, unresolved: true}`, never dropped), `related_notes` (ranked
indirect connections with reasons), and the link-rewriting `rename_note`
over the knowledge engine. The four read tools return a JSON array, not
newline-joined rows — a note body can contain both the row and field
delimiters, so prose encoding let a note forge hits pointing at paths it
does not own.
`validateToolParametersSchema` rejects tool schemas that aren't a top-level
`Type.Object` (OpenAI silently rejects `anyOf`-rooted schemas). The chat agent
edits notes with pi's native file tools pointed at `./vault` — no custom edit
tool. Chat is a single persistent thread; the open note is auto-attached as
context (agent-side only). `Cmd+K` rolls a fresh thread. Two more no-tools pi
sessions serve the editor: inline-AI/intent classification, and an ephemeral
in-memory session for ghost-text on a fast model.
`vault/AGENTS.md` is the user's standing instructions — seeded once per vault
root, loaded into the chat + delegation sessions as an extra context file
(`packages/server/src/agent-instructions/`), skipped when marked
`private: true`, and the file the bundled prompt nudges the agent to append
durable memory to. Instruction files reach the model VERBATIM in every turn's
system prompt (nothing in pi truncates them —
`packages/agent/src/__tests__/agents-file-budget.test.ts`), so their bytes are
a recurring per-turn cost. Repo-authored instruction files are held to a
budget by that test; `vault/AGENTS.md` is the one the host must bound at
runtime instead, because the agent appends to it unattended — the loader keeps
the head (standing instructions) and sheds the tail (accumulated memory).
**Private notes** (`private: true` frontmatter, `docs/privacy.md` is the
contract): excluded from every AI surface on this device, fail-closed — the
agent's file tools refuse them (per-call live-disk probe in pi's `tool_call`
hook, `packages/agent/src/privacy/`, path-normalization parity with pi's own tools),
`search_vault`/`get_backlinks`/`get_links`/`related_notes` drop them entirely
(`get_links` is the one with no index-level prefilter — forwardLinks also
serves Page details' outgoing/unresolved counts, which must match the file's
real bytes, so its whole privacy story is the port's live-disk probe), editor
AI + ghost text + read-aloud go hard-off, the chat context hint withholds even
the path, and delegation refuses. Unparseable frontmatter counts as private. A
leak-prevention boundary for AI features, NOT a security boundary.

### IPC / Bridge

`packages/bridge/src/ipc-registry.ts` is the single source of truth: each channel
pairs a TypeBox payload schema with a result/event type, and the
transport-agnostic `Bridge` type is derived from it. `createHost` returns a
schema-validated handler map (`packages/server/src/handlers/`) that the desktop
shell serves over ONE local WebSocket server (`startWsHost`,
`packages/server/src/transport/ws-host.ts`); the renderer dials it with
`createWsBridge` using the endpoint + per-boot token the bootstrap-only
preload exposes as `window.bridgeBootstrap`. Add a channel = registry entry +
host handler + one line in the dev-harness fixture Bridge
(`apps/desktop/dev/fixture-bridge.ts`), which fails typecheck until covered.
The fixture stub must do something real against the in-memory state or throw
an error naming the gap — never silently return `[]`/undefined.

## Decisions

**Before raising a "new" finding, read the `note` issues.** Findings that were
investigated and deliberately declined live there so they are not re-raised:
[#446](https://github.com/kyh/inteligir/issues/446) (general),
[#453](https://github.com/kyh/inteligir/issues/453) (privacy model's accepted
holes — `docs/privacy.md` is the contract),
[#472](https://github.com/kyh/inteligir/issues/472) (routines/delegation
autonomous-write residuals), and
[#474](https://github.com/kyh/inteligir/issues/474). An issue's PLAN can name
paths that no longer exist even when its concern is live — verify every path
before following it.

Plan files and ADR docs are not tracked in this repo; this section is the
record for the decisions code comments cite.

- **Vault liveness: ephemeral listing + one open-note watcher.**
  NO recursive filesystem watcher, ever. The vault LISTING is an on-demand
  crawl (TTL-shared snapshot) refreshed on window focus, app structural
  writes, delegation completion, and "Refresh vault"; the only watcher is a
  single non-recursive watch on the open note, filtered through a pure change
  classifier with self-save suppression, so the app's own autosaves generate
  zero vault-changed traffic. External edits to other files surface on the
  next refresh — that trade is the design. "Ephemeral snapshot" in a comment
  refers to this on-disk crawl cadence, not to the SQLite projection, which
  governs where DERIVED knowledge lives rather than how disk changes are seen.
- **The knowledge index is a wipe-and-rebuild cache.** The SQL KnowledgeStore
  persists projections (`~/.inteligir/indexes/<hash>.sqlite`) purely to make
  boot cheap; corruption or a version mismatch deletes and rebuilds from the
  vault. Nothing durable may ever live in index.sqlite — durable state
  belongs in the `~/.inteligir` JsonStores. Per-device, never synced.
- **Frontmatter is the ONLY property store.** No metadata DB, ever. Typed
  properties parse/serialize against the file's own YAML
  (`@repo/notes/markdown/frontmatter`); YAML the typing rules can't represent
  is preserved byte-exactly, never coerced or dropped.
- **Delete = OS trash.** User-initiated deletes (`deleteVaultEntry`: sidebar,
  header, HTML-app broker, conflict dismiss) move the file to the OS trash
  via `HostPlatform.trashItem` (Electron `shell.trashItem`; permanent-remove
  fallback where the OS has none). The OS is the trash UI — no in-app trash
  view. Sync-applied remote deletes stay permanent (`VaultManager.delete`):
  the originating device already trashed, core's `SyncIo.remove` is
  synchronous by contract, and reconcile preserves conflicting local edits as
  sibling copies.
- **Sync has THREE independent deletion guards; never merge them.** The
  empty-listing refusal and the unaccounted-in-base refusal recognize a
  specific broken LISTING; the deletion gate (`packages/notes/src/sync/engine.ts`)
  recognizes an implausible RESULT — a plan deleting more than
  `max(25, 5% of the base manifest)` is held whole, applying nothing and
  leaving the anchor clean, until a human confirms it. That third layer exists
  because every listing rule has eventually leaked, and it is the only one that
  needs no listing invariant to hold. It **bounds the blast radius of a leak;
  it does not detect one** — it reads a count, never a cause, so a leak that
  sheds a single path (one case-only rename, one symlink) sits far below the
  floor and passes straight through. Only an explicit human action may pass
  `confirmDeletions`, which carries the approved COUNT and waives the gate only
  up to it, for one pass, never persisted: the confirmed pass re-reconciles, so
  a plan that grew since the hold holds again with the new number. The
  debounced, periodic and realtime passes must always be able to do nothing but
  report the hold. The gate is **per device against that device's own anchor**,
  so a confirmation on one device CAUSES the hold on every other — desktop
  (Settings → Sync, plus a global toast on the transition into held) and mobile
  (the vault screen's status row) each carry their own confirm affordance, and
  neither may tell the user to go and confirm on the other.
- **No tag rename/delete UI, ever.** Tags are projections over note bodies
  (inline `#tags` + frontmatter `tags:`); a "rename/delete tag" affordance is
  a bulk content mutation disguised as a filter-chip action. Edit the notes
  (or ask the agent).
- **`~/.inteligir` is owner-only** (0700 dirs / 0600 data files) because
  session transcripts and snapshots carry note content; `hardenAppDir`
  re-asserts it on every boot for files third parties (pi) create 0644.
  pi's auth.json stays pi-owned: plaintext-but-0600 by design — pi reads it
  directly during OAuth refresh, so there is no cipher-injection seam.
- **Remote-device capability is an ALLOWLIST, never a blocklist.** A blocklist
  leaves every channel added after it was written silently reachable by a
  paired phone — including destructive ones like `RESET_APP_DATA`. Allowlists
  fail closed. Adding a channel to `REMOTE_ALLOWED_*` is a deliberate act with
  a threat model attached, not a default.
- **Host services are process-global `getX()` singletons ON PURPOSE.** Do not
  thread an explicit `HostContext` through the handlers, and do not build a
  disposable registry. One host per process is a domain fact (a single-user
  desktop app), enforced by the `createHost` guard plus `host.lock`. The
  managers are constructor-injectable, so tests already build them with fakes
  (`delegation-manager.test.ts`) — the conversion would buy testability that
  exists, across 185 `getX()` call sites in 53 files and 5 package APIs. The
  `reset*()` set that `teardownAgentResources()` calls is ORDER-INDEPENDENT:
  every body is `instance?.close(); instance = null`, and a reset that reads
  another singleton is a bug. The only real ordering is the four pins around
  `fs.rmSync` (drop caches, close the sqlite handle, suspend vault writes,
  re-assert the lock afterward), which no construction order derives and which
  stay hand-written with their inline comments. Completeness is enforced by a
  DERIVED test that greps every `packages/*/src` for the reset/dispose export
  convention — self-extending, not a maintained list.
- **Palette commands and settings sections stay hardcoded lists.** No command
  registry, no section registry, at ~11 commands and ~10 sections: a registry
  buys indirection and an ordering problem in exchange for a `.push()`.
  Revisit if a THIRD surface needs to contribute commands it does not own.
- **`KnowledgeIndex` is not dead code — do not delete it.** It never runs in
  production (the SQL `KnowledgeStore`'s FTS5 does), which makes it look
  deletable. `@repo/notes` carries no sqlite dependency deliberately — it is
  the pure sharing seam, `SqlDriver` is platform-injected — so this in-memory
  composition is the ONLY way the package can test its own knowledge engine;
  ~1,200 lines of tests for related-notes, tags, the link graph, the perf
  oracle and the privacy gate drive production logic through it.
- **SSE, not hibernatable WebSockets, for the vault DO changes stream**
  (`vault-coordinator.ts`). Cloudflare's WebSocket page recommends
  hibernation, but no doc says don't stream SSE from a Durable Object. Sync is
  OFF by default, so exposure is one resident DO per online synced device, and
  a rewrite would cross `@repo/notes/sync/wire` — the pure seam BOTH platforms
  drive — for a rounding-error bill. Revisit if sync becomes default-on.
- **The D1 auth schema ships via `drizzle-kit push`; there are no migration
  files.** Push is a supported primary flow for serverless databases, and the
  three things that make it dangerous are all absent here: one deployer (the
  account owner), an additive schema, and nothing derived that can rot —
  `apps/cloud/vitest.config.ts` builds the test DDL by running
  `drizzle-kit export` over `src/db/schema.ts`, so the suite always runs the
  schema the source declares. A second deployer or a destructive column change
  is the trigger for adopting migrations. The Better Auth tables in that
  schema are hand-written and diverge from `@better-auth/cli generate` in two
  places on purpose: timestamps are `mode: "timestamp"` (epoch SECONDS) where the
  generator emits `timestamp_ms`, and the generator's three secondary indexes
  (`session.userId`, `account.userId`, `verification.identifier`) are absent —
  cold paths over a handful of rows, while the hot path `session.token` is
  unique and therefore already indexed. **Never flip the timestamp mode in
  place.** Both modes read the same INTEGER column, so a redeploy without an
  accompanying `UPDATE <table> SET <col> = <col> * 1000` reads every stored
  date back as 1970 — which expires every live session and every pending
  verification token.
- **Better Auth's `baseURL` is derived per-request from the request origin**,
  never configured or allowlisted. Two things hold it up. The Worker declares
  no `routes` and no custom domain, so its workers.dev hostname is the only one
  that reaches it and a spoofed `Host` never arrives — which is what makes
  trusting the incoming origin safe. And the coordinator URL is per-install
  configuration (Settings → Account; a self-hoster points at their own Worker),
  so a fixed fallback would mint password-reset links back at the wrong
  deployment. Adding a route or a custom domain is the trigger to revisit: once
  more than one hostname reaches the Worker, the origin needs a gate.
- **React Compiler is deliberately not adopted** (both Vite configs; ~148 memo
  call sites). react.dev recommends it for _new_ apps and says existing apps
  should "roll out at your own pace." If it is ever adopted, annotation mode
  on leaf components is the only defensible entry — explicitly NOT the
  Plate/Slate tree (it mutates editor nodes) and NOT `vault-context.tsx`,
  whose memo identities ARE the cadence-split contract, not an optimization
  the compiler may reason about.
- **No coverage tooling, on purpose** (0 of 14 vitest configs, no provider, no
  CI step). This repo enforces targeted invariants STRUCTURALLY —
  teardown-completeness, no-dead-channels, no-ungated-dispatch, kit-parity,
  no-orphan-components, pi-quarantine — rather than via a global percentage
  that would be satisfied by tests asserting nothing. A derived fitness test
  that fails when a SIXTH dispatch path appears is worth more than a coverage
  number. If coverage is ever added: `coverage.include` is MANDATORY in
  Vitest 4 (`coverage.all` was removed), and gate only `@repo/notes`.
- **Renderer component tests drive the DOM with `fireEvent`, not
  `@testing-library/user-event`** (which is not a dependency). user-event is a
  fidelity upgrade — it replays the full pointer/keyboard sequence — not a
  correctness fix, and these tests assert handler wiring rather than input
  semantics. It also costs something real here: `markdown-editor.test.tsx`
  runs on fake timers to drive the autosave debounce, and user-event hangs
  under fake timers unless every call is wired to `advanceTimers`. Reach for
  it only for a test that genuinely depends on the event sequence a real user
  produces.
- **Two generator defaults are deliberately inert.**
  `packages/ui/components.json` declares `rsc: true` and there is no per-app
  `components.json`: the shadcn CLI's monorepo add flow is not used — components
  live in `packages/ui` behind the no-orphan-components test — and the
  `"use client"` directives the flag produces are ignored by both consumers,
  which are plain Vite/Rollup builds with no RSC bundler in the graph.
  `apps/mobile/src/styles.css` opens with `@import "tailwindcss"` rather than
  the per-layer sub-imports; that file IS the inlined concatenation of theme +
  preflight + utilities, so there is no compiled-output delta, and the
  sub-import form only buys anything on a web target — `react-native-web` is
  not in the mobile dependency graph.
- **The CSP grants bare `https:` to `frame-src` and `connect-src`**
  (`apps/desktop/src/renderer/index.html`). Three MDX vocabulary nodes render
  remote https iframes (`<file>`, `<video>`, `<media_embed>`) and the embed
  dialog promises "any page"; react-tweet fetches its own API host. So **the
  http(s) scheme gate and the PDF content gate in `navigation-guard.ts` are
  the only narrowing** — deleting either re-opens exactly what they guard.
  `apps/desktop/dev/index.html` must carry the same resource directives: it is
  the only surface that can catch a CSP regression, since jsdom does not
  enforce CSP.
- **The packaged renderer loads over `file://`, not a custom `app://` scheme.**
  This is a real deviation from the Electron security checklist, held safe by
  everything around it: `sandbox: true`, `contextIsolation: true`,
  `nodeIntegration: false`, the CSP, the navigation guard pinning the window to
  the loaded URL, and a window-open handler that denies every popup. Migrating
  ripples wider than the one `loadFile` call: the CSP's `'self'` starts meaning
  something different, `isSameOriginNavigation`'s file: branch (opaque origin,
  so exact-URL match) collapses into a normal origin compare, Vite's asset base
  changes, and `html-app-view.tsx`'s broker gains a meaningful `event.origin` —
  today the window and its no-same-origin frame both report the opaque `null`,
  so source identity plus the per-open token is the only discriminator
  available. Do it when the renderer needs a capability `file://` cannot
  grant — a service worker, an origin-scoped storage API, or a fetch that must
  be same-origin.
