# Agent Instructions

## Project Overview

**inteligir** — an AI-native notes app (Obsidian-with-an-agent), hosted. A user
signs in and gets a _vault_: a folder of plain markdown files they own, living
in their own Durable Object. It's AI-native two ways: chat to an agent that
edits those files, and highlight a checkbox to _delegate_ it to a background
agent that does the task and writes the result back.

Turborepo monorepo. **The product is one Cloudflare Worker** (`apps/web`) —
marketing site, auth, workspace UI and backend on one origin. An Electron shell
and an Expo app wrap it; five packages are shared between them.

## Tech Stack

- **Monorepo**: Turborepo + pnpm workspaces
- **Product**: TanStack Start + React 19 + Tailwind CSS 4 on a Cloudflare
  Worker (@repo/web), with Durable Objects (SQLite), R2 and D1
- **Auth**: Better Auth on D1 via Drizzle — email+password, bearer tokens,
  optional GitHub/Google, invite-gated sign-up
- **Editor**: Plate (platejs) rich markdown + a raw textarea fallback
- **UI**: shadcn/ui (Base UI), lucide-react, sonner, zustand
- **AI Agent**: pi coding agent framework (@earendil-works/pi-coding-agent),
  running as a node process inside a per-user Cloudflare Sandbox container
- **Desktop**: Electron + electron-vite (@repo/desktop) — a window on the
  hosted app, nothing more
- **Mobile**: Expo + Expo Router (@repo/mobile) — a signed-in shell (the Expo
  SDK major is pinned in `pnpm-workspace.yaml`'s catalog; naming it here only
  rots)

Notes are markdown files in the user's own vault. The whole product runs on
Cloudflare: the manifest and every derived index in the user's `UserHost`
Durable Object, the file bytes in R2, accounts in D1, the agent in a container.
`docs/privacy.md` states plainly what that means and what it does not.

## Workspace Structure

```
apps/            # shippable artifacts
  web/           # THE PRODUCT (@repo/web) — ONE CF Worker:
                 #   marketing site + /app (auth pages SSR, workspace client-only)
                 #   /api/auth/* — Better Auth on D1
                 #   UserHost   — one Durable Object per user: the vault
                 #                manifest, every JsonStore, the knowledge
                 #                index, the Bridge host, the alarm multiplex
                 #   AgentSandbox — the per-user container class
  web/container/ # The agent image (@repo/agent-container) — pi + a daemon;
                 # the ONLY place @earendil-works/pi* may be imported
  desktop/       # Electron SHELL (@repo/desktop) — one window, one origin,
                 # the inteligir:// scheme, a tray, shell auto-update
  mobile/        # Expo (@repo/mobile) — a signed-in shell
packages/        # libraries — boundaries are PACKAGE facts (deps + exports maps)
  notes/         # PURE platform-neutral domain (@repo/notes) — runs on
                 # workerd, in the browser and in React Native:
                 #   knowledge/ — link graph, backlinks, lexical search + the
                 #                SQL store (schema + FTS5, driver-injected),
                 #                tags, tasks, rename byte-surgery
                 #   markdown/  — remark parse pipeline, opaque nodes for what
                 #                the editor can't model, wiki-links, frontmatter
  bridge/        # Iso wire contract (@repo/bridge) — the IPC registry, the ws
                 # client + protocol, the agent grant table, shared schemas
  ui/            # Shared UI components (@repo/ui) — vendored stock shadcn on
                 # Base UI; web-only, leaf
  editor/        # The note editor (@repo/editor) — Plate kits, the Slate↔mdast
                 # round-trip, editor AI, properties, the open-note runtime
  workspace/     # The product UI (@repo/workspace) — the whole workspace
                 # surface over an injected Bridge, plus the fixture Bridge
tools/
  repo-guards/   # Derived fitness tests over the repo itself
```

Dep DAG (every edge between `packages/`, pinned against the manifests by
`dep-dag.test.ts`): notes and ui are leaves; bridge→notes;
editor→bridge+notes+ui; workspace→bridge+editor+notes+ui. Nothing under
`packages/` may import `node:*` or `electron` — every one of them is bundled
into a browser, and `notes`+`bridge` also into workerd and React Native. That
is lint-enforced for those two and enforced over shipped source (tests
excluded) by `dep-dag.test.ts` for the rest. `@repo/notes` is the sharing seam:
no node/electron/react imports at all, and platforms inject their capabilities
(the SQL driver, the clock). Content hashes arrive as VALUES the host already
computed (`apps/web/src/worker/hash.ts`), not through an injected hasher.

The UI packages reach the backend through `@repo/bridge` ONLY. That is a
package fact rather than a lint rule: neither `@repo/workspace` nor
`@repo/editor` depends on `@repo/web`, so there is nothing to import.

## Common Commands

```bash
pnpm dev:web          # THE PRODUCT — vite + miniflare on :5174 (pinned)
pnpm dev:desktop      # The Electron shell (CDP :9222)
pnpm dev              # Every workspace
pnpm build            # Build all
pnpm typecheck        # Type check all
pnpm lint             # Lint all   (oxlint)
pnpm format:fix       # Format     (oxfmt) — run BEFORE gates, never after
pnpm verify           # The whole gate, mirroring CI (see Quality Gates)
```

**`docs/development.md` is the dev guide**; `apps/web/README.md` is the
product's own — every route, the Durable Object's protocol, the local loop and
the owner-only deploy. The two change checklists are skills, not prose:
`.claude/skills/add-bridge-channel` and `.claude/skills/add-editor-node`.

**`CONTEXT.md` is the glossary** — what each domain word MEANS and which
neighbouring concept it gets confused with (vault vs manifest, doc vs note,
version vs revision, ticket vs session, the open note's three paths). This file
is architecture and § Decisions is why; read the glossary before either.

## Agent-driven development

`AGENTS.md` is the tool-agnostic guide meant to be **run** — read it before
touching anything. The essentials:

- **Provision**: `pnpm install`. That's all — no bootstrap script.
- **Run the product**: `pnpm dev:web` puts the whole Worker on miniflare in
  process — site, auth, Durable Object, vault, index and the agent path.
- **There is no seeded login, and sign-up is invite-only.** `AGENTS.md` § "There
  is no seeded login" has the verified recipe. Never run `db:push` or
  `db:studio`: both hit production D1.
- **Verify**: `pnpm format:fix && pnpm verify` for the static gate, then drive
  the running app. The web product and the Electron shell are both headlessly
  drivable; mobile is not.
- **Login-free agent flows**: `AGENT_RUNTIME=scripted` swaps the container for
  an in-memory one, keeping every production path around it —
  `.claude/skills/e2e-drive` and `docs/e2e-driving.md`.

## Verifying Changes

Use the **agent-browser** skill to drive a running app. Don't claim a UI change
works without driving it; type/test passing isn't feature-correct.

- `pnpm dev:web` then `agent-browser open http://localhost:5174/app`.
- `INTELIGIR_APP_URL=http://localhost:5174 pnpm dev:desktop` exposes CDP on
  9222; `agent-browser connect 9222` attaches to the shell's window. The
  variable is not optional: without it the shell loads `https://inteligir.com`
  and a change gets "verified" against production. (It reaches the task because
  `apps/desktop/turbo.json` names it in the `dev` task's `passThroughEnv` —
  turbo runs in strict env mode and strips anything unnamed.)
- From a signed-in `/app` page you can open a second Bridge socket and call any
  host method directly — far faster than clicking. The exact snippet is in
  `docs/e2e-driving.md`.
- 5174 is PINNED (`strictPort`), because the ticket mint's Origin allowlist is
  exact: a silent bump to 5175 renders a workspace that cannot reach its host.

## Quality Gates

Before committing:

```bash
pnpm format:fix && pnpm verify
```

`verify` is `typecheck && lint && knip && format && test && build` — the same
six steps CI runs, in one command so no caller can drift from CI. It is
check-only on purpose: `format:fix` runs FIRST and never after the gates,
because formatting the byte-pinned round-trip fixtures corrupts them and ships
red.

## The product Worker — `apps/web`

`src/worker/server.ts` splits one origin three ways: `/api/*`, `/v1/*` and
`/auth/*` go to the Worker's own route table, everything else to TanStack
Start's SSR handler — the marketing page, the auth pages, and the client-only
shell that `/app` mounts the workspace from. One origin is what makes the UI and
the API same-origin, which is what the session cookie and the ticket mint's
Origin allowlist depend on.

**`ssr: false` is a per-ROUTE fact, never the `/app` layout's.** The flag is
inherited downward, so declaring it on the layout would make the auth pages —
a form and two `useState`s — client-only by inheritance, and every visitor
would watch a blank document until the bundle landed. Only the workspace and
the deep-link page carry it. What that costs is a guard that has to answer
server-side, and `beforeLoad` has no browser to ask: the cookie is `httpOnly`,
and this Worker cannot ask ITSELF either, because Cloudflare states that
"routes cannot be the target of a same-zone `fetch()` call" — a loopback to
`/api/auth/get-session` would resolve in miniflare and fail only in production.
So the gate is what a render CAN establish: a request carrying no session
cookie has no session, and `ssrWhenSignedOut`
(`apps/web/src/lib/session-guard.ts`) server-renders precisely those. A request
that carries one may hold a live session or a dead one, so it stays
client-rendered and the guard runs the real check where it always ran. Which
routes may declare the flag is pinned by
`tools/repo-guards/src/route-ssr.test.ts`, because re-adding the one line is
otherwise invisible.

Two tsconfig programs, deliberately: the site compiles under `lib.dom`,
`src/worker/` compiles without it. workerd and the DOM both declare
`BufferSource` and `BodyInit` globally with different bounds, so one program
would typecheck the Worker against a stdlib it never runs on. That is also why
the whole Worker — entry, routes, tests — lives under one directory.

### `UserHost` — one Durable Object per user

Addressed `env.UserHost.getByName("user:" + userId)`, where the userId is
derived from the caller's own credential: no `/v1/host/*` path carries one, so a
caller holding no session cannot bring an object into existence by naming one.
(`POST /v1/agent/:userId/report` is the one route with the id in its path — the
container holds no session — and there the segment must AGREE with a claim the
token's own SIGNATURE proves before an object is named. Verifying first is what
makes the invariant total rather than nearly true: naming an object CREATES one,
so a name read out of unverified claims is a name anyone can type. The OAuth
callback's `state` addresses the same way.) It serves
that user's whole Bridge — every host method and event channel the registry
declares — over one hibernatable WebSocket per client, and it owns everything
that user has: the vault manifest, the JsonStores, the knowledge index, the
chat transcript, the background lane, the tickets and the budgets.

- **The class is its ENTRY POINTS and nothing else.** `composeHost`
  (`host/host-composition.ts`) is the one artifact holding the wiring graph —
  vault, index, agent, editor AI, voice, capture, stores and the complete
  handler map — so the object's constructor names parts rather than building
  them, and `__tests__/host-handlers.test.ts` asserts completeness against the
  composition production wires instead of a hand-copied twin of it.
- **Hibernation is the point** (§ Decisions). Sockets are accepted with
  `ctx.acceptWebSocket`, per-socket identity lives in the socket's own
  attachment, and the broadcast set is rebuilt from `ctx.getWebSockets()` on
  every push.
- **The socket authenticates with a single-use TICKET in its first frame**
  (§ Decisions), minted at `POST /v1/host/ticket` against the session. The
  ticket is where the capability class is decided, once, from which credential
  carried the session.
- **Two chokepoints, in one module that owns both.** `SocketGate`
  (`host/socket-gate.ts`) holds the dispatch map, the socket enumeration, the
  broadcast fan-out and the reconnect hydration, so `resolve()` is the only
  reader of the map and `push()` the only pusher of an event frame — hydration
  included, which resolves a getter host-side and would otherwise volunteer
  state the method gate forbids asking for. Its socket seam is structural
  (attachment + readyState + send), so `__tests__/socket-gate.test.ts` drives
  BOTH directions with a fake socket and asserts what was withheld;
  `__tests__/no-ungated-dispatch.test.ts` is the backstop that fails when a
  third path appears.
- **Every registry method is implemented for real.** `collectHandlers` throws
  at construction if one is unregistered, and a capability this host does not
  have has no channel at all — a method that answers only by refusing satisfies
  both that guard and `no-dead-channels` while failing at runtime. Adding a
  channel is the LAST step of building a capability; retiring one deletes it.
- **Six ways in besides the socket**, split by transport or credential, never by
  capability: the ticket mint, the asset upload too large for a frame, the deep
  link the `/app/link` page POSTs, the vault export that arrives as a
  navigation, the container's report, and the provider's OAuth redirect. The
  last two carry a token this Worker minted, because neither caller has a
  session.

### The vault

One vault per user, inside that user's host object. The manifest is a
`vault_files` table in the object's own SQLite (`version`, `contentHash`,
`size`, `deleted_at` — qualified, because the knowledge index's core schema owns
the unqualified `files` in the same database); the bytes are R2 objects under
that object's prefix. The manifest is authoritative for versions and hashes.

- **The manifest IS the listing.** The object is the only writer, so there is
  nothing to crawl and nothing to watch: every mutation fires `onChanged`, and
  the host broadcasts `onVaultChanged` from it — NAMING the paths that moved, so
  a client re-lists only when its own rows can have changed and re-reads a note
  only when that note did. An EMPTY change is `refreshVault`'s own
  announcement: it asserts nothing, so every client re-reads.
- **A cold open is ONE round trip.** `getWorkspaceBoot` answers the root, the
  listing, the persisted ui state and the open note's own bytes together — the
  host resolves which note that is from ui-state, so the client never has to
  learn what it wants before it can ask for it.
- **Write ordering is crash-consistent**: bytes reach R2 BEFORE the manifest row
  commits, and a permanent purge removes the manifest row BEFORE the R2 object.
  The tolerable failure is an orphan blob, never a dangling pointer.
- **Delete is a tombstone** (§ Decisions), swept by the host's alarm after a
  retention window.
- **Paths are case-preserving but case-insensitive** (§ Decisions).
- **The deletion gate** (§ Decisions) sits here, in the object every writer goes
  through.

Notes are **markdown the editor never refuses**: GFM plus `[[wiki-links]]`
(aliases, `![[transclusion]]`), `$$` math, mermaid fences, `> [!NOTE]` alerts,
and the MDX components `<toggle>`, `<column_group>/<column>`, `<video>`,
`<media_embed>`, `<file>`, `<date>`, `<callout>` — the constructs with a real
editor node. Everything else that parses (raw HTML, `{…}` expressions, unknown
JSX) becomes an **opaque node**: inert literal text that serializes back
byte-for-byte, so an agent can write whatever a model produces and the file
still opens. Only a document that cannot be PARSED at all — a mismatched tag,
an unbalanced brace — falls back to Raw, and Raw is otherwise a toggle the user
chooses. Files stay `.md`.

### The knowledge index

`@repo/notes/knowledge/*` is pure and platform-neutral: `projectDoc()` is the
ONE parse per doc, `LinkGraphIndex` resolves links over projections, and the SQL
`KnowledgeStore` (schema + FTS5 bm25 search, written once over an injected
`SqlDriver`) persists them. `apps/web/src/worker/host/knowledge/` is the host
shell: `do-sql-driver.ts` binds `ctx.storage.sql`, `user-knowledge.ts` mirrors
the rows into the in-memory graph.

- **Projection is a WRITE, not a diff** (§ Decisions).
- **Hydration is the normal path**, not a boot optimization: the object
  hibernates, so the in-memory graph is gone by the next message while the rows
  are not. Every query replays them through core's resumable cursor, paged with
  a yield between pages.
- **A reconcile survives, once per wake**, because the store is a
  wipe-and-rebuild cache and write-time projection is best-effort (a streamed
  upload never held its bytes). It diffs the manifest's own content hashes
  against the hash each projection recorded — exact, and free when nothing
  moved. Work too large for one pass continues on the alarm.
- **Rename asks the index, not the vault.** `renameCandidates` names the moved
  doc, the notes whose links resolve to it, and the notes whose links the new
  name would SHADOW, all off the in-memory graph — so a rename reads only the
  docs it may rewrite, however large the vault is. The old stem is recorded in
  the moved doc's frontmatter `aliases:`; wiki targets resolve through aliases
  after every path tier, and a real filename always beats an alias.

### The agent

The pi coding agent runs as a node process inside a **per-user Cloudflare
Sandbox** (`AgentSandbox`), driven by that user's `UserHost`. pi is never
imported into the Worker; the image is `apps/web/container/`, built from this
repo, and its `src/pi/` is the harness quarantine.

- **The container filesystem is EPHEMERAL by contract** (§ Decisions), so a
  wake is the ordinary path: the image carries everything and the vault is
  re-materialized from the manifest.
- **The Durable Object never awaits a turn** (§ Decisions): `send` resolves once
  the container accepts, and everything the turn produces arrives later as short
  authenticated `POST /v1/agent/:userId/report` requests.
- **Two lanes are two CONTAINERS** (§ Decisions) — chat and the unattended lane
  delegation and routines share.
- **The provider credential never reaches the container** (§ Decisions).
- **Egress is `enableInternet = false` plus an allowlist.** `allowedHosts` is
  the firewall; `outboundByHost` is the credential seam and intercepts HTTP and
  HTTPS on ports 80 and 443 only, so it is not a security boundary. The
  allowlist is the provider APIs plus `PUBLIC_HOST`; anything else is a
  deliberate `AGENT_EXTRA_ALLOWED_HOSTS` entry.
- **The Durable Object owns the transcript** (§ Decisions); pi's session files
  are disposable working state.
- **What the agent may do is DECLARED, not inferred.**
  `@repo/bridge/agent-grants` is the grant table — policy rows (`capability`,
  `agentName`, `tier`, `description`-for-a-model) across four granted tiers plus
  the never-granted set grouped by reason. Every tool is implemented HOST-SIDE
  (`agent/agent-tools.ts`) in the object that owns the vault, and the container
  receives them as a manifest at boot — so a tool has its own paging ceilings,
  its own refusals, and, for the destructive tier, a confirmation raised inside
  the executor that no container can skip. The mutating tiers capture a restore
  point before writing, fail-closed; `delegate_task` is capped per turn, being
  the one capability that manufactures agent turns. The mutating tiers are
  absent from the unattended lane: a proposal has no conversation to be
  confirmed in, and a background agent that could delegate would queue its own
  successors. Each tool's model-facing sentence comes FROM the table, so a tool
  with no policy row throws at registration. The never-granted groups' `why` is
  rendered into the bundled instructions, so a denial is stated to the model
  rather than met with silence.
- **Restore points are R2 copies** (`agent/agent-snapshots.ts`), scoped
  `(origin, ref)` across the three writing surfaces — chat, delegation,
  routine — newest 50 per origin. A restore writes back through the vault, so
  the manifest, the index and the deletion gate all see an ordinary write.
- **Delegation and routines** run on the background lane, serialized by a
  DURABLE lock row (an in-memory one reads as free on the very next invocation).
  Routines fire from the object's alarm, unprompted; their write path is
  host-owned rather than agent-owned, because nobody is watching.
- **Skills live in the VAULT**, at `skills/<slug>/SKILL.md` (§ Decisions).
- **`vault/AGENTS.md`** is the user's standing instructions — seeded into a new
  vault, loaded into both sessions as an extra context file, and the file the
  bundled prompt nudges the agent to append durable memory to. Instruction files
  reach the model VERBATIM in every turn's system prompt, so their bytes are a
  recurring per-turn cost; the loader keeps the head and sheds the tail.
- **`AGENT_RUNTIME=scripted`** replaces the container with an in-memory one.
  The runner, the transcript, the tool executor, the confirmation broker and the
  vault write-back are the production ones either way — and so is the RETURN
  path: the port covers both directions, so the scripted container produces real
  reports and presents its own boot bearer to the same sink an HTTPS report
  reaches. The lane a report belongs to is derived there, once, from that bearer.

### The editor's AI, voice, capture, skills

- **Editor AI** (⌘J menu, intent classification, ghost text) is a DIRECT
  provider call from the Durable Object, not a container turn (§ Decisions).
  Transient by contract: nothing here touches the transcript, the vault or any
  store.
- **Voice** is TTS over ElevenLabs (one streamed HTTP request per speakable
  chunk) and STT over Workers AI whisper (request/response). Every field is per
  OBJECT (§ Decisions). The user's ElevenLabs key is sealed like the provider
  refresh token.
- **Deep-link capture**: `inteligir://` has exactly six verbs
  (`packages/bridge/src/deep-link.ts`, pure parser + sanitizer) and reaches the
  Worker as `POST /v1/host/link?verb=…` — a POST, because a GET a page can cause
  is a CSRF write. `append`/`task` capture ONE sanitized plain-text line onto
  TODAY's daily note through a durable inbox with an exactly-once apply (the
  open note's live buffer via `onCaptureApply`, else the host-side
  compare-and-swap on the manifest version). `today` / `note/<target>` /
  `search?q=` navigate. `session` is refused: a web client is already signed in.
  Target paths are computed host-side, never taken from the URL.

### Auth and the data lifecycle

- **Better Auth per request** (`auth/auth.ts`), D1 through the Drizzle adapter,
  bearer plugin on, `baseURL` derived from the request origin (§ Decisions).
- **Sign-up is invite-gated by a Worker route in front of Better Auth**
  (`auth/invite.ts`), claiming the code in one atomic statement and then
  forwarding to `/api/auth/sign-up/email` so the response comes back untouched.
- **Ownership needs no table**: a session names exactly one host object.
- **Export is a streamed zip** (`GET /v1/host/export`), one R2 body at a time,
  nothing gathered — a vault may exceed the isolate's memory. There is no
  import, and that is a decision (`apps/web/README.md` § The data lifecycle).
- **Deleting the account deletes the account's data**: Better Auth's
  `deleteUser` runs `UserHost.purgeAccount()` in a `beforeDelete` hook —
  containers destroyed, the R2 prefix swept, `ctx.storage.deleteAll()` for the
  tables, the KV keys and the alarm together. BEFORE, so a purge that fails
  leaves the account able to ask again; idempotent, so asking again resumes.
- **Rate limits: anonymous callers in D1, authenticated ones in the object**
  (§ Decisions).

## The workspace UI — `@repo/workspace` + `@repo/editor`

`App` consumes an injected `Bridge` (`@repo/bridge/client::installBridge`) and
knows nothing about a transport. `apps/web/src/app/workspace-mount.tsx` is the
only place that dials one.

`workspace/workspace-page.tsx` is the one surface: **Sidebar (file tree) |
single-document Editor | BottomComposer** (chat pinned bottom — no side chat
panel, no tabs: opening a note replaces the open one), settings behind a dialog;
connections collapse under the editor column; a right-edge TOC minimap expands
on hover; the graph view (lazy d3-force canvas) and full-text search live in the
command palette.

- `workspace/vault-context.tsx` — a `VaultProvider` that PRODUCES all vault
  state but exposes it through three cadence-split seams: stable action
  callbacks (identity fixed, so action-only consumers never re-render), the
  listing (entries + folder name + wiki resolver, changing only on a structural
  refresh), and the high-cadence open-note slice in a zustand store
  (`@repo/editor/note/open-note-store`, `useOpenNote` via selectors) so a
  keystroke re-renders only the editor. The note's live machinery (controller +
  autosave debounce + vanish watcher) is the extracted, unit-tested
  `@repo/editor/note/note-runtime`. ONE Connections panel — the notes that link
  INTO this one; outgoing links are already on screen in the document
  (unresolved ones dashed, with a create affordance) and counted in Page
  details, so they are not restated below it. The sidebar file tree is VS
  Code-style (full-width rows, depth as in-row padding, roving-tabindex keyboard
  nav).
- The markdown parse pipeline lives in `@repo/notes/markdown/*`;
  `@repo/editor/markdown/` is the Plate-coupled byte-stability brain over it —
  the Slate↔mdast rules and the idempotent round-trip (bounded fixpoint).
  **Rich is the default surface**: any file that PARSES opens Rich and
  normalizes on the first real edit; constructs with no editor node ride along
  as opaque nodes, and only a parse failure opens Raw (byte-exact) with the
  badge. Every node type lives in
  `@repo/editor/kits/*` as a Base (headless) + React pair; `base-kit.ts`
  composes the Base halves for the headless serializer mirror, and kit-parity
  tests make drift impossible. The round-trip fixture matrix under
  `packages/editor/src/__tests__/fixtures/` is byte-pinned (oxfmt ignores it —
  formatting fixtures is corruption).
- **Editor AI**: ⌘J menu (cursor vs selection command sets + Translate page,
  host-side intent classification for free-form prompts; generate streams under
  an `ai` mark; edit lands as accept/reject suggestions), reachable from the
  selection toolbar, slash menu, block menu, and space-in-empty-paragraph;
  ghost-text completions on a fast model, on by default. AI state never reaches
  disk.
- **File Properties**: a typed panel over YAML frontmatter, edited via the
  header's "Page details" popover (plus Raw mode) — the file is the ONLY store
  (`@repo/notes/markdown/frontmatter` typing rules: true/false→checkbox, yes/no
  stay text, dates only YYYY-MM-DD; unsupported/invalid YAML preserved
  byte-exactly). The page-title `<h1>` above the doc IS the filename — editing
  it renames the file. Pasting or dropping an image uploads the bytes to
  `assets/` and inserts bare `![](assets/…)`.
- **Palette extras**: ONE search box — a `tag:<name>` term narrows the search to
  that tag (inline `#tags` + frontmatter tags, case-unified in the core tag
  index); clicking an inline `#tag` chip seeds it. That text ∧ tag composition
  is `@repo/notes/knowledge/vault-search`, shared verbatim with the agent's
  `search_vault`, so there is no separate tag browser to drift from it. "New
  note from template…" applies `templates/*.md` with `{{date}}`/`{{title}}`
  substitution. **Three periodic cadences** (`@repo/bridge/daily-notes`'s
  `CADENCES` — daily, weekly, monthly), each a palette command that opens or
  creates the current one, each with its own folder, filename format and
  `templates/<cadence>.md`, all configured in Settings → Notes; `CADENCE_ORDER`
  is the display order every surface iterates. ⌘D is the daily one specifically.
  "Read page aloud" speaks the open note over the TTS path (hidden for private
  notes, fail-closed re-check before sending).
- **Tasks view**: a palette-launched alternate main surface like the graph, over
  the projection's per-doc task extraction (every GFM `- [ ]` is a task;
  per-note `tasks: false` opts out). Scheduling is association — first
  date-shaped `[[link]]` in the item, else the note's daily-note date — computed
  client-side via `@repo/notes/knowledge/task-schedule`. Toggling goes through
  the guarded `toggleVaultTask` channel
  (`@repo/notes/knowledge/task-ordinal`: ordinal-locate + raw-byte
  equality, refusal values kick an index self-heal); rows delegate through the
  same (sourceFile, ordinal) delegation store the editor uses.
- **HTML apps are not built** (§ Decisions). A vault `.html` opens as text.
- **Appearance is a typed record in ui-state** (`appearance/appearance.ts`):
  editor + mono font, size, line height, column width, accent and chrome
  contrast, each a CSS custom property pushed onto `:root` by the ONE
  `applyAppearanceSideEffects` funnel. It needs no channel of its own —
  `ui-state` is a schemaless key→JSON map, so the whole record persists under
  one key.

## IPC / Bridge

**The IPC seam is four files, split so a reader can tell the list from the
machinery.** `ipc-entry.ts` is the vocabulary — four channel kinds, four
one-line constructors. `ipc-registry.ts` is THE TABLE: one row per channel,
grouped by domain, naming channels and nothing else. `ipc-contract.ts` is the
machinery every row derives — `Bridge`, `HostMethod`, `EventMethod`,
`IpcHandler`, `IpcEvent` — and names no channel. `channel-policy.ts` is what
is left over: the three per-channel opt-ins the compiler cannot ask for.

Payload schemas and result types live with their DOMAIN (`vault.ts`,
`knowledge.ts`, `skills.ts`, `delegation.ts`, `agent-actions.ts`, …), never in
the registry — a table you read one row at a time is worth more than a file
that holds everything a row mentions.

**Adding a channel is four COMPILE errors and one test.** Registry entry, host
handler (`collectHandlers` refuses to construct without it), fixture-Bridge line
(`packages/workspace/src/dev/fixture-bridge.ts`), and a grant-table row
(`EVERY_METHOD_IS_WEIGHED` in `agent-grants.ts` stops compiling, naming the
method). Nothing is pinned by hand — no written-down method list, no asserted
count. The test that remains is the one no type can see: `no-dead-channels`
proves a real CALLER exists. The fixture stub must do something real against the
in-memory state or throw an error naming the gap — never silently return
`[]`/undefined.

The three opt-ins in `channel-policy.ts` stay lists rather than an exhaustive
per-method table, because the default answer to each is NO and the default is
the safe one: unnamed means unreachable from a companion, never re-pushed on
reconnect, framed as JSON. An exhaustive table would force sixty rows of "no"
and make the wrong answer as cheap to write as the right one. `BINARY_CHANNELS`
is the only place the raw-PCM tag mapping lives; `HYDRATED_EVENTS` pairs each
stateful event with the getter that answers its current state, re-pushed after
every connect — full event replay is deliberately not provided.

## The shells

- **`apps/desktop`** is a window on the hosted product and nothing else: no
  vault, no agent, no index, no renderer of its own. Its whole security surface
  is the origin pin — the window loads exactly ONE origin, top-level navigation
  away from it goes to the system browser, and `window.open` is denied
  unconditionally. The origin comes from `INTELIGIR_APP_URL` (runtime, then
  baked in at build), then `https://inteligir.com`; nothing the page can
  influence is ever consulted. It also owns the `inteligir://` scheme,
  validating against the same pure parser the Worker runs and re-emitting as
  `/app/link?verb=…`, built from the parsed verb with a named parameter each.
- **`apps/mobile`** holds a Better Auth session in the keychain and says plainly
  that the notes and the agent live in the web app. The host's `mobile` client
  class exists and is tested — a bearer with no browser Origin admits to
  `REMOTE_ALLOWED_METHODS`/`_EVENTS` — but no companion surface is built on it
  yet.

## Decisions

**Before raising a "new" finding, read the `note` issues.** Findings that were
investigated and deliberately declined live there so they are not re-raised:
[#446](https://github.com/kyh/inteligir/issues/446) (general),
[#453](https://github.com/kyh/inteligir/issues/453) (privacy model's accepted
holes — `docs/privacy.md` is the contract),
[#472](https://github.com/kyh/inteligir/issues/472) (autonomous-write
residuals), and [#474](https://github.com/kyh/inteligir/issues/474). An issue's
PLAN can name paths that no longer exist even when its concern is live — verify
every path before following it.

Plan files and ADR docs are not tracked in this repo; this section is the
record for the decisions code comments cite.

- **HIBERNATION SHAPES EVERY IN-MEMORY CHOICE.** The host accepts sockets with
  `ctx.acceptWebSocket` and serves them through the `webSocket*` handler methods
  rather than `addEventListener`, so an idle object with open sockets is evicted
  and accrues no duration billing. The consequence is a rule, not a preference:
  **no in-memory field may hold anything a later message needs.** Per-socket
  identity lives in the socket's own attachment; the broadcast set is rebuilt
  from `ctx.getWebSockets()` on every push rather than tracked in a `Map` (a
  `Map` reads as EMPTY after the first eviction, so every push would silently
  reach nobody); tags are fixed at accept time, so auth state cannot be one; the
  knowledge graph hydrates from rows on every query. The two in-memory things
  that are correct are the ones that can only exist while the object is PINNED —
  the mutation mutex, and the AI lanes' `AbortController`s, which are only
  meaningful while their request is open. Anything else in memory is a bug that
  passes every test on a warm object.

- **Nothing is module scope. Ever.** One Worker isolate serves many tenants'
  Durable Objects in one module scope, so a module-level field is a
  CROSS-TENANT leak, not a shared cache: the event bus would fan one user's
  events onto another user's sockets, the voice buffer would stream one user's
  note text to another, the background lane's lock would serialize one user's
  delegations against another's. Every one of those is an instance field
  constructed with the object it belongs to.

- **The socket authenticates with a single-use TICKET, in the first frame.** A
  browser cannot set an `Authorization` header on `new WebSocket()`, and both
  alternatives are worse: a credential in the query string lands in every
  request log, and the cookie that rides the handshake is attached cross-origin
  too, so a socket admitted on it alone would be forgeable from any page the
  browser has open. The ticket answers all of it — this object minted it, for
  one socket, for one minute, and spending it is a `DELETE … RETURNING` in one
  synchronous turn of this object's own SQLite, with no D1 round trip on the
  wake path. It also keeps the raw session token out of the page: `getSession()`
  is asked only who the user is, so an XSS steals one socket rather than the
  account.

- **The Origin allowlist guards the MINT, and must never become a
  CLASSIFIER.** An exact-match allowlist of FULL origins (scheme + host + port,
  never a hostname compare, never normalized first) sits on the ticket mint,
  because a cookie is the one credential a cross-site page can make a browser
  send. It is deliberately NOT on the socket upgrade: a native client sends no
  Origin, and a socket opened without a ticket does nothing and is reaped at its
  deadline. The tempting move — "absent Origin means native, so grant the
  companion class" — derives a capability grant from a header a caller omits for
  free. The class is decided by WHICH CREDENTIAL carried the session instead:
  cookie + allowlisted Origin is `web`, bearer + no Origin is `mobile`, and both
  remaining combinations refuse.

- **`web` is blanket-granted the whole host surface, and an allowlist there
  would be theatre.** One Durable Object per user, every handler scoped to that
  object's own storage, and a session that already implies full control of the
  account those handlers act on — so a list of names between a user's session
  and a user's own state protects nothing. What would change the calculus is a
  capability that reaches OUTSIDE the tenancy or spends money on the user's
  behalf; the moment one lands it needs its own class rather than a quiet
  arrival inside this grant. That is the whole risk of a blanket grant, which is
  why it is written down rather than inferred from the absence of a list.

- **The companion capability set is an ALLOWLIST, never a blocklist.**
  `REMOTE_ALLOWED_METHODS`/`_EVENTS` name the narrow surface a `mobile` client
  reaches. A blocklist would leave every channel added after it was written
  silently reachable — including `deleteVaultEntry` and `connectAiProvider`.
  Allowlists fail closed. The host enforces both at all three points, all three
  required: invoke/send dispatch, event broadcast, AND the reconnect hydration
  push (which resolves a getter host-side and would otherwise volunteer state
  the method gate forbids asking for).

- **The object has ONE alarm, so every deadline MULTIPLEXES through it.** A
  Durable Object has exactly one pending alarm, so a second concern that calls
  `setAlarm` for itself silently cancels whatever was already armed. The
  multiplex is therefore structural: `HostAlarm` (`host/host-alarm.ts`) holds
  ONE list of concerns, each a `sweep` plus the `dueAt` it next needs waking
  for, and re-arms at the earliest of them. Adding a concern is one ROW —
  two halves that have to agree is how a concern ends up swept but never woken
  for. `setAlarm` is confined to that class, which is what "no concern arms for
  itself" means; the count of call sites is a consequence, not the rule, and
  every concern that moves a deadline says so (`onDeadlineChanged`) rather than
  arming. A `setTimeout` is never
  the answer either — a pending timer PINS the object in memory, which is the
  hibernation the whole transport exists to get, and it dies with the eviction
  that a socket's auth deadline, a capture's ack and a routine's schedule all
  have to survive.

- **Projection is a WRITE, not a fingerprint diff.** The object is the only
  writer, so every mutation hands the index the doc's text along with the hash
  the manifest stored it under, and the projection happens on the way out of the
  inbound path. There is no crawl, no stat sweep and nothing to compare. What
  survives is a RECONCILE, once per wake, for the two things write-time
  projection structurally cannot cover: a schema or projection version bump
  drops every row on purpose, and a streamed upload never held its bytes. It
  diffs the manifest's own content hashes against the hash each projection
  recorded — exact, and free when nothing moved. Do not reintroduce a stat
  fingerprint; there is no filesystem to stat.

- **The knowledge index is a wipe-and-rebuild cache, in a database that also
  holds durable state.** Corruption or a version mismatch drops the store's
  tables and rebuilds from the manifest. Because that database is the object's
  own SQLite — shared with the vault manifest, whose law is the exact opposite —
  `reset()` drops exactly the tables the store created, recorded by the driver,
  never a hardcoded list that could fall behind the core schema. Nothing durable
  may ever live in the index tables. Search is FTS5 bm25 through core's store,
  so the ranking is the same code every consumer of `@repo/notes` gets.

- **Durable Object SQLite bills rows WRITTEN, and FTS5 multiplies them.** Every
  index row an INSERT touches is a billed write, and `search_fts`'s shadow
  tables turn one document into a row per distinct term — so a full re-index
  costs a multiple of the document count, not the document count. That is the
  cost behind write-time projection and hash diffing, and it is why "just
  re-index on wake" is not the simple option it looks like.

- **`KnowledgeIndex` is not dead code — do not delete it.** It never runs in
  production (the SQL `KnowledgeStore`'s FTS5 does), which makes it look
  deletable. `@repo/notes` carries no sqlite dependency deliberately — it is the
  pure sharing seam, `SqlDriver` is platform-injected — so this in-memory
  composition is the ONLY way the package can test its own knowledge engine;
  a thousand-odd lines of tests for related-notes, tags, the link graph and the
  perf oracle drive production logic through it.

- **Frontmatter is the ONLY property store.** No metadata table, ever. Typed
  properties parse and serialize against the file's own YAML
  (`@repo/notes/markdown/frontmatter`); YAML the typing rules can't represent is
  preserved byte-exactly, never coerced or dropped.

- **The editor refuses a file only when it cannot PARSE it.** A vocabulary gate
  — anything outside a fixed list of constructs drops the whole document into an
  unstyled textarea — is the tempting answer and is REJECTED. It has a real
  reason behind it: unknown JSX deserializes to escaped TEXT, so a save mangles
  `<Foo>` into `\<Foo>`. Remove that reason instead of the gate. An **opaque
  node** (`@repo/notes/markdown/remark-opaque`) holds such a construct's
  markdown as a string, renders it as inert literal text, and emits it back
  unescaped, exactly as a plain-text editor treats a tag it does not understand.
  Two consequences are load-bearing:
  - **`<` is shared between JSX and CommonMark.** `micromark-extension-mdx`
    bundles `mdx-md`, which disables autolink/htmlFlow/htmlText so JSX owns the
    character; that alone made `<https://x>`, `<a@b.com>`, `<!-- c -->` and a
    bare `<50ms` whole-file parse ERRORS, because the JSX tokenizer throws
    rather than declining. So `remark-mdx-agnostic.ts` composes the jsx and
    expression extensions itself and wraps the tag constructs in a crash-free
    lookahead: JSX runs only where a tag can actually start. The lookahead is a
    deliberate SUPERSET of mdx-jsx's grammar — accepting too much only
    reproduces today's parse error, accepting too little would divert a real
    component to htmlText and silently stop rendering it.
  - **`htmlFlow` stays disabled** (so does `codeIndented`, which
    `knowledge/link-extract.ts` matches for task-ordinal lockstep). Its
    type-6/7 branches swallow every line to the next blank one, so a single
    `<div>x</div>` line inside a `<callout>` would eat the `</callout>`.
    Block-level HTML arrives as JSX, which nests; only the non-tag forms
    (comments, instructions, declarations, CDATA) need CommonMark, and
    `htmlText` covers those.
    The opaque value is RE-SERIALIZED from the node, never sliced out of the
    source: a slice is byte-exact only where no container prefixes the lines it
    spans, and inside a blockquote it would capture the `> ` markers that the
    stringifier then adds again.

- **The vault is CASE-PRESERVING BUT CASE-INSENSITIVE.** `Note.md` and `note.md`
  are ONE file, spelled the way it was last written. R2 keys are case-SENSITIVE,
  so the hazard is not the local one: two spellings that were one file on a
  laptop would become two live objects, each with its own manifest row, each
  shadowing the other's wiki links — and a guard written for the local hazard
  guards nothing, because the two keys never collide. So identity is the FOLDED
  path (NFC, lowercased) and the R2 key derives from it; the second object is
  unrepresentable rather than merely unlikely. The consequence, stated: a user
  cannot keep both spellings side by side, and writing one when the other exists
  overwrites it and adopts the newer spelling. In exchange a case-only rename is
  a pure retitle — the display path changes, the blob never moves, no link can
  dangle.

- **Delete is a TOMBSTONE, and a permanent purge is the alarm's job.** There is
  no OS trash to hand a file to, and something has to take its place: undoing an
  agent-CREATED note is a delete, so with no trash tier every such undo would be
  permanent. A tombstoned row keeps its bytes for a retention window and both
  row and blob are purged by the host's alarm — row FIRST, then the object, so
  the manifest never points at a missing blob.

- **There is no R2 bucket lifecycle rule, and there must not be one.** The
  manifest is the authority for which bytes are live. A bucket-level expiry
  policy cannot read it, so it would eventually delete a blob whose row still
  points at it. Every expiry this product has is driven by the manifest or by a
  snapshot row: the trash sweep purges both halves together, and the snapshot
  prune drops each evicted row's blob with it.

- **ONE deletion gate, in the object every writer goes through, and it bounds a
  blast radius rather than detecting a bug.** Deletions past
  `max(25, 5% of the manifest)` inside a rolling window are held whole —
  applying nothing. It reads a COUNT, never a cause, so
  a bug that sheds one path per call sits far below the floor and passes
  straight through; describe it that way and never as detection. The count
  accumulates over a WINDOW rather than per call, because a caller deleting one
  file at a time in a loop is the shape this deployment can actually produce and
  a per-call gate would never see it; the window drains on its own, and a
  restore removes its file from it. Because it lives in the object rather than
  on a device, the browser, the agent and the upload route are all held by one
  number. **The vault takes a confirmation that waives one pass, and no Bridge
  channel spells it** — so what releases a hold today is the window draining,
  and `heldDeletionMessage` says exactly that. A refusal naming an act nobody
  can perform sends the user and the model both looking for a button that does
  not exist; building the verb is what earns the other sentence back.

- **Rate limits: anonymous callers in D1, authenticated ones in the object.**
  The auth routes are limited in D1 because their callers are anonymous and a
  shared store is the only place to count them. Every authenticated host leaf is
  the opposite: the caller proved a session, the Worker already derived the one
  object that serves them, and that object has its own synchronous SQLite — so
  the ledger is local, with no D1 round trip, no second store and no key to
  build, because THE OBJECT IS THE ACCOUNT. A limiter in the Worker would have
  cost two D1 operations per request to protect one, which is a limiter that
  pays for the attack. What it bounds honestly is the WORK each leaf does, not
  the wake that carried the request — that wake is the caller's own object, and
  bounding it is an edge rule, not a table.

- **The container filesystem is EPHEMERAL BY CONTRACT.** On sleep (10 minutes
  idle) or restart every file is deleted, every process terminates, and only the
  Sandbox's Durable Object identity survives. So a wake is not a recovery path,
  it is the ordinary one: the image carries everything, and the vault is
  re-materialized from the manifest each time. Nothing durable may be written
  there — that is why skills live in the vault and the transcript lives in the
  object. `persistAcrossSessions`, `snapshot()` and `start({snapshot})` are NOT
  built on: they appear in the GA blog post and not in the API reference.

- **A Durable Object never awaits a turn.** A delegation or a routine runs for
  up to ten minutes, and an object that waited on one would hold an invocation
  open for the whole of it — with the user's sockets, their vault manifest and
  their knowledge index behind it. So `send` resolves as soon as the container
  ACCEPTS, and everything the turn produces arrives later as separate short
  requests into the report path. An object that instead held the container's
  event stream open would be pinned for the life of the turn, and an outbound
  connection expires at fifteen minutes — mid-answer.

- **The two agent lanes are two CONTAINERS, and the reason is write
  attribution.** The container reports the agent's file writes from a filesystem
  WATCHER, which cannot say which session wrote a file. Two pi sessions sharing
  one `./vault` would make every agent write ambiguous between an attended edit
  the chat toast can undo and an unattended one the delegation dock owns. Two
  containers make the lane a fact of the CREDENTIAL instead: each boots with its
  own report bearer, and the report route resolves the lane from the token
  rather than from anything the caller says. Everything else is shared and must
  be — one vault, one index, one snapshot store, one durable background lock.

- **The Durable Object owns the transcript; pi's session files are working
  state.** A wake starts a FRESH pi session seeded with prior turns as context,
  rather than rehydrating pi's `sessions/*.jsonl`. Rehydrating would mean this
  repo hand-authoring a third party's on-disk format and keeping step with it
  across upgrades — the coupling the pi quarantine exists to prevent, relocated
  somewhere no test could see it. The cost is real and stated: pi's own view of
  the conversation restarts, so anything not in the transcript does not come
  back.

- **EVERY FACT `boot` CARRIES IS CLASSIFIED, and `SandboxBoot`'s own type is
  what forces it.** It is the INTERSECTION of three groups rather than a record
  of its own, so a fact added to a boot has nowhere to be written that does not
  also answer what keeps it true for a container that is already running:
  IDENTITY (`bootId`, the report bearer) is minted per boot; PINS (the report
  URL, the provider, the model, the tool set, Browser Run) cannot be handed to a
  live container, so the runner folds a digest of the whole group into the warm
  predicate and a mismatch is a cold wake; SESSION (the instructions) rides the
  `reset` verb, which throws away the pi session and leaves `./vault` and the
  revision alone. The bug that shape exists to make unrepresentable is a warm
  fast path keyed on the boot id alone: it silently dropped the provider the
  user had just switched to, and left the model answering out of the thread
  "New chat" told them was gone. What decides a reset is the CONVERSATION the
  container names — the chat thread's id, or an unattended run's own, since a
  background task is a conversation of one turn and the lane's container
  outlives it.

- **The provider credential never reaches the container.** The Worker owns the
  OAuth round-trip; the refresh token is AES-GCM sealed in the object under an
  HKDF-derived per-user key; the container is configured with a PLACEHOLDER, and
  the Sandbox's outbound interception mints a short-lived access token and puts
  it on a request the container already sent. So a model with `bash` — and it
  has one — can read every file and environment variable in that container and
  find no credential. What it DOES hold is its report bearer, which entitles it
  to SPEND this user's provider quota, bound to one account and one container
  generation. **That is a spend bound, not isolation**, and it is the honest
  replacement for pi's plaintext-at-0600 `auth.json` (fine on one person's
  machine; not multi-tenant).

- **The agent's reach is POLICY, not a sandbox in the security sense.** The
  container confines what the agent can touch on the MACHINE — it is not the
  user's laptop, egress is `enableInternet = false` plus a short allowlist, and
  the credential is not in there. It confines nothing about the VAULT: the whole
  vault is materialized under `./vault` on every wake, `private: true` is not a
  concept this host has, and a shell reaches every byte of it. So the grant
  table's never-granted tier and its inline confirmations govern what the agent
  does DELIBERATELY through the host's own tools, which are the only way out of
  the container into the vault of record. Describe them that way; do not sell
  them as a boundary. `docs/privacy.md` is the contract.

- **Skills live in the VAULT**, at `skills/<slug>/SKILL.md`. The container's
  filesystem is not a store (it is deleted on every sleep, so a skill written
  there would be gone before the confirmation finished rendering), and the vault
  is the only durable user-owned store this host has. It is already materialized
  into the container, so the agent opens a skill body with its own `read` tool;
  a skill is a markdown file in a folder, which is what a skill is; and it
  exports and backs up with everything else the user owns. The cost is honest:
  `skills/` shows up in the sidebar like any other folder, and deleting it
  deletes the skills. What reaches the model is the LISTING, rendered into the
  agent's instructions under a prompt budget — the same shape pi's own skill
  loading has.

- **The editor's AI runs from the OBJECT, not the container.** The ⌘J menu, its
  intent classifier and ghost text need no filesystem and no tools, and the
  container's ordinary state is asleep — a ghost completion would pay a cold
  start, a whole-vault materialization and a pi boot. So they are direct
  provider calls over the same sealed credential. The bound that matters: an
  outbound `fetch` PINS the object and the wall clock is billed as duration, and
  ghost text fires per typing pause. Hence ONE request in flight per lane and
  exactly two lanes, a new request ABORTS the one it supersedes before it
  starts, and every request has a deadline. Widening either is a billing
  decision, not a UX one.

- **ONE resolution decides which AI provider runs** (`effectiveProvider`), and
  every reader goes through it: what Settings RENDERS and what a turn RUNS are
  the same answer. The stored selection is normalized on read — defaulted to the
  first offered provider, and dropped when it names one this deployment stopped
  offering — rather than written back, because a configuration change is not a
  user action and overwriting their choice would lose it if the configuration
  came back. Two defaults for one question is not a tidiness issue: it is a
  fresh account being SHOWN a selected provider and then told none is selected
  the moment it sends a message.

- **HTML apps are not built, and the three blockers are recorded rather than
  re-derived** (`apps/web/README.md` § What is deliberately not here yet). A
  vault `.html` rendered as a live app needs, in order: a `connect-src 'none'`
  CSP on the SERVED document (read + `fetch` inside an `allow-scripts` frame is
  unbounded exfiltration, and the CSP has to come from whatever serves the
  file); a `usercontent.` hostname with `/api/auth/*` refused on it BEFORE the
  route exists (see the Better Auth `baseURL` entry); and a confirmation story
  for the broker's write half. The previous shape shipped a REFUSING seam
  instead, which was worse than nothing — it carried a whole broker, its tests
  and a disabled runtime for a capability no route served. A vault `.html` is a
  text file, which is what it is on disk.

- **Better Auth's `baseURL` is derived per-request from the request origin**,
  never configured or allowlisted. Every hostname that reaches this Worker is
  one the deployment owns — the two routed apex hosts and the workers.dev
  subdomain — and Cloudflare routes by hostname, so a spoofed `Host` never
  arrives. Deriving is also what makes the deployment portable: the coordinator
  is per-install configuration, so a fixed fallback would mint password-reset
  links back at the wrong deployment, and localhost/preview/prod all work with
  no config. **The trigger to revisit is a hostname the deployment does not
  fully control reaching the Worker** — a user-content subdomain (the HTML-app
  blocker above) is the live candidate, and it needs `/api/auth/*` refused on it
  BEFORE the route exists, not after.

- **The D1 auth schema ships via `drizzle-kit push`; there are no migration
  files.** Push is a supported primary flow for serverless databases, and the
  three things that make it dangerous are all absent here: one deployer (the
  account owner), an additive schema, and nothing derived that can rot —
  `apps/web/vitest.config.ts` builds the test DDL by running `drizzle-kit
export` over `src/worker/db/schema.ts`, so the suite always runs the schema the
  source declares. A second deployer or a destructive column change is the
  trigger for adopting migrations. **A push also DROPS what the schema no longer
  declares** — that is the same property read from the other side, and it is how
  a retired table leaves production. The Better Auth tables are hand-written and
  diverge from `@better-auth/cli generate` in two places on purpose: timestamps
  are `mode: "timestamp"` (epoch SECONDS) where the generator emits
  `timestamp_ms`, and the generator's three secondary indexes (`session.userId`,
  `account.userId`, `verification.identifier`) are absent — cold paths over a
  handful of rows, while the hot path `session.token` is unique and therefore
  already indexed. **Never flip the timestamp mode in place.** Both modes read
  the same INTEGER column, so a redeploy without an accompanying
  `UPDATE <table> SET <col> = <col> * 1000` reads every stored date back as
  1970 — which expires every live session and every pending verification token.

- **The shell must never become a browser.** `apps/desktop` loads exactly one
  origin and stays on it: top-level navigation away is handed to the system
  browser, `window.open` is denied unconditionally, and the target origin comes
  only from the environment or the build, never from anything the page can
  influence. A shell that can be navigated anywhere is a browser carrying the
  user's credentials in it, wearing the product's chrome. That policy is pure,
  unit-tested, and the whole security surface of that process — there is no
  vault, no agent and no renderer of ours in it.

- **Palette commands and settings sections stay hardcoded lists.** No command
  registry, no section registry, at ~11 commands and ~10 sections: a registry
  buys indirection and an ordering problem in exchange for a `.push()`. The
  trigger this entry named — a THIRD surface contributing commands it does not
  own — has ARRIVED, and the answer is still no registry. That surface is the
  AGENT: the grant table hands it a set of capabilities the palette also offers.
  What the two share is the OPERATION underneath — the vault's trash, the
  guarded line edit, the delegation store — never the command list and never the
  window handler. The palette stays a hardcoded array of client commands; the
  agent reaches the same operations through the host's own tools. Revisit only
  if a surface needs to contribute a COMMAND ROW to the palette it does not own.

- **No tag rename/delete UI, ever.** Tags are projections over note bodies
  (inline `#tags` + frontmatter `tags:`); a "rename/delete tag" affordance is a
  bulk content mutation disguised as a filter-chip action. Edit the notes (or
  ask the agent).

- **React Compiler is deliberately not adopted** (~150 memo call sites).
  react.dev recommends it for _new_ apps and says existing apps should "roll out
  at your own pace." If it is ever adopted, annotation mode on leaf components
  is the only defensible entry — explicitly NOT the Plate/Slate tree (it mutates
  editor nodes) and NOT `workspace/vault-context.tsx`, whose memo identities ARE
  the cadence-split contract, not an optimization the compiler may reason about.

- **No coverage tooling, on purpose** (no provider in any vitest config, no CI
  step). This repo enforces targeted invariants STRUCTURALLY — no-dead-channels,
  no-ungated-dispatch, handler completeness, kit-parity, no-orphan-components,
  the dep-DAG paragraph, agent-grant parity, exact payload schemas, the pi
  quarantine — rather than via a global
  percentage that would be satisfied by tests asserting nothing. A derived
  fitness test that fails when a THIRD dispatch path appears is worth more than
  a coverage number. If coverage is ever added: `coverage.include` is MANDATORY
  in Vitest 4 (`coverage.all` was removed), and gate only `@repo/notes`.

- **Component tests drive the DOM with `fireEvent`, not
  `@testing-library/user-event`** (which is not a dependency). user-event is a
  fidelity upgrade — it replays the full pointer/keyboard sequence — not a
  correctness fix, and these tests assert handler wiring rather than input
  semantics. It also costs something real here: `markdown-editor.test.tsx` runs
  on fake timers to drive the autosave debounce, and user-event hangs under fake
  timers unless every call is wired to `advanceTimers`. Reach for it only for a
  test that genuinely depends on the event sequence a real user produces.

- **`packages/ui/components.json` declares `rsc: true` and it is deliberately
  inert.** There is no per-app `components.json`: the shadcn CLI's monorepo add
  flow is not used — components live in `packages/ui` behind the
  no-orphan-components test — and the `"use client"` directives the flag
  produces are ignored by every consumer, all of which are plain Vite/Rollup
  builds with no RSC bundler in the graph.
