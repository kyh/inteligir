# Agent Instructions

## Project Overview

**inteligir** — an AI-native notes app (Obsidian-with-an-agent), hosted. You
sign in; your content is markdown files in a vault the service holds for you.
It's AI-native two ways: chat to an agent that edits those files, and highlight
a checkbox to _delegate_ it to a background agent that does the task and writes
the result back.

Turborepo monorepo. One Cloudflare Worker (`apps/web`) is the whole product: the
marketing site, the auth API, and `/app` — a client-only route that mounts the
workspace UI over a WebSocket to a per-user Durable Object holding that user's
vault, knowledge index, agent, and background work. An Electron **shell**
(`apps/desktop`) wraps that URL in a window; an Expo app (`apps/mobile`) is a
signed-in companion shell. The UI itself lives in shared packages so every
client renders the same product.

## Tech Stack

- **Monorepo**: Turborepo + pnpm workspaces
- **Everything server-side**: Cloudflare Workers — TanStack Start + React 19 +
  Tailwind CSS 4 for the site, a `UserHost` Durable Object per account
  (SQLite manifest + FTS5 index), R2 for file bytes, D1 for Better Auth
- **Editor**: Plate (platejs) rich markdown + a raw textarea fallback
- **UI**: shadcn/ui (Base UI), lucide-react, sonner, zustand
- **Agent**: the pi coding agent, running in a per-user Cloudflare Sandbox
  container (`apps/web/container`) the Durable Object drives
- **Desktop**: Electron shell (@repo/desktop) — a window on the hosted app
- **Mobile**: Expo + Expo Router (@repo/mobile) — a signed-in shell
  (the Expo SDK major is pinned in `pnpm-workspace.yaml`'s catalog; naming it
  here only rots)

## Workspace Structure

```
apps/            # shippable artifacts
  web/           # THE PRODUCT (@repo/web) — one Worker: marketing site,
                 #   /api/auth/* (Better Auth on D1), and /app (the workspace,
                 #   client-only) over a UserHost Durable Object per account
  web/container/ # The agent image (@repo/agent-container) — pi in a per-user
                 #   Cloudflare Sandbox. Holds no credential and no policy.
  desktop/       # Electron SHELL (@repo/desktop) — a window on the hosted app,
                 #   the inteligir:// scheme, a tray, and shell auto-update
  mobile/        # Expo companion (@repo/mobile) — a signed-in shell
packages/        # libraries — boundaries are PACKAGE facts (deps + exports maps)
  notes/         # PURE platform-neutral domain (@repo/notes) — runs in workerd,
                 #   a browser and RN alike:
                 #   knowledge/ — link graph, backlinks, lexical search, rename
                 #                byte-surgery, task extraction, tags
                 #   markdown/  — remark parse pipeline, MDX vocabulary gate,
                 #                wiki-links, frontmatter typing
  bridge/        # Iso wire contract (@repo/bridge) — the Bridge/IPC registry,
                 #   the ws client + protocol, the agent grant table, shared
                 #   schemas (deps: notes only)
  ui/            # Shared UI components (@repo/ui) — Base UI + Tailwind
  editor/        # The note editor (@repo/editor) — Plate kits, the Slate↔mdast
                 #   round-trip, inline AI, the open-note store and runtime
  workspace/     # The product UI (@repo/workspace) — sidebar, editor pane,
                 #   composer, palette, settings, delegation dock, voice, and
                 #   the fixture Bridge every client's contract is proven against
tools/
  repo-guards/   # Derived fitness tests over the repo itself. Ships nothing.
```

Dep DAG (every edge between `packages/`, pinned against the manifests by
`tools/repo-guards/src/dep-dag.test.ts`): notes and ui are leaves; bridge→notes;
editor→bridge+notes+ui; workspace→bridge+editor+notes+ui. Every one of these
packages is bundled into a browser (and `notes`/`bridge` into React Native), so
none of them may import `node:*` or `electron` — that is a package fact for
`notes` and `bridge` (lint-enforced) and a shipped-source fact for the rest
(the same dep-dag test, which excludes their `__tests__`, where walking the
filesystem is the point).

`@repo/notes` is the sharing seam: no node/react/workspace imports (lint- and
tsconfig-enforced); callers inject capabilities (SQL driver, IO, clock).
The Worker drives it over a Durable Object's SQLite, and the fixture Bridge
drives the identical engine over SQLite-wasm.

## Common Commands

```bash
pnpm dev              # Dev all workspaces
pnpm dev:web          # THE PRODUCT — vite + miniflare, the real Worker locally
pnpm dev:desktop      # The Electron shell (point it somewhere with INTELIGIR_APP_URL)
pnpm build            # Build all
pnpm typecheck        # Type check all
pnpm lint             # Lint all   (oxlint)
pnpm format:fix       # Format     (oxfmt) — run BEFORE gates, never after
pnpm verify           # The whole gate, mirroring CI (see Quality Gates)
```

**`apps/web/README.md` is the deep guide to the product**: every route, the
Durable Object's vault and index, the agent, the auth surfaces, the local dev
recipe (including minting an invite), and the owner-only deploy.
`docs/development.md` is the shorter orientation across all three clients.
The two change checklists are skills, not prose — `.claude/skills/add-bridge-channel`
and `.claude/skills/add-editor-node` carry the worked recipes.

## Agent-driven development

`AGENTS.md` is the tool-agnostic guide meant to be **run** — read it before
touching anything. The essentials:

- **Provision**: `pnpm install`. That's all.
- **Fastest loop**: `pnpm dev:web` — the real Worker, the real Durable Object,
  the real agent path, in-process on miniflare.
- **Verify**: `pnpm format:fix && pnpm verify` for the static gate, then drive
  the running app with `agent-browser open`.
- **Sign-up is invite-only and there is no seeded login.** `apps/web/README.md`
  § Dev has the four-command recipe for a local account. Never run `db:push`:
  it hits production D1.
- **Login-free agent flows**: the whole test suite runs the agent on the
  in-memory container (`AGENT_RUNTIME=scripted`), which drives the production
  runner, tool executor, transcript and write-back over a fake sandbox.

## Verifying Changes

Use the **agent-browser** skill to drive a running app. Don't claim a UI change
works without driving it; type/test passing isn't feature-correct.

- `pnpm dev:web` serves the site and `/app`; `agent-browser open` drives it.
- `pnpm dev:desktop` runs the shell with `--remoteDebuggingPort 9222`;
  `agent-browser connect 9222` attaches to it. Point it at your local Worker
  with `INTELIGIR_APP_URL=http://localhost:5174`.

## Quality Gates

Before committing:

```bash
pnpm format:fix && pnpm verify
```

`verify` is `typecheck && lint && knip && format && test && build` — the same
six steps CI runs, in one command so no caller can drift from CI. It is
check-only on purpose: `format:fix` runs FIRST and never after the gates,
because formatting the byte-pinned fixtures corrupts them and ships red.

## The host — `apps/web/src/worker`

One Worker, three surfaces: the SSR'd marketing site, `/api/auth/*` (Better
Auth on D1 + Drizzle, bearer tokens), and `/v1/*` — which is a thin router in
front of `UserHost`, one Durable Object per account, addressed
`getByName("user:" + userId)`. **The Worker ADDRESSES; the object VERIFIES.**
No forwarded verdict exists to forge: every route names an object by userId,
and the object re-derives the truth from the session the caller presents and
refuses a name that does not match it.

### Data model — the vault

`host/vault/user-vault.ts` owns the vault: a manifest in the object's own
SQLite (path, version, content hash, size, `deleted_at`) with the bytes in R2.
It is the only writer, so there is nothing to poll and no listing to go stale.
Deletion is a TOMBSTONE (`state: "trashed"`), never a manifest row's removal —
the bytes stay in R2 and the row keeps its version, which is what makes a
delete undoable and a concurrent write to a trashed path a question the caller
must answer rather than a race.

Notes are **markdown with a fixed MDX vocabulary**: GFM plus `[[wiki-links]]`
(aliases, `![[transclusion]]`), `$$` math, mermaid fences, `> [!NOTE]` alerts,
and the MDX components `<toggle>`, `<column_group>/<column>`, `<video>`,
`<media_embed>`, `<file>`, `<date>`. Anything outside the vocabulary (unknown
JSX, expressions, HTML comments) sends the file to Raw mode rather than being
mangled. Files stay `.md`.

The derived indexes (wiki/md link graph, backlinks, full-text search, tags,
tasks, wiki-target list) are `@repo/notes/knowledge/*` — pure and
platform-neutral: `projectDoc()` is the ONE parse per doc, `LinkGraphIndex`
resolves links over projections, and the SQL `KnowledgeStore` (schema + FTS5
bm25 search, written once in core over an injected `SqlDriver`) persists
projections. `host/knowledge/` is the object's shell: it binds that store to
the DO's own SQLite (`do-sql-driver.ts`), hydrates the in-memory graph from
persisted rows at boot, and reconciles against the manifest's content hashes.
Renames rewrite `[[links]]` across the vault byte-surgically (shadow-protection
qualifies links the new name would steal) and record the old stem in the moved
doc's frontmatter `aliases:`.

### UI — `packages/workspace`, one fixed workspace

The UI consumes an injected `Bridge` (`@repo/bridge/client::installBridge`) and
reaches the host through nothing else. `workspace/workspace-page.tsx` is the
only surface: **Sidebar (file tree) | single-document Editor | BottomComposer**
(chat pinned bottom — no side chat panel, no tabs: opening a note replaces the
open one), settings behind a dialog; backlinks collapse under the editor
column; a right-edge TOC minimap expands on hover; the graph view (lazy
d3-force canvas) and full-text search live in the command palette.

- `workspace/vault-context.tsx` — a `VaultProvider` that PRODUCES all vault
  state but exposes it through three cadence-split seams: the stable
  `VaultActionsContext` callbacks (`useVaultActions` — identity fixed, so
  action-only consumers never re-render), `VaultListingContext`
  (`useVaultListing`: entries + folderName + wiki resolver, changes only on a
  structural refresh), and the high-cadence open-note slice in a zustand store
  (`@repo/editor/note/open-note-store`, `useOpenNote` via selectors —
  `openPath` persisted in ui-state under `workspace.openNote`) so a keystroke
  re-renders only the editor. The note's live machinery (controller + autosave
  debounce + vanish watcher) is the extracted, unit-tested
  `@repo/editor/note/note-runtime`. ONE Connections panel
  (`workspace/connections-panel.tsx`) — the notes that link INTO this one —
  collapses under the editor column; outgoing links are already on screen in
  the document (unresolved ones dashed, with a create affordance) and counted
  in Page details, so they are not restated below it. The sidebar file tree is
  VS Code-style (full-width rows, depth as in-row padding, roving-tabindex
  keyboard nav — `sidebar/tree-navigation.ts`).
- The markdown parse pipeline (remark-gfm + math + MDX vocabulary + wiki-links
  - frontmatter) lives in `@repo/notes/markdown/*`; `@repo/editor/markdown/` is
    the Plate-coupled byte-stability brain over it — the Slate↔mdast rules and
    the idempotent round-trip (bounded fixpoint). **Rich is the default
    surface**: any file that parses within the vocabulary opens Rich and
    normalizes on the first real edit; only unrepresentable content (unknown JSX,
    parse errors) opens Raw (byte-exact) with the badge. Every node type lives in
    `@repo/editor/kits/*` as a Base (headless) + React pair; `base-kit.ts`
    composes the Base halves for the headless serializer mirror — kit-parity
    tests make drift impossible. The round-trip fixture matrix under
    `packages/editor/src/__tests__/fixtures/` is byte-pinned (oxfmt ignores it —
    formatting fixtures is corruption).
- **Editor AI** (transient-only — AI state never reaches disk): ⌘J AI menu
  (cursor vs selection command sets + Translate page, host-side intent
  classification for free-form prompts; generate streams under an `ai` mark;
  edit lands as accept/reject suggestions), reachable from the selection
  toolbar, slash menu, block menu, and space-in-empty-paragraph; ghost-text
  completions on a fast model, on by default (Settings › Editor AI opts out).
- **File Properties**: a typed panel over YAML frontmatter, edited via the
  header's "Page details" popover (plus Raw mode) — the file is the ONLY store
  (`@repo/notes/markdown/frontmatter` typing rules: true/false→checkbox, yes/no
  stay text, dates only YYYY-MM-DD; unsupported/invalid YAML preserved
  byte-exactly). The page-title `<h1>` above the doc IS the filename — editing
  it renames the file. Pasting/dropping an image writes bytes via
  `writeVaultAsset` and inserts bare `![](assets/…)`.
- **Palette extras**: ONE search box — a `tag:<name>` term narrows the search
  to that tag (inline `#tags` + frontmatter tags, case-unified in the core tag
  index); clicking an inline `#tag` chip seeds it. The text ∧ tag composition
  is `@repo/notes/knowledge/vault-search`, shared verbatim with the agent's
  `search_vault`, so there is no separate tag browser to drift from it.
  "New note from template…" applies `templates/*.md` with `{{date}}`/`{{title}}`
  substitution; ⌘D opens/creates today's `journal/YYYY-MM-DD.md` (Settings →
  Notes configures folder/format); "Read page aloud"/"Stop reading" speaks the
  open note over the TTS path (`voice/read-aloud.ts` — chunked into the one tts
  client; stops on note switch / voice-chat start).
- **Deep links / capture**: `inteligir://` has exactly six verbs
  (`packages/bridge/src/deep-link.ts`, pure parser + sanitizer) and the web
  answers five of them at `POST /v1/host/:userId/link`: `append`/`task` capture
  ONE sanitized plain-text line onto TODAY's daily note (durable inbox +
  exactly-once apply — the open note's live buffer via `onCaptureApply`, else
  the host-side CAS drain), and `today` / `note/<target>` / `search?q=`
  navigate. Target paths are computed host-side, never taken from the URL. It
  is a POST because a GET a page can cause is a CSRF write; `/app/link` is the
  navigable client that reads the query and calls it with the user's bearer,
  and the desktop shell translates the scheme into that route.
- **Tasks view**: a palette-launched alternate main surface like the graph
  ("Open tasks view") over the projection's per-doc task extraction (every GFM
  `- [ ]` is a task; per-note `tasks: false` opts out). Scheduling is
  association — first date-shaped `[[link]]` in the item, else the note's
  daily-note date — computed client-side via
  `@repo/notes/knowledge/task-schedule`. Toggling goes through the guarded
  `toggleVaultTask` channel (`@repo/notes/knowledge/guarded-line-edit`:
  ordinal-locate + raw-byte equality, refusal values kick an index self-heal);
  rows delegate through the same (sourceFile, ordinal) delegation store the
  editor uses.

### The agent — `apps/web/src/worker/agent/` + `apps/web/container`

The object owns the vault, the transcript, the grant table and **every tool
implementation**; the container owns the model loop and a scratch copy of the
vault at `/workspace/vault`. It holds no credential (a placeholder key goes in,
and the sandbox's outbound interception swaps in a freshly minted short-lived
one on the way out — `agent/egress.ts`), no tool implementation and no policy.

**What the agent may do is DECLARED, not inferred**: `@repo/bridge/agent-grants`
is the grant table — policy rows (`capability`, `agentName`, `tier`,
`description`-for-a-model) across four granted tiers plus the never-granted set
grouped by reason. It is not an allowlist of bridge methods like
`REMOTE_ALLOWED_METHODS`, because a companion client reaches the identical
handler and the agent must not: every row is implemented separately, host-side,
in `agent/agent-tools.ts`. The mutating tiers capture a restore point before
writing (fail-closed) and the destructive tier raises a human confirmation
inside the executor, so no tool can skip it (`agent/confirmations.ts` →
`onAgentConfirmationRequested`; unanswered expires as a decline);
`delegate_task` is additionally capped per turn, being the one capability that
manufactures agent turns. The never-granted groups' `why` is rendered into the
seeded `AGENTS.md` (`renderNeverGrantedSection`), so a denial is stated to the
model rather than met with silence. The mutating tiers are absent from the
UNATTENDED lane, in two places on purpose: the manifest a container boots with
omits them, and the executor refuses them anyway, so a container running a
stale boot cannot reach one. Each tool's model-facing sentence comes FROM the
table (`grantedDescription`), so a tool with no policy row throws at manifest
time. Result rows are a JSON array, never newline-joined prose — a note body
can contain both the row and field delimiters, so prose encoding let a note
forge hits pointing at paths it does not own.

Chat is a single persistent thread; the open note is auto-attached as context.
`Cmd+K` rolls a fresh thread. Delegation and routines run on the same
background lane. `vault/AGENTS.md` is the user's standing instructions — seeded
once per vault, loaded into the chat + background sessions as an extra context
file, and the file the bundled prompt nudges the agent to append durable memory
to. Instruction files reach the model VERBATIM in every turn's system prompt,
so their bytes are a recurring per-turn cost; the loader keeps the head
(standing instructions) and sheds the tail (accumulated memory), because the
agent appends to it unattended.

### IPC / Bridge

`packages/bridge/src/ipc-registry.ts` is the single source of truth: each
channel pairs a TypeBox payload schema with a result/event type, and the
transport-agnostic `Bridge` type is derived from it. The `UserHost` builds a
schema-validated handler map from that same registry (`host/handler-registry.ts`
— a channel added there fails the object's boot until it is answered) and
serves it over one hibernatable WebSocket at `GET /v1/host/:userId/ws`. The
client dials it with `createWsBridge` and authenticates with its Better Auth
session token in the socket's FIRST FRAME — never a cookie, never a query
param. Add a channel = registry entry + host handler + one line in the fixture
Bridge (`packages/workspace/src/dev/fixture-bridge.ts`), which fails typecheck
until covered. The fixture stub must do something real against the in-memory
state or throw an error naming the gap — never silently return `[]`/undefined.

## Decisions

**Before raising a "new" finding, read the `note` issues.** Findings that were
investigated and deliberately declined live there so they are not re-raised:
[#446](https://github.com/kyh/inteligir/issues/446) (general),
[#453](https://github.com/kyh/inteligir/issues/453),
[#472](https://github.com/kyh/inteligir/issues/472) and
[#474](https://github.com/kyh/inteligir/issues/474). An issue's PLAN can name
paths that no longer exist even when its concern is live — verify every path
before following it.

Plan files and ADR docs are not tracked in this repo; this section is the
record for the decisions code comments cite.

- **The agent's confinement is the container, and the container is not the
  policy.** The model has `bash` inside a per-user Cloudflare Sandbox with an
  outbound allowlist, an ephemeral filesystem, no provider credential and no
  tool implementation. That bounds the REACH — a compromised image cannot touch
  the user's machine, cannot exfiltrate a credential, and cannot widen its own
  surface, because every capability that leaves the container is implemented in
  the Durable Object and schema-checked against that user's own vault. What it
  does NOT bound is what the model does with the scratch vault copy it was
  legitimately given: `never-granted` is a statement about what the host
  implements on the agent's behalf, not a wall, and `destructive-confirmed` is
  a prompt for the human rather than a gate. Describe them that way.

- **There is no `private: true`.** Per-note AI exclusion was a local-first
  feature backed by a live-disk probe on the same machine as the model; the
  host does not model note privacy and no channel answers a privacy question.
  The workspace still refuses to attach the open note's path as a context hint
  when the BUFFER says `private: true`, and that is all it is: a client-side
  gesture with no host behind it. Do not describe it as a boundary, and do not
  add a channel that implies one without a design for what enforces it.

- **The vault has one writer, so there is nothing to poll.** The Durable Object
  owns the manifest and the bytes; a listing it just returned is the truth.
  `refreshVault` survives as a RE-ANNOUNCE — every pane re-queries — rather
  than a re-crawl, and there is no watcher, no snapshot TTL and no external-edit
  channel to arm. A second client sees a change because the object broadcasts
  it, not because anyone looked again.

- **The knowledge index is a wipe-and-rebuild cache.** The SQL KnowledgeStore
  persists projections into the object's own SQLite purely to make a wake
  cheap; corruption or a version mismatch drops the tables and rebuilds from
  the manifest. **Nothing durable may ever live in the index tables** — durable
  state belongs in the manifest or the object's KV stores.

- **Frontmatter is the ONLY property store.** No metadata table, ever. Typed
  properties parse/serialize against the file's own YAML
  (`@repo/notes/markdown/frontmatter`); YAML the typing rules can't represent
  is preserved byte-exactly, never coerced or dropped.

- **Delete is a tombstone, not a removal.** `deleteVaultEntry` marks the
  manifest row `trashed` and leaves the bytes in R2 with the row's version
  intact. That is what makes a delete undoable, what lets a write to a trashed
  path be a question rather than a race, and why nothing in the vault API
  removes a row.

- **The deletion gate recognizes an implausible RESULT, not a broken input.** A
  call deleting more than `max(25, 5% of the live manifest)` inside a ten-minute
  window is HELD whole — applying nothing — until a human confirms it
  (`user-vault.ts`). It **bounds the blast radius; it does not detect a cause**:
  it reads a count, so a bug that sheds a single path sits far below the floor
  and passes straight through. Only an explicit human action may pass
  `confirmDeletions`, which carries the approved COUNT and waives the gate only
  up to it, for one call, never persisted.

- **No tag rename/delete UI, ever.** Tags are projections over note bodies
  (inline `#tags` + frontmatter `tags:`); a "rename/delete tag" affordance is a
  bulk content mutation disguised as a filter-chip action. Edit the notes (or
  ask the agent).

- **Client capability is an ALLOWLIST, never a blocklist.** A blocklist leaves
  every channel added after it silently reachable by a companion client —
  including destructive ones like `RESET_APP_DATA`. Allowlists fail closed.
  Adding a channel to `REMOTE_ALLOWED_*` is a deliberate act with a threat model
  attached, not a default. The gate is enforced at three points, all three
  required: invoke/send dispatch, event broadcast, AND the reconnect hydration
  push (which resolves a getter host-side and would otherwise volunteer state
  the method gate forbids asking for).

- **The Origin gate on the host socket REJECTS an absent Origin.** A browser
  always attaches Origin to a WebSocket handshake, so its absence means a
  non-browser caller, and admitting that silently is the CSRF hole the check
  exists to close. It is an exact-match allowlist of full origins — never a
  hostname comparison, which would admit every port on a dev machine. This is
  what a native client (the Expo app) currently cannot get past, and the fix is
  a design decision about how a non-browser client proves itself, not a
  loosening of this check.

- **One host per user is a Durable Object, not a singleton registry.** The
  object IS the composition root: its constructor builds the vault, the index,
  the agent and the stores, and its lifetime is the isolation. Do not introduce
  process-global `getX()` accessors — a Worker isolate serves many users, and a
  module-level instance is a cross-tenant bug waiting to be written.

- **Palette commands and settings sections stay hardcoded lists.** No command
  registry, no section registry, at ~11 commands and ~10 sections: a registry
  buys indirection and an ordering problem in exchange for a `.push()`. The
  trigger this entry named — a THIRD surface contributing commands it does not
  own — has ARRIVED, and the answer is still no registry. That surface is the
  AGENT: the grant table hands it a set of capabilities the palette also offers.
  What the two share is the OPERATION underneath — the vault's trash, the
  guarded line edit, the delegation queue — never the command list and never
  the window handler. Revisit only if a surface needs to contribute a COMMAND
  ROW to the palette it does not own.

- **`KnowledgeIndex` is not dead code — do not delete it.** It never runs in
  production (the SQL `KnowledgeStore`'s FTS5 does), which makes it look
  deletable. `@repo/notes` carries no sqlite dependency deliberately — it is
  the pure sharing seam, `SqlDriver` is platform-injected — so this in-memory
  composition is the ONLY way the package can test its own knowledge engine;
  ~1,200 lines of tests for related-notes, tags, the link graph and the perf
  oracle drive production logic through it.

- **The D1 auth schema ships via `drizzle-kit push`; there are no migration
  files.** Push is a supported primary flow for serverless databases, and the
  three things that make it dangerous are all absent here: one deployer (the
  account owner), an additive schema, and nothing derived that can rot —
  `apps/web/vitest.config.ts` builds the test DDL by running `drizzle-kit
export` over `src/worker/db/schema.ts`, so the suite always runs the schema
  the source declares. A second deployer or a destructive column change is the
  trigger for adopting migrations. The Better Auth tables in that schema are
  hand-written and diverge from `@better-auth/cli generate` in two places on
  purpose: timestamps are `mode: "timestamp"` (epoch SECONDS) where the
  generator emits `timestamp_ms`, and the generator's three secondary indexes
  (`session.userId`, `account.userId`, `verification.identifier`) are absent —
  cold paths over a handful of rows, while the hot path `session.token` is
  unique and therefore already indexed. **Never flip the timestamp mode in
  place.** Both modes read the same INTEGER column, so a redeploy without an
  accompanying `UPDATE <table> SET <col> = <col> * 1000` reads every stored date
  back as 1970 — which expires every live session and every pending
  verification token.

- **Better Auth's `baseURL` is derived per-request from the request origin.**
  Two hostnames route to this Worker plus its workers.dev name, and the
  coordinator URL is per-install configuration (a self-hoster points a client at
  their own Worker), so a fixed fallback would mint password-reset links back at
  the wrong deployment. What holds it up is that only hostnames Cloudflare
  routes to this script can reach it, so a spoofed `Host` never arrives. Adding
  a wildcard route is the trigger to revisit: the moment an arbitrary hostname
  can reach the Worker, the origin needs its own gate.

- **React Compiler is on for mobile and off for the web.** react.dev recommends
  it for _new_ apps and says existing apps should "roll out at your own pace" —
  `apps/mobile` is new and turns it on in `app.config.js`; the web build carries
  ~148 memo call sites it would have to reason about. If it is ever adopted
  there, annotation mode on leaf components is the only defensible entry —
  explicitly NOT the Plate/Slate tree (it mutates editor nodes) and NOT
  `vault-context.tsx`, whose memo identities ARE the cadence-split contract, not
  an optimization the compiler may reason about.

- **No coverage tooling, on purpose** (no provider, no CI step). This repo
  enforces targeted invariants STRUCTURALLY — no-dead-channels, dep-DAG parity,
  no-ungated-dispatch, kit-parity, no-orphan-components, grant-table parity,
  pi-quarantine — rather than via a global percentage that would be satisfied by
  tests asserting nothing. A derived fitness test that fails when a fourth
  dispatch path appears is worth more than a coverage number. If coverage is
  ever added: `coverage.include` is MANDATORY in Vitest 4 (`coverage.all` was
  removed), and gate only `@repo/notes`.

- **Component tests drive the DOM with `fireEvent`, not
  `@testing-library/user-event`** (which is not a dependency). user-event is a
  fidelity upgrade — it replays the full pointer/keyboard sequence — not a
  correctness fix, and these tests assert handler wiring rather than input
  semantics. It also costs something real here: `markdown-editor.test.tsx` runs
  on fake timers to drive the autosave debounce, and user-event hangs under fake
  timers unless every call is wired to `advanceTimers`. Reach for it only for a
  test that genuinely depends on the event sequence a real user produces.

- **`packages/ui/components.json` declares `rsc: true` and it is inert.** The
  shadcn CLI's monorepo add flow is not used — components live in `packages/ui`
  behind the no-orphan-components test — and the `"use client"` directives the
  flag produces are ignored by the consumers, which are plain Vite/Rollup builds
  with no RSC bundler in the graph.

- **HTML apps are OFF, and the refusal is written down rather than absent.** A
  vault `.html` opened as an app runs in a `sandbox="allow-scripts allow-forms"`
  frame with a postMessage broker that can read the whole vault — and
  `allow-scripts` does not restrain `fetch`. On one person's machine that was an
  accepted bargain; hosted, "the agent wrote it after reading a note" is a live
  exfiltration path. The seam (`setHtmlAppRuntime`) stays, installed with a
  refusal (`apps/web/src/app/html-apps-disabled.ts`), so it cannot quietly
  become a working path: shipping it needs the served document to carry a
  `connect-src 'none'` CSP, which belongs with whatever serves it.

- **The desktop app is a SHELL and must never become a browser.** It loads
  exactly one origin, pins top-level navigation to it, and denies every popup
  (`apps/desktop/src/main/navigation-guard.ts`). The origin comes from exactly
  two places — `INTELIGIR_APP_URL` and a build-time define — and never from
  anything the page can influence: a shell whose target can be changed from
  inside the page it loaded is a browser carrying the user's credentials. The
  one thing the shell does that a browser tab cannot is see a response's real
  `Content-Type`, which is what the `.pdf` sub-frame gate uses.
