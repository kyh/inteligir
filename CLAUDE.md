# Agent Instructions

## Project Overview

**inteligir** — an AI-native notes app (Obsidian-with-an-agent), local-first.
The vault is markdown files in a git repo the user owns; one local Node process
serves the workspace, owns the vault, indexes it, and drives a coding agent
that edits those same files. The only hosted piece is a Cloudflare Worker
carrying the marketing site, accounts, and cross-device thread sync.

**The architecture's decision record is GitHub issue
[#542](https://github.com/kyh/inteligir/issues/542)** — what was chosen, and
what was rejected and why.

Turborepo + pnpm monorepo.

## Workspace Structure

```
apps/
  app/           @repo/app — THE PRODUCT (issue #545): one local Node process.
                 TanStack Start SPA (UI) served by a custom entry (src/node/,
                 its own tsconfig program) that owns /api/v1 (the contract
                 table on Hono), the /ws invalidation bus, and the db. Dev
                 mounts Vite middlewareMode in-process; prod serves
                 dist/client + the Start server entry's fetch. src/node/cloud/
                 is the sync CLIENT (issue #572): the credential at rest, the
                 frozen-body outbox, the pull/apply loop and the local
                 /cloud/* routes Settings and `inteligir sync` drive.
                 src/node/voice/ is dictation (issue #578): the pinned model
                 cache under ~/.inteligir/models/, and streaming Parakeet
                 (sherpa-onnx) on a persistent session worker per hold, over a
                 dedicated /voice/stream websocket. src/node/comments/ serves the
                 anchored-comment sidecars through the vault (#583). Agent
                 memory was REMOVED (#589 reversed #575) — the harnesses
                 carry their own.
  cli/           @repo/cli — the `inteligir` CLI (issue #553): citty over
                 the typed hc client, consola for the human path (raw writes
                 for anything verbatim — consola rewrites `backtick` spans).
                 Every leaf takes --json and is EXECUTED
                 by the fitness test against 400/500; `requireOk` is the one
                 status gate, returning hono's success member so a refusal
                 cannot be printed as an answer. Discovery reuses
                 @repo/app/node/config, then requires the responder's
                 /system/status dataDir to match this checkout's (a
                 neighbouring dev server is refused, never adopted). The app
                 serves the agent manual on GET /api/v1/guide, and the codex
                 runtime injects INTELIGIR_SERVER_URL + a PATH carrying the
                 CLI's bin dir into agent shells, so a model drives the
                 product by typing `inteligir …` in bash. The staged layout
                 itself is `apps/launcher/scripts/staged-layout.mjs` — the
                 build and both smokes import it, and the encoders that
                 cannot (apps/app, the shell, the published `bin` map) are
                 held against it by
                 tools/repo-guards/src/install-layout.test.ts.
  launcher/      inteligir — THE PUBLISHED ARTIFACT (issue #555). `npx
                 inteligir` boots the product IN THIS PROCESS: parse the
                 command line, hand it to the app's own boot as environment,
                 import it. Its build stages the app and CLI into
                 `dist/apps/{app,cli}` — the shape both of the app's runtime
                 resolvers already walk, so a packaged install keeps its
                 migrations, its SPA and the agent's CLI-on-PATH with no third
                 code path. better-sqlite3 and @parcel/watcher stay runtime
                 deps (native); everything else is inlined.
  desktop/       @repo/desktop — the Electron shell (issue #555): one window on
                 the local server, supervising it as a CHILD process. The whole
                 security surface is the ORIGIN PIN (src/main/origin-pin.ts,
                 pure + unit-tested): one origin, top-level navigation away
                 goes to the system browser, window.open denied
                 unconditionally, no preload and no IPC. A server already
                 listening is ADOPTED, not fought, and only a child the shell
                 started is killed on quit.
  web/           @repo/web — ONE Cloudflare Worker: the TanStack Start
                 marketing site, the auth pages, Better Auth on D1
                 (invite-gated sign-up), and the v3 cloud (issue #554):
                 device pairing (/app/pair approves one, /app/devices lists and
                 revokes), the per-user ThreadSyncDO (merged thread log +
                 capture inbox + ws invalidation), the flag-gated Artifacts
                 mint. src/worker/ is its own tsconfig program (no DOM —
                 workerd's globals must win).
  mobile/        @repo/mobile — the Expo RN client (#576): a sync-only
                 thread/capture surface over the cloud contract; reaches
                 nothing but cloud-contract + domain.
packages/
  domain/        @repo/domain — zod-only leaf vocabulary (view context, ids,
                 provider events), vendored-from-bb shapes; every package may
                 reach it, it reaches nothing.
  thread-view/   @repo/thread-view — pure timeline projection; the app's
                 panel and the CLI render the same rows through it.
  cloud-contract/ @repo/cloud-contract — the cloud wire contract (zod only):
                 pairing, device auth, sync push/pull, captures, the ws ping
                 frames, the typed error envelope, and the paths all three
                 spell. TWO implementations: apps/web serves every row and
                 apps/app's sync client (src/node/cloud/, issue #572) consumes
                 them.
  typed-routes/  @repo/typed-routes — contract-first Hono route machinery,
                 vendored from bb (MIT): defineRoute rows, compile-time
                 handler enforcement, the hc client schema derivation.
  server-contract/ @repo/server-contract — the wire contract: THE route
                 table + payload schemas, the typed hc client, and the ws
                 notification protocol (subscription targets, per-entity
                 change kinds, strict outbound / lenient inbound).
  db/            @repo/db — drizzle + better-sqlite3 (WAL, sync=NORMAL),
                 committed SQL migrations applied on boot, the DbNotifier
                 seam, prefixed-nanoid ids.
  notes/         @repo/notes — PURE platform-neutral domain: the knowledge
                 engine (link graph, FTS5 search over an injected SqlDriver,
                 tags, tasks, rename byte-surgery) over ONE markdown scan
                 (scan-parse + wiki-links), frontmatter, the dialect's own
                 modules (markdown/remark-*, comments/, formulas/, import/),
                 and `text/` — ONE Myers diff under diff3. No node/react/ui
                 imports — lint-enforced.
  editor/        @repo/editor — the Plate.js WYSIWYG (resurrected, #580):
                 kits/nodes for every dialect construct, the md-rules table,
                 the fixpoint serializer + fixture matrix, the open-note
                 runtime (vault-session/note-runtime/open-note-store) the app
                 drives through injected ports (host.tsx / host-io.ts).
  agent-runtime/ @repo/agent-runtime — the ACP runtime (#588): one adapter
                 speaks Zed's agent-client-protocol to claude-code-acp and
                 codex-acp children; harnesses are data rows; the
                 provider-event vocabulary is the one internal grammar.
  agent-skills/  @repo/agent-skills — product skill files: the
                 dialect's first-party spec, served to agents as files.
  ui/            @repo/ui — vendored stock shadcn on Base UI; leaf.
tools/
  repo-guards/   @repo/repo-guards — derived fitness tests over the REPO: the
                 package dependency DAG + its platform-purity rules and ws
                 change-kind reachability. The
                 invariants that span workspaces and belong to none of them.
```

## Tech Stack

- **Monorepo**: Turborepo + pnpm workspaces, oxlint/oxfmt, vitest, knip
- **Web**: TanStack Start + React 19 + Tailwind CSS 4 on a Cloudflare Worker
- **Auth**: Better Auth on D1 via Drizzle — email+password, bearer tokens,
  optional GitHub/Google, invite-gated sign-up

## Common Commands

```bash
pnpm dev              # THE PRODUCT (apps/app) — the local server, per-checkout port
pnpm dev:desktop      # The Electron shell over it (CDP on 9222)
pnpm dev:web         # apps/web: vite + miniflare on :5174 (pinned, strictPort)
pnpm package:launcher      # The npm artifact (apps/launcher) — `npx inteligir`
pnpm package:desktop  # An UNSIGNED macOS arm64 dmg
pnpm smoke:launcher    # Pack, install into a scratch prefix, boot, probe, stop
pnpm smoke:desktop    # Package the .app, boot its server, drive it, SIGTERM (macOS only)
pnpm build            # Build all
pnpm typecheck        # Type check all
pnpm lint             # Lint all   (oxlint)
pnpm format:fix       # Format     (oxfmt) — run BEFORE gates, never after
pnpm verify           # The static gate (CI adds the e2e suite on top)
pnpm e2e              # The scenario suite; --prod for the built shell
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
agent-browser and runs the scenario suite in BOTH modes (`pnpm e2e` and
`pnpm e2e --prod`). Both, because they serve different code — dev runs Vite's
middleware and no CSP, prod serves the built shell under the real policy. So a
green `verify` is not a green CI; run `pnpm e2e` too before claiming one.

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
  (`threads.originDocPath` alone; an anchor still cannot exist without its
  doc, but a doc alone is a marker-less attachment). The agent edits the
  vault directly, and ANCHORED COMMENTS are the review channel (#583): the
  panel's Actions | Comments | Properties tabs are the transcript, review and
  metadata surfaces; approvals answer inline. `threads.writeMode` survives as
  an INERT column (cross-device sync version skew makes a drop unsafe).
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
  turn's `input`, because that is the ONLY per-turn channel codex honours —
  `instructions` is read at thread start/resume only, the shell environment is
  built once per session, and session instructions are per session. There is NO
  tool: the agent already works in the vault checkout and can read the file, so
  a `get_view_context` tool would buy a round trip to deliver what it can
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
  (`apps/app/src/app/actions/related-section.tsx`): backlinks lead because
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
  the app bundle in the packaged layout), with a three-sentence instructions
  pointer, never the spec inlined.

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
  `pnpm e2e --prod`. Partials render in a PREVIEW OUTSIDE the composer field and
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
  human affordance, the same reason connectors gets `list` and nothing else. The
  residual is stated: English only, and the final's rough text is the accepted
  cost of the streaming feel.
- **THE DEVICE CREDENTIAL IS THE SYNC SWITCH, and it lives in the data dir.**
  `<dataDir>/device-credential` at 0600, beside `instance-secret` and for the
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
  (`@repo/cloud-contract/pairing`): the approve page refuses a target at PARSE,
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
  transform is ONE spelling in `@repo/cloud-contract/pairing`
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
- **Sync carries THREADS, not the vault, and the contract has no thread-metadata
  read.** The pull answers events alone, so lane and title are push-only —
  nothing reads them back, and this client therefore sends neither. The
  consequence is stated rather than hidden: a thread with no events never
  reaches another device, because the merged log is the only channel that
  carries one.
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

- **The launcher boots in-process; the desktop shell supervises a child.**
  Opposite answers because the failure differs: `npx` wants one exit code and
  a `^C` that reaches the vault's owner, while the shell must not share its
  compositor's event loop with better-sqlite3, a watcher fork and `git`. The
  shell adopts an already-listening server rather than fighting it, and only
  kills the child it started.
- **A LOOPBACK PORT IDENTIFIES NOTHING, so adoption is earned.** Any local
  process can hold 4664 and answer `/health` 200; adopting on that alone hands
  a squatter the trusted window and the origin's storage. Every boot mints a
  secret into `<dataDir>/instance-secret` at 0600 and answers a nonce challenge
  with an HMAC over it (`/api/v1/system/identity`), and a client adopts only
  when the answer verifies against the secret in the data dir IT resolved and
  the responder names that same dir. The bound is honest: it proves the
  responder can READ that data directory, not that it is this code — which is
  exactly the line between "the program that owns this vault" and "the program
  that got to the port first". `/system/status`'s dataDir is a CLAIM; this is
  the proof.
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
- **The prod document carries a nonce CSP with `'strict-dynamic'`, not a hash
  list.** The built shell's one inline script hashes cleanly, but the Start
  router INJECTS further inline scripts at runtime whose content varies per
  render, so a hash allowlist blocks the app the moment it hydrates (measured,
  not assumed). `style-src` keeps `'unsafe-inline'` for runtime-injected component styles —
  the one stated residual. `frame-src` is `'self'` for exactly one frame:
  inteligir-html's sandboxed srcdoc preview (never allow-same-origin). The directive that earns the
  most here is `connect-src`: a script that cannot reach a third-party origin
  cannot exfiltrate the vault.
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
- **The knowledge scan disables `codeIndented` and `htmlFlow`**
  (`@repo/notes/markdown/scan-parse`). A checkbox is addressed by its POSITION
  among a doc's task items, so the scan's count has to agree with the set the
  editor draws — and CommonMark's defaults are where a micromark scan and
  lezer-markdown diverge. The agreement is pinned by the editor's roundtrip fixture matrix.
- **Frontmatter is the ONLY property store.** No metadata table, ever. YAML the
  typing rules can't represent is preserved byte-exactly, never coerced.
- **No coverage tooling, on purpose.** This repo enforces targeted invariants
  structurally rather than via a global percentage: the dependency DAG and its
  platform rules and ws change-kind reachability
  (`tools/repo-guards`), route-table completeness
  (`apps/app/src/node/__tests__/route-table.test.ts`), migration↔schema
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
- **Vendored source keeps its attribution header.** Third-party license texts
  live under `tools/licenses` and ship with the published artifact.
- **`packages/ui/components.json` declares `rsc: true` and it is deliberately
  inert** — the `"use client"` directives it produces are ignored by every
  consumer, all plain Vite builds with no RSC bundler in the graph.

**Before raising a "new" finding, read
[#542](https://github.com/kyh/inteligir/issues/542)** — the decision record
carries what was rejected as well as what was chosen. The older `note` issues
(#446, #453, #472, #474) catalogue findings declined against the hosted
Durable-Object architecture this rewrite replaced; their concerns rarely
survive the move, and none of their paths do.
