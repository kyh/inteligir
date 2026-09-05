# Agent Instructions

## Project Overview

**inteligir** — an AI-native notes app (Obsidian-with-an-agent), local-first.
The vault is markdown files in a git repo the user owns; one local Node process
owns that vault, indexes it, answers one API, and drives a coding agent that
edits those same files. The only hosted piece is a Cloudflare Worker carrying
the marketing site, accounts, cross-device thread sync, the capture inbox and
the account's hosted vault git remote (#618).

**TWO PROGRAMS.** `apps/desktop` is the shipped product — the window, and the
SPA inside it. `apps/cli` is the `inteligir` binary: `serve` IS that local
server, and every other verb is a client of a running one.

**The architecture's decision record is GitHub issues
[#542](https://github.com/kyh/inteligir/issues/542) and
[#611](https://github.com/kyh/inteligir/issues/611)** — what was chosen, and
what was rejected and why. #611 is the v4 consolidation, and it REVERSES four
of #542's lines deliberately; where the two disagree, #611 wins.

Turborepo + pnpm monorepo.

## Workspace Structure

```
apps/
  desktop/       @repo/desktop — THE SHIPPED PRODUCT (issue #611). THREE
                 bundles under electron-vite: src/main/ (the window, the
                 inteligir:// protocol handler, the forked server),
                 src/preload/ (the bridge: the loopback ws origin, because a
                 browser WebSocket cannot be proxied and window.location.origin
                 no longer names a server, and the updater, because it lives in
                 main; nothing that holds a token), and src/renderer/ (the SPA:
                 TanStack Router file routes over @repo/api/local). The whole
                 security surface is the ORIGIN PIN (src/main/origin-pin.ts,
                 pure + unit-tested): one origin, top-level navigation away
                 goes to the system browser, window.open denied
                 unconditionally, permissions denied except origin-scoped
                 media. utilityProcess forks `inteligir serve`; a server
                 already listening is ADOPTED once it answers this instance's
                 token, and only a child the shell started is killed on quit.
  cli/           inteligir — THE PUBLISHED BINARY, and THE SERVER (issues #553,
                 #611). `serve` is the whole local process — src/server/ owns
                 the vault, the knowledge index, the agent runtime, the oRPC
                 handler at /rpc, the /ws invalidation bus and the db, built
                 by the ONE composition root (`compose.ts`); every
                 other verb is a citty leaf that is a CLIENT of a running one,
                 with consola for the human path (raw writes for anything
                 verbatim — consola rewrites `backtick` spans). Every leaf
                 takes --json and is EXECUTED by the fitness test against the
                 refusal path. src/server/cloud/ is the sync CLIENT (issue
                 #572): the credential at rest, the frozen-body outbox, the
                 pull/apply loop and the local cloud procedures Settings and
                 `inteligir cloud` drive. src/server/voice/ is dictation (issue
                 #578): the pinned model cache under ~/.inteligir/models/, and
                 streaming Parakeet (sherpa-onnx) on a persistent session
                 worker per hold, over a dedicated /voice/stream websocket.
                 src/server/comments/ serves the anchored-comment sidecars
                 through the vault (#583). Agent memory was REMOVED (#589
                 reversed #575) — the harnesses carry their own. Discovery is
                 ONE FILE: `<dataDir>/server.json` carries the bound port and
                 the bearer together, so the address and the credential cannot
                 disagree and nothing probes. The server serves the agent
                 manual, and the ACP runtime injects INTELIGIR_DATA_DIR + a
                 PATH carrying this bin dir into agent shells, so a model
                 drives the product by typing `inteligir …` in bash. The build
                 inlines every workspace package (they export TS source) and
                 stages as CONTENT the migrations, the dialect skills, the
                 vendored licence texts, and the desktop renderer's bundle as
                 dist/ui, which `serve --open` answers over plain HTTP.
  web/           @repo/web — ONE Cloudflare Worker: the TanStack Start
                 marketing site, the auth pages, the @repo/ui gallery at
                 /design (src/components/gallery), Better Auth on D1
                 (invite-gated sign-up), and the v3 cloud (issue #554):
                 device login (POST /v1/device/login mints the device
                 credential from email + password; /app/devices lists and
                 revokes), the per-user ThreadSyncDO (merged thread log +
                 capture inbox + ws invalidation), and the hosted vault git
                 remote (issue #618): durable-git repo cells behind
                 src/worker/vault/git-remote.ts, one per user, device-authed.
                 src/worker/ is its own tsconfig program (no DOM —
                 workerd's globals must win).
  mobile/        @repo/mobile — the Expo RN client (#576): read-only threads,
                 produced captures and (#618) a read-only notes surface over
                 the hosted vault's /cloud read rows, rendered through
                 @repo/notes' own parse; reaches @repo/api/cloud, @repo/domain
                 and @repo/notes only.
packages/
  domain/        @repo/domain — zod-only leaf vocabulary (view context,
                 provider events), vendored-from-bb shapes; every package may
                 reach it, it reaches nothing.
  api/           @repo/api — ONE contract package, TWO entry points (#611).
                 `./local/*` is the oRPC contract the renderer and the CLI
                 compile against and `inteligir serve` implements: ONE folder
                 per domain, each a `<domain>-contract.ts` +
                 `<domain>-schema.ts`, plus the ws notification protocol and
                 the paths that are NOT procedures, and `build-thread-timeline`
                 — the pure fold from stored events into the timeline rows the
                 delta algebra beside it diffs. `./cloud/*` is the cloud wire:
                 device login, device auth, sync push/pull, captures, the ws ping
                 frames, the typed error envelope, and the ONE page planner
                 every reader of the merged log runs (`cloud/sync/plan-page`) —
                 two copies of that planner would be two answers to "did this
                 row move the cursor?", and a mis-set cursor is a duplicated
                 conversation — and, for the same reason, the CLIENT RUNTIME
                 CORE both consumers run (the byte primitives, the approval
                 slot, the login flow, the sync session; #639 below).
                 apps/web SERVES every row; the CLI's sync client
                 consumes all of them; apps/mobile consumes the read half alone
                 — it pulls threads and produces captures, and never pushes or
                 claims, because the desktop runs the turns and owns applying a
                 capture to the vault. Two entries rather than one router
                 because their compatibility obligations are OPPOSITE: /local's
                 ends ship in one bundle and may break freely, /cloud is a
                 deployed Worker answering installs that may be months stale and
                 may never break. A dep-dag row pins apps/web to /cloud alone.
                 src/ holds exactly those two buckets, and a dep-dag row refuses
                 a third: the cloud-never-reaches-local guard populates itself
                 from src/cloud, so a file outside both halves is one no guard
                 reads. /cloud stays zod + REST paths (NOT oRPC, diverging from
                 #611 phase 6 deliberately): oRPC addresses procedures by router
                 position, so moving the deployed wire to it would break exactly
                 the stale installs /cloud may never break.
  db/            @repo/db — drizzle + better-sqlite3 (WAL, sync=NORMAL),
                 committed SQL migrations applied on boot, the DbNotifier
                 seam, prefixed-nanoid ids.
  notes/         @repo/notes — PURE platform-neutral domain: the knowledge
                 engine (link graph, FTS5 search over an injected SqlDriver,
                 tags, tasks, rename byte-surgery) over ONE markdown scan
                 (scan-parse + wiki-links), frontmatter, the dialect's own
                 modules (markdown/remark-*, comments/, formulas/),
                 and `text/` — ONE Myers diff under diff3. No node/react/ui
                 imports — lint-enforced. `markdown/mdast-nodes.ts` is the
                 mdast NARROWING boundary: a walk asks it what a node is
                 rather than discriminating structurally at each visit.
  editor/        @repo/editor — the Plate.js WYSIWYG (resurrected, #580):
                 kits/nodes for every dialect construct, the md-rules table,
                 the fixpoint serializer + fixture matrix, the open-note
                 runtime (vault-session/note-runtime/open-note-store) the app
                 drives through two seams: `VaultSessionPorts`
                 (note/vault-session.ts) and the `EditorHostIo` singleton
                 (host-io.ts), which host.ts opens to React.
                 `node-props.ts` is the SLATE DECODE BOUNDARY, and it is the
                 reason no walk here narrows structurally: a node's dialect
                 fields ride `TElement`'s open index signature, so every read
                 arrives as `unknown` and this is the one place it becomes a
                 domain value.
  agent-runtime/ @repo/agent-runtime — the ACP runtime (#588): one adapter
                 speaks Zed's agent-client-protocol to claude-code-acp and
                 codex-acp children; harnesses are data rows; the
                 provider-event vocabulary is the one internal grammar.
  agent-skills/  @repo/agent-skills — product skill files: the
                 dialect's first-party spec, served to agents as files.
  ui/            @repo/ui — the shared component vocabulary on Base UI:
                 shadcn in components/, the Fluid Functionalism sidebar and
                 system helpers beside it, and the Beautiful UI surfaces in
                 ai/. All four origins were vendored and the code is now this
                 repo's own — it obeys this repo's rules, not upstream's
                 shape. What survives of the origin is the MIT attribution
                 header on each file and its licence text in tools/licenses.
                 A LIBRARY AHEAD OF ITS CONSUMERS: `src/ai` holds fifteen
                 components no surface draws on yet, kept by owner decision
                 and listed one by one in the PER-EXPORT orphan guard
                 (`tools/repo-guards/src/ui-orphan-exports.test.ts`), so a
                 sixteenth still fails. Leaf.
tools/
  repo-guards/   @repo/repo-guards — derived fitness tests over the REPO: the
                 package dependency DAG + its platform-purity rules, ws
                 change-kind reachability, and the dangling-reference sweep
                 over every path and @repo/* name the repo writes down. The
                 invariants that span workspaces and belong to none of them.
  e2e/           @repo/e2e — the scenario suite `pnpm e2e` runs: it boots real
                 instances and drives them over the wire, which is why it sits
                 outside `verify` (every unit passes while the composition
                 fails).
```

## Tech Stack

- **Monorepo**: Turborepo + pnpm workspaces, oxlint/oxfmt, vitest, knip
- **Web**: TanStack Start + React 19 + Tailwind CSS 4 on a Cloudflare Worker
- **Auth**: Better Auth on D1 via Drizzle — email+password, bearer tokens,
  invite-gated sign-up; no social providers

## Commands and gates

`docs/development.md` owns the commands, the ports, where state lives and the
gate. What every session keeps regardless:

```bash
pnpm format:fix && pnpm verify   # before committing — format FIRST, never after
```

`verify` is the STATIC gate (`typecheck && lint && knip && format && test &&
build`, check-only on purpose). CI runs those six and then the scenario suite,
so a green `verify` is not a green CI — run `pnpm e2e` too before claiming
one. `tools/repo-guards/src/ci-verify-parity.test.ts` keeps that "plus a few
more" an honest claim: every step on top of `verify` is a row in
`DECLARED_CI_EXTRAS` with its reason.

**There is no seeded login, and sign-up is invite-only.** `AGENTS.md` has the
recipe. Never run `db:push` or `db:studio`: both hit production D1; the local
command is `db:push:local`.

`apps/web/README.md` is the product Worker's own guide — routes, auth, the
local loop and the owner-only deploy. `AGENTS.md` is the runnable quickstart;
`CONTEXT.md` glosses the carried domain vocabulary.

## Decisions

Each bullet is the decision, what it rejected and why, and the file that
carries the mechanism. The dangling-reference guard keeps the pointers honest.

- **THE EDITOR IS A WYSIWYG OVER A BYTE-DISCIPLINED SERIALIZER** (epic #579,
  reversing #542's editor line by owner decision; do not "fix" it back). Plate.js
  over one owned parse, one rule table and a bounded fixpoint. Byte stability is
  a contract defended by tests, not a property of the data model: canonical
  files round-trip byte-exact, churn-class constructs may canonicalize on the
  first save (stated per fixture), and a file the pipeline cannot round-trip
  opens raw. The fixtures are formatter-exempt because their bytes are the
  assertion. `packages/editor/README.md` § Invariants and
  `packages/editor/src/markdown/markdown-doc.ts`.

- **THE EDITOR SHIPS ITS BEHAVIOUR CSS.** `packages/editor/src/styles.css`
  carries the toggle collapse, the callout marker swap and the code theme, and
  reaches the app through the desktop `globals.css` import. Every hook is
  spelled once in `packages/editor/src/style-hooks.ts` and pinned to the sheet
  in both directions by `packages/editor/src/__tests__/style-hooks.test.ts`,
  because the editor once shipped with the stylesheet missing and no test
  noticed.

- **NOTES SPEAK THE INTELIGIR DIALECT**: `[[Title]]` / `[[Title#H]]` /
  `[[Title|alias]]` / `[[Title|uuid]]` wiki links (the last pipe starts the
  alias), `{{source|display|meta}}` formula pills, `%%i:id:start/end%%` comment
  anchors, and `inteligir-callout` / `inteligir-chart` / `inteligir-canvas` /
  `inteligir-html` / `:::tabs` blocks, all valid markdown, all round-tripping.
  Every spelling lives in one place (`@repo/notes/markdown/fence-langs`,
  `@repo/editor/nodes/canvas-header`) because the rule table and the knowledge
  scan both read it. The file layout stays plain nested `.md`: no bundles, no
  meta.json; frontmatter is the only property store and a note's UUID is
  frontmatter `id:`. `{{` is reserved from MDX expressions by a tokenizer guard
  on both braces. Comment thread bodies live in a `<note>.comments.json`
  sidecar.

- **A turn row's `sourceSeqEnd` names its own contributors**, not every
  turn-scoped event. A streaming assistant message is turn-scoped but lands as a
  top-level row; counting it moved the turn row and resent the whole subtree on
  every token.

- **The auto-commit stages what the window's writers named.** A scheduler that
  names no paths makes the flush unscoped, which only the boot sweep and the
  post-sync drain do; a change nobody announced waits for a whole-tree caller.
  Unscoped `add -A` survives for a large vault's first commit, where a pathspec
  would exceed ARG_MAX (`apps/cli/src/server/vault/git-engine.ts`).

- **The knowledge index does not persist a stat fingerprint.** A warm reconcile
  over 2000 notes is ~105ms off the critical path; a second persisted table in a
  cache whose recovery primitive is deleting the file is a crash waiting for a
  missed re-create.

- **NOTE HISTORY IS LOCAL, AND A RESTORE IS A WRITE.** The history surface reads
  the vault's own git repo, so it works offline with no remote. Restoring
  revision N writes its bytes through the ordinary write path with
  `expectedHash`, never `git checkout` or `git revert`, which would bypass the
  CAS, the re-index, the `/ws` notification and the open buffer's convergence.
  There is no `vault.restore` procedure (a second server write path is a second
  CAS), so both clients run the same composition: checkpoint with
  `vault.commitNow`, then write with the base the diff was computed from, never a
  fresh read. A restore's CAS refusal is reported, not diff3-merged: the user
  named exact bytes. Reading the log is off the repo lock. The git flags and the
  parse are `apps/cli/src/server/vault/git-history.ts`; the composition is
  `apps/desktop/src/renderer/app/actions/history-tab.tsx` and `vault restore` in
  `apps/cli/src/commands/vault.ts`. A deleted note comes back the same way: the
  deleted-notes list is the git log's deletions plus the worktree's uncommitted
  ones (a just-deleted note is not in the log for up to 60s), and restore is a
  `revision` read plus an `ifAbsent` write. There is no trash folder and no
  purge.

- **THE AUTO-COMMIT IS SESSION-SHAPED (15s quiet / 60s max)** so the log is
  answerable: a single-file commit names its file and a fifteen-second pause
  ends an editing session. Why the max wait is the sync interval is
  `apps/cli/src/server/vault/git-engine.ts`.

- **A write carries the base it was computed from.** `expectedHash` is compared
  under the repo lock; a mismatch answers 409 with the current content and the
  client diff3-merges and retries. Creation uses `ifAbsent`. Without it an agent
  write landing between a read and a save is silently overwritten. diff3 rather
  than active-user-wins, which discards concurrent body edits wholesale.
  `apps/desktop/src/renderer/app/note/guarded-vault-io.ts` and
  `@repo/notes/text/diff3`.

- **A CREATE IS NOT A WRITE WITH AN EMPTY BASE.** Creation sends `ifAbsent` and
  no hash; hashing bytes not yet on disk is a refusal every time. A guarded
  write with no recorded base throws rather than inferring one, because an
  inferred base lets a concurrent edit win silently. The policy is
  `apps/desktop/src/renderer/app/note/guarded-vault-io.ts`.

- **EVERY ERROR A VAULT ROW DECLARES HAS A PRODUCER.** A code no handler raises
  hands the client a branch that never runs while the real refusal falls
  through. Derived from both sides:
  `apps/cli/src/server/vault/__tests__/vault-contract-errors.test.ts`.

- **Containment is PHYSICAL, not lexical.** The vault realpaths the deepest
  existing ancestor and refuses symlinked leaves; a lexical check passes a
  `notes.md` that is a symlink to a private key, and a `git pull` from a hostile
  remote can plant one (`apps/cli/src/server/vault/vault-service.ts` over
  `path-containment.ts`).

- **The vault dir and the data dir must be disjoint**, refused at boot: a data
  dir inside the vault gets committed and pushed, database and config included.

- **Ingest is ONE transaction.** Append, lifecycle projection and queue touch
  happen in one immediate transaction; notifications flush after commit.
  Lifecycle CAS predicates include the turn identity so a late completion for
  turn A cannot settle turn B (`apps/cli/src/server/threads/service.ts`).

- **Agent commits stage the turn's own write set**, from the fileChange events,
  under a counted commit hold that defers the vault debounce and blocks a sync.
  Committing the whole dirty tree attributes a concurrent turn's writes to
  whoever settles first (`apps/cli/src/server/agents/agent-commits.ts`).

- **`runGit` PREPENDS `--literal-pathspecs` TO EVERY INVOCATION.** A pathspec is
  a glob, so `[a].md` names `a.md` too and a commit scoped to one note staged
  its neighbour. The one argv builder is `apps/cli/src/server/vault/git-run.ts`.

- **THE SERVER IS SPLIT ALONG ONE-RESPONSIBILITY SEAMS**: `vault/git-run` /
  `git-porcelain` / `git-bootstrap` / `git-engine`; `cloud/sync-pass` /
  `socket-link` / `sync-cadence`; `agents/interaction-waiters`
  beside a watchdog that sweeps per-turn timestamps rather than re-arming a
  timer per frame; `writeTransaction` in `@repo/db/connection` as the one
  spelling of `BEGIN IMMEDIATE`. `ThreadService.boot()` is called from the
  composition root because crash recovery writes.

- **THE AGENT SURFACE IS THE ⌘K ACTION COMPOSER AND THE RIGHT PANEL** (what it
  retired is the register on #645; do not bring any of it back). An action is an
  ordinary thread attached to the note it was composed over
  (`threads.originDocPath`). The agent edits the vault directly and anchored
  comments are the review channel; the panel's Actions | Comments | History |
  Settings tabs are transcript, review, revision, and the note's own properties,
  related notes and delete. ⌘P is the palette, ⌘F the find bar, ⌘\ is zen.
  "Ask agent" seeds the composer through
  `packages/editor/src/agent-request.ts`, so the editor never imports the shell.
  `apps/desktop/src/renderer/app/actions/actions-panel.tsx` and
  `action-composer.tsx`.

- **COMMENTS CARRY THE AUTHOR'S `source`, AND THE SIDECAR WRITE IS A CAS.** The
  server signs `user` when a caller says nothing; the CLI signs `agent` under
  `INTELIGIR_THREAD_ID`. The sidecar write retries once on a base mismatch, then
  answers `CONFLICT`. The comment-id grammar has one spelling in
  `@repo/notes/comments/sidecar-schema`.
  `apps/cli/src/server/comments/comments-service.ts` and
  `apps/cli/src/commands/comment.ts`.

- **WINDOW-LEVEL HOSTS MOUNT AT THE ROOT ROUTE.** `ConfirmDialogHost`, `Toaster`
  and the one `TooltipProvider` live in
  `apps/desktop/src/renderer/routes/__root.tsx`; a host mounted by one route
  leaves another route's `confirm()` parked on a dialog that never opens.

- **A VIEW CONTEXT RIDES THE MESSAGE, and it is a statement about the past.**
  What the user was looking at travels on the send (`@repo/domain/view-context`),
  never as a thread column or a server-side "current view" that has no owner.
  It describes the screen the message left from, so navigating away mid-turn
  changes nothing. There is no tool: the agent can already read the file, and
  the one thing a tool could add, a live selection, cannot be made honest. It is
  a statement, not a grant. A queued send carries none. There is no selection
  field; real offsets need a Slate to markdown offset map.
  `apps/cli/src/server/agents/view-context-prompt.ts`.

- **THE RAIL IS THE WORKSPACE; THE TOP BAR IS THE OPEN NOTE.** Search, new
  note and folder, the folder scope, the recents/tree toggle, sync, deleted
  notes and Settings live in the left rail; find in note, copy link, comments,
  export and the panel toggle live above the note. Two lists, one rule: the
  recents view is one list by recency with a folder hint, and folders exist only
  in the tree. A create lands where an IDE's would, in the tree's selected
  folder, else at the scope. The rail hides what the user did not write
  (`@repo/notes/knowledge/doc-file`'s `isVaultMetadataPath`: comment sidecars,
  dot-entries); the server's listing stays complete because the CLI and the
  agent read it. Under the macOS shell the rail reserves the traffic-light
  corner (`apps/desktop/src/renderer/app/title-bar.ts`); nothing else is a
  logo. `apps/desktop/src/renderer/app/sidebar/sidebar.tsx`.

- **THE WIKI-LINK PREVIEW IS A HOVER CARD, NOT A TOOLTIP.** Base UI's
  PreviewCard (`@repo/ui/components/hover-card`): the pointer can move into it,
  the text selects, the title opens the note. Base UI's Popover has no hover
  mode; a hand-positioned `pointer-events-none` div is what it replaced
  (`packages/editor/src/wiki-chip.tsx`).

- **THE DEFAULT HARNESS IS A STORED CHOICE, read per thread start.**
  `<dataDir>/agent-prefs.json`, edited from Settings › Agents; unset falls back
  to claude when it is on PATH. Not config.json, which is read once at boot and
  never written by the app. A thread keeps the harness it started on
  (`threads.providerId`); the choice reaches the next one. The store is
  `apps/cli/src/server/agents/agent-prefs-store.ts`; the one fallback rule is
  `defaultHarnessId` in `agent-driver.ts`.

- **RELATED IS ONE PANEL SECTION**: backlinks first because they are counted,
  then the scorer's rows with their reasons, no dedup between the halves
  (`apps/desktop/src/renderer/app/actions/related-section.tsx`). Outgoing links
  stay absent (they are on screen as wiki-links); no graph view; the route stays
  search-shaped (a `limit`, no `total`); suggestions are fetched only while the
  section is unfolded; refresh rides the existing `files-changed` and
  `content-changed` kinds, which sweep the `knowledgeRoot` family whole because
  a link into a note lives in another note's bytes.

- **THE EDITOR COLUMN SHOWS ONE NOTE.** No second pane and no pane vocabulary:
  one `OpenNoteStore`, and every surface reads the open note. Registries keyed
  on a note's path keep that key so a late answer cannot land on the note that
  replaced it. There is no raw/rich toggle: the surface derives from
  `packages/editor/src/note/markdown-gate.ts` alone.

- **THE APPEARANCE DIALS ARE ONE DECLARATION, READ THROUGH `.typeset-docs`.**
  The tokens are declared once in `apps/desktop/src/renderer/styles/globals.css`.
  No accent axis: nothing in Plate consumes a hue.

- **Stemming is a SHADOW of the indexed text, never a rewrite of it.** Literal
  and stem columns at equal bm25 weight; `@repo/notes/knowledge/search-query`
  owns the one policy both engines run. FTS5's `porter` tokenizer is rejected
  for a measured reason: it stems the index, so a prefix query for a half-typed
  word stops retrieving (86 of 1,555 prefixes over the labelled corpus), and it
  puts half a shared policy inside SQLite's C. Every term asks both halves, and
  that OR is the exact tier: a doc holding the literal word scores about twice a
  stem-only hit. Residual: the title/body gap is 10x, so a title collision still
  beats a body exact match. `search-query.ts` and `knowledge/search-excerpt.ts`.

- **CONNECTORS ARE AN APP-OWNED REGISTRY, injected per-session over ACP**
  (reversing the codex-owned registry, whose premise died with the ACP runtime).
  One store, edited in Settings and by the CLI; every harness receives the
  enabled rows through `session/new`'s `mcpServers`. Secrets stay in the data
  dir and are redacted on every read
  (`apps/cli/src/server/connectors/connectors-service.ts`).

- **AGENT MEMORY IS REMOVED** (reversing #575). Claude Code and Codex carry
  their own; a third beside them was two answers to one question. What survived
  is the pattern: content the agent consumes lives in files it reads with its
  own shell. The dialect skills ride `INTELIGIR_SKILLS_DIR` with a
  three-sentence pointer on the first turn, never the spec inlined.

- **ONE SET OF SESSION FACTS, TWO PROJECTIONS.** The shell env and the prompt
  are pure functions of one `AgentSessionFacts`, and the runtime's `shellEnv` is
  a getter read at every spawn, because read once `INTELIGIR_CONNECTED_DIRS`
  froze at the first turn (`apps/cli/src/server/agents/agent-shell-env.ts`).

- **DICTATION IS STREAMING PARAKEET, REVERSING whisper.cpp** (#574 → #578, by
  owner decision; do not "fix" it back). whisper gave punctuation and capitals
  but made dictation batch; the owner chose live partials. So the engine is
  `sherpa-onnx-node` with a streaming Parakeet transducer, and the final has no
  punctuation and no capitalization. That trade is the point.
- **THE MODEL FILE IS THE SWITCH.** No `voiceEnabled` flag: `install` fetches
  against the pinned sha, `remove` deletes, off is no model on disk. The mic
  streams over a websocket; there is no batch procedure. The pick, the atomic
  download and the pure-JS `.tar.bz2` extraction are
  `apps/cli/src/server/voice/model-catalog.ts` and `model-store.ts`.
- **A PERSISTENT SESSION WORKER, not one per clip, and THE SESSION IS BOUNDED.**
  The model loads once per hold and stays warm. The worker is not optional:
  `better-sqlite3` is synchronous and the watcher's liveness ping rides a bare
  timer, so an inline native decode would stall a save, a query and the ping
  together. A hold is capped at `VOICE_MAX_AUDIO_SECONDS`. Teardown on every
  exit path is `apps/cli/src/server/voice/stream-session.ts`.
- **A DEDICATED DICTATION WEBSOCKET, off the invalidation bus.** `/voice/stream`
  carries PCM16 up and partial/final/error down; `/ws` carries pings and never a
  payload. It sits behind the same loopback guard, is exempt from the
  route-table guard like `/ws`, and its sockets are closed by name at teardown
  so a live hold cannot stall exit.
- **THE RENDERER STREAMS WITH A `ScriptProcessorNode`, not an `AudioWorklet`.**
  A worklet is fetched as a script and the prod CSP names `worker-src 'none'`;
  ScriptProcessorNode is deprecated but loads no module. Partials render outside
  the composer field and only the final splices in
  (`apps/desktop/src/renderer/app/voice/dictation.ts`).
- **THE SHA GATE IS THE REAL GUARD; the `modelUnusable` nuke is the backstop.**
  Only bytes matching the pin reach the recognizer. onnxruntime does not
  translate a parse failure into a catchable error, so an unparseable model
  would crash rather than nuke; the sha gate is why that path is unreachable.
  The probe actually loads the native binding, so an unsupported platform
  answers `unavailable`. The shell grants `media` origin-scoped. No CLI verb:
  holding a key over a live microphone is not something a shell can express.
  English only.

- **THE DEVICE CREDENTIAL IS THE SYNC SWITCH, and it lives in the data dir.**
  `<dataDir>/device-credential` at 0600: not in `inteligir.db` (the thread log it
  uploads) and not in the vault (a git repo pushed to a remote). No separate
  "sync enabled" flag: two values that must agree can disagree. Signed out, the
  app opens no socket, arms no timer and makes no request, asserted at the
  shipping cadence in `apps/cli/src/server/cloud/__tests__/sync-runtime.test.ts`.
  Cost accepted: "pause sync" is signing out, which discards the queue.
  `apps/cli/src/server/cloud/credential-store.ts` and `sync-runtime.ts`.

- **THE HOSTED VAULT'S READ PATHS ARE BUDGETED PER DEVICE, and the budget buys
  time, not prevention.** `/v1/vault/*` and `/v1/git/*` consume a window keyed
  on the device, never the address: a stolen credential moves between addresses
  and the device row is what `/app/devices` revokes. Two families so a drained
  read budget never takes sync down. It breaks a runaway loop and caps what one
  credential costs per minute; revocation is the control. Both ceilings are set
  from the worst legitimate minute (20 devices, every push pings all; one note's
  embeds on the read side, which the format does not bound). Revocation and
  account deletion drop the rows. A read-scoped credential is the deeper answer
  and is not built; the trigger is a second party holding a credential for
  someone else's account.

- **A DEVICE SIGNS IN WITH EMAIL + PASSWORD, and gets the same device
  credential** (owner decision, the Obsidian model, reversing the
  browser-approved pairing line). `POST /v1/device/login` verifies the password
  through Better Auth's server API, mints the device credential and deletes the
  session the sign-in created, so a device holds exactly one secret and the
  devices page is what revokes it. The route is unauthenticated and throttled
  per caller address: a login route with no throttle is a password oracle.
  Rejected: the browser approve page, the one-time code, PKCE and the loopback
  callback, a ceremony whose point was keeping the password out of the app.
  Residual: the password passes through the app once over HTTPS. Social
  providers are gone with it: a login that must work inside the app can only be
  a password. The one flow both the CLI and the phone run is
  `@repo/api/cloud/device/login-flow.ts`; the route is
  `apps/web/src/worker/device/login.ts`.
- **`@repo/api/cloud` IS THE CLIENT RUNTIME CORE, not only the wire**:
  `bytes.ts`, `approval-slot.ts` (connector OAuth's one slot),
  `device/login-flow.ts`, `sync/sync-session.ts`. The CLI and the
  phone inject only stores, timers and sockets; a security discipline with two
  spellings is two to audit. The cloud vault-path grammar is `parseVaultPath`
  with the parse required to be the identity. The `[[Title|uuid]]` tier lives in
  `buildResolver` (tier 0); the desktop and mobile listings carry no `id` yet.

- **ON THE PHONE, THE RUNTIME THAT MOVES A VALUE IS THE ONE THAT NOTIFIES.**
  `SyncRuntime` and the login flow publish stores the screens subscribe to, so
  a poll pass, a revocation or a refused login is shown. A refused capture keeps
  its text and says why. `apps/mobile/src/sync/sync-runtime.ts`,
  `apps/mobile/src/login/login-store.ts`.

- **A pulled event lands through the SAME ingest, marked with its origin**
  (`ThreadService.applySyncedEvents`). The origin changes three things: the
  thread row takes the log's id, nothing is re-enqueued, and a settle does not
  drain this device's queue. The cursor moves inside that transaction, which is
  what makes the apply exactly-once. Signing in again resets the cursor, so a synced
  row also carries `events.origin_device_id` / `origin_device_seq` under a
  unique index, keyed `(device, position)` rather than the account-global `seq`.
  Lifecycle projects over what landed, never what arrived.
  `apps/cli/src/server/cloud/sync-pass.ts`.

- **Only the process that owns a provider may declare it dead.** Crash recovery
  reads the `turn/started` row's provenance and leaves a remote turn alone; a
  fabricated failure would sync back to the machine still doing the work. A
  device that never returns leaves the thread active here.

- **CONVERGENCE MEANS THE SAME SET, NOT THE SAME ORDER.** `events.sequence` is
  an arrival order per device under a UNIQUE(thread, sequence), so no
  renumbering exists. Pinned: both devices hold the same set and each writer's
  turn stays contiguous. Projecting the account log's global `seq` instead is
  the change if a shared interleave is ever needed.

- **A SYNC PASS IS FENCED BY SESSION IDENTITY, not by "is a session live?".**
  Every step re-checks the id after every await, because the dangerous case is
  a different sign-in: an old ack deletes rows a later sign-in queued. `dispose`
  aborts too. The fence is `@repo/api/cloud/sync/sync-session.ts`.

- **The outbox stores the bytes it will send, once, at enqueue.** The log calls
  a position replayed with a different body `sync-conflict`. `deviceSeq` is its
  own counter in `sync_state`, not `MAX()` over a shrinking queue and not
  `events.sequence`. An event the contract refuses is dropped rather than
  stranding every event behind it (`takePushBatch` in
  `apps/cli/src/server/cloud/outbox.ts`; the frozen-body store is
  `packages/db/src/sync-outbox.ts`).

- **SYNC IS PERMISSIONED BY ACCOUNT; the account IS the entitlement.**
  Accountless, the app is local-only and makes zero cloud requests. Signed in, the
  credential alone entitles threads, captures and the hosted vault, with no
  second flag. The invite gate is account-creation policy. The BYO git remote
  (`INTELIGIR_VAULT_REMOTE`) stays accountless.

- **The THREAD channel carries thread events alone.** A thread with no events
  never reaches another device. Vault bytes ride the git remote, never this log.

- **Cloud state names its Durable Object from a VERIFIED credential.** Account
  deletion revokes credentials first, then purges, then writes a tombstone every
  route refuses, because the reorder alone leaves an in-flight request able to
  recreate state.

- **Say the delivery guarantee you implement.** Captures are at-least-once
  delivery with exactly-once deletion by the owning claim, so the apply must be
  idempotent on the capture id (`@repo/api/cloud/captures/captures-schema`).

- **THE PLATE SLASH MENU AND BOTTOM TOOLBAR ARE THE INSERTION SURFACES.** Slash
  items are grouped data in `packages/editor/src/slash-menu.tsx`; the toolbar is
  selection-stateless. Every insertable row's markdown must re-parse to a
  modeled construct; the kit-parity vocabulary pins the set. Legacy
  `<!-- inteligir:thread anc_… -->` markers parse as opaque comments and are
  preserved; nothing writes new ones.

- **ONE BINARY, TWO MODES: `inteligir serve` IS the server, and `npx` is a verb**
  (reversing the launcher-boots-in-process line). `npx inteligir serve --open`
  is the zero-install path with one exit code. The desktop shell still forks a
  child so the compositor never shares an event loop with better-sqlite3, a
  watcher fork and `git`; `utilityProcess` supervises, with readiness, the
  SIGKILL behind a grace and the deliberate absence of a restart in
  `apps/desktop/src/main/server-process.ts`. The shell adopts a listening server
  and only kills the child it started.

- **ONE COMPOSITION ROOT.** `apps/cli/src/server/compose.ts` builds every
  service in boot order and returns `{ context, teardown }`; `createApp` is
  route wiring, `serve.ts` is listen + `server.json` + signals + exit code, and
  the booted suites call the same composition. The two dials `serve.ts` injects
  (the cloud socket opener, the agent driver) are injected because compose is
  reachable from the renderer's test program. `dev-instance.ts` owns the
  per-checkout derivation; `config.ts` stays the parser.

- **THE BIN EXITS 128+n WHEN THE SERVER DIES BY SIGNAL, NEVER 0**
  (`apps/cli/bin/inteligir`). Re-raising the signal at the wrapper exited 0.

- **THE CREDENTIAL IS A FILE, NOT A CHALLENGE** (reversing the
  loopback-adoption-is-earned line). The server writes `<dataDir>/server.json`
  at 0600 and removes it on ordered shutdown; every caller reads it and sends
  the bearer. No probing, no adoption ceremony, and the browser-origin guard
  survives only where the credential is ambient: a cookie-authed request must
  also prove same-origin because loopback "site" ignores the port. The bound is
  the honest one: it proves the caller can read the data dir, not that it is
  this code. One token, two carriers (header, and an HttpOnly SameSite=Strict
  cookie). `apps/cli/src/server/server-file.ts` and `browser-request.ts`.

- **Shutdown is ORDERED, per-step TIME-BOXED, and its exit code is the truth.**
  Writers stop, the vault flush runs, handles close; each step has its own
  budget because one wedged step under a single budget starves the flush. The
  listener step closes websockets by name, because an upgraded socket is
  detached from the HTTP server's tracking and one open tab once stalled the
  whole teardown. `apps/cli/src/server/shutdown.ts` and `ws-bus.ts`.

- **THE CSP IS STATIC, and deleting TanStack Start from the product bought
  that** (reversing the nonce CSP). Start injected per-render inline scripts; a
  plain Vite SPA injects none, so `script-src` is `'self'` and one fixed header
  is served by the protocol handler and the server alike. `style-src` keeps
  `'unsafe-inline'`. `connect-src` earns the most: a script that cannot reach a
  third-party origin cannot exfiltrate the vault. `apps/cli/src/server/csp.ts`.

- **THE RENDERER'S ONLY DOOR IS `inteligir://app`.** The protocol handler
  carries the bundle, `/rpc/*` and `/vault/asset`, attaching the bearer in main,
  so the page is same-origin with its API, there is no CORS, and the renderer
  never holds the token (which is what keeps `<img src>` working). Websockets
  are the one exception: main attaches the bearer to those upgrades and the
  single preload hands the renderer the loopback origin. The pin cannot use
  `URL.origin`, which answers `"null"` for any non-special scheme; scheme and
  host are compared as fields. A copied link names the server's loopback origin,
  never the page's. `apps/desktop/src/main/protocol.ts`, `origin-pin.ts`,
  `credential-scope.ts`, `apps/desktop/src/types.ts`,
  `apps/desktop/src/renderer/app/socket-origin.ts`.

- **UPDATES ARE electron-updater OVER THE GITHUB RELEASE, and nothing moves
  without a click** (reversing "no update feed"). electron-builder's `publish`
  row writes `app-update.yml` beside the app and `latest-mac.yml` into the
  output; the release carries the dmg, the zip (Squirrel installs from the zip,
  never the dmg), its blockmap and that manifest, uploaded by `gh release
create`, never by electron-builder. `autoDownload` and `autoInstallOnAppQuit`
  are off: a check 15s after launch and every 4 minutes, the download and the
  restart each a click, in Settings › About or the app menu. Install stops the
  server child first, so the vault's pending commit flushes before Squirrel
  swaps the bundle. THE BRIDGE CARRIES TWO THINGS: the loopback origin and the
  updater, because the updater lives in main and no server can answer for it;
  every frame crosses as `unknown` and the page parses it. Still no token in
  the renderer. `apps/desktop/src/main/updates.ts` (the policy over an
  injectable port) and `apps/desktop/src/update-state.ts` (the one state).

- **Better Auth's `baseURL` is derived per-request from the request origin.**
  Every hostname reaching this Worker is one the deployment owns, and Cloudflare
  routes by hostname; a fixed fallback would mint reset links at the wrong
  deployment. Revisit if a hostname the deployment does not control reaches the
  Worker (`apps/web/src/worker/auth/auth.ts`).

- **Sign-up is invite-gated by a Worker route in front of Better Auth**
  (`apps/web/src/worker/auth/invite.ts`): claims the code atomically and
  forwards into the one instance with `disableSignUp` off; every other instance
  carries the flag. `apps/web/README.md` § Auth.

- **The D1 auth schema ships via `drizzle-kit push`; there are no migration
  files.** One deployer and an additive schema; `apps/web/vitest.config.ts`
  derives the test DDL by `drizzle-kit export`. A second deployer or a
  destructive column change is the trigger for migrations. Never flip the
  timestamp mode in place: both modes read the same INTEGER column and a
  redeploy without `UPDATE <table> SET <col> = <col> * 1000` reads every date as
  1970 and expires every session.

- **`KnowledgeIndex` in @repo/notes is not dead code.** `@repo/notes` carries no
  sqlite dependency (`SqlDriver` is injected), so this in-memory composition is
  the only way the package tests its own engine.

- **THE CLIENT DOES NOT DECIDE WHAT A DOC IS.** `@repo/notes/knowledge/doc-file`
  is the one answer: `isDocPath` (`.md`, `.markdown`, `.mdx`, `.txt`) and
  `docStem`. A private `.md` rule in a client hides every `.txt` note and
  disagrees on display the moment a name is not lowercase.
  `apps/desktop/src/renderer/app/__tests__/vault-hooks.test.ts` walks the
  renderer for either shape.

- **The knowledge scan disables `codeIndented` and `htmlFlow`**
  (`@repo/notes/markdown/scan-parse`). A checkbox is addressed by position among
  a doc's task items, so the scan's count must agree with the editor's, whose
  plugin list disables both too; pinned by
  `packages/notes/src/__tests__/task-ordinal.test.ts`.

- **THE SCAN'S GRAMMAR IS NOT THE EDITOR'S, and `verbatim-spans` is the one
  bridge.** The scan is total so a malformed tag cannot cost a note its index
  row; the editor's MDX tokenizer throws. A `targetSpan` is a licence to rewrite
  bytes, so the scan runs the editor's plugin list as a bare parse
  (`@repo/notes/markdown/verbatim-spans`) and withholds the span inside those
  ranges. Unifying the grammars is rejected: one malformed tag would stop a note
  indexing. A doc the editor refuses yields no ranges, correctly: it opens raw.

- **Frontmatter is the ONLY property store.** No metadata table. YAML the typing
  rules cannot represent is preserved byte-exactly.

- **No coverage tooling, on purpose.** Targeted structural invariants instead:
  the dependency DAG and platform rules, ws change-kind reachability
  (`tools/repo-guards`), route-table completeness
  (`apps/cli/src/server/__tests__/http-surface.test.ts`), migration↔schema
  agreement (`packages/db/src/__tests__/schema-agreement.test.ts`), the
  per-export orphan guard over `@repo/ui`, the CLI guide and its `--json` flags,
  the editor's buffer invariant. If coverage is ever added, `coverage.include`
  is mandatory in Vitest 4, and gate only `@repo/notes`.

- **A structural guard states its own rule in the failure**, names the file, and
  derives every value it compares. The one hand-written list is
  `dep-dag.test.ts`'s `DECLARED_EDGES`, which is the pin itself.

- **VENDORED CODE IS THIS REPO'S CODE, except for the attribution.** Rename,
  restructure and delete freely; "the next re-pull becomes a conflict" is not a
  reason. Every vendored file keeps its `// Vendored from X, MIT.` header and the
  licence texts live under `tools/licenses`, staged into the artifact as
  `dist/licenses`, with `pnpm smoke:cli` deriving the expected set from the
  directory.

- **`packages/ui/components.json` declares `rsc: true` and it is inert**: every
  consumer is a plain Vite build.

- **THE ORPHAN GUARD OVER `@repo/ui` IS PER EXPORT**: every named export under
  the wildcard-exported directories needs a consumer outside the gallery or a
  reasoned allowance row (`tools/repo-guards/src/ui-orphan-exports.test.ts` says
  why neither a file guard nor knip can ask this). Base UI's `render` prop is the
  polymorphism channel; there is no Slot.

- **THE REACT COMPILER IS ON FOR ALL THREE APPS**: `compiler: true` on
  `@vitejs/plugin-react` in both vite configs and `reactCompiler: true` in
  `apps/mobile/app.config.js`. The manual-memo sweep is a follow-up.

- **TOOLING PINS, each with its reason beside it**: `vite` is a pnpm override
  because the catalog bound only the manifests that spell it; `@types/node`
  tracks `engines.node`; `compatibility_date` is the lockfile's oldest workerd,
  held by `tools/repo-guards/src/wrangler-compat-date.test.ts`; `pnpm e2e` boots
  the built Worker bundle (`tools/e2e/src/scenarios/built-worker-boot.ts`);
  agent-browser is pinned by hand in `.github/workflows/ci.yml` because a global
  install rides no lockfile. The arguments are `pnpm-workspace.yaml`'s comments.

- **TEMPLATES ARE A FOLDER, AND PLACEHOLDERS EXPAND ON BYTES BEFORE ANY PARSER.**
  A template is a doc under `templates/` (a fixed convention like the daily
  folder, no setting); `templates/Daily.md` shapes the daily note. Exactly three
  placeholders, `{{date}}`, `{{time}}`, `{{title}}`, replaced textually on the
  raw markdown, so the formula grammar never sees them and every other `{{…}}`
  is a pill left byte-exact. Insert lands the body through the paste parser at
  the selection and leaves the template's frontmatter behind; a note minted
  from a template drops the template's `id:`, because two notes with one id
  make the uuid link tier ambiguous. `@repo/notes/templates/placeholders`,
  `packages/editor/src/insert-template.ts`.

**Before raising a "new" finding, read
[#542](https://github.com/kyh/inteligir/issues/542)**: the decision record
carries what was rejected as well as what was chosen. The older `note` issues
(#446, #453, #472, #474) catalogue findings declined against the hosted
Durable-Object architecture this rewrite replaced.
