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
                 handler at /rpc, the /ws invalidation bus and the db; every
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
                 conversation. apps/web SERVES every row; the CLI's sync client
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
                 and listed one by one in the orphan guard, so a fifteenth
                 still fails. Leaf.
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

## Common Commands

```bash
pnpm dev              # THE PRODUCT — the shell over its own server
pnpm dev:desktop      # Alias of dev, kept deliberately (owner call 2026-08-26)
pnpm dev:mobile       # apps/mobile: expo start
pnpm cli serve        # The server ALONE, from source; a shell adopts it
pnpm dev:web          # apps/web: vite + miniflare on :5174 (pinned, strictPort)
pnpm package:cli      # The npm artifact (apps/cli) — `npx inteligir serve`
pnpm package:desktop  # An UNSIGNED macOS arm64 dmg
pnpm smoke:cli        # Pack, install into a scratch prefix, boot, probe, stop
pnpm smoke:desktop    # Package the .app, boot its server, drive it, SIGTERM (macOS only)
pnpm build            # Build all
pnpm typecheck        # Type check all
pnpm lint             # Lint all   (oxlint)
pnpm format:fix       # Format     (oxfmt) — run BEFORE gates, never after
pnpm verify           # The static gate (CI adds the e2e suite on top)
pnpm e2e              # The scenario suite (one mode — the SPA is a static build)
```

`apps/web/README.md` is the product Worker's own guide — routes, auth, the
local loop and the owner-only deploy. `AGENTS.md` is the runnable quickstart;
`CONTEXT.md` glosses the carried domain vocabulary.

## Quality Gates

Before committing:

```bash
pnpm format:fix && pnpm verify
```

`verify` is `typecheck && lint && knip && format && test && build` — the STATIC
gate, in one command so no caller can drift from it. It is check-only on
purpose: `format:fix` runs FIRST.

CI runs those six and then a few more that `verify` cannot: it installs
agent-browser and runs the scenario suite. ONE run, because there is one
build — the workspace is a plain SPA served as files, so the suite drives the
same bytes and the same policy a user gets. So a green `verify` is not a green
CI; run `pnpm e2e` too before claiming one.

That "plus a few more" is a CLAIM, and
`tools/repo-guards/src/ci-verify-parity.test.ts` is what keeps it one: every
gate workflow runs `pnpm verify` or its chain in verify's own order, and every
step on top of that is a row in `DECLARED_CI_EXTRAS` with its reason. A step
nobody declared fails the guard rather than quietly becoming a build a
developer cannot reproduce.

**There is no seeded login, and sign-up is invite-only.** `AGENTS.md` has the
recipe. Never run `db:push` or `db:studio`: both hit production D1; the local
command is `db:push:local`.

## Decisions

- **THE EDITOR IS A WYSIWYG OVER A BYTE-DISCIPLINED SERIALIZER** (epic #579,
  reversing #542's editor line — deliberately, by the owner; do not "fix" it
  back). The editor is Plate.js (Slate) resurrected whole from `7dc78ffe^`
  WITH its byte-stability apparatus: one owned parse (`@repo/notes/markdown`),
  one rule table (`packages/editor/src/markdown/md-rules.ts`), a bounded
  FIXPOINT serializer, kit parity between the live editor and its headless
  mirror, and a byte-pinned fixture matrix (canonical / churn / raw tiers).
  Byte stability is a CONTRACT DEFENDED BY TESTS rather than a property of the
  data model: canonical files round-trip byte-exact; churn-class constructs
  (legacy forms, marker normalization) may canonicalize on the first save,
  stated per fixture; a file the pipeline cannot round-trip safely opens RAW.
  The fixtures are formatter-exempt — their bytes ARE the assertion.

- **NOTES SPEAK THE INTELIGIR DIALECT**
  (#581, renamed 2026-08-22 — the product is inteligir, so the format carries
  its name): `[[Title]]` / `[[Title#H]]` / `[[Title|alias]]` / `[[Title|uuid]]`
  wiki links (the LAST pipe starts the alias), `{{source|display|meta}}`
  formula pills, `%%i:id:start/end%%` comment anchors, and `inteligir-callout`
  / `inteligir-chart` / `inteligir-canvas` / `inteligir-html` / `:::tabs`
  blocks — all valid markdown, all round-tripping through the fixpoint. The
  spellings live in ONE place each (`@repo/notes/markdown/fence-langs`,
  `@repo/editor/nodes/canvas-header`) because the editor's rule table and the
  knowledge scan both read them and a drift would silently stop indexing links
  inside callouts. The FILE LAYOUT stays plain nested `.md`:
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
  commit of a large vault, where a pathspec would exceed ARG_MAX.

- **The knowledge index does not persist a stat fingerprint.** A warm
  reconcile over 2000 notes is ~105ms and runs off the critical path, so the
  saving is imperceptible — while the cost is a second persisted table inside
  a cache whose recovery primitive is deleting the file, so every `nuke()`
  must re-create it and a missed re-create is a crash.
- **A write carries the base it was computed from.** `expectedHash` on the
  vault write route is compared under the repo lock; a mismatch answers 409
  WITH the current content, and the client merges (diff3) and retries. Creation
  uses `ifAbsent` instead. Without this, an agent write landing between a
  client's read and its save is silently overwritten — the failure mode is
  invisible, so the guard has to be in the protocol, not the UI. This
  uses diff3 instead of an active-user-wins rebase that discards concurrent
  disk body edits wholesale. Merging non-overlapping regions is less lossy
  (#603).
- **Containment is PHYSICAL, not lexical.** The vault realpaths the deepest
  existing ancestor and refuses symlinked leaves. A lexical check passes
  `notes.md` when that name is a symlink to `~/.ssh/id_ed25519`, and a `git
pull` from a hostile remote is enough to plant one.
- **The vault dir and the data dir must be disjoint**, refused at boot. A data
  dir inside the vault gets committed and pushed — the SQLite database and the
  config with it.
- **Ingest is ONE transaction.** Appending a provider event, projecting the
  thread's lifecycle, and touching the queue happen in one immediate
  transaction; notifications flush after commit. Separately: lifecycle CAS
  predicates include the TURN identity, so a late completion for turn A cannot
  settle turn B.
- **Agent commits stage the turn's own write set**, taken from the fileChange
  events, under a counted commit hold that defers the vault's debounce and
  blocks a sync from starting. Committing the whole dirty tree attributes a
  concurrent turn's writes — and the user's — to whoever settles first.
- **THE AGENT SURFACE IS THE ⌘K ACTION COMPOSER AND THE RIGHT PANEL** (#587 —
  retiring the chat dock, the delegation checkbox/selection
  affordances, thread-chip markers, and #560's proposals pipeline whole). An
  ACTION is an ordinary thread ATTACHED to the note it was composed over
  (`threads.originDocPath` alone). The agent edits the vault directly, and
  ANCHORED COMMENTS are the review channel (#583): the panel's Actions |
  Comments | Properties tabs are the transcript, review and metadata surfaces;
  approvals answer inline.
  The palette moved to ⌘P; ⌘\ is zen. The selection toolbar's "Ask agent"
  seeds the composer with the quoted selection through a module-store seam
  the app registers — the editor package never imports the shell.

- **A VIEW CONTEXT RIDES THE MESSAGE, and it is a statement about the past.**
  What the user was looking at when they pressed Enter travels on the send
  (`@repo/domain/view-context`) — never as a thread column, never as a mutable
  server-side "current view". That value would have no owner and no truth (two
  windows, a closed tab, a turn still running after the app quit) and would be
  a lie the first time anyone stopped looking. Because the context describes
  the screen the message LEFT FROM, the staleness question dissolves: nothing
  needs to happen when the user navigates away mid-turn. The consequences are
  three. It reaches the model as a leading `{type:"text"}` element of the
  turn's `input`, because that is the ONLY channel a preamble has: ACP's
  `session/new` carries no instructions field at all, and the shell environment
  is built once per session. The session's own standing instructions ride the
  same channel, on the first turn of the session. There is NO tool: the agent
  already works in the vault checkout and can read the file, so a
  `get_view_context` tool would buy a round trip to deliver what it can
  already fetch, and the one thing it could add — a LIVE selection — is the one
  thing that cannot be made honest. And it is a STATEMENT, NOT A GRANT: it
  widens nothing, because the agent could already write any file in the vault,
  so no permission model belongs around it. A queued send carries none — the
  drain is minutes later, and storing a context for later gives away the exact
  property that makes it immune to rot.

- **RELATED IS ONE PANEL SECTION — linked mentions and the scorer's
  suggestions merged in the right sidebar** (owner's call 2026-08-22,
  reversing the under-document foot sections; the editor's ConnectionsPanel
  slot died with them). One list below Properties in the actions panel
  (`apps/desktop/src/renderer/app/actions/related-section.tsx`): backlinks lead because
  they are COUNTED — each row carries "Links here" plus the linking sentence,
  and the fold's summary keeps the honest truncation clause — and the
  scorer's rows follow with their own REASONS, because the failure mode of an
  inferred list is a plausible-looking row that is there by accident. No
  dedup between the halves: the scorer excludes direct neighbours by
  construction. What survives from the old placement decisions: OUTGOING
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
  that replaced it.

- **THE APPEARANCE DIALS ARE ONE DECLARATION, READ THROUGH `.typeset-docs`.** The
  funnel's tokens (`--editor-font`, `-mono`, `-size`, `-line-height`, `-width`)
  are declared once in `apps/desktop/src/renderer/styles/globals.css` and reach
  the WYSIWYG through that class alone. There is deliberately NO accent axis:
  nothing in Plate consumes a hue, so a dial for one would set a value no
  surface reads.

- **Stemming is a SHADOW of the indexed text, never a rewrite of it.**
  `search_fts` carries `title/headings/body` AND `title_stems/heading_stems/
body_stems` at the same bm25 weights, and `@repo/notes/knowledge/search-query`
  owns the one stemmer both engines call. FTS5's built-in `porter` tokenizer
  would have been the idiomatic answer and is REJECTED for a measured reason:
  it stems the INDEX, so a prefix query for a partly-typed word runs against
  stems and dies where the suffix begins — 86 of the 1,555 prefixes over the
  labelled corpus stop retrieving anything (`hirin`, `packin`, `migratio`),
  and typing is what the palette does. It would also put half a shared policy
  inside SQLite's C, where the pure `SearchIndex` cannot execute the same one.
  EVERY term asks BOTH halves, and that OR is **the exact tier**, not a
  belt-and-braces duplicate: Porter over-stems (`busy`/`business` → `busi`,
  `organ`/`organization` → `organ`), so the shadow alone lets a collision in a
  title outrank the word itself in a body. A doc holding the literal word
  satisfies both arms and bm25 sums the columns each matched, so it scores
  about twice a stem-only hit; the pure `SearchIndex` SUMS its two
  contributions to say the same thing. Implementing it on one side only is a
  silent lockstep break — the set-comparison lockstep test cannot see an
  ordering — so it is pinned by a ranking assertion run against BOTH engines.
  The residual is stated: the tier is one extra helping of a term's own field
  weight and the title/body gap is 10x, so a title-level collision still beats
  a body-level exact match. Closing that needs idf, which only bm25 has.
  **`tokenize()` folds diacritics** (NFD, nonspacing marks dropped) and the
  store states `remove_diacritics 2` against it — the stem is computed in JS
  and folded by SQLite, so an unfolded tokenizer made `acciones` reach one
  engine and not the other. **The snippet is cut in JS**
  (`knowledge/search-excerpt.ts`), by both engines: `snippet()` cuts one column
  from THAT column's offsets, and FTS5 will not carry a `body_stems` match
  across to the literal body, so a stemmed hit rendered the note's opening
  filler.

- **CONNECTORS ARE AN APP-OWNED REGISTRY, injected per-session over ACP**
  (#591, reversing the codex-owned-registry decision — its stated premise,
  codex as the only harness, died with #588). One local store, edited in
  Settings → Connectors and by the CLI's parity verbs; every harness receives
  the same enabled rows through ACP `session/new`'s `mcpServers`.
  `~/.codex/config.toml` is no longer consulted. Secrets stay in the data
  dir and are REDACTED in every read.

- **AGENT MEMORY IS REMOVED** (#589, reversing #575 — deliberately). Claude
  Code and Codex carry their own memory systems; a third memory beside theirs
  was two answers to one question. What
  DID survive the removal is the pattern: content the agent consumes lives in
  FILES read with its own shell — the vendored dialect skills ride
  `INTELIGIR_SKILLS_DIR` (resolved from `@repo/agent-skills`, staged beside
  the app bundle in the packaged layout), with a three-sentence pointer
  delivered on the session's first turn prompt, never the spec inlined.

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
  `POST /voice/transcribe` stays for a whole-clip caller (scripted mode, any
  non-interactive path) and feeds the SAME engine — it pushes the clip through a
  stream and reads the final. The model is the int8 variant
  (`…-480ms-int8`, ~106 MB download vs 450 MB fp32, the size the one-model path
  was chosen for), a `.tar.bz2` of four files (encoder/decoder/joiner + tokens)
  pinned by the ARCHIVE's sha and extracted in pure JS (`tar` + `unbzip2-stream`
  — Node has no bzip2, and Windows' tar.exe cannot do `-j`). THE MODEL FILE IS
  STILL THE SWITCH: no `voiceEnabled` flag, `install` fetches against the pin,
  `remove` deletes, "off" is "no model on disk".
- **A PERSISTENT SESSION WORKER, not one per clip.** Streaming re-uses the
  recognizer as frames arrive, so the model loads ONCE per hold and stays warm;
  a worker per re-transcription would pay the ~0.7 s load on every cadence.
  `stream-session.ts` owns it and it is TORN DOWN ON EVERY EXIT PATH — release,
  cancel, ws disconnect, and app teardown — with no leaked worker and no escaped
  rejection (the prior `#warmUp` unhandled-rejection is the reason every async
  path here catches and every worker terminates; pinned in
  `stream-session.test.ts`). The batch path and the probe stay one-shot
  (`runVoiceWorker`), because they answer once. The worker is not optional —
  `better-sqlite3` is synchronous and the watcher's fork channel pings on a bare
  timer, so an inline native decode would stall a save, a query and the
  watcher's liveness together.
- **A DEDICATED DICTATION WEBSOCKET, off the invalidation bus.** `GET
/voice/stream` carries PCM16 frames UP (binary) and `partial`/`final`/`error`
  DOWN (text); the `/ws` bus carries change-kind PINGS by decision and NEVER a
  payload, so this is its own endpoint. It sits behind the SAME
  loopback/browser-origin guard and, like `/ws`, is exempt from the route-table
  guard because a websocket is neither a request/response pair nor something the
  typed client reaches. Its sockets are HIJACKED off the HTTP server on upgrade
  exactly as the bus's are, so the listener teardown step closes BOTH by name —
  a live hold must not stall the process's exit (the same trap the shutdown
  decision records for `/ws`).
- **THE RENDERER STREAMS WITH A `ScriptProcessorNode`, not an `AudioWorklet`.**
  A worklet's module is fetched as a script, and this app's prod CSP names
  `worker-src 'none'` on purpose (the same directive that refused transformers.js
  in #574). ScriptProcessorNode is deprecated but loads no module, so it is the
  one raw-frame source the policy admits — proven under the real policy by
  `pnpm e2e`, which serves the built bundle and its header. Partials render in a PREVIEW OUTSIDE the composer field and
  only the final splices in (`spliceIntoComposer`, the #574 live-base/live-caret
  fix), so a partial rewriting mid-hold can never eat text the user typed.
- **THE SESSION IS BOUNDED.** Parakeet streams incrementally, so there is no
  window to slide — but the recognizer's state still grows with audio, so a hold
  is capped at `VOICE_MAX_AUDIO_SECONDS`; frames past it are dropped and the
  final answers what was fed.
- **THE SHA GATE IS THE REAL GUARD; the `modelUnusable` nuke is the backstop**
  (kept from #574). `model-store` verifies the archive's sha256 against the pin
  before extracting, so only the exact bytes that DO load ever reach the
  recognizer — the practical protection against a bad model. The worker still
  reports `modelUnusable` for a CATCHABLE load refusal and the service nukes the
  model and drops to `no-model` (the delete-and-rebuild the knowledge cache
  uses); a decode failure keeps the files, because that is about the audio. The
  honest residual: onnxruntime does NOT translate a parse failure into a
  catchable error — it raises a C++ exception that aborts — so a truly
  unparseable model would crash rather than nuke. The sha gate is why that path
  is unreachable, which is exactly why it is the guard that matters. The
  `preparing` state covers the one-time onnx graph load a warm-up forces at
  install, so a catchable open failure is caught there rather than at the first
  dictation. **THE PROBE ACTUALLY LOADS THE NATIVE BINDING** (`import(
"sherpa-onnx-node")` requires the addon), so a platform whose binary cannot
  load answers `unavailable` at the switch. **THE DESKTOP SHELL GRANTS `media`,
  ORIGIN-SCOPED** (unchanged), and there is **NO CLI VERB** — dictation is a
  human affordance, and holding a key over a live microphone is not something a
  shell invocation can express. The residual is stated: English only, and the
  final's rough text is the accepted cost of the streaming feel.
- **THE DEVICE CREDENTIAL IS THE SYNC SWITCH, and it lives in the data dir.**
  `<dataDir>/device-credential` at 0600, beside `server.json` and for the
  same reason — and the two places it must NOT go are what fix the location:
  not `inteligir.db`, which is the thread log this credential exists to upload,
  and not the vault, which is a git repo pushed to a remote the user chose.
  There is deliberately no separate "sync enabled" flag: two values that must
  agree are two values that can disagree, and both disagreements are bad — a
  flag off beside a live credential leaves a working credential nothing uses,
  a flag on beside none is a promise no loop can keep. So SYNC IS OFF BY
  DEFAULT because an unpaired install has no credential, and with none it opens
  no socket, arms no timer and makes no request (asserted, at the shipping
  cadence, in `cloud/__tests__/sync-runtime.test.ts`). The cost, accepted:
  "pause sync" is not expressible — you unpair, which discards the queue.
- **PAIRING IS APPROVED IN A BROWSER, and the code survives only as plumbing**
  (issue #573). Nothing shows a `XXXX-XXXX` to a human any more and nothing
  accepts one: Settings has a button, the dashboard has a device table, the CLI
  has `inteligir sync pair` with no argument. What was deleted is the FERRY, not
  the artifact — the mint route, the code table, the ten-minute TTL and the
  one-time redeem are untouched, because they are the security story and the
  redirect merely carries what a user's eyes used to. The durable credential
  never transits the browser: it is minted by the local app's own redeem and
  lands only in `<dataDir>/device-credential`.
  **This is small here and large elsewhere because THE APP IS ALREADY A
  LOOPBACK SERVER** — the callback a CLI tool would stand a server up for is one
  more route on it. No typed-code fallback survives, and the user it would serve
  cannot exist: reaching this product's UI at all means a browser reaching its
  loopback, and a browser that can do that can complete the redirect (an ssh
  user's port-forward carries both).
  **THE REDIRECT ALLOWLIST IS CONTRACT, not handler code**
  (`@repo/api/cloud/pairing/pairing-schema`): the approve page refuses a target at PARSE,
  and the local app validates its OWN composition through the same schema, so
  there is one gate rather than two that can disagree. It is judged on `URL`
  FIELDS — `hostname`, `protocol`, `pathname`, and `username`/`password` required
  empty — because `new URL("http://127.0.0.1@evil.example/…")` parses to username
  `127.0.0.1` and hostname `evil.example`, and every host check that ever fell
  for that was reading the wrong field. `[::1]` is REFUSED and `localhost` with
  it: this process binds the `127.0.0.1` literal and nothing else, so an
  allowlist wider than the set of addresses that can answer is an open redirect
  with extra steps — one carrying a live pairing code. The port is deliberately
  unconstrained, default included, because loopback is loopback on any port.
  The allowlist's SECOND and only other arm is the mobile deep link,
  `inteligir://pair/callback`, exact on every field (`URL` parses `pair` into
  hostname, `/callback` into pathname; port required absent — a custom scheme
  has no server). The residual an allowlist cannot reach — an app squatting the
  `inteligir://` scheme on the same OS receives the redirect, code included —
  is held by PKCE, the same property that keeps the open loopback port safe.
  The desktop renderer's `inteligir://app` origin pin is a separate policy over
  the same scheme string; neither is widened by reference to the other.
  **THE STATE IS THE APP'S, and the callback is inert without it.** One slot,
  128 bits, ten minutes, compared in constant time and CONSUMED BEFORE the
  redeem — a state that survived its own redeem is a URL replayable out of a
  browser history. A wrong state does NOT consume it, or any local page could
  cancel a pairing mid-flight. `GET /pair/callback` sits outside the contract
  table for the reason `/ws` states its own (a browser wants a page, and no
  typed client has any use for the row) and outside the browser-origin guard for
  the mirror of it: the request IS a cross-site top-level navigation, which is
  exactly what that guard refuses, so the state stands in its place.
  **THE SERVER OPENS THE BROWSER**, via `execFile` with an argv list and never a
  shell, so the act is identical from a browser tab, the Electron shell and a
  headless CLI — and the shell's unconditional `window.open` denial never comes
  into play. Whether to open is a REQUEST FIELD rather than a second route,
  because beginning a pairing is one verb; it is required rather than defaulted,
  since the caller that must say `false` is the agent's `--json` path and a
  default is precisely what that path would forget. A failed open is an ordinary
  answer (`opened: false`), not an error: the URL is returned either way and
  Settings shows it as a link.
  The callback's port comes from the REQUEST's own Host header, not from
  `config.port`, because `listen` may have probed past a busy dev port — and a
  Host that is not one of this app's loopback origins answers 400 rather than a
  redirect pointing somewhere else.
  **THE CODE IS BOUND WITH PKCE (RFC 7636, S256), and that is why the open port
  is safe.** `state` guards only THIS app's callback; it never reaches the
  cloud, and `redeem` is unauthenticated — so an intercepted redirect on the
  loopback would otherwise let any local listener read the code and redeem it
  directly. So `beginPair` mints a high-entropy VERIFIER, keeps it in the
  pending slot, and sends only its `S256` CHALLENGE through the browser: the
  approve page forwards the challenge to the mint, the Worker stores it on the
  code row, and `redeem` now takes the verifier and refuses unless
  `S256(verifier)` equals the stored challenge (constant-time; a mismatch or a
  null challenge answers `invalid-code` and does NOT consume the code, so an
  interceptor's wrong-verifier attempt neither reveals the miss nor burns the
  real pairing). The verifier never leaves the app, so an intercepted code alone
  cannot be spent — which is what makes the deliberately-open port a non-issue
  rather than a hole: the port stays open BECAUSE the code is bound. The S256
  transform is ONE spelling in `@repo/api/cloud/pairing/pairing-schema`
  (`pkceChallengeS256`), computed the same way at begin and at redeem. The mint
  refuses a plain or absent challenge — `S256` is the only method — because a
  challenge equal to its verifier binds nothing an interceptor could not also
  send.
  **THE APPROVE PAGE NAMES THE ACCOUNT** it is about to join (the session's
  email), because a shared or ambient browser session would otherwise pair a
  device to the wrong account and sync private threads both ways with no sign of
  it. **The browser opener never touches a shell**: `execFile` with an argv
  list, and on win32 it is `rundll32 url.dll,FileProtocolHandler <url>` rather
  than `cmd /c start`, because cmd re-parses the approve URL's `&` query
  separators even with `shell:false` — the URL's own ampersands would truncate
  it and could run the tail as a command. **`beginPair`/`completePair` are
  guarded by `disposed` and `dispose` clears the pending slot**, so a callback
  in flight during ordered shutdown redeems nothing and writes no credential
  after teardown.
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
  dangerous case answers "yes, live" about a DIFFERENT pairing: an old push's
  ack deletes the outbox rows a re-pairing has since queued, and an old pull's
  page applies another account's events and drags the new cursor past rows it
  never saw. Cancellation (an `AbortController` per session, plus a per-request
  timeout) covers the in-flight half; identity covers the half cancellation
  cannot reach, where the response already arrived and there is nothing left to
  abort. Both are needed, and `dispose` aborts too — otherwise the teardown
  step's budget is a hope, and the pass keeps writing (the vault included)
  after the process was told to stop.
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
  behind it.
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
  and was false in both directions.
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
  package staging the other two, so `staged-layout.mjs`'s six-way contract has
  nothing left to hold together. The desktop shell still forks a CHILD, and
  that reason is unchanged: it must not share its compositor's event loop with
  better-sqlite3, a watcher fork and `git`. What changed is who supervises —
  `utilityProcess` IS a managed Node child with owned bookkeeping, so the
  process handle, the piped stdio and the SIGTERM `kill()` sends are the
  runtime's. Readiness, the SIGKILL behind an overrun grace, and the
  deliberate ABSENCE of a restart are `src/main/server-process.ts`'s own.
  The shell adopts an already-listening server rather than fighting it, and
  only kills the child it started.
- **THE CREDENTIAL IS A FILE, NOT A CHALLENGE** (#611, reversing the
  loopback-adoption-is-earned line — its premise, that a client had no channel
  to the server but the port, is what died). On boot the server writes
  `<dataDir>/server.json` at 0600 — `{port, token, vaultDir, pid}` — and
  removes it on ordered shutdown; every caller reads it and sends
  `Authorization: Bearer <token>`. That kills three problems at once. There is
  no probing and no neighbouring-checkout ambiguity, because the FILE names the
  port that answered rather than the port the derivation predicted. There is no
  adoption ceremony, because a squatter on 4664 cannot have written the file
  and so fails the token instead of being adopted. And the browser-origin
  guard survives only where the credential is AMBIENT: a page cannot hold the
  bearer, so that carrier is trusted as-is, while a COOKIE-authed request must
  additionally prove same-ORIGIN (`apps/cli/src/server/browser-request.ts`) —
  loopback "site" ignores the port, so a co-resident page on another 127.0.0.1
  port carries this server's cookie by itself. The bound is the same honest
  one the nonce challenge had — it proves the caller can READ that data
  directory, not that it is this code — which is exactly the line between "the
  program that owns this vault" and "the program that got to the port first".
  The browser is the one client that cannot set a header, so the document
  carries the same token as an HttpOnly SameSite=Strict cookie: one token, two
  carriers, never a second secret.
- **Shutdown is ORDERED, per-step TIME-BOXED, and its exit code is the truth.**
  Writers stop, then the vault's pending commit flushes, then the handles
  close. Each step has its own budget because a single budget for the whole
  teardown is not a bound on anything — one wedged step consumes it and starves
  every step behind it, which is precisely how the vault flush gets skipped.
  The listener step must CLOSE THE WEBSOCKETS BY NAME: an upgraded socket is
  detached from the HTTP server's connection tracking, so `server.close()`
  never completes while one is open and `closeAllConnections()` does not touch
  it — one open browser tab stalled the entire teardown at step one, exited 0,
  and left the database un-closed. A step that fails or times out exits
  non-zero and says which.
- **THE CSP IS STATIC, and deleting TanStack Start is what bought that**
  (#611, reversing the nonce-CSP decision). The nonce apparatus existed because
  the Start router INJECTED inline scripts at runtime whose content varied per
  render, so neither a hash list nor a fixed policy could admit them (measured,
  not assumed). A plain Vite SPA injects none, so `script-src` is `'self'` and
  the whole policy is a fixed header — served identically by the protocol
  handler to the window and by the server to a browser, because two spellings
  of one policy is one policy that can rot. `style-src` keeps `'unsafe-inline'`
  for runtime-injected component styles — the one stated residual. `frame-src`
  is `'self'` for exactly one frame: inteligir-html's sandboxed srcdoc preview
  (never allow-same-origin). The directive that earns the most here is
  `connect-src`: a script that cannot reach a third-party origin cannot
  exfiltrate the vault.
- **THE RENDERER'S ONLY DOOR IS `inteligir://app`** (#611). Serving the
  workspace from a custom scheme makes the loopback server cross-origin to it,
  and the answer is NOT CORS on that server: the protocol handler carries the
  bundle, `/rpc/*` and `/vault/asset` alike, attaching the bearer in MAIN. So
  the page is same-origin with its own API, there is no CORS anywhere, and THE
  RENDERER NEVER HOLDS THE TOKEN — which is what keeps an `<img src>` inside a
  note working, since an image tag cannot carry an `Authorization` header. The
  scheme is registered `standard` (Chromium then gives it a real origin, which
  the pin depends on), `secure`, `supportFetchAPI` and `stream`. Websockets are
  the ONE exception and need deliberate work: a browser `WebSocket` cannot be
  proxied by a protocol handler, so the bus and the dictation stream dial
  loopback directly, main attaches the bearer to those upgrades with
  `onBeforeSendHeaders`, and the single preload hands the renderer that origin
  as `window.desktopBridge.socketOrigin` — `window.location.origin` no longer
  names a server. **The pin cannot use `URL.origin`**: Node's parser answers
  the opaque string `"null"` for any non-special scheme, so `inteligir://app`
  and `inteligir://evil` would compare EQUAL. Scheme and host are compared as
  fields. A link the user COPIES is the mirror of this: it must name the
  server's own loopback origin (`socketOrigin()`), never the page's, because
  the shell's scheme is registered with no OS and this process denies
  `window.open` for it — a copied `inteligir://app` URL opens nowhere,
  inteligir included. The residual is stated rather than hidden: the bound port
  can move across restarts, so a copied link is a same-machine affordance and a
  durable address is its own feature.
- **Better Auth's `baseURL` is derived per-request from the request origin**,
  never configured or allowlisted. Every hostname that reaches this Worker is
  one the deployment owns, and Cloudflare routes by hostname, so a spoofed
  `Host` never arrives. A fixed fallback would mint password-reset links back
  at the wrong deployment; deriving makes localhost/preview/prod work with no
  config. The trigger to revisit is a hostname the deployment does not fully
  control reaching the Worker.
- **Sign-up is invite-gated by a Worker route in front of Better Auth**
  (`apps/web/src/worker/auth/invite.ts`), claiming the code in one atomic
  statement and then forwarding into the one instance built with
  `disableSignUp` off. Every other caller's instance carries the flag, which
  shuts `/api/auth/sign-up/email` and `auth.api.signUpEmail` together; each
  social provider carries its OWN `disableSignUp`, so a provider is a sign-in
  for an account that already linked it, never a way to get one.
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
  editor draws — and the editor's plugin list
  (`@repo/notes/markdown/md-plugins`, via `parse`) disables both too.
  CommonMark's defaults are where the two would diverge: indented code hides a
  4-space-indented `- [ ]` the editor still shows, and flow HTML lets one
  `<div>x</div>` line swallow every task line under it. The agreement is pinned
  by counting the same docs through both parses
  (`packages/notes/src/__tests__/task-ordinal.test.ts`).
- **THE SCAN'S GRAMMAR IS NOT THE EDITOR'S, and `verbatim-spans` is the one
  bridge.** `@repo/notes/markdown/scan-parse` is plain markdown and TOTAL, so a
  malformed tag cannot cost a note its place in the index; the editor's
  `md-plugins` stack runs remark-math, the agnostic MDX tokenizer (which
  THROWS) and remark-opaque. The two therefore disagree about which bytes are
  verbatim: `<div>[[A]]</div>`, `$$[[A]]$$` and `{ [[A]] }` are ONE opaque
  string to the editor and a wiki link with a rewritable `targetSpan` to the
  scan. A `targetSpan` is a LICENCE TO REWRITE BYTES, so the scan runs the
  editor's own plugin list as a bare `parse` (`markdown/verbatim-spans.ts`) and
  withholds the span inside those ranges — the existing "indexed but never
  rewritten" tier, the same one an unverifiable destination lands in. Unifying
  the two grammars is the rejected alternative: it would let one malformed tag
  stop a note indexing at all. A doc the editor's grammar REFUSES yields no
  ranges, and that is correct rather than lax — it opens RAW, so it has no
  round trip whose bytes could be broken.
- **Frontmatter is the ONLY property store.** No metadata table, ever. YAML the
  typing rules can't represent is preserved byte-exactly, never coerced.
- **No coverage tooling, on purpose.** This repo enforces targeted invariants
  structurally rather than via a global percentage: the dependency DAG and its
  platform rules and ws change-kind reachability
  (`tools/repo-guards`), route-table completeness
  (`apps/cli/src/server/__tests__/http-surface.test.ts`), migration↔schema
  agreement (`packages/db/src/__tests__/schema-agreement.test.ts`),
  no-orphan-components, the CLI guide and its `--json`
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

**Before raising a "new" finding, read
[#542](https://github.com/kyh/inteligir/issues/542)** — the decision record
carries what was rejected as well as what was chosen. The older `note` issues
(#446, #453, #472, #474) catalogue findings declined against the hosted
Durable-Object architecture this rewrite replaced; their concerns rarely
survive the move, and none of their paths do.
