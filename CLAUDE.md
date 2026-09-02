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
                 src/preload/ (ONE string — the loopback ws origin, because a
                 browser WebSocket cannot be proxied and window.location.origin
                 no longer names a server), and src/renderer/ (the SPA:
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
                 `inteligir sync` drive. src/server/voice/ is dictation (issue
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
                 marketing site, the auth pages, Better Auth on D1
                 (invite-gated sign-up), and the v3 cloud (issue #554):
                 device pairing (/app/pair approves one, /app/devices lists and
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
                 pairing, device auth, sync push/pull, captures, the ws ping
                 frames, the typed error envelope, and the ONE page planner
                 every reader of the merged log runs (`cloud/sync/plan-page`) —
                 two copies of that planner would be two answers to "did this
                 row move the cursor?", and a mis-set cursor is a duplicated
                 conversation — and, for the same reason, the CLIENT RUNTIME
                 CORE both consumers run (the byte primitives, the approval
                 slot, the pairing machine, the sync session; #639 below).
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
                 drives through injected ports (host.tsx / host-io.ts).
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
                 A LIBRARY AHEAD OF ITS CONSUMERS: `src/ai` holds fourteen
                 components no surface draws on yet, kept by owner decision
                 and listed one by one in the PER-EXPORT orphan guard
                 (`tools/repo-guards/src/ui-orphan-exports.test.ts`), so a
                 fifteenth still fails. Leaf.
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
  optional GitHub/Google, invite-gated sign-up

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

The decision, its reversal pointers and its "rejected because" live HERE;
where a file's leading comment carries the mechanism, the bullet names the
file rather than restating it — the dangling-reference guard keeps those
pointers honest, which is more than a copy ever gave.

- **THE EDITOR IS A WYSIWYG OVER A BYTE-DISCIPLINED SERIALIZER** (epic #579,
  reversing #542's editor line — deliberately, by the owner; do not "fix" it
  back). The editor is Plate.js (Slate) resurrected whole from `7dc78ffe^`
  WITH its byte-stability apparatus. Byte stability is a CONTRACT DEFENDED BY
  TESTS rather than a property of the data model: canonical files round-trip
  byte-exact; churn-class constructs may canonicalize on the first save,
  stated per fixture; a file the pipeline cannot round-trip safely opens RAW.
  The fixtures are formatter-exempt — their bytes ARE the assertion. The
  apparatus itself — one owned parse, one rule table, the bounded FIXPOINT,
  kit parity, the fixture matrix — is `packages/editor/README.md` § Invariants
  and `packages/editor/src/markdown/markdown-doc.ts`.

- **THE EDITOR SHIPS ITS BEHAVIOUR CSS** (#633). A kit's hook is only behaviour
  while a rule reads it: `packages/editor/src/styles.css` carries the
  toggle-body collapse, the callout marker/badge swap and the code highlight
  theme, and reaches the app through the desktop renderer's `globals.css`
  import. Every hook is spelled ONCE in `packages/editor/src/style-hooks.ts`,
  and `packages/editor/src/__tests__/style-hooks.test.ts` pins sheet and
  hooks to each other in BOTH directions — the whole editor once shipped with
  the stylesheet missing and no test noticed.

- **NOTES SPEAK THE INTELIGIR DIALECT**
  (#581, renamed 2026-08-22 — the product is inteligir, so the format carries
  its name): `[[Title]]` / `[[Title#H]]` / `[[Title|alias]]` / `[[Title|uuid]]`
  wiki links (the LAST pipe starts the alias), `{{source|display|meta}}`
  formula pills, `%%i:id:start/end%%` comment anchors, and `inteligir-callout`
  / `inteligir-chart` / `inteligir-canvas` / `inteligir-html` / `:::tabs`
  blocks — all valid markdown, all round-tripping through the fixpoint. Every
  spelling lives in ONE place (`@repo/notes/markdown/fence-langs`,
  `@repo/editor/nodes/canvas-header`), because the editor's rule table and
  the knowledge scan both read them. The FILE LAYOUT stays plain nested `.md`:
  no note bundles, no meta.json/layout.json; frontmatter remains the only
  property store, and a note's UUID is frontmatter `id:`. `{{` is reserved
  from MDX expressions by a tokenizer guard on BOTH braces. Comments' thread
  bodies live in a `<note>.comments.json` sidecar beside the note.

- **A turn row's `sourceSeqEnd` names its own contributors**, not every
  turn-scoped event. A streaming assistant message is turn-scoped but lands as
  a TOP-LEVEL row, so counting it moved the turn row — and a turn row carries
  its children, so every token resent the whole subtree. The delta is only a
  delta if a row's identity tracks what the row actually holds.

- **The auto-commit stages what the window's writers named.** A scheduler that
  names no paths makes the whole flush unscoped, which is what the boot sweep
  and the post-sync drain do. The trade, stated: a change nobody announced
  waits for a whole-tree caller (sync, `commitNow`, shutdown, next boot)
  rather than riding the next flush. Unscoped `add -A` survives for the first
  commit of a large vault, where a pathspec would exceed ARG_MAX
  (`apps/cli/src/server/vault/git-engine.ts`).

- **The knowledge index does not persist a stat fingerprint.** A warm
  reconcile over 2000 notes is ~105ms and runs off the critical path, so the
  saving is imperceptible — while the cost is a second persisted table inside
  a cache whose recovery primitive is deleting the file, so every `nuke()`
  must re-create it and a missed re-create is a crash.
- **NOTE HISTORY IS LOCAL, AND A RESTORE IS A WRITE** (#616). The per-note
  history surface reads the vault's own git repo — no server component, no
  new storage, no sync dependency, so it works offline and with no remote.
  RESTORING revision N means writing its bytes through the ORDINARY write path
  with `expectedHash` — never `git checkout`, `git revert` or an index
  manipulation, which would bypass the CAS under the repo lock, the knowledge
  re-index, the `/ws` notification and the open buffer's own convergence, and
  would leave a detached HEAD to explain. There is deliberately no
  `vault.restore` PROCEDURE — a second server write path is a second CAS that
  can disagree with the first — so BOTH clients run the same composition:
  checkpoint (`vault.commitNow`, because the auto-commit is session-shaped and
  the bytes being replaced are typically in no revision yet), then `write`
  with the base the diff was computed from — the snapshot the user was SHOWN,
  never a fresh read, which would bless bytes that landed after the diff was
  drawn. Unlike every other CAS refusal in this app, a restore's is REPORTED
  rather than diff3-merged: the user named exact bytes, and merging them with
  whatever landed underneath yields a file that is neither. READING the log
  is OFF THE REPO LOCK (`log` and `cat-file` never touch the index, while the
  lock is the chain a whole sync pass holds); the residual is a read landing
  inside a rebase seeing its temporary HEAD. The four load-bearing `git log`
  flags and the name-status parse are
  `apps/cli/src/server/vault/git-history.ts`'s header; the composition is
  `apps/desktop/src/renderer/app/actions/history-tab.tsx` and `vault restore`
  in `apps/cli/src/commands/vault.ts`.
- **THE AUTO-COMMIT IS SESSION-SHAPED (15s quiet / 60s max), because a log has
  to be ANSWERABLE.** "Restore the version from before I rewrote the intro"
  cannot be served by thirty anonymous revisions, so a single-file commit
  NAMES ITS FILE and a fifteen-second pause is what ends an editing session.
  What the max wait trades, and why 60s is the sync interval, is
  `apps/cli/src/server/vault/git-engine.ts`'s header.
- **A write carries the base it was computed from.** `expectedHash` on the
  vault write route is compared under the repo lock; a mismatch answers 409
  WITH the current content, and the client merges (diff3) and retries. Creation
  uses `ifAbsent` instead. Without this, an agent write landing between a
  client's read and its save is silently overwritten — the failure mode is
  invisible, so the guard has to be in the protocol, not the UI. This uses
  diff3 instead of an active-user-wins rebase that discards concurrent disk
  body edits wholesale: merging non-overlapping regions is less lossy (#603).
  The client half is `apps/desktop/src/renderer/app/note/guarded-vault-io.ts`;
  the merge is `@repo/notes/text/diff3`.
- **A CREATE IS NOT A WRITE WITH AN EMPTY BASE** (#632). Note creation sends
  `ifAbsent` and no hash — hashing the content about to be written names
  bytes that are not on disk, which the server can only refuse, and every
  session create answered `CAS_MISMATCH`. A guarded write with NO recorded
  base THROWS rather than inferring one: an inferred base would let a
  concurrent edit merge to the disk's bytes alone and drop this one silently,
  and every open reads first, so reaching it is a caller bug that should be
  loud. `apps/desktop/src/renderer/app/note/guarded-vault-io.ts` is the whole
  policy, tested against the real vault.
- **EVERY ERROR A VAULT ROW DECLARES HAS A PRODUCER.** `ALREADY_EXISTS` is
  declared on `vault.write` alone — it is `ifAbsent`'s refusal — because a
  row advertising a code no handler raises hands the client a branch that
  never runs, while the refusal it meant to catch arrives as another class and
  falls through. Derived from both sides rather than listed:
  `apps/cli/src/server/vault/__tests__/vault-contract-errors.test.ts`.
- **Containment is PHYSICAL, not lexical.** The vault realpaths the deepest
  existing ancestor and refuses symlinked leaves. A lexical check passes
  `notes.md` when that name is a symlink to `~/.ssh/id_ed25519`, and a `git
pull` from a hostile remote is enough to plant one
  (`apps/cli/src/server/vault/vault-service.ts`, over
  `path-containment.ts`).
- **The vault dir and the data dir must be disjoint**, refused at boot. A data
  dir inside the vault gets committed and pushed — the SQLite database and the
  config with it.
- **Ingest is ONE transaction.** Appending a provider event, projecting the
  thread's lifecycle, and touching the queue happen in one immediate
  transaction; notifications flush after commit. Separately: lifecycle CAS
  predicates include the TURN identity, so a late completion for turn A cannot
  settle turn B (`apps/cli/src/server/threads/service.ts`).
- **Agent commits stage the turn's own write set**, taken from the fileChange
  events, under a counted commit hold that defers the vault's debounce and
  blocks a sync from starting. Committing the whole dirty tree attributes a
  concurrent turn's writes — and the user's — to whoever settles first
  (`apps/cli/src/server/agents/agent-commits.ts`).
- **`runGit` PREPENDS `--literal-pathspecs` TO EVERY INVOCATION** (#635) — the
  commit path included, not only the log. A pathspec is a GLOB: `[a].md` names
  `a.md` too, so a commit scoped to one note staged its neighbour's edits
  under the wrong revision. Every path the engine passes is a filesystem name,
  never a pattern, and the one argv builder is where the flag lives and the
  one place it can be forgotten: `apps/cli/src/server/vault/git-run.ts`.
- **THE SERVER IS SPLIT ALONG ONE-RESPONSIBILITY SEAMS** (#641), each file's
  header stating its own: `vault/git-run` / `git-porcelain` / `git-bootstrap`
  / `git-engine`; `cloud/sync-pass` / `socket-link` / `sync-cadence` /
  `pair-flow`; `agents/interaction-waiters`, beside a watchdog that SWEEPS
  per-turn timestamps rather than re-arming a timer per frame; and
  `writeTransaction` in `@repo/db/connection` as the one spelling of `BEGIN
IMMEDIATE`, so the one-transaction-ingest law is structural, with
  `ThreadService.boot()` called from the composition root because crash
  recovery WRITES. Two defects the split surfaced and fixed: `dispose` no
  longer swallows a failed shutdown flush (the vault teardown step must be
  able to exit non-zero naming it), and the trash sweep counts only real
  purges.
- **THE AGENT SURFACE IS THE ⌘K ACTION COMPOSER AND THE RIGHT PANEL** (#587;
  what it retired is the register on #645 — do not bring any of it back). An
  ACTION is an ordinary thread ATTACHED to the note it was composed over
  (`threads.originDocPath` alone). The agent edits the vault directly, and
  ANCHORED COMMENTS are the review channel (#583): the panel's Actions |
  Comments | History tabs are the transcript, review and revision surfaces,
  with the frontmatter properties inlined above them; approvals answer
  inline. The palette is ⌘P; ⌘\ is zen. The selection toolbar's "Ask agent"
  seeds the composer with the quoted selection through a module-store seam
  the app registers (`packages/editor/src/agent-request.ts`) — the editor
  package never imports the shell.
  `apps/desktop/src/renderer/app/actions/actions-panel.tsx` and
  `action-composer.tsx` carry the surfaces.

- **COMMENTS CARRY THE AUTHOR'S `source`, AND THE SIDECAR WRITE IS A CAS**
  (#634). Every comment was signed `user`, the agent's included, while the
  served guide routes agent review through `inteligir comment …` — the review
  channel misattributed its own reviewer. The server signs `user` when a
  caller says nothing; the CLI signs `agent` under `INTELIGIR_THREAD_ID`. The
  sidecar joins the write-carries-its-base invariant (one re-read-and-retry,
  then the declared `CONFLICT`), and the comment-id grammar has ONE spelling
  in `@repo/notes/comments/sidecar-schema`.
  `apps/cli/src/server/comments/comments-service.ts` and
  `apps/cli/src/commands/comment.ts` carry the mechanics.

- **WINDOW-LEVEL HOSTS MOUNT AT THE ROOT ROUTE** (#636). `ConfirmDialogHost`,
  `Toaster` and the one `TooltipProvider` live in
  `apps/desktop/src/renderer/routes/__root.tsx`: `confirm()` parks a promise
  until a host settles it and `toast()` paints nothing without one, so a host
  mounted by one route left /settings' Unpair awaiting a dialog that never
  opened and every refusal deferred until the user navigated back.

- **A VIEW CONTEXT RIDES THE MESSAGE, and it is a statement about the past.**
  What the user was looking at when they pressed Enter travels on the send
  (`@repo/domain/view-context`) — never as a thread column, never as a mutable
  server-side "current view", which would have no owner and no truth and would
  be a lie the first time anyone stopped looking. Because the context
  describes the screen the message LEFT FROM, the staleness question
  dissolves: nothing needs to happen when the user navigates away mid-turn.
  There is NO tool: the agent already works in the vault checkout and can read
  the file, so a `get_view_context` tool would buy a round trip to deliver
  what it can already fetch, and the one thing it could add — a LIVE
  selection — is the one thing that cannot be made honest. It is a STATEMENT,
  NOT A GRANT: it widens nothing, because the agent could already write any
  file in the vault, so no permission model belongs around it. A queued send
  carries none — storing a context for later gives away the exact property
  that makes it immune to rot. How it reaches the model, and why that is the
  ONLY channel a preamble has, is
  `apps/cli/src/server/agents/view-context-prompt.ts`'s header. The SELECTION
  field is cut end to end (#638): nothing ever produced one and no stored or
  synced event carries it; real offsets need a Slate→markdown offset map,
  which is its own issue. `getVaultFileFacts` went with it, a port stubbed to
  null with no caller.

- **RELATED IS ONE PANEL SECTION — linked mentions and the scorer's
  suggestions merged in the right sidebar** (owner's call 2026-08-22,
  reversing the under-document foot sections; the editor's ConnectionsPanel
  slot died with them). One list below Properties in the actions panel:
  backlinks lead because they are COUNTED, the scorer's rows follow with
  their own REASONS — the failure mode of an inferred list is a
  plausible-looking row that is there by accident — and no dedup is needed
  between the halves (`apps/desktop/src/renderer/app/actions/related-section.tsx`
  states why). What survives from the old placement decisions: OUTGOING
  links stay deliberately absent (they are on screen in the document as
  wiki-links, unresolved ones dashed — listing them would be the same
  information twice with one copy stale); no graph view is coming; the
  related route stays search-shaped (a `limit`, no `total` — a ranked top-N
  has no honest count of the rest); suggestions are fetched only while the
  section is unfolded (that read settles the index and runs a lexical probe
  per title token); and the refresh rides the EXISTING change kinds — vault
  `files-changed` and doc `content-changed` sweep the `knowledgeRoot` family
  WHOLE, because a link into a note lives in another note's bytes, so a
  path-scoped invalidation is not expressible.

- **THE EDITOR COLUMN SHOWS ONE NOTE.** There is no second pane and no pane
  vocabulary: the workspace holds one `OpenNoteStore`, and what the top bar, the
  actions panel, the composer and the comment surface all read is simply the
  open note. The registries that key on a note's PATH (the comment-meta map,
  the title-focus entry) keep that key anyway — a module outlives the document
  it describes, so a late query answer or a keystroke must not land on the note
  that replaced it. The pane VOCABULARY is gone with the pane (#638):
  `editor-column` / `EditorColumn`, and prose says column or note. **The
  raw/rich TOGGLE is cut** (#638): the surface derives from the gate alone
  (`packages/editor/src/note/markdown-gate.ts`) — a parseable note edits
  richly, a gated note opens the textarea with its reason, a recovery pops
  back to Rich. `setMode`/`richAvailable` had no product caller, and the
  Properties copy pointed users at a Raw mode they could not reach; re-adding
  the toggle is a revert of that commit, not a feature.

- **THE APPEARANCE DIALS ARE ONE DECLARATION, READ THROUGH `.typeset-docs`.** The
  funnel's tokens (`--editor-font`, `-mono`, `-size`, `-line-height`, `-width`)
  are declared once in `apps/desktop/src/renderer/styles/globals.css` and reach
  the WYSIWYG through that class alone. There is deliberately NO accent axis:
  nothing in Plate consumes a hue, so a dial for one would set a value no
  surface reads.

- **Stemming is a SHADOW of the indexed text, never a rewrite of it.** The
  store carries the literal columns AND their stem columns at the same bm25
  weights, and `@repo/notes/knowledge/search-query` owns the one policy both
  engines execute. FTS5's built-in `porter` tokenizer would have been the
  idiomatic answer and is REJECTED for a measured reason: it stems the INDEX,
  so a prefix query for a partly-typed word dies where the suffix begins — 86
  of the 1,555 prefixes over the labelled corpus stop retrieving anything, and
  typing is what the palette does — and it would put half a shared policy
  inside SQLite's C, where the pure `SearchIndex` cannot execute the same one.
  EVERY term asks BOTH halves, and that OR is **the exact tier**, not a
  belt-and-braces duplicate: Porter over-stems, so the shadow alone lets a
  collision in a title outrank the word itself in a body; a doc holding the
  literal word satisfies both arms and scores about twice a stem-only hit on
  both engines, pinned by a ranking assertion run against BOTH — the
  set-comparison lockstep test cannot see an ordering. The residual is stated:
  the title/body gap is 10x, so a title-level collision still beats a
  body-level exact match, and closing that needs idf, which only bm25 has.
  Diacritics are folded on both sides and the snippet is cut in JS by both
  engines; `search-query.ts` and `knowledge/search-excerpt.ts` carry those two
  arguments.

- **CONNECTORS ARE AN APP-OWNED REGISTRY, injected per-session over ACP**
  (#591, reversing the codex-owned-registry decision — its stated premise,
  codex as the only harness, died with #588). One local store, edited in
  Settings → Connectors and by the CLI's parity verbs; every harness receives
  the same enabled rows through ACP `session/new`'s `mcpServers`.
  `~/.codex/config.toml` is no longer consulted. Secrets stay in the data
  dir and are REDACTED in every read
  (`apps/cli/src/server/connectors/connectors-service.ts`).

- **AGENT MEMORY IS REMOVED** (#589, reversing #575 — deliberately). Claude
  Code and Codex carry their own memory systems; a third memory beside theirs
  was two answers to one question. What
  DID survive the removal is the pattern: content the agent consumes lives in
  FILES read with its own shell — the vendored dialect skills ride
  `INTELIGIR_SKILLS_DIR` (resolved from `@repo/agent-skills`, staged beside
  the app bundle in the packaged layout), with a three-sentence pointer
  delivered on the session's first turn prompt, never the spec inlined.

- **ONE SET OF SESSION FACTS, TWO PROJECTIONS** (#636). The env a session's
  shell inherits and the prompt that describes it are pure functions of one
  `AgentSessionFacts`, so the two cannot state different facts — and the
  runtime's `shellEnv` is a GETTER read at every adapter spawn, because read
  once as a value `INTELIGIR_CONNECTED_DIRS` froze at the first turn.
  `apps/cli/src/server/agents/agent-shell-env.ts`.

- **DICTATION IS STREAMING PARAKEET AGAIN, REVERSING #574's whisper.cpp**
  (issue #578). This is a deliberate reversal, and it must not be "fixed" back
  by someone reading only #574: that issue optimized the FINAL TEXT (whisper
  returns punctuation and capitals verbatim) and, in doing so, made dictation
  batch — hold, release, THEN the whole clip transcribes. The owner chose the
  STREAMING FEEL over the cleaner final: the words appear as you speak. So the
  engine is `sherpa-onnx-node` + a streaming NeMo Parakeet transducer again, the
  runtime this repo shipped before the local-first rewrite. THE TRADEOFF IS THE
  WHOLE POINT AND IS ACCEPTED: the final has NO punctuation and NO
  capitalization. Do not bolt whisper back on to fix that — the two were weighed
  and the live partials won.
- **ONE MODEL, BOTH PATHS.** The mic streams over a websocket; the batch
  `voice.transcribe` procedure stays for a whole-clip caller (scripted mode, any
  non-interactive path) and feeds the SAME engine. The model is the int8
  variant, the size the one-model path was chosen for, pinned by the
  ARCHIVE's sha. THE MODEL FILE IS STILL THE SWITCH: no `voiceEnabled` flag,
  `install` fetches against the pin, `remove` deletes, "off" is "no model on
  disk". The pick, the atomic download and the pure-JS `.tar.bz2` extraction
  are `apps/cli/src/server/voice/model-catalog.ts` and `model-store.ts`.
- **A PERSISTENT SESSION WORKER, not one per clip, and THE SESSION IS
  BOUNDED.** Streaming re-uses the recognizer as frames arrive, so the model
  loads ONCE per hold and stays warm; a worker per re-transcription would pay
  the ~0.7 s load on every cadence. The worker is not optional —
  `better-sqlite3` is synchronous and the watcher's fork channel pings on a bare
  timer, so an inline native decode would stall a save, a query and the
  watcher's liveness together. A hold is capped at `VOICE_MAX_AUDIO_SECONDS`;
  frames past it are dropped and the final answers what was fed. Teardown on
  EVERY exit path with no escaped rejection is
  `apps/cli/src/server/voice/stream-session.ts`'s header, pinned in
  `stream-session.test.ts`.
- **A DEDICATED DICTATION WEBSOCKET, off the invalidation bus.**
  `/voice/stream` carries PCM16 frames UP and `partial`/`final`/`error` DOWN;
  the `/ws` bus carries change-kind PINGS by decision and NEVER a payload, so
  this is its own endpoint. It sits behind the SAME loopback/browser-origin
  guard and, like `/ws`, is exempt from the route-table guard because a
  websocket is neither a request/response pair nor something the typed client
  reaches. Its sockets are HIJACKED off the HTTP server on upgrade exactly as
  the bus's are, so the listener teardown step closes BOTH by name — a live
  hold must not stall the process's exit (the trap the shutdown decision
  records).
- **THE RENDERER STREAMS WITH A `ScriptProcessorNode`, not an `AudioWorklet`.**
  A worklet's module is fetched as a script, and this app's prod CSP names
  `worker-src 'none'` on purpose (the same directive that refused
  transformers.js in #574); ScriptProcessorNode is deprecated but loads no
  module, so it is the one raw-frame source the policy admits — proven under
  the real policy by `pnpm e2e`. Partials render in a PREVIEW OUTSIDE the
  composer field and only the final splices in, so a partial rewriting
  mid-hold can never eat text the user typed
  (`apps/desktop/src/renderer/app/voice/dictation.ts`).
- **THE SHA GATE IS THE REAL GUARD; the `modelUnusable` nuke is the backstop**
  (kept from #574). `model-store` verifies the archive's sha256 against the pin
  before extracting, so only the exact bytes that DO load ever reach the
  recognizer. The worker still reports `modelUnusable` for a CATCHABLE load
  refusal and the service nukes the model and drops to `no-model`; a decode
  failure keeps the files, because that is about the audio. The honest
  residual: onnxruntime does NOT translate a parse failure into a catchable
  error — it raises a C++ exception that aborts — so a truly unparseable model
  would crash rather than nuke; the sha gate is why that path is unreachable,
  which is exactly why it is the guard that matters. **THE PROBE ACTUALLY
  LOADS THE NATIVE BINDING**, so a platform whose binary cannot load answers
  `unavailable` at the switch. **THE DESKTOP SHELL GRANTS `media`,
  ORIGIN-SCOPED**, and there is **NO CLI VERB** — dictation is a human
  affordance, and holding a key over a live microphone is not something a
  shell invocation can express. The residual is stated: English only, and the
  final's rough text is the accepted cost of the streaming feel.
- **THE DEVICE CREDENTIAL IS THE SYNC SWITCH, and it lives in the data dir.**
  `<dataDir>/device-credential` at 0600, beside `server.json` and for the
  same reason — and the two places it must NOT go are what fix the location:
  not `inteligir.db`, which is the thread log this credential exists to upload,
  and not the vault, which is a git repo pushed to a remote the user chose.
  There is deliberately no separate "sync enabled" flag: two values that must
  agree are two values that can disagree, and both disagreements are bad. So
  SYNC IS OFF BY DEFAULT because an unpaired install has no credential, and
  with none it opens no socket, arms no timer and makes no request (asserted,
  at the shipping cadence, in
  `apps/cli/src/server/cloud/__tests__/sync-runtime.test.ts`). The cost,
  accepted: "pause sync" is not expressible — you unpair, which discards the
  queue. `apps/cli/src/server/cloud/credential-store.ts` and `sync-runtime.ts`
  carry the argument.
- **THE HOSTED VAULT'S READ PATHS ARE BUDGETED PER DEVICE, and the budget buys
  TIME rather than prevention.** The account is the entitlement, so a verified
  credential reads every note — which makes a stolen `igd_` a vault-exfiltration
  credential and not only a thread one. `/v1/vault/*` and `/v1/git/*` therefore
  consume a fixed window keyed on the DEVICE, never the caller's address: what
  is being spent is a credential, a stolen one moves between addresses, and the
  device row is the thing `/app/devices` revokes. Two families, two keys, so a
  drained read budget never takes a device's sync down with it.
  WHAT IT ACTUALLY BUYS, stated rather than implied: it BREAKS A RUNAWAY LOOP
  and caps what one credential costs per minute. It does NOT meaningfully slow
  a determined reader — `/v1/git` hands a whole vault over in a couple of
  requests, and any per-minute read ceiling low enough to matter is one a real
  client trips. Revocation is the control; this keeps abuse from being free.
  BOTH CEILINGS ARE SET FROM THE WORST LEGITIMATE MINUTE, never from the common
  case. An account may hold 20 devices, every push pings all the others, and a
  pinged device syncs immediately — so one device can owe ~20 git passes in a
  minute, around a hundred requests. On the read side the legitimate burst is
  ONE NOTE'S EMBEDS, which the format does not bound at all; the residual is
  that a note carrying more than the ceiling sees its tail answered 429. A
  ceiling that refuses real work is worse than none, because the client reports
  it as `offline` and the user has nothing to act on. REVOCATION AND ACCOUNT
  DELETION DROP THE ROWS: the table carries no foreign key, so nothing else
  ever would, and a pair-then-revoke loop would grow it forever. A READ-SCOPED
  credential (read vs write) is the deeper answer and is NOT implemented; the
  trigger to build it is a second party ever holding a credential for someone
  else's account.
- **PAIRING IS APPROVED IN A BROWSER, and the code survives only as plumbing**
  (issue #573). Nothing shows a `XXXX-XXXX` to a human any more and nothing
  accepts one. What was deleted is the FERRY, not the artifact — the mint
  route, the code table, the ten-minute TTL and the one-time redeem are
  untouched, because they are the security story and the redirect merely
  carries what a user's eyes used to. The durable credential never transits
  the browser: it is minted by the local app's own redeem and lands only in
  `<dataDir>/device-credential`. **This is small here and large elsewhere
  because THE APP IS ALREADY A LOOPBACK SERVER** — the callback a CLI tool
  would stand a server up for is one more route on it. No typed-code fallback
  survives, and the user it would serve cannot exist: reaching this product's
  UI at all means a browser reaching its loopback, and a browser that can do
  that can complete the redirect.
  **THE REDIRECT ALLOWLIST IS CONTRACT, not handler code**
  (`@repo/api/cloud/pairing/pairing-schema`): the approve page refuses a
  target at PARSE and the local app validates its OWN composition through the
  same schema, so there is one gate rather than two that can disagree. It is
  judged on `URL` FIELDS, never on a host string — the schema's header names
  the parse that fooled every host check reading the wrong field. `[::1]` is
  REFUSED and `localhost` with it: this process binds the `127.0.0.1` literal
  and nothing else, so an allowlist wider than the set of addresses that can
  answer is an open redirect with extra steps — one carrying a live pairing
  code. The port is deliberately unconstrained, default included, because
  loopback is loopback on any port. The only other arm is the mobile deep
  link, `inteligir://pair/callback`, exact on every field; the residual an
  allowlist cannot reach — an app squatting the `inteligir://` scheme on the
  same OS receives the redirect, code included — is held by PKCE. The desktop
  renderer's `inteligir://app` origin pin is a separate policy over the same
  scheme string; neither is widened by reference to the other.
  **THE STATE IS THE APP'S, and the callback is inert without it** — one
  slot, compared in constant time and CONSUMED BEFORE the redeem (a state that
  survived its own redeem is a URL replayable out of a browser history), and a
  wrong state does NOT consume it, or any local page could cancel a pairing
  mid-flight (`@repo/api/cloud/pairing/approval-slot.ts`). `GET /pair/callback`
  sits outside the contract table and outside the browser-origin guard;
  `apps/cli/src/server/cloud/pair-callback.ts` states both reasons, and why
  the callback's port comes from the request's own Host header.
  **THE SERVER OPENS THE BROWSER**, via `execFile` with an argv list and never
  a shell, so the act is identical from a browser tab, the Electron shell and
  a headless CLI — and the shell's unconditional `window.open` denial never
  comes into play. Whether to open is a REQUEST FIELD rather than a second
  route, because beginning a pairing is one verb; it is required rather than
  defaulted, since the caller that must say `false` is the agent's `--json`
  path and a default is precisely what that path would forget. A failed open
  is an ordinary answer, not an error. The win32 spelling, and why `cmd /c
start` is refused, is `apps/cli/src/server/cloud/browser-opener.ts`.
  **THE CODE IS BOUND WITH PKCE (RFC 7636, S256), and that is why the open
  port is safe.** `state` guards only THIS app's callback and `redeem` is
  unauthenticated, so an intercepted redirect on the loopback would otherwise
  let any local listener spend the code. The verifier never leaves the app, so
  an intercepted code alone cannot be spent — the port stays open BECAUSE the
  code is bound. `S256` is the only method, because a challenge equal to its
  verifier binds nothing an interceptor could not also send. The step-by-step,
  the one S256 spelling and the non-consuming mismatch are
  `pairing-schema.ts`'s PKCE header and `pairing-flow.ts`.
  **THE APPROVE PAGE NAMES THE ACCOUNT** it is about to join, because a
  shared or ambient browser session would otherwise pair a device to the
  wrong account and sync private threads both ways with no sign of it.
  `beginPair`/`completePair` are guarded by `disposed` and `dispose` clears
  the pending slot (`apps/cli/src/server/cloud/pair-flow.ts`), so a callback
  in flight during ordered shutdown redeems nothing and writes no credential
  after teardown.
- **`@repo/api/cloud` IS THE CLIENT RUNTIME CORE, not only the wire** (#639):
  `bytes.ts`, `pairing/approval-slot.ts` (device pairing and connector OAuth
  run the SAME slot), `pairing/pairing-flow.ts` and `sync/sync-session.ts`.
  The CLI and the phone ride the same machines and inject only their stores,
  timers and sockets, because a security-bearing discipline with two
  spellings is two to audit. The cloud vault-path grammar IS `parseVaultPath`,
  with the parse required to be the identity — stricter by design, since the
  hand-rolled copy admitted `.GIT/hooks/x` and `a\b`. The `[[Title|uuid]]` id
  tier lives in `buildResolver` (tier 0) so every resolver can read it; the
  stated residual is that the desktop and mobile listings carry no `id`, so
  their resolvers cannot feed it until the wire does.
- **ON THE PHONE, THE RUNTIME THAT MOVES A VALUE IS THE ONE THAT NOTIFIES**
  (#646). A mirrored snapshot has one writer and every write is user- or
  boot-driven, so a poll pass and a dashboard revocation never reached the
  screen; `SyncRuntime` and the pairing flow publish stores the screens
  subscribe to, and the pairing flow is ONE machine fed by both the
  in-session return and the deep-link listener, so a failure on either path
  is SHOWN. A refused capture keeps its text and says why (#647).
  `apps/mobile/src/sync/sync-runtime.ts`,
  `apps/mobile/src/pairing/pairing-store.ts`, `apps/mobile/src/app/index.tsx`.
- **A pulled event lands through the SAME ingest, marked with its origin**
  (`ThreadService.applySyncedEvents`, issue #572). A second append path would
  be a second answer to thread lifecycle. The origin changes exactly three
  things and each is forced: the thread row is created with the id the LOG
  gave it (a device minting its own would make one conversation two); nothing
  is enqueued back to the outbox, or two devices echo forever; and a settle
  does not drain this device's queue, because the turn ran elsewhere and
  starting a local one would put two agents on one thread. **THE CURSOR MOVES
  INSIDE THAT TRANSACTION** — that is what makes the apply exactly-once, and
  advancing it as a second write is precisely the window a crash duplicates a
  conversation through. The cursor is not enough on its own, though: a re-pair
  RESETS it, so a synced row also carries the log row's own identity —
  `events.origin_device_id` / `origin_device_seq`, under a unique index — and
  an append that already holds one is skipped. `(device, position)` rather than
  the account-global `seq`, because a global seq means a DIFFERENT row under a
  different account and an idempotency check keyed on it would wrongly skip a
  genuine event. Lifecycle projects over what LANDED, never over what arrived:
  replaying a `turn/started` whose completion fell on the far side of a page
  boundary would leave a long-finished turn running.
  `apps/cli/src/server/cloud/sync-pass.ts` carries the cursor argument.
- **Only the process that owns a provider may declare it dead.** Crash recovery
  fails every thread still marked running, and after sync "still running" can
  mean another device's turn — so `recoverWedgedThreads` reads the `turn/started`
  row's own provenance and leaves a remote turn alone. Fabricating that failure
  would be bad locally and worse on the wire: it syncs back to the machine where
  the work is genuinely still going. The residual is the same trade inverted —
  a device that never returns leaves the thread active here until it does,
  because no process can tell "still working" from "gone" across a network.
- **CONVERGENCE MEANS THE SAME SET, NOT THE SAME ORDER.** `events.sequence` is
  allocated per thread by whichever device appends — for a synced row, the
  device that PULLED it — so it is an ARRIVAL order. Two devices that both
  write before either syncs hold the same rows in different positions, and the
  local log is append-only under a UNIQUE(thread, sequence), so no renumbering
  is available to fix it. What IS guaranteed, and pinned: both devices hold the
  same set, and each writer's own turn stays contiguous and in its order on
  both. The account log does carry a total order (its global `seq`); projecting
  THAT instead is the change to make if a shared interleave is ever needed, and
  it means the timeline stops reading `sequence`.
- **A SYNC PASS IS FENCED BY SESSION IDENTITY, not by "is a session live?".**
  Every step re-checks the id it started under after every await, because the
  dangerous case answers "yes, live" about a DIFFERENT pairing — an old push's
  ack deletes the outbox rows a re-pairing has since queued, and an old pull's
  page applies another account's events. Cancellation covers the in-flight
  half; identity covers the half cancellation cannot reach, where the response
  already arrived. Both are needed, and `dispose` aborts too — otherwise the
  teardown step's budget is a hope. The fence is the contract's own
  (`@repo/api/cloud/sync/sync-session.ts`), so the CLI and the phone cannot
  spell it differently.
- **The outbox stores the bytes it will send, once, at enqueue.** The log calls
  a stored position replayed with a different body `sync-conflict`, so
  re-serializing at push time turns every retry after a grammar change into
  one. `deviceSeq` is its own counter in `sync_state` rather than `MAX()` over
  the queue, because a pushed row is deleted and a counter over a shrinking
  table hands a later event a position the log already holds — and it cannot
  come from `events.sequence`, which is per THREAD and orders nothing about a
  device. A queued event the contract itself refuses (past the per-event byte
  ceiling) is dropped from the batch rather than retried, because the log
  refuses the WHOLE batch for it and one bad event would strand every event
  behind it (`packages/db/src/sync-outbox.ts`).
- **SYNC IS PERMISSIONED BY ACCOUNT — the account IS the entitlement** (owner
  decision 2026-08-25, issue #618, the Obsidian model). Accountless, the app
  is fully functional local-only and makes ZERO cloud requests (pinned at the
  shipping cadence in `cloud/__tests__/sync-runtime.test.ts` and the
  pair-callback boot suite). Paired, the credential alone entitles ALL THREE
  sync kinds — threads, captures, and the hosted vault — with no second flag
  and no sub-entitlement, ever: a "vault sync enabled" bit beside the
  credential is exactly the two-values-that-can-disagree failure the
  credential-is-the-switch decision forbids. The invite gate is account-
  CREATION policy, never sync policy. The BYO git remote
  (`INTELIGIR_VAULT_REMOTE`) stays fully accountless — it is the user's own.
- **The THREAD channel carries thread events alone, and its contract has no
  thread-metadata read.** The pull answers events, so lane and title are
  push-only — nothing reads them back, and this client therefore sends
  neither. The consequence is stated rather than hidden: a thread with no
  events never reaches another device, because the merged log is the only
  channel that carries one. (Vault bytes ride their own channel — the git
  remote — never this log.)
- **Cloud state names its Durable Object from a VERIFIED credential**, never
  from anything a caller supplies. Account deletion revokes credentials FIRST,
  then purges, then writes a tombstone every route refuses against — the
  reorder alone still leaves an in-flight verified request able to recreate
  state after the purge.
- **Say the delivery guarantee you implement.** Captures are at-least-once
  delivery with exactly-once deletion by the owning claim, so the client's
  apply must be idempotent on the capture id. "Exactly-once" was written first
  and was false in both directions
  (`@repo/api/cloud/captures/captures-schema`).
- **THE PLATE SLASH MENU AND BOTTOM TOOLBAR ARE THE INSERTION SURFACES.**
  Slash items are grouped data in `packages/editor/src/slash-menu.tsx`; the
  bottom-center toolbar acts through the live-editor registry
  and is deliberately selection-stateless. Every insertable row's markdown
  must re-parse to a modeled construct — the kit-parity vocabulary pins the
  set. Legacy `<!-- inteligir:thread anc_… -->` markers in existing vaults
  parse as opaque comments and are preserved verbatim; nothing writes new
  ones.

- **ONE BINARY, TWO MODES: `inteligir serve` IS the server, and `npx` is a
  VERB rather than a package** (#611, reversing the launcher-boots-in-process
  line). `npx inteligir serve --open` keeps the zero-install path for free —
  one exit code, a `^C` that reaches the vault's owner — and there is no third
  package staging the other two. The desktop shell still forks a CHILD, and
  that reason is unchanged: it must not share its compositor's event loop with
  better-sqlite3, a watcher fork and `git`. What changed is who supervises:
  `utilityProcess` IS a managed Node child, and readiness, the SIGKILL behind
  an overrun grace and the deliberate ABSENCE of a restart are
  `apps/desktop/src/main/server-process.ts`'s own — its header says why a
  restart ladder is wrong. The shell adopts an already-listening server rather
  than fighting it, and only kills the child it started.
- **ONE COMPOSITION ROOT** (#640). `apps/cli/src/server/compose.ts` builds
  every service in boot order and returns `{ context, teardown }` as a VALUE;
  `createApp` is route wiring over it, `serve.ts` is listen + `server.json` +
  signals + exit code, and the booted suites call the same composition with
  hermetic ports, so the production graph and the suites' graph cannot
  diverge — three hand-built copies had. The two dials `serve.ts` INJECTS
  (the cloud socket opener, the agent driver) are injected because compose is
  reachable from the renderer's test program; `compose.ts`'s header says why
  neither may load there. `dev-instance.ts` owns the per-checkout derivation;
  `config.ts` stays the parser.
- **THE BIN EXITS 128+n WHEN THE SERVER DIES BY SIGNAL, NEVER 0** (#636).
  Re-raising the child's signal at the wrapper ran the still-installed relay
  against a dead child and exited 0; 128+n is the encoding a shell reports and
  Node's own default handlers use, and the exit code is the truth about the
  child. `apps/cli/bin/inteligir`.
- **THE CREDENTIAL IS A FILE, NOT A CHALLENGE** (#611, reversing the
  loopback-adoption-is-earned line — its premise, that a client had no channel
  to the server but the port, is what died). On boot the server writes
  `<dataDir>/server.json` at 0600 and removes it on ordered shutdown; every
  caller reads it and sends the bearer. That kills three problems at once: no
  probing and no neighbouring-checkout ambiguity, because the FILE names the
  port that answered; no adoption ceremony, because a squatter cannot have
  written the file and so fails the token; and the browser-origin guard
  survives only where the credential is AMBIENT — a COOKIE-authed request must
  additionally prove same-ORIGIN, because loopback "site" ignores the port.
  The bound is the same honest one the nonce challenge had — it proves the
  caller can READ that data directory, not that it is this code — which is
  exactly the line between "the program that owns this vault" and "the
  program that got to the port first". One token, two carriers (the header,
  and an HttpOnly SameSite=Strict cookie for the one client that cannot set a
  header), never a second secret. `apps/cli/src/server/server-file.ts` and
  `browser-request.ts` carry the argument.
- **Shutdown is ORDERED, per-step TIME-BOXED, and its exit code is the truth.**
  Writers stop, then the vault's pending commit flushes, then the handles
  close; each step has its own budget because a single budget for the whole
  teardown is not a bound on anything — one wedged step starves every step
  behind it, which is precisely how the vault flush gets skipped. The listener
  step must CLOSE THE WEBSOCKETS BY NAME, because an upgraded socket is
  detached from the HTTP server's connection tracking — one open browser tab
  once stalled the entire teardown, exited 0, and left the database un-closed.
  A step that fails or times out exits non-zero and says which.
  `apps/cli/src/server/shutdown.ts` carries the order and the derived
  deadline; `ws-bus.ts` the close-by-name trap.
- **THE CSP IS STATIC, and deleting TanStack Start is what bought that**
  (#611, reversing the nonce-CSP decision). The nonce apparatus existed because
  the Start router INJECTED inline scripts at runtime whose content varied per
  render, so neither a hash list nor a fixed policy could admit them (measured,
  not assumed). A plain Vite SPA injects none, so `script-src` is `'self'` and
  the whole policy is a fixed header — served identically by the protocol
  handler to the window and by the server to a browser, because two spellings
  of one policy is one policy that can rot. `style-src` keeps `'unsafe-inline'`
  — the one stated residual. The directive that earns the most here is
  `connect-src`: a script that cannot reach a third-party origin cannot
  exfiltrate the vault. What each directive forces and refuses is
  `apps/cli/src/server/csp.ts`'s header.
- **THE RENDERER'S ONLY DOOR IS `inteligir://app`** (#611). Serving the
  workspace from a custom scheme makes the loopback server cross-origin to it,
  and the answer is NOT CORS on that server: the protocol handler carries the
  bundle, `/rpc/*` and `/vault/asset` alike, attaching the bearer in MAIN. So
  the page is same-origin with its own API, there is no CORS anywhere, and THE
  RENDERER NEVER HOLDS THE TOKEN — which is what keeps an `<img src>` inside a
  note working, since an image tag cannot carry an `Authorization` header.
  Websockets are the ONE exception: a browser `WebSocket` cannot be proxied by
  a protocol handler, so the bus and the dictation stream dial loopback
  directly, main attaches the bearer to those upgrades, and the single preload
  hands the renderer that origin — `window.location.origin` no longer names a
  server. **The pin cannot use `URL.origin`**: Node's parser answers the
  opaque string `"null"` for any non-special scheme, so `inteligir://app` and
  `inteligir://evil` would compare EQUAL; scheme and host are compared as
  fields. A link the user COPIES must name the server's own loopback origin,
  never the page's — a copied `inteligir://app` URL opens nowhere, inteligir
  included; the residual is that the bound port can move across restarts, so
  a copied link is a same-machine affordance and a durable address is its own
  feature. `apps/desktop/src/main/protocol.ts`, `origin-pin.ts`,
  `credential-scope.ts`, `apps/desktop/src/types.ts` and
  `apps/desktop/src/renderer/app/socket-origin.ts` carry the mechanics.
- **Better Auth's `baseURL` is derived per-request from the request origin**,
  never configured or allowlisted. Every hostname that reaches this Worker is
  one the deployment owns, and Cloudflare routes by hostname, so a spoofed
  `Host` never arrives. A fixed fallback would mint password-reset links back
  at the wrong deployment; deriving makes localhost/preview/prod work with no
  config. The trigger to revisit is a hostname the deployment does not fully
  control reaching the Worker (`apps/web/src/worker/auth/auth.ts`).
- **Sign-up is invite-gated by a Worker route in front of Better Auth**
  (`apps/web/src/worker/auth/invite.ts`), claiming the code in one atomic
  statement and forwarding into the one instance built with `disableSignUp`
  off; every other instance, and each social provider, carries the flag, so a
  provider is a sign-in for an account that already linked it, never a way to
  get one. `apps/web/README.md` § Auth is the mechanism.
- **The D1 auth schema ships via `drizzle-kit push`; there are no migration
  files.** One deployer, an additive schema, and nothing derived that can rot —
  `apps/web/vitest.config.ts` builds the test DDL by running `drizzle-kit
export` over `src/worker/db/schema.ts`. A second deployer or a destructive
  column change is the trigger for adopting migrations. **Never flip the
  timestamp mode in place**: both modes read the same INTEGER column, so a
  redeploy without an accompanying `UPDATE <table> SET <col> = <col> * 1000`
  reads every stored date back as 1970 — which expires every live session.
- **`KnowledgeIndex` in @repo/notes is not dead code — do not delete it.**
  `@repo/notes` carries no sqlite dependency deliberately (`SqlDriver` is
  platform-injected), so this in-memory composition is the ONLY way the package
  can test its own knowledge engine; the related-notes, tags and link-graph
  suites drive production logic through it.
- **THE CLIENT DOES NOT DECIDE WHAT A DOC IS.**
  `@repo/notes/knowledge/doc-file` is the one answer to both halves of the
  question — `isDocPath` (the extensions the vault indexes: `.md`,
  `.markdown`, `.mdx`, `.txt`), `isNotePath` (the `.md` half, for a caller that
  will splice frontmatter or move a file to Trash/) and `docStem` (the name a
  surface shows). A private `.md` rule in a client is two bugs at once: a
  `.md`-only PREDICATE hides every `.txt` note the server lists, links and
  searches, and two spellings of the display rule disagree the moment a name
  is not lowercase — a case-sensitive `endsWith` prints `Notes.MD` verbatim
  where a case-insensitive one prints `Notes`.
  `apps/desktop/src/renderer/app/__tests__/vault-hooks.test.ts` walks the
  renderer and fails on either shape, with the extension derived rather than
  typed out. The desktop client's trash-vs-delete gate and the server's
  `trash.ts` both call `isNotePath`, so that deliberate lockstep is one
  spelling rather than two that agree by hand.
- **The knowledge scan disables `codeIndented` and `htmlFlow`**
  (`@repo/notes/markdown/scan-parse`). A checkbox is addressed by its POSITION
  among a doc's task items, so the scan's count has to agree with the set the
  editor draws, and the editor's plugin list disables both too; CommonMark's
  defaults are where the two would diverge. The agreement is pinned by
  counting the same docs through both parses
  (`packages/notes/src/__tests__/task-ordinal.test.ts`); `scan-parse.ts`'s
  header carries the two examples.
- **THE SCAN'S GRAMMAR IS NOT THE EDITOR'S, and `verbatim-spans` is the one
  bridge.** `@repo/notes/markdown/scan-parse` is plain markdown and TOTAL, so a
  malformed tag cannot cost a note its place in the index; the editor's
  `md-plugins` stack runs the agnostic MDX tokenizer, which THROWS. The two
  therefore disagree about which bytes are verbatim, and a `targetSpan` is a
  LICENCE TO REWRITE BYTES — so the scan runs the editor's own plugin list as
  a bare `parse` (`@repo/notes/markdown/verbatim-spans`) and withholds the
  span inside those ranges, the existing "indexed but never rewritten" tier.
  Unifying the two grammars is the rejected alternative: it would let one
  malformed tag stop a note indexing at all. A doc the editor's grammar
  REFUSES yields no ranges, and that is correct rather than lax — it opens
  RAW, so it has no round trip whose bytes could be broken.
- **Frontmatter is the ONLY property store.** No metadata table, ever. YAML the
  typing rules can't represent is preserved byte-exactly, never coerced.
- **No coverage tooling, on purpose.** This repo enforces targeted invariants
  structurally rather than via a global percentage: the dependency DAG and its
  platform rules and ws change-kind reachability
  (`tools/repo-guards`), route-table completeness
  (`apps/cli/src/server/__tests__/http-surface.test.ts`), migration↔schema
  agreement (`packages/db/src/__tests__/schema-agreement.test.ts`),
  the per-export orphan guard over `@repo/ui`, the CLI guide and its `--json`
  flags, the editor's buffer invariant. A test that fails when a THIRD dispatch
  path appears is worth more than a percentage a suite asserting nothing can
  satisfy. If coverage is ever added: `coverage.include` is MANDATORY in
  Vitest 4, and gate only `@repo/notes`.
- **A structural guard states its own rule in the failure**, names the file, and
  derives every value it compares. No hardcoded counts, no hand-copied lists —
  the one exception is `dep-dag.test.ts`'s `DECLARED_EDGES`, which IS the pin
  rather than a copy of one.
- **VENDORED CODE IS THIS REPO'S CODE, except for the attribution.** The rule
  that vendored files stay close to upstream so a re-pull is a clean diff is
  GONE (owner's call): rename, restructure and delete freely, and make the code
  obey this repo's rules rather than upstream's shape — "it would make the next
  re-pull a conflict" is not a reason for anything. What survives is the
  LICENSING, which is an obligation rather than a convention and does not
  depend on tracking upstream at all: every vendored file keeps its `// Vendored
from X, MIT.` header, and the third-party license texts live under
  `tools/licenses`, staged into the published artifact as `dist/licenses` — a
  repo-root path can never be a `files` glob — with `pnpm smoke:cli` deriving
  the expected set from that directory rather than a hand-copied list.
- **`packages/ui/components.json` declares `rsc: true` and it is deliberately
  inert** — the `"use client"` directives it produces are ignored by every
  consumer, all plain Vite builds with no RSC bundler in the graph.
- **THE ORPHAN GUARD OVER `@repo/ui` IS PER EXPORT** (#648): every named
  export under the wildcard-exported directories needs a consumer outside the
  gallery or a reasoned allowance row
  (`tools/repo-guards/src/ui-orphan-exports.test.ts` says why neither a file
  guard nor knip can ask the question). What the cut settled: both Slot copies
  are deleted and NOT replaced — Base UI's `render` prop is the polymorphism
  channel; one `lib/compose-refs`, one `lib/collapse`, one
  `hooks/proximity-overlays`; one name per size, variant and part.
- **THE REACT COMPILER IS ON FOR ALL THREE APPS** (#644): `compiler: true` on
  `@vitejs/plugin-react` in both vite configs (it loads
  `oxc-transform-react`, pinned in the catalog) and `reactCompiler: true` in
  `apps/mobile/app.config.js`. Three apps, one story, so a reviewer never
  re-derives which app memoizes by hand. The manual-memo sweep is a
  follow-up.
- **TOOLING PINS, each with its reason beside it** (#642): `vite` is a pnpm
  OVERRIDE, not only a catalog entry, because the catalog bound only the
  manifests that spell it; `@types/node` tracks `engines.node`; one root
  `clean` script; `lint` is bare `oxlint`; `compatibility_date` is the
  lockfile's OLDEST resolved workerd, held by
  `tools/repo-guards/src/wrangler-compat-date.test.ts`; `pnpm e2e` boots the
  BUILT Worker bundle (`tools/e2e/src/scenarios/built-worker-boot.ts`),
  because nothing else executes the artifact `wrangler deploy` ships; and
  agent-browser installs pinned in `.github/workflows/ci.yml`, since a global
  install rides no lockfile and no cooldown. The arguments live in
  `pnpm-workspace.yaml`'s own comments.

**Before raising a "new" finding, read
[#542](https://github.com/kyh/inteligir/issues/542)** — the decision record
carries what was rejected as well as what was chosen. The older `note` issues
(#446, #453, #472, #474) catalogue findings declined against the hosted
Durable-Object architecture this rewrite replaced; their concerns rarely
survive the move, and none of their paths do.
