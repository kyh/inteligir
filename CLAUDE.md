# Agent Instructions

## Project Overview

**inteligir** is Obsidian where an agent edits your notes with you. It is for
general knowledge workers, not developers: a small invited cohort, on macOS
Apple silicon only. The vault is a folder of markdown files on the user's own
disk; one local Node process owns that vault, indexes it, answers one API, and
drives the agent that edits those same files. The only hosted piece is a
Cloudflare Worker carrying the marketing site, accounts, cross-device sync, the
capture inbox and the account's hosted vault.

The premises every change builds from, each with its reason:

- **The agent runs on the user's own Claude or ChatGPT plan, on their Mac,**
  through the runtimes bundled inside the .app, because the owner never pays
  for model usage and a knowledge worker has no agent to install.
- **Signing the agent in is the vendor's own sign-in, into the vendor's shared
  store** (`~/.claude`, `~/.codex`), so a Mac already signed in stays signed in
  and the app never holds a model credential of its own.
- **There is no API-key fallback**: a key is a bill the user never chose and a
  secret the app would have to keep.
- **No model call goes through the Worker or the phone**, because a model call
  there is one the owner pays for.
- **Git is the engine, never the vocabulary.** History, undo and sync ride git,
  and no product surface says git, commit, remote, repo, terminal, CLI, PATH or
  MCP, because none of those words is the user's. Settings › Advanced is the one
  exception, for the user who brings their own sync server.
- **The phone is a full editor.** It writes through a guarded Worker endpoint
  and asks a Mac to run the agent, because a phone holds neither git nor a
  model.
- **Connectors are the default agent's own MCP config**, because one registry,
  the vendor's, with the vendor's own sign-in, beats a second one beside it.
- **Dictation is the operating system's**, because the Mac's and the phone
  keyboard's are already there and cost the app no speech model.
- **Every feature is core.** Nothing sits behind a tier or a flag, and nothing
  already built is cut for the persona: the persona changes the words.
- **An account is optional, and offered.** Without one the app is a local notes
  app that makes no cloud request; with one it syncs, and the hosted vault is
  free up to about 1 GB.

**TWO PROGRAMS.** `apps/desktop` is the shipped product — the window, and the
SPA inside it — and the user installs it as the signed dmg. `apps/cli` is the
`inteligir` binary: `serve` IS that local server, and every other verb is a
client of a running one. The CLI is the agent's door and the developer's;
nothing the user does needs a terminal.

**The architecture's decision record is GitHub issues
[#542](https://github.com/kyh/inteligir/issues/542) and
[#611](https://github.com/kyh/inteligir/issues/611)** — what was chosen, and
what was rejected and why. #611 is the v4 consolidation, and it REVERSES four
of #542's lines deliberately; where the two disagree, #611 wins. Where either
of them, or a Decisions bullet below, assumes a developer at the keyboard, this
overview wins, and the issue that changes that code rewrites the bullet in the
same commit.

Turborepo + pnpm monorepo.

## Workspace Structure

```
apps/
  desktop/       @repo/desktop — THE SHIPPED PRODUCT (issue #611). THREE
                 bundles under electron-vite: src/main/ (the window, the
                 inteligir:// protocol handler, the forked server, the first
                 run), src/preload/ (the bridge: only what main owns — the
                 loopback ws origin, the updater, the spell checker, the vault
                 switch, Reveal/Open of a vault entry, the diagnostics (data
                 folder, debug choice, restart, log) — and nothing that holds
                 a token; every frame crosses as `unknown` and is parsed on
                 both sides, the page mirroring each through one
                 `bridge-store.ts`; beside it the first-run window's own,
                 which carries the vault choice alone),
                 and src/renderer/ (the SPA: TanStack Router file routes over
                 @repo/api/local; `app/workspace.tsx` owns the note, the rail,
                 the palette and the panel; `app/note/` the guarded writes;
                 `app/palette/` the ⌘P pages; `app/sidebar/` the rail's
                 Recent | Files | Deleted views; `app/onboarding/` the agent
                 and account steps `/welcome` offers after a first run; and
                 `first-run/`, the page a launch with no vault opens, with no
                 router and no server).
                 The whole security surface is
                 the ORIGIN PIN (src/main/origin-pin.ts, pure + unit-tested):
                 one origin, top-level navigation away goes to the system
                 browser, window.open denied unconditionally, every
                 permission denied. utilityProcess forks
                 `inteligir serve` and, through main's fork broker, every node
                 child that server needs; a server already listening is
                 ADOPTED once it answers this instance's token at the bundled
                 version, and only a child the shell started is killed on quit.
                 A Mac without the developer tools, or whose git is older
                 than 2.45, runs the git the .app ships
                 (src/main/bundled-git.ts).
  cli/           inteligir — THE PUBLISHED BINARY, and THE SERVER (issues #553,
                 #611). `serve` is the whole local process — src/server/ owns
                 the vault, the knowledge index (its scan on a worker thread),
                 the agent runtime, the oRPC handler at /rpc, the /ws
                 invalidation bus and the db, built by the ONE composition root
                 (`compose.ts`); every other verb but `vault open` is a citty
                 leaf that is a CLIENT of a running one, with consola for the
                 human path (raw writes for anything verbatim — consola
                 rewrites `backtick` spans). Every leaf takes --json and is
                 EXECUTED by the fitness test against the refusal path, except
                 the rows in `EXCLUDED_COMMANDS`
                 (`apps/cli/src/__tests__/json-flag-enforcement.test.ts`), each
                 with its reason. src/server/ splits by domain (vault/,
                 knowledge/, agents/, threads/, comments/, cloud/ the sync
                 client). Every app-written file in the data
                 dir is a `json-file-store.ts` over `staged-write.ts`;
                 `config.json` is read at boot and never written by the app
                 except its `vaultDir`, the selector a switch rewrites
                 (`vault-switch.ts`). Discovery is ONE FILE:
                 `<dataDir>/server.json` carries the bound port and the bearer
                 together, so the address and the credential cannot disagree
                 and no port is scanned. The ACP runtime injects
                 INTELIGIR_DATA_DIR + a PATH carrying this bin dir into agent
                 shells, so a model drives the product by typing
                 `inteligir …` in bash. The build inlines every workspace
                 package (they export TS source) and stages as CONTENT the
                 migrations, the dialect skills, the vendored licence texts,
                 and the desktop renderer's bundle as dist/ui, which
                 `serve --open` answers over plain HTTP.
  web/           @repo/web — ONE Cloudflare Worker: the TanStack Start
                 marketing site, the auth pages, the @repo/ui gallery
                 (src/components/gallery: `pnpm dev:gallery`, a dev-only
                 page the Worker never ships), Better Auth on D1
                 (invite-gated sign-up), and the v3 cloud (issue #554):
                 device login (POST /v1/device/login mints the device
                 credential from email + password, POST /v1/device/sign-up
                 creates the account and mints it; /app/devices, and any
                 signed-in Mac's Settings › Account with its own device
                 credential, list and revoke), the per-user ThreadSyncDO
                 (merged thread log + capture inbox + dispatch inbox + ws
                 invalidation), and the hosted vault git remote
                 (issue #618): durable-git repo
                 cells behind src/worker/vault/git-remote.ts, one per user,
                 device-authed, which the Worker commits to itself through
                 the cell's own receive-pack
                 (src/worker/vault/commit-changes.ts) when a phone posts a
                 change set to /v1/vault/commit
                 (src/worker/vault/commit-route.ts).
                 src/worker/ is its own tsconfig program (no DOM —
                 workerd's globals must win).
  mobile/        @repo/mobile — the Expo RN client (#576): synced threads,
                 held in its SQLite file and read offline
                 (src/sync/sqlite-sync-store.ts), kept current over the
                 account's socket while the app is in the foreground, with a
                 running turn's streamed text folded in memory alone
                 (src/sync/live-turns.ts), that it
                 asks a Mac's agent in through the dispatch inbox, from a
                 durable queue of its own (src/dispatch/dispatch-runtime.ts),
                 produced captures and (#618) a local SQLite mirror of every
                 note's text (src/notes/vault-mirror.ts), kept current from
                 the hosted vault's /cloud read rows by blob oid and read
                 offline, each note opened in the desktop's editor: the
                 @repo/mobile-editor page the app bundle carries, in a
                 WebView whose bridge the phone answers over its store
                 (src/editor/editor-host.ts, editor-ports.ts), each note's
                 comment store in a sheet beside it that replies and
                 resolves, a new comment made on a selection in the page
                 (src/notes/comment-ops.ts), and a
                 durable outbox of the phone's own edits
                 (src/notes/vault-outbox.ts) sent through the guarded commit
                 route, its file verbs (create, rename, delete, photos)
                 planned in src/notes/file-ops.ts; reaches @repo/api/cloud,
                 @repo/domain, @repo/notes and
                 @repo/mobile-editor/bridge-protocol only.
  mobile-editor/ @repo/mobile-editor — the phone's editor: @repo/editor
                 under the touch profile, built by Vite as ONE classic
                 script (vite/classic-page.ts refuses anything else, since
                 WKWebView loads no module script from file://) that the
                 phone opens in a WebView. Every read, write and navigation
                 is a frame to the native screen over a typed, nonce-stamped
                 bridge (src/bridge/protocol.ts, exported as
                 ./bridge-protocol, the one thing the phone imports);
                 src/host/page-host.ts is the editor's host over it. Reaches
                 @repo/editor, @repo/notes and @repo/ui only.
packages/
  domain/        @repo/domain — zod-only leaf vocabulary (view context,
                 provider events, the thread-title rule), vendored-from-bb
                 shapes; every package may reach it, it reaches nothing.
  api/           @repo/api — ONE contract package, TWO entry points (#611).
                 `./local/*` is the oRPC contract the renderer and the CLI
                 compile against and `inteligir serve` implements: ONE folder
                 per domain, each a `<domain>-contract.ts` +
                 `<domain>-schema.ts`, plus the ws notification protocol, the
                 paths that are NOT procedures, and `build-thread-timeline`,
                 the pure fold the delta algebra beside it diffs. `./cloud/*`
                 is the cloud wire, the ONE page planner every reader of the
                 merged log runs (`cloud/sync/plan-page`) — two copies would be
                 two answers to "did this row move the cursor?", and a mis-set
                 cursor is a duplicated conversation — and, for the same
                 reason, the CLIENT RUNTIME CORE both consumers run. apps/web
                 SERVES every row; apps/mobile pulls threads, produces
                 captures and dispatches, and commits vault change sets from
                 a queue it settles itself, and never pushes a thread event,
                 claims a capture or a dispatch or speaks git, because the
                 desktop runs the turns and owns applying a capture to the
                 vault. Two entries rather than one router because their
                 compatibility obligations are OPPOSITE: /local's ends ship in
                 one bundle and may break freely (a CLI installed apart refuses
                 another release's server as `SERVER_VERSION_MISMATCH`),
                 /cloud is a deployed Worker answering installs that may be
                 months stale and may never break. A dep-dag table
                 (`CLOUD_ONLY_CLIENTS`) pins apps/web and apps/mobile to /cloud
                 alone, and a dep-dag row refuses a third bucket in src/, since
                 the cloud-never-reaches-local guard populates itself from
                 src/cloud. /cloud stays zod + REST paths (NOT oRPC, diverging
                 from #611 phase 6 deliberately): oRPC addresses procedures by
                 router position, so moving the deployed wire to it would break
                 exactly the stale installs /cloud may never break.
  db/            @repo/db — drizzle + better-sqlite3 (WAL, sync=NORMAL),
                 committed SQL migrations applied on boot, the DbNotifier
                 seam, prefixed-nanoid ids.
  notes/         @repo/notes — PURE platform-neutral domain: the knowledge
                 engine (link graph, FTS5 search over an injected SqlDriver,
                 the literal text scan behind matches and unlinked mentions,
                 the resolver's problems report, tags and tag families,
                 the rename and tag-rename byte-surgery) over ONE markdown scan
                 (scan-parse + wiki-links), frontmatter (the pin and id line
                 cuts included), `templates/` (the three placeholders and the
                 convention folders), the dialect's own modules
                 (markdown/remark-*, comments/, formulas/),
                 `text/` — ONE Myers diff under diff3 — and `sync/`, the one
                 verdict a path two writers changed gets and the conflict
                 copy's name and words. No node/react/ui
                 imports — lint-enforced. `markdown/mdast-nodes.ts` is the
                 mdast NARROWING boundary: a walk asks it what a node is
                 rather than discriminating structurally at each visit.
  editor/        @repo/editor — the Plate.js WYSIWYG (resurrected, #580):
                 kits/nodes for every dialect construct, the md-rules table,
                 the fixpoint serializer + fixture matrix, the open-note
                 runtime (vault-session/note-runtime/open-note-store) the app
                 drives through three seams, `VaultSessionPorts`
                 (note/vault-session.ts), the `GuardedVaultPort` its one write
                 policy runs over (guarded-vault-io.ts) and the `EditorHostIo`
                 singleton (host-io.ts, opened to React by host.ts; the link
                 resolver store and note formulas it carries live here too, so
                 no host writes its own), plus the note-level verbs the shell
                 reaches by path and the action registry a deep node asks the
                 shell through (`agent-request`; the comment surface keeps its
                 own, `CommentActions`).
                 `node-props.ts` is the SLATE DECODE BOUNDARY: a node's dialect
                 fields ride `TElement`'s open index signature, so every read
                 arrives as `unknown` and this is the one place it becomes a
                 domain value, which is why no walk narrows structurally.
  agent-runtime/ @repo/agent-runtime — the ACP runtime (#588): one adapter
                 speaks the Agent Client Protocol (@agentclientprotocol/sdk)
                 to claude-agent-acp and codex-acp children; harnesses are
                 data rows; the provider-event vocabulary is the one internal
                 grammar, exactly what the ACP mapper emits.
  agent-skills/  @repo/agent-skills — product skill files: the
                 dialect's first-party spec, served to agents as files.
  ui/            @repo/ui — the shared component vocabulary on Base UI:
                 shadcn in components/, the Fluid Functionalism sidebar and
                 system helpers beside it, and the Beautiful UI surfaces in
                 ai/, all vendored and now this repo's own (see VENDORED CODE).
                 A LIBRARY AHEAD OF ITS CONSUMERS: `src/ai` holds fifteen
                 components no surface draws on yet, kept by owner decision
                 and listed one by one in `AWAITING_CONSUMER`
                 (`tools/repo-guards/src/ui-package.ts`), which the PER-EXPORT
                 orphan guard (`tools/repo-guards/src/ui-orphan-exports.test.ts`)
                 reads, so a sixteenth still fails. Leaf.
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
and a macOS job runs `test` where the app ships and `pnpm smoke:desktop` on an
unsigned pack, so a green `verify` is not a green CI — run `pnpm e2e` too
before claiming one. `tools/repo-guards/src/ci-verify-parity.test.ts` keeps
that "plus a few more" an honest claim: every step on top of `verify` is a row
in `DECLARED_CI_EXTRAS` with its reason.

**A change a user can notice updates `CHANGELOG.md` in the same task**: a line
under `## Unreleased`, in the user's words rather than a commit subject, and a
behaviour that changed or went away says what to do about it. The line is
written for someone who takes notes, not someone who reads code; a change to
the command line goes under `### On the command line` in that section, the one
place the CLI's own words stay. A release's notes are that section (THE
RELEASE NOTES ARE THE CHANGELOG, below).

**There is no seeded login, and sign-up is invite-only.** `AGENTS.md` has the
recipe. Never run `db:push:remote` or `db:studio:remote`: both hit production
D1. The bare `db:push` and `db:studio` are the local ones.

`apps/web/README.md` is the product Worker's own guide — routes, auth, the
local loop and the owner-only deploy. `AGENTS.md` is the runnable quickstart;
`CONTEXT.md` glosses the carried domain vocabulary.

## Decisions

Each bullet is the decision, what it rejected and why, and the file that
carries the mechanism. The mechanism itself is the code's and its tests' to
state; a bullet names where it lives. The dangling-reference guard keeps the
pointers honest.

The list is grouped by the part of the system a decision governs; append a new bullet
to the END of its group.

- [Editor and dialect](#editor-and-dialect)
- [Vault: writes, git and containment](#vault-writes-git-and-containment)
- [Knowledge: index, search and links](#knowledge-index-search-and-links)
- [Agents and threads](#agents-and-threads)
- [Dictation](#dictation)
- [Cloud, sync and accounts](#cloud-sync-and-accounts)
- [Server process and the desktop shell](#server-process-and-the-desktop-shell)
- [Desktop workspace surfaces](#desktop-workspace-surfaces)
- [Repo guards, vendoring and tooling](#repo-guards-vendoring-and-tooling)

### Editor and dialect

- **THE EDITOR IS A WYSIWYG OVER A BYTE-DISCIPLINED SERIALIZER** (epic #579,
  reversing #542's editor line by owner decision; do not "fix" it back). Plate.js
  over one owned parse, one rule table and a bounded fixpoint. Byte stability is
  a contract defended by tests, not a property of the data model: canonical
  files round-trip byte-exact, churn-class constructs may canonicalize on the
  first save (stated per fixture), and a file the pipeline cannot round-trip
  opens raw. The fixtures are formatter-exempt because their bytes are the
  assertion. `packages/editor/README.md` § Invariants and
  `packages/editor/src/markdown/markdown-doc.ts`.

- **THE EDITOR SHIPS ITS BEHAVIOUR CSS, AND THE APPEARANCE DIALS ARE ONE
  DECLARATION.** `packages/editor/src/styles.css` carries the toggle collapse,
  the callout marker swap, the code theme and the prose scope (`.typeset-docs`),
  and reaches each host through its `globals.css` import: the desktop's and the
  phone editor page's (`apps/mobile-editor/src/styles/globals.css`). Every hook
  is spelled once in `packages/editor/src/style-hooks.ts` and pinned both ways
  by `packages/editor/src/__tests__/style-hooks.test.ts`, which also holds each
  host to the import, because a missing sheet fails no other test. The
  appearance tokens are declared once in
  `apps/desktop/src/renderer/styles/globals.css` and read, with no fallback, by
  `.typeset-docs`. The phone page imports the sheet and not those defaults, so
  it writes its own value for every token the sheet reads, one each and no
  dials, `--editor-size` at 16px or more because iOS zooms into smaller text;
  `tools/repo-guards/src/appearance-tokens.test.ts` counts those writes. No
  accent axis: nothing in Plate consumes a hue.

- **NOTES SPEAK THE INTELIGIR DIALECT**: `[[Title]]` / `[[Title#H]]` /
  `[[Title|alias]]` / `[[Title|uuid]]` wiki links (the last pipe starts the
  alias), `{{source|display|meta}}` formula pills, `%%i:id:start/end%%` comment
  anchors, GitHub alerts (`> [!NOTE]` through `> [!CAUTION]`) as THE callout,
  and `inteligir-chart` / `inteligir-canvas` / `inteligir-html` / `:::tabs`
  blocks, all valid markdown, all round-tripping. The `inteligir-callout` fence
  is READ-COMPAT (`COMPAT_CALLOUT_LANG`): rendered and round-tripped byte-exact
  for the notes that hold one, never inserted, taught or seeded, which
  `tools/repo-guards/src/agent-skills.test.ts` holds for the skills and
  `apps/cli/seed/`. Migrating it to an alert on save is rejected: it carries
  kinds the five-variant alert grammar cannot spell (info, error, a priority
  with its level), and the rewrite would make a canonical construct churn.
  Every spelling lives in one place (`@repo/notes/markdown/fence-langs`,
  `@repo/editor/nodes/canvas-header`, each node's Slate type in
  `@repo/editor/dialect-node-keys`) because the rule table and the knowledge
  scan both read it. Plain nested `.md`: no bundles, no meta.json. FRONTMATTER
  IS THE ONLY PROPERTY STORE: no metadata table, a note's UUID is its `id:`, and
  YAML the typing rules cannot represent is preserved byte-exactly. `{{` is
  reserved from MDX expressions by a tokenizer guard on both braces.

- **AN ICON BESIDE A LABEL IS A SIBLING OF THE LABEL, NEVER INSIDE IT.**
  `Button` trims its text with `text-box`, which only a block container
  honours, so an inline svg inside the label's span is pushed above it.
  `labelChildren` (`packages/ui/src/components/button.tsx`) lifts every element
  child out beside the trimmed text, however the icon was passed; "which
  children are text" is spelled once, in `@repo/ui/lib/text-children`.

- **EVERY FLOATING SURFACE IS A BASE UI PRIMITIVE THROUGH `@repo/ui`, never a
  hand-positioned div**, which owns no dismissal, flipping, layering or focus
  and drifts on scroll. A selection-anchored surface hands the Positioner a
  virtual anchor (`comments/comment-kit.tsx`, `block-menu.tsx`). Base UI is
  reached only through `@repo/ui` (the one exception is `inline-combobox.tsx`),
  and a missing primitive is added there first, with a gallery demo. The find
  bar hangs under the top bar's Find button through `setFindBarAnchor`
  (`packages/editor/src/find-bar.tsx`), since the editor never reaches the
  shell; the wiki-link preview is the HoverCard, because Popover has no hover
  mode (`packages/editor/src/wiki-chip.tsx`). The ⌘K composer is a non-modal
  `Dialog` mounted in the note column, and its `finalFocus` returns focus
  through the editor rather than the DOM
  (`apps/desktop/src/renderer/app/actions/action-composer.tsx` says why). The
  selection toolbar (`packages/editor/src/selection-toolbar.tsx`) is the one
  exception: it has no open/dismiss lifecycle, so a Popover would still need
  its selection-driven `open` and its `frozen` hold.

- **THE EDITOR COLUMN SHOWS ONE NOTE.** No second pane and no pane vocabulary:
  one `OpenNoteStore`, and every surface reads the open note. Registries keyed
  on a note's path keep that key so a late answer cannot land on the note that
  replaced it. There is no raw/rich toggle: the surface derives from
  `packages/editor/src/note/markdown-gate.ts` alone.

- **THE CHROME HAS FIVE TYPE ROLES, AND THEY ARE FLUID'S LADDER.** caption 11,
  body 12, subtitle 13, title 15, display 24 — the compact column of
  `typeScale` (`packages/ui/src/lib/size-context.tsx`), drawn as the
  `text-caption | body | subtitle | title | display` utilities in
  `packages/ui/src/styles/globals.css`, whose numbers
  `lib/__tests__/type-scale.test.ts` derives from the map. THE MERGE ENGINE HAS
  TO BE TOLD THEY ARE SIZES: any unknown value after `text-` reads as a colour,
  so `cn("text-body", "text-muted-foreground")` drops the size. `cn` is
  configured once (`packages/ui/src/lib/cn.ts`) and imported from there by
  every file, reversing the drop-the-pass-through cleanup: a second,
  unconfigured `cn` would be the bug again. No `text-sm`, `text-xs` or px/rem
  literal in the chrome, because a role says what a line IS;
  `tools/repo-guards/src/type-roles.test.ts` holds that, since a scale held by
  convention drifts, and sweeps `packages/ui/src/ai` too, skipping files held
  in `AWAITING_CONSUMER` (owner decision). THE NOTE IS NOT CHROME: its prose
  keeps the appearance dials and sizes in em, the title as a multiple of
  `--editor-size` (`packages/editor/src/editor-column.tsx`), and a fixed size
  that is part of the note is a reasoned `PROSE_SIZES` row in that guard.

- **THE PLATE SLASH MENU IS THE INSERTION SURFACE, AND THE TOUCH TOOLBAR IS
  ITS SOFT-KEYBOARD TWIN.** Slash items are grouped
  data (`GROUPS` in `packages/editor/src/slash-menu.tsx`), and every row's
  markdown must re-parse to a modeled construct and be its own fixpoint
  (`packages/editor/src/__tests__/slash-rows.test.ts`, which excepts no row),
  and no two rows may write the same bytes: a second name for one construct is
  a keyword on its row, not a row (`/day` finds Date).
  A soft keyboard has no chord and a finger no hover, so the touch kit adds a
  keyboard toolbar (`packages/editor/src/touch-toolbar.tsx`) whose buttons are
  rows of the tables the desktop reads: the headings, lists, to-do and quote
  are `GROUPS` rows run as the slash menu runs them, the marks are
  `MARK_SHORTCUTS`, inline code is `EDITOR_SHORTCUTS`' row through
  `runEditorShortcut`, Comment is `COMMENT_SHORTCUTS`' row, and indent is what
  Tab runs; only what no table holds is
  `TOUCH_ACTIONS` (`packages/editor/src/__tests__/touch-toolbar.test.tsx`
  refuses a button named by anything else). A locked editor's slash menu
  offers no `richBlock` row, a block it could never fill.
  An empty inline equation writes no bytes, by owner decision: markdown has no
  empty inline math (`packages/editor/src/markdown/md-rules.ts`). Legacy
  `<!-- inteligir:thread anc_… -->` markers parse as opaque comments and are
  preserved; nothing writes new ones.

- **TEMPLATES ARE A FOLDER, AND PLACEHOLDERS EXPAND ON BYTES BEFORE ANY PARSER.**
  A template is a doc under `templates/` (a fixed convention like the daily
  folder, no setting); `templates/Daily.md` shapes the daily note. Exactly three
  placeholders, `{{date}}`, `{{time}}`, `{{title}}`, replaced textually on the
  raw markdown, so the formula grammar never sees them and every other `{{…}}`
  is a pill left byte-exact. A note minted from a template drops the template's
  `id:`, because two notes with one id make the uuid link tier ambiguous.
  `@repo/notes/templates/placeholders`, `packages/editor/src/insert-template.ts`.

- **A BINDING IS SPELLED FROM THE TABLE ITS LISTENER READS, never as a
  literal.** Five tables own every chord and each handler walks its own:
  `GLOBAL_SHORTCUTS` (`apps/desktop/src/renderer/app/global-shortcuts.ts`),
  `MARK_SHORTCUTS` (`packages/editor/src/mark-shortcuts.ts`, which builds
  Plate's `shortcuts` config, so Plate's defaults never run), `EDITOR_SHORTCUTS`
  (`packages/editor/src/editor-shortcuts.ts`), `FIND_BAR_SHORTCUTS`
  (`packages/editor/src/find-bar.tsx`) and `COMMENT_SHORTCUTS`
  (`packages/editor/src/comments/comment-kit.tsx`). Every label is derived from
  those rows through `@repo/ui/lib/hotkey-spelling`, so a rebinding leaves no
  stale label. `shortcut-tables.test.ts` refuses a chord two tables share,
  because a key both claim runs both. A row claims shift explicitly, so an
  unshifted row never fires on a shifted chord; ⌘⇧O is the one shifted row. The
  rail's `[` and the panel's `]` are BARE rows, answering only with focus
  outside a field, since a bare key is a character wherever text is typed.

- **A PIN IS THE FRONTMATTER KEY `pinned: true`, AND ITS EDIT IS A LINE CUT.**
  Pinning travels with the file, so every device and the agent agree; a pinned
  note tops the recents with no Pinned heading, which would cost more height
  than it explains. `pinnedFrontmatterYaml` (`@repo/notes/markdown/frontmatter`)
  cuts or appends the key's own lines rather than re-serializing through
  `serializeProperties`, which restyles every flow list; unpinning removes the
  key, never writes `false`. The open note takes the edit through the live
  editor, so the autosave carries it; any other note is a guarded write whose
  mismatch is reported, never merged
  (`apps/desktop/src/renderer/app/note/pin-note.ts`). The pinned set is the
  index's (`usePinnedPaths`), so a pin shows after the sweep.

- **GO TO HEADING IS THE PALETTE OVER THE TOC'S WALK, AND AN EXTRACT IS ONE
  HISTORY BATCH.** ⌘⇧O opens the palette on the open note's outline and lands
  through the TOC's own `goToHeading` (`packages/editor/src/toc.tsx`). The
  outline is walked once, by whatever opens the page, and rides the page
  (`PaletteEntry` in `apps/desktop/src/renderer/app/palette/command-palette.tsx`),
  never walked in render: the workspace sits outside the Plate provider and
  cannot subscribe to the document, so a render-time read is one nothing
  refreshes. "Extract
  to new note" (`packages/editor/src/extract-note.ts`) serializes the blocks
  through the editor's own `serializeNote` and creates the note through the
  exclusive `createNewFileAt` before touching the buffer, because
  create-or-reuse would count an existing file as success and the blocks would
  leave for a note that never received them. Blocks anchoring a comment are
  refused: the thread would stay behind. The removal and the `[[link]]` land in
  one flush, so one undo restores both; the created file stays, because the
  vault has no transaction and a note that exists is truer than an edit that
  never happened.

- **A FORMULA RECOMPUTE IS NOT AN EDIT, AND A BOUND REF'S NOTE IS FOUND BY
  ID.** `@(name#note-id#pill-id)` names its note by frontmatter `id`, which the
  index's wiki-targets rows carry, so a host reads only that note
  (`packages/editor/src/note-formulas.ts`); reading every doc to
  find one id is rejected, since a recompute runs after each typing pause. The
  walk follows refs up to 64 deep (`@repo/notes/formulas/resolve-graph`). The
  display a recompute rewrites lands outside the undo history: the user never
  typed it, and one undo must reach their own last edit
  (`packages/editor/src/formulas/formula-recompute.ts`). The id has one reader,
  `noteIdOfProperties` in `@repo/notes/markdown/frontmatter`.

- **A BLOCK OVERLAY NAMES ITS BLOCK BY NODE ID AND SUBSCRIBES TO THE
  DOCUMENT.** The heading fold and the drag handle wrap each top-level block
  through `aboveNodes`, whose `path` goes stale after an insert above, since
  Plate re-renders a block only when its own node changes. So each keys a block
  by its NodeIdPlugin id (`blockId` in `packages/editor/src/node-props.ts`) and
  reads the document through `useEditorSelector` with an equality that moves
  only when what it draws does. Plate turns the plugin off under
  NODE_ENV=test, so such a suite mounts the harness with `nodeIds`.
  `packages/editor/src/heading-collapse.tsx`,
  `packages/editor/src/block-draggable.tsx`.

- **AN EMBED IS ONE LEVEL OF STATIC RENDER, AND EVERY VOID HAS A STATIC ROW.**
  An embed inside an embed stays a chip, the nesting stop, so the only cycle
  left to refuse is a note embedding itself
  (`packages/editor/src/transclusion-guard.ts`). PlateStatic's default element
  draws a void empty or throws, so `STATIC_COMPONENTS`
  (`packages/editor/src/transclusion.tsx`) holds a row for every void, pinned
  by `packages/editor/src/__tests__/transclusion-static.test.ts`.

- **A SAVE KEEPS EVERY LINE BREAK, AND ONE THAT WOULD JOIN TWO LINES OPENS
  RAW.** Plate's default text rule drops a leading `"\n"`, a soft break after
  any inline node, so the rule table keeps it
  (`packages/editor/src/markdown/md-rules.ts`). A paragraph's soft break saves
  as a hard break, since the editor's model holds both as one `"\n"`. The hard
  break is `\`, except after a bare url, which would read it back as its own
  (`@repo/notes/markdown/md-plugins`), and a bare url is an opaque inline,
  never `html`, which would turn the break before it into a space. The gate
  backs it: a save may split a line but never join two (`keepsText` in
  `packages/editor/src/markdown/markdown-doc.ts`).

- **COMMENT MARKERS PAIR ACROSS THE DOCUMENT, AND THE TINT IS ONE ROOT
  DECORATION.** A block comment is a marker line above a fence and another
  below it, so markers pair in document order over the whole note
  (`commentSpans` in `packages/editor/src/comments/comment-ranges.ts`). Pairing
  per block, which draws a two-paragraph comment as two orphans, is rejected,
  and so is refusing a selection that crosses blocks. The ranges are returned
  for the root alone, because Slate re-renders a block whose share of a root
  range moved, where a per-text decoration leaves an untouched middle block
  with a stale tint. `packages/editor/src/__tests__/comment-decorate.test.tsx`.

- **A POPUP'S MOTION RIDES ITS POPUP ELEMENT, AND REDUCED MOTION IS ONE
  POLICY.** Base UI unmounts a closing popup once the Popup element's own
  animations finish, so a framer popup renders its Popup as the motion element,
  with no `actionsRef` hold or fallback timer, each exit wrapped in `PopupExit`
  (`packages/ui/src/lib/popup-exit.tsx`). Reduced motion is `MotionPolicy`
  (`packages/ui/src/lib/motion-policy.tsx`) at each app root, and tw-animate's
  classes collapse to 1ms in `packages/ui/src/styles/globals.css`, so no class
  carries a `motion-reduce:` suffix.

- **TYPING IN A LONG NOTE WALKS IT ONLY THROUGH A RECORDED BUDGET, AND THE
  BUDGET FINDS ITS PASSES.** In a 10k-line note a keystroke, a caret move and
  the settle after typing may each walk the whole note only through the passes
  their rows name, each row with its reason; a keystroke's time is held to how
  it grows with the note and the settle's to the parse of the same note, ratios
  so a slow runner cannot fail them. A pass is found, never declared: a block
  near the note's end records the stack of every read of it, so a new pass fails
  named by the function that ran it, where instrumenting the known passes would
  miss the one nobody instrumented. A pass a keystroke cannot afford caches by
  top-level block, since an edit replaces the blocks it touched and keeps every
  other by identity (`packages/editor/src/toc.tsx`,
  `packages/editor/src/note-stats.ts`,
  `packages/editor/src/comments/comment-ranges.ts`, the save's prune in
  `packages/editor/src/markdown/md-rules.ts`).
  `packages/editor/src/__tests__/typing-budget.test.tsx`.

- **EVERY SAVE SERIALIZES THROUGH `serializeNote`.** The live save, an extract
  and the gate call it (`packages/editor/src/markdown/markdown-doc.ts`), since
  the rule table expects its pre-pass over the whole value, `pruneForMarkdown`
  (`packages/editor/src/markdown/md-rules.ts`): Slate's padding beside an
  inline element and an empty inline equation leave every block before a run
  is converted. A paragraph rule's prune was rejected, because a heading or a
  list item then saved `**a****b**`; Plate's own `serializeMd` skips the
  pre-pass and writes a ZWSP beside every chip.

- **THE PHONE RUNS THE DESKTOP'S EDITOR THROUGH A TOUCH KIT, AND ITS RICH
  BLOCKS ARE READ-ONLY IN THE MODEL** (0.6 direction: the phone is a full
  editor). A host sets `EditorProfileProvider`
  (`packages/editor/src/editor-profile.tsx`); `touch` mounts
  `TOUCH_EDITOR_KIT`, which is `CONTENT_KIT`, the lock and the touch chrome,
  COMPOSED rather than the desktop kit minus its pointer chrome, so a pointer
  surface added to the desktop stays off the phone until someone names it
  there (`packages/editor/src/kits/touch-editor-kit.ts`,
  `packages/editor/src/__tests__/touch-kit.test.ts`). A chart, a canvas, an
  html block, tabs and columns are read-only there by owner decision: the lock
  is an `apply` override refusing every op inside one, and a payload's
  `set_node` on the void itself, while a whole-block insert, remove or move
  passes, so a re-seed lands and a deleted block comes back with one undo; a
  refused op never reaches history
  (`packages/editor/src/kits/rich-block-lock-kit.ts`). Hiding the edit buttons
  alone was rejected: a paste, a key or a transform from elsewhere would still
  reach the block, so the renderers hide them (`useRichBlocksLocked`) and the
  model refuses what arrives anyway. A keystroke aimed inside a locked block is
  refused at `beforeinput` too, before slate-react takes it: a tap leaves the
  caret in the block's text, outside the editable, and slate-react defers a
  plain character's insert to an input event the browser never fires there, so
  the model guard alone let that character land wherever the user typed next.
  An html block's Run needs the host's frame, and a host with none
  (`htmlFrameUrl: null`) draws no Run.
  `packages/editor/src/__tests__/rich-block-lock.test.tsx`.

- **THE PHONE'S EDITOR IS A VITE PAGE IN A WEBVIEW: ONE CLASSIC SCRIPT BEHIND A
  TYPED, NONCE-STAMPED BRIDGE** (0.6 direction: the phone is a full editor).
  `@repo/mobile` is React Native under Metro and TypeScript 6; the editor is
  DOM React under Vite, the React Compiler and TypeScript 7. Expo DOM
  components were rejected: they compile the editor a second way and typecheck
  it under the phone's TypeScript. WKWebView loads no module script, and no
  `crossorigin` tag, from `file://` (vitejs/vite#14483), so the build is one
  IIFE with every dynamic import inlined and fails on anything else
  (`apps/mobile-editor/vite/classic-page.ts`). The page shows one note for its
  life; opening another writes it and asks the native stack, which keeps the
  back gesture. Native reaches the page only by injecting a call to a door
  installed non-writable on `window`, never a message event a child frame's
  `parent.postMessage` could forge, and every frame after `init` carries its
  nonce (`apps/mobile-editor/src/bridge/page-bridge.ts`). The wire breaks
  freely, since both ends ship in one binary
  (`apps/mobile-editor/src/bridge/protocol.ts`), and the page's host is the
  editor's own write policy over it (`apps/mobile-editor/src/host/page-host.ts`).
  `tools/e2e/src/scenarios/phone-editor-page.ts` loads the built page from
  `file://` against a scripted phone.

- **THE PHONE CARRIES ITS EDITOR PAGE IN THE BINARY, AND ITS WEBVIEW LOADS
  NOTHING BUT THE PAGE** (0.6 direction: the phone is a full editor,
  reversing #542's read-only phone and the React Native renderer of the
  dialect it drew with, a second renderer that could not edit and degraded
  every construct it did not model). The note screen opens the built page
  from the app bundle, so a note opens offline from `file://`: a config
  plugin adds the build as a folder reference, and since Xcode copies a
  folder under its name on disk, `ios/` links the bundle's name to it
  (`apps/mobile/plugins/with-editor-page.js`). The page ships inside the
  binary, so its build joins the native fingerprint
  (`apps/mobile/fingerprint.config.js`): an EAS Update bundled beside another
  page matches no install, since the bridge breaks freely between releases.
  The native end is one policy (`apps/mobile/src/editor/editor-host.ts`): a
  frame counts only from the page's own document and under the nonce its load
  was given, so a child frame's message or an earlier load's is dropped; the
  WebView loads the page and the child frames the page itself makes, hands a
  followed web link to Safari and refuses everything else, and its origin list
  admits every address, because the library hands whatever that list refuses
  to the OS itself, before the policy runs. The page's store is the phone's
  (`apps/mobile/src/editor/editor-ports.ts`): a write's base is compared with
  the text the phone holds, so a change a sync landed since the page read
  comes back for the page's own merge, and its file verbs are the list's.
  Leaving the note, the back gesture and the app going inactive each flush the
  page within a bound; a page two screens down is released after its flush
  and loads again on return, and a content process iOS killed reloads.
  `apps/mobile/src/editor/__tests__/`.

### Vault: writes, git and containment

- **THE AUTO-COMMIT IS SESSION-SHAPED (15s quiet / 60s max) AND STAGES WHAT THE
  WINDOW'S WRITERS NAMED**, so the log is answerable: a single-file commit names
  its file and a fifteen-second pause ends an editing session. A scheduler that
  names no paths (the boot sweep, the post-sync drain), a window past
  `MAX_SCOPED_COMMIT_PATHS` or the flush after a failed one is unscoped; a
  change nobody announced waits for one. A turn's start is one too, less every
  path a live turn has claimed (`checkpointUnclaimed`): it stages the whole
  tree and takes the claims back out, because `--literal-pathspecs` rules out
  an `:(exclude)` and naming every other path is the argv a first commit
  overflows. Unscoped `add -A` survives for a large vault's first commit, where
  a pathspec would exceed ARG_MAX. `apps/cli/src/server/vault/git-engine.ts`
  says why the max wait is the sync interval.

- **NOTE HISTORY IS LOCAL, AND A RESTORE IS A WRITE.** History reads the
  vault's own git repo, so it works offline. A restore writes the revision's
  bytes through the ordinary guarded write, never `git checkout` or
  `git revert`, which would bypass the CAS, the re-index, the `/ws`
  notification and the open buffer's convergence; there is no `vault.restore`
  procedure, since a second server write path is a second CAS. A CAS refusal is
  reported, not diff3-merged, because the user named exact bytes
  (`apps/cli/src/server/vault/git-history.ts`,
  `apps/desktop/src/renderer/app/actions/history-tab.tsx`, `vault restore` in
  `apps/cli/src/commands/vault.ts`). A deleted note comes back the same way,
  from the log's deletions plus the worktree's uncommitted ones. There is no
  trash folder and no purge.

- **A write carries the base it was computed from, and NAMES ITS GUARD.**
  `vault.write`'s `guard` is a required union
  (`packages/api/src/local/vault/vault-schema.ts`): `expected` carries the hash
  the write was computed from, `absent` is a create, `overwrite` is
  last-writer-wins spelled out. One required field rather than two optional
  ones: an omitted field would make last-writer-wins the silent default, and
  two optionals let a hash and a create travel together. `expected` is compared
  under the repo lock (`apps/cli/src/server/vault/vault-router.ts`); a mismatch
  answers 409 with the current content and the client diff3-merges and
  retries, rather than active-user-wins, which discards concurrent body edits
  wholesale. A write ANSWERS THE BYTES THAT LANDED and the open buffer rebases
  onto them, because a buffer kept over a merged base passes the next CAS
  without the external edit. Every error a vault row declares has a producer
  (`apps/cli/src/server/vault/__tests__/vault-contract-errors.test.ts`), since
  a code no handler raises is a client branch that never runs. The diff3-on-409
  policy is the editor's, run by every host over its own `GuardedVaultPort`,
  because two write policies are two answers to what a stale save does; a
  host's adapter only turns the base into its store's CAS token (the desktop's
  hashes it, `apps/desktop/src/renderer/app/note/guarded-vault-io.ts`).
  `packages/editor/src/guarded-vault-io.ts`,
  `packages/editor/src/vault-editor.ts` and `@repo/notes/text/diff3`.

- **A CREATE IS NOT A WRITE WITH AN EMPTY BASE.** Creation sends the `absent`
  guard, which carries no hash; hashing bytes not yet on disk is a refusal
  every time. A guarded write with no recorded base throws rather than
  inferring one, because an inferred base lets a concurrent edit win silently.
  A path already taken answers `exists`, a `CreateOutcome` rather than a throw,
  and that answer is the one existence check: create-or-reuse (`createFileAt`)
  answers the existing file's path, and an exclusive create (`createNewFileAt`)
  hands it back for the caller to step past
  (`packages/editor/src/note/vault-session.ts`). The policy is
  `packages/editor/src/guarded-vault-io.ts`.

- **Containment is PHYSICAL, not lexical.** The vault realpaths the deepest
  existing ancestor and refuses symlinked leaves; a lexical check passes a
  `notes.md` that is a symlink to a private key, and a `git pull` from a hostile
  remote can plant one (`apps/cli/src/server/vault/vault-service.ts` over
  `path-containment.ts`). The vault dir and the data dir must be disjoint,
  refused at boot: a data dir inside the vault gets committed and pushed.

- **`runGit` PREPENDS `--literal-pathspecs` AND `core.hooksPath=/dev/null` TO
  EVERY INVOCATION.** A pathspec is a glob, so `[a].md` names `a.md` too and a
  commit scoped to one note would stage its neighbour. A user's hook can
  refuse, stall or rewrite an engine commit, rebase or push, and `--no-verify`
  reaches only pre-commit and commit-msg. Residual: a git-lfs vault's upload
  is a pre-push hook too, so it does not run. The one argv builder is
  `apps/cli/src/server/vault/git-run.ts`.

- **A MOVE IS A RENAME THAT KEEPS THE NAME, and `planMove` is its one verdict.**
  The tree's drop and the palette's "Move note to folder…" both ask `planMove`
  (`apps/desktop/src/renderer/app/sidebar/tree-ops.ts`), so both refuse for the
  same reasons. The drag's source is component state, not `dataTransfer`, so a
  file dragged in from the desktop is ignored. No second write path: the move
  rides `vault.rename`, which rewrites links for a folder as for a note
  (`apps/cli/src/server/knowledge/rename.ts`), and the vault session carries
  the open note through it (`packages/editor/src/note/vault-session.ts`). The
  rename's pure half (the moves, the old stem a renamed note keeps as an alias,
  the writes) is `@repo/notes/knowledge/plan-rename`, which the phone plans its
  renames with too; only the guards are each caller's.

- **WHERE A PASTE LANDS IS A STORED VAULT CHOICE, and the host resolves it, not
  the editor.** `<dataDir>/vault-prefs.json` holds `attachments` (the root,
  beside the note, or one folder, default `assets/`), read per paste so a
  Settings or CLI change reaches the next one; the editor hands the host a base
  name and the host answers the folder through `attachmentDir`
  (`@repo/api/local/vault/attachment-location`). `setPrefs` refuses only a path
  that is a file, which would refuse every paste. The bytes ride as a
  multipart Blob rather than base64 inside the json.
  `apps/cli/src/server/vault/vault-prefs-store.ts`. The file's name is
  `freeAssetPath` (`@repo/notes/knowledge/asset-name`), which the phone's
  photos run too; `vault-prefs.json` never reaches the phone, so they land in
  the default folder, spelled once as `DEFAULT_ATTACHMENTS_FOLDER` in
  `@repo/notes/templates/placeholders`.

- **THE OS SEES A VAULT ENTRY THROUGH MAIN ALONE, and main checks physically.**
  Reveal in Finder and Open with default app send main a vault-relative path;
  main parses it with the vault grammar, joins it under the current vault,
  realpaths both sides and asks `pathContains`
  (`inteligir/server/path-containment`), so a `..`, an absolute path or a
  planted symlink reaches no `shell.*` call
  (`apps/desktop/src/main/vault-entry.ts`). A browser tab has no bridge and
  draws no row; Copy path needs no main, since the listing carries the root.

- **A SECOND VAULT GETS ITS OWN DATA DIR, AND A SWITCH IS A NEW CHILD, A NEW
  SESSION AND A NEW WINDOW.** The default vault keeps the root data dir; any
  other lives in `<root>/vaults/<sha256(path)[:16]>/`, derived once in
  `config.ts`, and the root's `config.json` is the selector the shell and
  `inteligir serve` both read. A folder is ONE vault however it is spelled: a
  selection stores its physical spelling (`physicalVaultDir`, the native
  realpath) unless the given spelling alone already keys a data dir
  (`resolveVaultCandidate`), and "already open" and "is the default" compare
  physically, so a symlinked spelling never mints a signed-out twin; the hash
  stays over the stored spelling, since re-deriving it would move every
  selector written.
  Cost accepted: the credential and the agent default live in the data dir, so
  a second vault starts signed out, which also keeps it off the account's
  hosted remote; connectors belong to the agent, so every vault shares them.
  The shell switches only a child it started, puts the previous vault back on
  any failure, and opens a new window, since a
  `BrowserWindow`'s session is fixed at creation. A rollback that cannot write
  the selector back quits rather than run beside a `config.json` naming the
  vault that failed, which the next launch would open (`runVaultSwitch`).
  A first run writes the selector before the first child exists, unless it
  chose the default vault, and a failed first boot removes it again
  (`writeManagedVaultDir(root, null)`), so the next launch asks rather than
  opening the folder that failed (FIRST RUN IS DECIDED IN MAIN, in the Server
  group). The folder is picked in main, so the page never names a path it was
  not handed, and a picked switch to a folder another service syncs asks first,
  in the first run's words. `inteligir vault open <dir>` runs the same plan
  (`apps/cli/src/server/vault-switch.ts`) and restarts nothing.
  `apps/desktop/src/main/vaults.ts`, `main/index.ts` (`switchVault`),
  `apps/desktop/src/vaults-state.ts`.

- **A SYNC PASS HOLDS THE REPO LOCK ONLY FOR ITS LOCAL STEPS.** The fetch and
  the push run unlocked between locked local steps: held across the network,
  the lock made every save and every turn start wait out a dropped
  connection's timeout. The price is that the world moves during the fetch, so
  the integration step re-checks first. Only a merge that fails outright is
  remembered, by the two tips it failed between, so a pass where neither moved
  skips it rather than failing the same way every minute (CONCURRENT EDITS
  NEVER STOP SYNC, below). Network git gives up under
  1KB/s for 30s, or an ssh connect past 20s
  (`apps/cli/src/server/vault/git-run.ts`). The split is
  `apps/cli/src/server/vault/git-engine.ts`.

- **THE ENGINE'S GIT IGNORES THE VAULT'S OWN GIT HABITS, AND A PASS REPORTS ONE
  OUTCOME.** No engine git runs the vault's hooks (the `runGit` bullet), the
  rebase and the merge run with rerere pinned off, and every status read
  passes `--untracked-files=normal`, because a user's commit-msg hook, a
  recorded rerere resolution or `status.showUntrackedFiles=no` would refuse,
  rewrite or hide an engine commit and hold every sync behind it. Before the
  listen the bootstrap stages nothing but the starter notes it seeded into a
  folder it created; an opened folder's first commit is empty
  (`apps/cli/src/server/vault/git-bootstrap.ts`), since staging a large folder
  there outran the shell's readiness wait. A pass concludes one `SyncOutcome`,
  and a path two devices changed is never one of them: a detached HEAD says
  `detached`, never `clean`; a refused push says `rejected` (a 413
  `too-large`, a 507 `full`), never `offline` (`classifyNetworkFailure` in
  `apps/cli/src/server/vault/git-run.ts`).

- **THE CAPTURE INBOX MERGES BY UNION.** Two desktops each appending a phone
  capture to the root `Inbox.md` between syncs overlap on a file the app wrote
  itself, and without union the merge would copy the inbox aside over a
  conflict nobody made. Every boot makes
  sure `info/attributes` holds `/Inbox.md merge=union`: local, never a committed
  `.gitattributes`, because the vault's files are the user's. Residual: a
  bullet one device deleted beside the other's append comes back.
  `apps/cli/src/server/vault/git-bootstrap.ts`, over `CAPTURE_INBOX_PATH` in
  `@repo/notes/sync/reconcile-file`, whose verdict unions the same file
  (`diff3`'s `union` overlap) for a writer that runs no git.

- **A SAVE THAT FAILS IS SAID ONCE AND RETRIED; ONE WHOSE FILE IS GONE IS ASKED
  ABOUT.** A refused write keeps the buffer dirty, said once per failure and
  retried on a backoff, since nothing else re-arms the autosave. A guarded
  write that finds no file, its merge's retry included, answers `vanished` and
  is never retried; refusing to leave it would hold the user there for good, so
  leaving asks: discard, or re-create the note from the buffer.
  `packages/editor/src/note/note-runtime.ts`,
  `packages/editor/src/note/vault-session.ts` and
  `packages/editor/src/guarded-vault-io.ts`.

- **A WATCHER EVENT IS A MUTATION'S ECHO ONLY WHILE THE ENTRY IS THE ONE IT
  LEFT, AND A PULL NAMES ITS PATHS.** The runtime drops a watcher event only
  when a fresh lstat matches the one its mutation recorded: keyed on the path
  and a window alone, a foreign write landing behind a save (an agent editing
  the open note) would be dropped with the echo. A pass whose rebase moved
  HEAD reports the diff's paths, because a pass that names nothing makes every
  push from another device re-read the whole vault.
  `apps/cli/src/server/vault/vault-changes.ts`,
  `apps/cli/src/server/vault/vault-runtime.ts`.

- **THE MERGE'S LINE DIFF IS BOUNDED, AND A MERGE THAT KEPT THE BUFFER OVER
  AN OVERLAP SAYS SO.** `diffLines` (`@repo/notes/text/line-diff`) runs inside
  a save's CAS retry, where an unbounded trace cost gigabytes for two long,
  far-apart notes; past `maxEditDistance` it answers `overBudget`, one hunk
  diff3 reads as one changed region. Conflicting on every over-budget merge is
  rejected: it would warn when nothing was lost. A conflicted merge's toast
  opens that note's History (owner decision).
  `packages/editor/src/vault-editor.ts`,
  `apps/desktop/src/renderer/app/note/vault-provider.tsx`.

- **WHAT THE FILESYSTEM REFUSES COSTS THAT ENTRY, NEVER THE CALL.** A
  subfolder the walk cannot open lists empty, logged once, because one such
  folder would fail the listing and the boot; the root still throws. A move
  where the filesystem refuses a hard link (exFAT, some SMB mounts) falls back
  to the check-then-rename a folder move already accepts. A compare-and-swap
  read failing for any reason but absence is a fault, never "the file is
  gone". `apps/cli/src/server/vault/vault-service.ts`.

- **THE VAULT LISTS WHAT GIT WOULD KEEP.** The listing, the stat and the
  watcher all honour every `.gitignore` in the vault, so a docs repo's
  `node_modules/` and build output take no tree row, no index row and no
  wake. One matcher per file, scoped to its own folder and asked deepest-first
  (`@repo/notes/knowledge/vault-ignore`), because one rooted at the vault
  re-scopes a nested `*` to `**/*` and hides the whole tree; `.git` and the
  staging prefix stay the unconditional floor. Only `.gitignore` files, which
  travel with the vault: `info/exclude` and a global excludes file are one
  machine's. A change naming a `.gitignore`, or naming nothing, reloads the
  rules and has the index re-diff (`apps/cli/src/server/vault/vault-runtime.ts`
  over `vault-ignore-files.ts`). Rejected: a hardcoded skip list, which misses
  the next tool's folder and contradicts what the user already wrote down.
  Residual: a folder moved in whole with its own `.gitignore` is read at the
  next reload, and the hosted vault's listing honours only the floor.

- **A RENAME HOLDS THE OPEN NOTE THROUGH THE MOVE, NEVER LETS GO OF IT.** The
  session suspends the note's controller across `vault.rename`: edits still
  land in the buffer while saves and reloads wait, and it resumes at the new
  path, or the old one when the move failed (`suspend`/`resume` in
  `packages/editor/src/vault-editor.ts`). Disposing it and opening the new path
  was rejected: a keystroke typed during the move reached no controller. At a
  new path the resume reads before it writes, because the guarded io holds no
  base for a path it never read and the move writes the old name into the note
  as an alias. `packages/editor/src/note/vault-session.ts`.

- **GIT IS THE ENGINE, NEVER THE VOCABULARY, AND ITS RAW STATE IS SETTINGS ›
  ADVANCED'S.** The rail, a sync toast, History and a note's facts say sync
  and versions. A sync state's label and its one line (the rail's menu and a
  manual sync's toast alike) are spelled in `syncStateLabel` and
  `syncStateNote` (`apps/desktop/src/renderer/app/vault-hooks.ts`), and
  neither they nor the rail read `lastError`: it is git's own stderr, so a
  state only the engine can explain says "Sync paused" and the rail offers
  Sync details…, which opens Settings at `#advanced`, the one section that
  shows the remote, the raw state and the last error, the thread sync's
  included (`apps/desktop/src/renderer/app/settings/advanced-section.tsx`).
  History names a version by when and who, never by its subject or sha: the
  server reads `authorKind` off the author (the engine's identity is the
  user's own edits, the agent's is the agent, anyone else, another device or a
  person's own git, is `external` and keeps its name and subject), so no
  client matches an email (`apps/cli/src/server/vault/git-history.ts`).
  Quoting the engine's error inside a friendlier sentence is rejected: no
  sentence around git's stderr makes it the user's.
  `apps/desktop/src/renderer/app/__tests__/vault-hooks.test.ts` holds the copy
  to that and refuses a `lastError` read in any renderer source but that
  section.

- **AN OPENED FOLDER'S OWN ORIGIN IS ITS BYO REMOTE, AND A FOLDER ANOTHER
  SERVICE SYNCS NEVER TAKES THE HOSTED VAULT** (0.6 direction: an existing
  folder is a first-run path). Where a vault syncs has one record, its repo's
  own `origin`, read every pass under the repo lock (`readOriginConfig` in
  `apps/cli/src/server/vault/folder-facts.ts`), so a remote the user already
  had, or sets later, is the next pass's with no restart. The app marks the
  origin it manages (`inteligir.remote=account`, set whenever it writes the
  hosted url, dropped when an explicit remote takes the origin over), and an
  origin at the hosted url counts as marked, which covers a vault that synced
  before the mark. The order is the pin (`INTELIGIR_VAULT_REMOTE`), an
  unmarked origin, outside sync, then the account
  (`apps/cli/src/server/cloud/vault-remote.ts`); an account pass that meets an
  unmarked origin anyway records it and pushes nothing, since its set-url
  would push the user's repo into the hosted vault. OUTSIDE SYNC is judged
  once at boot from where the folder physically sits, never stored and never
  asked of the service (`apps/cli/src/server/vault/external-sync.ts`): two sync
  engines over one tree fight, so the folder keeps its service, the hosted
  vault stays off, `no-remote` names the service, and an origin of the user's
  own still syncs. Rejected: a stored per-vault sync choice, a second record a
  user's own `git remote set-url` would contradict, and config.json's
  `vaultRemote`, which pinned one remote for every vault the root selects and
  is now a boot warning. `inspectVaultFolder` answers the same facts before a
  folder is a vault (`inteligir vault open`), so a picker and a boot agree.
  ONE WRITE PATH EDITS THAT ORIGIN: `vault.setRemote`, which Settings ›
  Advanced (`apps/desktop/src/renderer/app/settings/sync-remote-row.tsx`) and
  `inteligir vault remote` both call, runs `setOrigin` in
  `apps/cli/src/server/vault/git-engine.ts` under the repo lock and kicks a
  pass. A url is `remote add|set-url` and drops the mark. Every move of the
  origin, this one's and a pass's (the pin, the account's url), is
  `pointOrigin`: it forgets the old remote's tips, so no status calls the
  vault synced before a pass reached the new one, and a hand-set
  `remote.origin.pushurl`, which `set-url` leaves and git would keep pushing
  to; the account drops only an origin the provider calls the user's own
  and sets the mark, so signed out the vault syncs nowhere. The url grammar is
  one, `@repo/api/local/vault/remote-url`, which the pin, the wire and the
  field all run. A pinned vault reports `remoteSource: "pinned"` and refuses a
  change (`CONFLICT`), since every pass writes the pin over the origin. No
  "off" choice: a folder another service syncs is already the derived off.

- **CONCURRENT EDITS NEVER STOP SYNC** (0.6 direction: diff3 auto-merge, an
  overlap makes a conflict copy). A pass rebases first, which keeps the
  history a line; a rebase that stops on a path both devices changed is
  aborted and the pass merges instead
  (`apps/cli/src/server/vault/git-merge.ts`). git merges every path it can,
  and each one it cannot gets `reconcileFile`'s verdict
  (`@repo/notes/sync/reconcile-file`), the one the phone's queue lands for the
  same inputs: an overlap keeps this device's lines and copies the other's
  aside, named after the committer of the newest commit that touched the path
  since the two parted. A branch holding an unpushed merge merges again,
  never rebases, because a rebase drops a merge commit. Every verdict lands
  through the index (`hash-object`, `update-index`, `checkout-index`), never
  a write into the vault from JS, so the merge commits exactly the tree on
  disk; whatever throws aborts the merge, and only that failure is
  remembered, by its two tips, and said in plain words. Every engine commit's
  committer is this device's name (`apps/cli/src/server/device-name.ts`: the
  name it signed in under, else the Mac's own), because that is how another
  device names its version; the author still says who made the change. A
  merge or rebase a crash left is aborted before the engine's first commit.
  The status carries this device's name and each report since boot, a copy a
  pull brought included, and every surface words them through
  `describeSyncConflict`. The desktop says each report once, as a toast that
  stays until dismissed and whose Open shows the version set aside, against
  the newest `at` it said, kept in the page's prefs so a reload says nothing
  again and a boot sync's report is still said
  (`apps/desktop/src/renderer/app/sync-conflict-notices.ts`); there is no
  lasting conflict list, because Recent shows the copy and the copies are the
  record. Rejected: a `conflict` state that stopped sync
  until someone ran git, which a knowledge worker cannot, and a rebase
  through the conflict, which replays every local commit and has nowhere to
  keep the other version.

- **AN UNTOUCHED STARTER VAULT YIELDS TO A REMOTE THAT HAS HISTORY** (0.6
  direction: a second Mac signs in to notes the account already holds). A
  vault whose history is exactly its seed holds nothing of the user's, and
  merging it is wrong: the two histories are unrelated, so a starter the user
  edited elsewhere is added on both sides with no base, the fresh seed stays at
  the path and the user's own version becomes the conflict copy, and every
  starter they deleted comes back. So the bootstrap commits the starter notes
  it seeds into a folder it created and records that commit
  (`inteligir.seedCommit`, `apps/cli/src/server/vault/git-bootstrap.ts`); a
  folder it did not seed never gets the key. A pass that meets a remote branch
  it does not contain while HEAD is still that commit, after its own commit of
  the dirty tree, moves the branch to the remote's tip with git's own checkout,
  announces the paths that moved so the index, `/ws` and the open buffer
  converge, drops the record and names it once in the server log; nothing is
  a conflict, since nothing of the user's was replaced (`yieldSeededHistory`
  in `apps/cli/src/server/vault/git-engine.ts`). The rule reads local history
  alone, so it holds for every remote: the account's, an adopted origin, one
  set in Advanced. Any other HEAD merges as above and drops the record.
  Rejected: `reset --hard`, which would overwrite a change landed after the
  pass's commit, where the checkout refuses it and the next pass commits and
  merges it. Residual: a vault an older build seeded has no record, and
  merges.

### Knowledge: index, search and links

- **The knowledge index does not persist a stat fingerprint.** A warm reconcile
  over 2000 notes reads and hashes every doc in ~200ms on a local disk, off the
  critical path; a second persisted table in a cache whose recovery primitive
  is deleting the file is a crash waiting for a missed re-create. On storage
  that fetches or wakes, the read deadline below keeps the reconcile to ~2s over
  2000 notes whether one read stalls or all of them do, so the fingerprint is
  not what makes slow storage usable. What only size+mtime buys is not opening
  the file: a vault whose notes the OS evicts to placeholders is fetched again
  on every boot. THE TRIGGER is a report of exactly that; the walk already
  stats every file for `modifiedMs`. `KnowledgeIndex` in `@repo/notes` is not
  dead code: the package carries no sqlite (`SqlDriver` is injected), so this
  in-memory composition is how it tests its own engine.

- **RELATED IS ONE PANEL SECTION**: backlinks first because they are counted,
  then the scorer's rows with their reasons, then unlinked mentions
  (`apps/desktop/src/renderer/app/actions/related-section.tsx`). Outgoing links
  stay absent (they are on screen); no graph view; the route is search-shaped
  (a `limit`, no `total`) and fetched only while unfolded. A change sweeps
  `orpc.knowledge.key()` whole, because a link into a note lives in another
  note's bytes, except that `content-changed` skips the vault-wide
  `knowledge.unlinkedMentions` (`app/workspace-context.tsx`).

- **Stemming is a SHADOW of the indexed text, never a rewrite of it.** Literal
  and stem columns at equal bm25 weight; `@repo/notes/knowledge/search-query`
  owns the one policy both engines run. FTS5's `porter` tokenizer is rejected
  for a measured reason: it stems the index, so a prefix query for a half-typed
  word stops retrieving (86 of 1,555 prefixes over the labelled corpus), and it
  puts half a shared policy inside SQLite's C. Every term asks both halves, and
  that OR is the exact tier: a doc holding the literal word scores about twice a
  stem-only hit. Residual: the title/body gap is 10x, so a title collision still
  beats a body exact match. `search-query.ts` and `knowledge/search-excerpt.ts`.

- **THE CLIENT DOES NOT DECIDE WHAT A DOC IS.** `@repo/notes/knowledge/doc-file`
  is the one answer: `isDocPath` (`.md`, `.markdown`, `.mdx`, `.txt`) and
  `docStem`. A private `.md` rule in a client hides every `.txt` note and
  disagrees on display the moment a name is not lowercase.
  `apps/desktop/src/renderer/app/__tests__/vault-hooks.test.ts` walks the
  renderer for either shape.

- **THE SCAN READS AS PROSE WHAT THE EDITOR DRAWS AS PROSE, BUT ITS GRAMMAR IS
  NOT THE EDITOR'S, and `verbatim-spans` is the one bridge.** The scan disables
  `codeIndented` and `htmlFlow` (`@repo/notes/markdown/scan-parse`) because the
  editor's plugin list does, pinned in
  `packages/notes/src/__tests__/link-extract.test.ts`. The scan is total, so a
  malformed tag cannot cost a note its index row, where the editor's MDX
  tokenizer throws; unifying the grammars is rejected for exactly that. A
  rename's span is a licence to rewrite bytes, so a rename's scan runs the
  editor's plugin list as a bare parse (`@repo/notes/markdown/verbatim-spans`)
  and withholds spans inside those ranges (`@repo/notes/knowledge/link-extract`);
  the index path emits no spans and never pays for that parse on every save.

- **A TAG IS A SCOPE ON THE RECENT LIST, NOT A VIEW; ITS NOTES ARE A LISTING,
  NOT A SEARCH; AND A TAG RENAME IS THE LINK RENAME'S SURGERY.** No tag browser
  (a Tags tab was built and removed by owner decision): a `#tag` chip asks the
  shell through `showTag` (`packages/editor/src/agent-request.ts`), and the
  rail answers with Recent scoped to the tag
  (`apps/desktop/src/renderer/app/sidebar/tagged-notes.tsx`).
  `knowledge.tagNotes` answers the tag's family with the whole count, paged,
  from the index alone, because the search route stops at its ceiling with no
  sign of a cut; the family is one predicate, `notesInTagFamily`
  (`@repo/notes/knowledge/tag-notes`). `knowledge.renameTag` splices a
  frontmatter entry over its own yaml scalar (`@repo/notes/markdown/frontmatter`),
  because re-serializing restyles a flow list and rewrites every line of a CRLF
  one, and every write is `writeIfUnchanged`, so a note that changed
  mid-rename is reported, never overwritten. The one name grammar is
  `isTagName` (`@repo/notes/knowledge/tag-grammar`, import-free so the
  contract loads no markdown parser). `@repo/notes/knowledge/rename-tags.ts`,
  `apps/cli/src/server/knowledge/rename-tag.ts`,
  `apps/desktop/src/renderer/app/sidebar/tag-scope.tsx`.

- **VAULT SEARCH IS A LITERAL SCAN BESIDE THE RANKED INDEX, and a replace
  rewrites exactly what the rows showed.** FTS5 cannot say where inside a line
  a hit sits, so `knowledge.matches` (the palette's "Search across the vault…",
  `inteligir matches`) scans bodies with ONE matcher,
  `@repo/notes/knowledge/text-matches`, which the listing, the rewrite and the
  find bar's jump all run; the store only pre-narrows by ascii substrings
  (`docTexts`), because LIKE folds ascii case alone. A replace is a per-file
  write with the hash of the bytes it read, and a mismatch is REPORTED by name,
  never diff3-merged: the user named exact bytes
  (`apps/desktop/src/renderer/app/palette/vault-replace.ts`). A cut listing, or
  one that no longer answers the box, cannot replace
  (`apps/desktop/src/renderer/app/palette/search-page.tsx`), and a run honours
  a cancel between notes, never inside one. The jump lands by ordinal among
  the note's matches, because a markdown column is not a Slate offset.

- **AN UNLINKED MENTION IS THE STEM OR AN ALIAS IN PROSE, and Link rewrites the
  bytes the row showed.** `knowledge.unlinkedMentions` (`inteligir unlinked`)
  runs the literal matcher over the target's names as whole words, longest
  first; one row per note, excluding notes already linking here. A hit inside
  code, math, a link, a url, frontmatter, an html tag or a comment marker is
  withheld by the scan's own regexes as well as the editor's verbatim ranges,
  because those come back empty for a doc the editor refuses. Not the H1:
  `[[H1 text]]` resolves to nothing. Link wraps exactly that site through a
  guarded write, targeting the route's `linkTarget`, because the bare stem may
  be another note's. `@repo/notes/knowledge/unlinked-mentions.ts`,
  `apps/desktop/src/renderer/app/actions/link-mention.ts`.

- **A PROBLEM IS THE RESOLVER'S VERDICT, never a scan's.** `knowledge.problems`
  (the palette's Problems page, `inteligir problems`) reads the resolved graph
  alone: unresolved links, missing embeds, orphans, and a link name
  (`wikiLinkName`) or frontmatter `id` two docs share, a tie the resolver is
  quietly breaking. Every row disappears with the sweep that fixes it, so none
  is stale. Daily notes and templates are orphans by design and left out
  unless asked (`@repo/notes/templates/placeholders` spells the folders). A row
  lands on the link ELEMENT (`packages/editor/src/link-locate.ts`), since the
  find bar cannot see a wiki chip's label, a prop of an inline void.
  `@repo/notes/knowledge/vault-problems.ts`.

- **A DOC THE INDEX CANNOT READ OR PROJECT COSTS THAT DOC, NEVER THE INDEX.**
  A refused read (EACCES, EIO) keeps the doc's last row and is retried every
  pass, since a permission fix announces nothing. A doc whose projection
  throws is indexed as an other, its hash kept on that row so it is not
  re-projected every reconcile nor after a restart (a build that could now
  project it bumps `PROJECTION_VERSION`), and projection runs one doc at a time
  outside the store transaction. Rebuilding on either is rejected: the rebuild
  re-reads the same vault and fails the same way, so it loops. For the same
  reason only the store's own failure rebuilds: the driver throws
  `KnowledgeStoreError` (`@repo/notes/knowledge/sql-knowledge-store`) for every
  database failure, and any other throw fails that pass, leaves the index
  standing and reconciles on the next.
  `apps/cli/src/server/knowledge/knowledge-runtime.ts`.

- **THE SCAN RUNS ON A WORKER; THE SERVER'S LOOP READS BYTES AND WRITES ROWS.**
  Projecting a 20k-line note is seconds of synchronous CPU (2.9s measured),
  every autosave re-projects it, and the server's thread also answers every
  request, the ws bus and the watcher's liveness ping. So projection, the stem
  shadow (`@repo/notes/knowledge/search-columns`) and both rewrite sets' byte
  surgery run on one warm worker
  (`apps/cli/src/server/knowledge/projection-worker.ts`). No projection cap
  below the vault's 10 MiB read cap (a doc over it indexes as an other:
  resolvable, never searched): by owner decision a lower one is added only if
  the worker cannot keep up. Most suites run the jobs inline
  (`apps/cli/src/server/knowledge/__tests__/inline-projector.ts`), because a
  worker booted from source (`apps/cli/src/server/worker-entry.ts`) costs
  seconds. Pinned over a 20k-line note in
  `apps/cli/src/server/knowledge/__tests__/knowledge-runtime.test.ts`.

- **AN MD URL HAS ONE READING, AND THE EDITOR RESOLVES IT WITH THE INDEX'S
  RESOLVER.** `mdLinkTarget` (`@repo/notes/knowledge/link-extract`) is how the
  scan reads an md url, and the editor reads a link's or an image's url
  through it and resolves it from the note it is written in with the index's
  own `buildResolver` (`packages/editor/src/link-resolver-store.ts`), so the
  image Problems calls missing is the one drawn missing and a link's Open
  follows a vault url in the app, an embedded note's links included; only an
  http(s) url reaches the browser. An image the resolver misses falls back to
  a root path, because a pasted asset is on disk before the listing that would
  resolve it.
  `useVaultLinkTarget` in `packages/editor/src/host.ts`,
  `packages/editor/src/nodes/image-node.tsx`, `link-node.tsx` and
  `packages/editor/src/transclusion.tsx`.

- **A WIKI LINK NAMES WHAT THE RESOLVER ANSWERS TO, AND ONE FUNCTION BESIDE THE
  PARSER WRITES IT.** `.md` is the one extension a link leaves off
  (`wikiLinkName` in `@repo/notes/knowledge/doc-file`), and the resolver keys
  that same name, so a `.txt` note links as `[[todo.txt]]`; letting every doc
  extension go was rejected to keep Obsidian's reading and the pinned
  resolver. The `[[` picker, Link and extract take their target from
  `wikiTargetForPath` (`@repo/notes/knowledge/link-resolve`: the name when it
  resolves back, else the path), and so does a rename, but its candidate
  predicate refuses the bare name unless no other file answers to it
  (`answersOnly` in `packages/notes/src/knowledge/rename-links.ts`), because a
  rename rewrites links the user did not type and must not lean on the
  resolver's tie-break. Every writer takes its bytes from `serializeWikiBody`
  (`@repo/notes/markdown/remark-wiki-link`), and a null from it writes nothing.
  Copy link copies the note's `[[wiki link]]`, spelled as the autocomplete
  spells it (`wikiLinkFor`, beside `wikiTargetForPath`), because a loopback URL
  opened nothing anywhere else and died with the port; a name no link can
  carry copies nothing and says so (`apps/desktop/src/renderer/app/note-topbar.tsx`).
  Pinned by the round trip in `packages/notes/src/__tests__/link-resolve.test.ts`.

- **A DOC WHOSE READ HAS NOT ANSWERED IN 2S IS DEFERRED, NOT AWAITED, AND READS
  OUT STAY BELOW NODE'S FS POOL.** On storage that fetches or wakes (an
  on-demand placeholder, a sleeping disk, a network mount) one open can block
  for minutes, and every query settles the pass first. So the pass moves on,
  the doc answers from its last entry, and the read lands in a later pass,
  judged against the index only then. A read left running still holds a slot
  of `READ_CONCURRENCY` (3): a stalled open holds one of node's four fs
  threads, and a fourth stalls every fs call in the process, saves included,
  which no deadline can free. Rejected: re-reading every path once its late
  read lands, which loops on storage that is always slow (only a doc changed
  while its read was out is read again), and a wider cap, which a local disk's
  warm reconcile wanted and the pool cannot afford. No provider
  path, bundle id or mount type appears anywhere; the scenario suite stalls a
  path through `INTELIGIR_SLOW_READS` (`apps/cli/src/server/vault/slow-reads.ts`).
  Residual: the listing's walk has no deadline, and a rename run before a
  deferred doc lands misses a link the doc gained offline. The boot's one
  timing line (`apps/cli/src/server/boot-report.ts`) counts what was deferred.
  `apps/cli/src/server/knowledge/deferred-reads.ts`,
  `tools/e2e/src/scenarios/slow-storage.ts`.

### Agents and threads

- **Ingest is ONE transaction.** Append, lifecycle projection and queue touch
  happen in one immediate transaction; notifications flush after commit.
  Lifecycle CAS predicates include the turn identity so a late completion for
  turn A cannot settle turn B (`apps/cli/src/server/threads/service.ts`).

- **Agent commits stage the turn's own write set**, from the fileChange events
  and the vault writes the agent makes through `inteligir` itself, under a
  counted commit hold that defers the vault debounce and blocks a sync.
  Committing the whole dirty tree attributes a concurrent turn's writes to
  whoever settles first (`apps/cli/src/server/agents/agent-commits.ts`). Under
  `INTELIGIR_THREAD_ID` the CLI names its thread on every call
  (`apps/cli/src/server/agent-thread-header.ts`) and the write handlers hand
  what they wrote to its running turn (`attributeWrites` in
  `apps/cli/src/server/orpc.ts`), a delete's comment stores and a comment's
  minted note id included, since whatever is not handed over lands unattributed
  in the next auto-commit; the header is attribution, not authority. A TURN IS
  FOUND BY ITS TRAILERS, NEVER BY ITS SHA, which a rebase onto another device's
  push rewrites: the commit carries `Thread:` and `Turn:`, an undo
  `Undoes-Turn:`, spelled once in `apps/cli/src/server/vault/turn-trailers.ts`
  and read back by `threads.turnChanges`
  (`apps/cli/src/server/agents/turn-changes.ts`). Undo
  needs the bytes from just before the turn, so the hold claims each path the
  turn reports and the turn starts with a checkpoint of the unclaimed dirty
  tree: the note the user was typing in lands as the engine's, never inside the
  turn. The turn settles before its commit lands, so the window hears
  `changes-committed` once it has. Undo covers reported edits alone (owner
  decision): nothing made beside a running action is attributed to it.
  Residuals: lines typed into a note WHILE the agent edits that note belong to
  the turn, since the canonicalizing save-back leaves no sound per-writer split;
  a crash mid-turn leaves its writes to the boot sweep, so that turn cannot be
  undone; a thread pulled from another device lists only what was committed
  after it arrived here.

- **THE AGENT SURFACE IS THE ⌘K ACTION COMPOSER AND THE RIGHT PANEL** (what it
  retired is the register on #645; do not bring any of it back). An action is an
  ordinary thread attached to the note it was composed over (its origin, below).
  The agent edits the vault directly and anchored comments are the review
  channel; the panel's Actions | Comments | History | Metadata tabs are
  transcript, review, revision, and the note's own properties, related notes
  and delete. The transcript ends each settled reply with the notes its turn
  edited and Undo changes, withheld while the thread runs; a finish toast
  ("Agent edited N notes", Undo) sits outside the panel, mounted by the
  workspace. A `changes-committed` frame names its thread, never its turn,
  since the bus carries no payload, and an undo sends the same frame a turn
  does: so the toast reads a thread's turns on its first frame since the
  window opened and announces the newest applied turn that read did not hold,
  and a thread first heard through a commit frame alone is an undo's
  (`apps/desktop/src/renderer/app/actions/turn-finish-toast.ts`). Both undos
  flush the open note first, so a line still inside the autosave debounce is
  merged around rather than missed (`undo-turn.ts`). "Ask agent" seeds the
  composer through `packages/editor/src/agent-request.ts`, so the editor never
  imports the shell. A SIGNED-OUT AGENT IS ANSWERED BY ITS SIGN-IN, NOT BY A
  REFUSED SEND: under the ACP runtime, a default agent its vendor calls signed
  out puts the sign-in in ⌘K's place, keeping what was typed or seeded for after
  it, and the Actions list offers it where it said "Press ⌘K"; a thread whose
  agent (`providerId`, else the default) is signed out, and that no other device
  runs, carries it above the reply. A vendor that did not answer is not signed
  out, and a scripted or disabled agent needs no sign-in, so both keep the
  field. ⌘K draws nothing until the runtime and the vendors have answered
  (`useSignInNeed` in `agent-hooks.ts`), because a field drawn first would be
  swapped for the sign-in under the typing; the field takes focus whenever it
  appears, after that wait as after a sign-in. Every one of those, each
  Settings card and onboarding draw ONE surface, `AgentSignIn`
  (`apps/desktop/src/renderer/app/agents/agent-sign-in.tsx`, over
  `agent-hooks.ts`): the default first ("Sign in with Claude" unless ChatGPT was
  chosen), the rest under Other, the waiting state with the page's address and
  its code, and a failure's own sentence with Try again. Settings has one Agent
  section: a card per agent, Claude first, ChatGPT under Other, "Use for new
  actions" only on a signed-in card that is not already, and Sign out behind a
  confirm that names the vendor's own app it signs out too (`vendorApp`: the
  store is shared). `apps/desktop/src/renderer/app/actions/actions-panel.tsx`
  and `action-composer.tsx`.

- **COMMENTS CARRY THE AUTHOR'S `source`, AND THE STORE WRITE IS A CAS.** The
  server signs `user` when a caller says nothing; the CLI signs `agent` under
  `INTELIGIR_THREAD_ID`. The store write retries once on a base mismatch, then
  answers `CONFLICT`. The comment-id grammar has one spelling,
  `COMMENT_ID_PATTERN` in `@repo/notes/comments/sidecar-schema`, which the body
  marker's regex is built from.
  `apps/cli/src/server/comments/comments-service.ts` and
  `apps/cli/src/commands/comment.ts`.

- **THE COMMENT STORE IS ONE DOT-FOLDER KEYED BY THE NOTE'S ID, and the cloud
  was rejected for it.** `.inteligir/comments/<note-id>.json`, keyed by the
  note's frontmatter `id`, so a rename or move anywhere (Finder, a pull, an
  agent's `mv`) strands nothing and one commit carries a note's anchors and
  bodies together. Bodies in a cloud table would drift from the anchors in the
  note's bytes and would need an account. A comment on a note without an id
  mints one (`withFrontmatterId`) through a guarded note write; a read mints
  nothing, and an `id` that is not text is refused, never overwritten. A legacy
  `<note>.comments.json` is folded in on first touch and over the whole tree
  once the server listens (`comments-migration.ts`, kicked from `serve.ts`, so
  it neither delays nor fails the boot). A deleted note's store goes with it
  unless a byte copy still carries that id, one rule
  (`@repo/notes/comments/store-removal`) the server's delete
  (`remove-with-comments.ts`) and the phone's both ask, and a
  restore brings both back through
  `@repo/api/local/vault/restore-comment-store`, reporting a store it could not
  restore, because one silently left behind strands its threads. A BYTE COPY
  IS RE-KEYED AND ITS STORE FORKED, never stripped of its id:
  `@repo/api/local/vault/give-note-own-id` (the Problems page's Give its own
  id, `inteligir vault new-id`) copies the store under a new id first, then
  moves the copy's `id:` line to it under the CAS, so both notes keep every
  thread and diverge, and the note keeping the old id keeps its
  `[[Title|uuid]]` links and actions. Deleting the copy's `id:` line was
  rejected: its anchors' bodies live only under that id.

- **A VIEW CONTEXT RIDES THE MESSAGE, and it is a statement about the past.**
  What the user was looking at travels on the send (`@repo/domain/view-context`),
  never as a thread column or a server-side "current view" that has no owner,
  so navigating away mid-turn changes nothing. There is no tool: the agent can
  already read the file, and the one thing a tool could add, a live selection,
  cannot be made honest. A queued send carries none.
  `apps/cli/src/server/agents/view-context-prompt.ts`.

- **AN @-MENTION RIDES THE SEND AS `contextPaths`, NEVER AS TEXT.** The stored
  `client/turn/requested.text` is exactly what the user typed, so the
  timeline, the phone and a thread's title read the message rather than a
  prefix the desktop glued on; the server names the notes in a block of its
  own (`composeContextPathsBlock`). UNLIKE the view context, a queued send
  KEEPS them (`queued_thread_messages.context_paths`): a mention is part of
  what the user asked, not a statement about a screen since left.
  `@repo/api/local/threads/threads-schema`.

- **THE DEFAULT HARNESS IS A STORED CHOICE, read per thread start.**
  `<dataDir>/agent-prefs.json`, not config.json, which is read once at boot and
  never written by the app; unset, claude, whatever PATH holds (reversing "the
  first harness on PATH": both runtimes ship in the app, so PATH says nothing
  about which one can run). A thread keeps the harness it started on. A model
  is per harness, because a model id is vendor-specific; a one-model spelling
  (`INTELIGIR_AGENT_MODEL`, config.json's `agentModel`) is named in a boot
  warning, never refused, since config a build does not act on must not brick
  it (`legacyModelWarnings` in `apps/cli/src/server/config.ts`).
  `apps/cli/src/server/agents/agent-prefs-store.ts`, `defaultHarnessId` in
  `agent-driver.ts`, `harnessReadiness` in
  `@repo/api/local/agents/agents-schema`.

- **CONNECTORS ARE THE DEFAULT AGENT'S OWN MCP CONFIG** (0.6 direction,
  reversing the app-owned registry and its hand-built OAuth: one registry, the
  vendor's, with the vendor's own sign-in). Settings lists, adds and removes the
  servers in the default agent's user-level config through its bundled binary
  and the one vendor spawn policy, resolved per call from `agent-prefs.json`, so
  a change of agent moves the section and every vault shares the list. Add and
  remove only: no toggle, and no header field, since Codex keeps no static
  header; one-click presets
  (`apps/desktop/src/renderer/app/settings/connector-presets.ts`). A session is
  handed no servers of the app's (`mcpServers: []`,
  `packages/agent-runtime/src/acp/acp-runtime.ts`), so the config Settings edits
  is the one a session loads. Claude's is read from `mcpServers` in
  `<CLAUDE_CONFIG_DIR ?? HOME>/.claude.json`, because `claude mcp list` prints
  no JSON and starts every stdio server; it is written with
  `mcp add-json -s user` (`mcp add`'s -H and -e take the name as a value) and
  `mcp remove -s user`; and `claude mcp login` refuses a stdin that is no
  terminal, so it runs under macOS's `script(1)` (the pty option of
  `vendor-process.ts`). The file keeps no answer about a sign-in, so a Claude
  URL row reads `unknown` and always offers one. Codex's is `mcp list --json`;
  its `mcp add` silently replaces and its `mcp remove` of a missing row exits 0,
  so both refusals are the list's, and every call on one vendor waits for the
  one before it, or two adds of one name would both pass. A codex
  `mcp add --url` whose server publishes a sign-in starts it and keeps running,
  so the add is handed back as that sign-in. A sign-in is one per agent and
  name, polled by Settings, and ended by its five-minute window, its row's
  removal or shutdown, each killing the vendor process (`mcp-sign-ins.ts`). A
  plain list answers from the last read for ten seconds, because reading
  codex's spawns it and runs OAuth discovery against every URL row, which that
  poll would do every 1.5s; every edit and every sign-in's end reads again
  (`connectors-service.ts`). A
  name this app adds cannot start with `-`, and every name rides after `--`, so
  a vendor row of any name can be removed. The retired registry is deleted at
  boot, never imported (`retired-connectors-file.ts`). A booted suite runs the
  vendors over stores under its own temp dir
  (`apps/cli/src/server/__tests__/boot-app.ts`).
  `apps/cli/src/server/connectors/vendor-mcp-config.ts`, `claude-mcp-config.ts`,
  `codex-mcp-config.ts`.

- **AGENT MEMORY IS REMOVED** (reversing #575). Claude Code and Codex carry
  their own; a third beside them was two answers to one question. What survived
  is the pattern: content the agent consumes lives in files it reads with its
  own shell. The dialect skills ride `INTELIGIR_SKILLS_DIR` with a
  three-sentence pointer on the first turn, never the spec inlined.

- **ONE SET OF SESSION FACTS, TWO PROJECTIONS, AND A LOADED SESSION IS HANDED
  ONLY THE INSTRUCTIONS IT DOES NOT HOLD.** The shell env and the prompt are
  pure functions of one `AgentSessionFacts`, and `shellEnv` is a getter read at
  every spawn, because read once `INTELIGIR_CONNECTED_DIRS` freezes at the first
  turn (`apps/cli/src/server/agents/agent-shell-env.ts`). ACP's `session/new`
  carries no instructions, so they ride a turn's prompt, and a loaded session
  gets them again only when their hash differs from the last set its thread was
  handed. Claude's `_meta.systemPrompt` is not used: it is one harness's
  channel. `apps/cli/src/server/agents/runtime-manager.ts`.

- **THE HOST CLOSES A PROVIDER SESSION IT GIVES UP ON, AND A CHILD'S DEATH
  FAILS ITS TURN THROUGH THE PROMPT.** The watchdog and a failed dispatch call
  `closeThread` first, so the next send resumes on a fresh child rather than a
  session holding the abandoned prompt. The child's exit closes the ACP
  connection with its status and last stderr lines, so the SDK rejects every
  pending request and a crash fails the dispatch or the turn like a refused
  prompt. Rejected: an exit callback beside it, and per-thread exit
  generations, which fit a process shared by threads and would be a second
  answer to "did this turn fail?". A CLOSE counts, though: an open awaiting the
  previous child's exit has no new child a close could stop yet, so every host
  close bumps the thread's close generation and an open that sees it move
  throws `ThreadClosedError` rather than spawn an orphan.
  `packages/agent-runtime/src/acp/acp-runtime.ts` and
  `apps/cli/src/server/agents/runtime-manager.ts`.

- **THE PROVIDER GRAMMAR IS WHAT THE ACP MAPPER EMITS, AND THE MAPPER IS PINNED
  TO THE ADAPTERS' REAL WIRE** (owner decision, reversing the kept-wide bb
  vocabulary). `ProviderEvent` carries exactly what `AcpTurnMapper` constructs,
  since a kind nothing produces is a branch every consumer carries. The mapper
  is tested against turns the pinned adapters really sent
  (`packages/agent-runtime/src/acp/__tests__/fixtures/<adapter>@<version>/`),
  because a fake agent encodes what the adapters were believed to send. The
  adapter and SDK pins are exact and move together, and a bump re-records
  (`packages/agent-runtime/scripts/record-acp-transcripts.ts`).

- **A TIMELINE DELTA MOVES A HELD TURN AS A PATCH, AND A ROW CARRIES WHAT THE
  PANEL DRAWS.** Upserting a turn whole resends every command, tool call and
  thought for one streamed token, so a held turn travels in `turnPatches` as
  its status and only the children past the base. A turn row's `sourceSeqEnd`
  names its own contributors, not every turn-scoped event: a streaming
  assistant message lands as a top-level row, and counting it would move the
  turn row on every token. A command row carries its first
  `COMMAND_OUTPUT_LINES` lines; the event log keeps every byte. A row whose
  text only grew (a thought, a plan, a streamed message) travels as a
  `textAppends` entry from the held text's length, since resending it whole
  costs bytes quadratic in its tokens; an append onto a text of another length
  refetches. Residual: a tool row's result still rides whole.
  `packages/api/src/local/thread-timeline.ts`.

- **A THREAD IS NAMED BY ITS FIRST MESSAGE, ON THE SERVER**, in the
  transaction that appends it, local or synced; an explicit title stays.
  Naming it in the desktop left every action the CLI, an agent or another
  device started as "Untitled action". The rule is `deriveThreadTitle`
  (`@repo/domain/thread-title`), which the phone runs too, and a title the log
  states in a `thread/meta` row outranks it on every device.
  `apps/cli/src/server/threads/service.ts`.

- **A STOP IS A CANCEL WITH A CLOSE BEHIND IT, AND THE TURN STILL ENDS THROUGH
  ITS OWN PROMPT** (owner decision: an agent writing the vault the wrong way
  needs a brake; deleting the unreachable `stopping` state was the rejected
  alternative). `threads.interrupt` sends ACP's `session/cancel`, and the turn
  settles through its prompt's `cancelled` end like any turn; one silent past
  `stopGraceMs` has its session closed and is settled by the host. Archiving a
  running thread stops it. A turn another device runs is refused (`CONFLICT`):
  only its own process can reach its provider. The wire thread says so
  (`runsElsewhere`), so the panel draws no Stop there rather than one that
  answers with a refusal (`apps/desktop/src/renderer/app/thread-activity.ts`).
  `apps/cli/src/server/agents/runtime-manager.ts`,
  `apps/cli/src/server/threads/service.ts`.

- **AN ACTION'S ORIGIN IS ITS NOTE'S ID, and the path is only the fallback.**
  Rebinding the stored path on the rename route was rejected: Finder, an
  agent's `mv` and a pull never reach that route. The create stores the note's
  frontmatter `id` (`threads.origin_note_id`) beside the path, minting one
  through the comment store's guarded step
  (`apps/cli/src/server/vault/ensure-note-id.ts`), and threads whose origin was
  recorded as a path alone are backfilled once after boot (`compose.ts`). Every
  read resolves the id through the index (`pathForNoteId`), preferring the
  stored path while it still carries the id, so a byte copy never takes the
  binding. The composer mints the open note's id through the live editor,
  because a server mint under the buffer would make the revision name bytes no
  longer on disk, and outside the undo history, because an undo would unbind
  the action just sent (`apps/desktop/src/renderer/app/note/open-note-id.ts`).
  `apps/cli/src/server/threads/thread-origins.ts`.

- **THE THREAD LIST IS A KEYSET PAGE, AND A QUESTION A PAGE CANNOT ANSWER IS
  ASKED OF THE SERVER.** `threads.list` answers `limit` threads (default 50)
  after an opaque `cursor`, live before archived and newest first. An offset
  was rejected because a thread touched between two reads would shift every
  row behind it. A page is a window, so what must be whole is its own query:
  the open note's actions (`originDocPath`), the rail's agent spinner, which
  asks for one `running` thread, archived ones included, and the palette's
  Actions search (`query`, a LIKE over the title and the stored origin path).
  `packages/db/src/threads.ts`,
  `apps/desktop/src/renderer/app/actions/thread-hooks.ts`,
  `apps/desktop/src/renderer/app/palette/threads-page.tsx`.

- **NO CONFIGURATION INSIDE THE VAULT RUNS ON THE AGENT'S HOST.** The vault is
  synced content (the hosted remote, a BYO remote, another device's pull), and
  the dot-entries holding a vendor's config are hidden from the rail. Claude
  sessions open with `settingSources: ["user"]`, the claude row's `sessionMeta`
  (`packages/agent-runtime/src/acp/harness-registry.ts`), because `project` and
  `local` read the vault's `.claude` settings and `.mcp.json`; CLAUDE.md and
  the vault-keyed MCP servers in `~/.claude.json` sit behind the same two
  gates, so they go too. codex-acp marks the session root trusted and takes no
  per-session option, so a pnpm patch marks it untrusted (`pnpm-workspace.yaml`
  names it), which also stops Codex reading the vault's AGENTS.md itself; the
  server's instructions already carry that file to both harnesses
  (`apps/cli/src/server/agents/agent-instructions.ts`). npm applies no pnpm
  patch, so a Codex session also refuses to open on a vault holding `.codex`
  (the row's `refusedVaultEntries`), whichever adapter is installed. Rejected: keeping a
  vault source and refusing its executing keys one by one, a list every vendor
  release can outgrow. User-level vendor config stays.
  `packages/agent-runtime/src/acp/__tests__/vault-config-isolation.test.ts`
  runs each pinned adapter against a fake vendor and reads what it was handed.

- **AN AGENT IS READY WHEN ITS VENDOR SAYS SO, THROUGH THE BUNDLED BINARY, OVER
  THE SHARED STORE, AND PATH IS NEVER CONSULTED** (reversing the PATH gate and
  the credential-file probe). Both runtimes ship inside the app, so a user with
  no vendor CLI installed is not an agent-less user: a harness row names its
  vendor executable, the override the adapter itself honours
  (`CLAUDE_CODE_EXECUTABLE`, `CODEX_PATH`) else the binary bundled beside the
  adapter, never PATH's. Signed-in is the vendor's own answer (`claude auth
status --json`, `codex login status`) read over `~/.claude` and `~/.codex`,
  so a Mac already signed in stays signed in; a file or keychain entry
  existing said nothing about whether the vendor still accepts it. Every vendor
  run goes through one spawn policy (`apps/cli/src/server/agents/vendor-process.ts`:
  the bundled binary alone, the data dir as cwd since a vendor reads project
  config from its cwd, the harness's `envOmit`, a deadline that kills the
  process group), and the answer is shared between concurrent asks and kept
  10s (`vendor-accounts.ts`), built in `serve.ts` and carried on the driver so
  `compose.ts` spawns nothing. A send is refused up front only when the
  thread's own runtime is missing from the install; a signed-out vendor is not
  pre-gated, because the adapter's `authRequired` is the refusal and it names
  the vendor. `packages/agent-runtime/src/acp/harness-registry.ts`.

- **UNDO IS A THREE-WAY REVERT OF ONE TURN'S COMMIT, THROUGH THE VAULT'S OWN
  CAS.** `threads.undoTurn` (`inteligir action undo`) reads each path the
  turn's commit changed at its parent and at the commit, and merges the turn's
  change out of the bytes on disk now (`@repo/notes/text/revert-edit`), so an
  edit made since survives. A note whose later edits overlap or touch the
  turn's is kept whole and named, never half undone (owner decision); no Redo,
  since History restores. Rejected: `git revert` or `git checkout`, which
  bypass the CAS, the re-index, the `/ws` notification and the open buffer's
  convergence, and a byte restore to the parent, which discards every later
  edit, the user's included — the loss undo exists to remove. Every write is
  the vault's `writeIfUnchanged` / `removeIfUnchanged` / `absent` guard, as a
  tag rename's are, so there is no second CAS and a write racing the undo is
  kept and named. A path a running turn claimed is `busy`, and a turn still
  running or already undone is refused (`CONFLICT`). The undo commits as the
  engine under `Undoes-Turn:`, holding commits while it writes so no flush or
  sync sweeps its writes into a commit that names no turn, and never through
  `attributeWrites`, so an agent undoing an earlier turn from inside a later
  one does not commit the undo as its own. A COMMENT STORE IS TAKEN BACK
  ENTRY BY ENTRY, never as lines, which can break its json
  (`@repo/notes/comments/revert-entries`), and after the notes: an entry the
  turn added goes only while it is as the turn left it, nothing answers it
  and no marker anchors it in its note once that note's revert has landed
  (found by id through the index; a legacy sidecar's by path). An entry the
  turn edited or deleted comes back while it is as the turn left it; a store
  left empty goes; one gone since with its note stays gone. Per entry, not per
  file: a store that keeps any entry the turn touched is named `edited-since`
  and still loses the rest. The comments list finds a store by its note's id
  alone, so a note whose revert took back the id the turn minted takes it
  again while that store is still there, or a reply the user left would be
  filed under nothing. `apps/cli/src/server/agents/turn-changes.ts`.

- **SIGNING AN AGENT IN IS THE METHOD ITS ADAPTER ADVERTISES, RUN BY THIS
  SERVER, ONE AT A TIME.** `agents.signIn` runs the harness row's `signIn`.
  claude's `claude-ai-login` is an ACP terminal method, which the client runs,
  so the server runs the bundled claude with `auth login --claudeai` through
  the one vendor spawn policy, piped, with no pty: why none is needed is the
  header of `agent-sign-in.ts`. The first address it prints is
  `signingIn.authUrl`, and the code that address's page shows reaches the
  login's stdin through `agents.submitSignInCode`, so a sign-in whose browser
  never opened still finishes; the harness row's `acceptsCode` holds the
  vendor's own test for a whole code, because the vendor answers a malformed
  one only on stderr and keeps waiting (`incomplete`). codex's `chat-gpt` is an agent method, so its adapter is
  started for the sign-in alone, on the env a session gets (`adapterSpawnEnv`),
  asked through `authenticate` and ended SIGTERM then SIGKILL
  (`packages/agent-runtime/src/acp/acp-sign-in.ts`). A login that exits 0 counts
  only once the vendor's own status says signed in. One sign-in per server,
  because two browser logins would race for one callback (`CONFLICT`); a
  cancel, the ten-minute ceiling and the server's shutdown each end the vendor
  process, and a sign-in the vendor refused is a `failed` outcome, never a
  refusal. The harness just signed in takes the default only from one a new
  thread could not run on, so a second sign-in never moves the user off the
  agent they already use (`agents-service.ts`). Rejected: a pty (a native
  dependency, or `script`), which the login does not need; an API-key method,
  since there is no API-key fallback; and claude through the adapter's `--cli`,
  a node process in front of the same binary.
  `apps/cli/src/server/agents/agent-sign-in.ts`.

- **A PHONE'S REQUEST LANDS THROUGH THE SEND, AND THE THREAD IS ITS LEDGER**
  (0.6 direction: the phone asks a Mac to run the agent). After the pull, the
  sync pass claims the account's dispatch inbox, hands each `turn` row to
  `ThreadService.acceptDispatch`, which runs the send's own decision, so a
  request starts, queues or is refused as a message typed here would, and acks
  what happened. No table records a claim: the request row naming the
  `dispatchId`, or the queued message carrying it, is the ledger
  (`threadHoldsDispatch` in `@repo/db/events`), so a lapsed claim handed over
  again, or one another Mac ran and this one pulled, acks with no second turn.
  Two refusals, in the phone's words: an archived thread, and one whose turn
  another device runs, where the request would wait on a queue a remote settle
  never drains. A signed-out agent is delivered: the request and its
  `provider/error` are what the phone reads. A new thread keeps the phone's id
  and binds the note it was asked over by `noteIdOf`, read and never minted,
  because a mint waits on the vault's lock and a claim held past its lapse runs
  on a second Mac. A PHONE-STARTED TURN'S APPROVAL (its request named a
  dispatch, `turnDispatchId`) is opened in the inbox under an id derived from
  the local row, so an open whose answer was lost asks for the same row, and
  closed once it settles here, however it settled; the phone's `answer`
  resolves it through `answerInteraction`, and an answer delivered twice reads
  delivered both times. `pending_interactions.relay` is the only bookkeeping,
  and the bus (`WsBus.onThreadChange`) brings a pass forward when an approval
  moves. Let my phone ask this Mac (Settings › Account,
  `<dataDir>/cloud-prefs.json`, owner decision: on unless turned off) is read
  per pass, and off, this Mac claims nothing. The Mac also says it on its
  socket's upgrade (`SYNC_WS_PHONE_REQUESTS_PARAM`), so the phone's "a Mac is
  listening" counts only Macs that would claim, and a change dials again
  (`phoneRequestsChanged`), since a hibernated socket's tags are fixed when it
  is accepted; an unreadable choice is announced off. Residual: a follow-up one Mac
  claims on a thread another Mac ran opens a fresh provider session there.
  `apps/cli/src/server/cloud/dispatches.ts`,
  `apps/cli/src/server/cloud/sync-pass.ts`,
  `apps/cli/src/server/threads/service.ts`.

### Dictation

- **DICTATION IS THE OPERATING SYSTEM'S** (owner decision, reversing streaming
  Parakeet; do not bring an in-app recognizer back). macOS dictation (fn twice,
  Edit › Start Dictation) and the phone keyboard's mic type into a field like a
  keyboard, so the app holds no microphone entitlement (`device.audio-input`,
  deliberately absent from `apps/desktop/resources/entitlements.mac.plist`), no
  `NSMicrophoneUsageDescription`, no web permission, no model and no socket.
  Rejected: an in-app recognizer, whose live partials cost a native addon on a
  worker, a ~100 MB third-party download behind a sha gate, a dictation socket
  and the app's only device grant. The window's session denies every
  permission request and check (`lockDownSession` in
  `apps/desktop/src/main/index.ts`), which
  `tools/e2e/src/scenarios/desktop-shell.ts` reads back as a denied microphone.
  The model folder an install already holds is removed after listen
  (`apps/cli/src/server/retired-model-dir.ts`). With the mic button gone, a
  Mac's ⌘K composer says "fn fn to dictate" beside Send
  (`apps/desktop/src/renderer/app/actions/action-composer.tsx`), the app's one
  hint. A dictated phrase lands as one IME-style commit, which Chromium once
  left the caret before when it was a field's first edit after a programmatic
  focus (`reconcileInsertionCaret` in `packages/editor/src/combobox-input.ts`
  still repairs the editor's combobox);
  `tools/e2e/src/scenarios/os-dictation-browser.ts` dictates and then types
  into the composer and into the note focus returns to, and both land in
  order, so `InputMessage` carries no such repair until that scenario says
  otherwise.

### Cloud, sync and accounts

- **THE DEVICE CREDENTIAL IS THE SYNC SWITCH, and it lives in the data dir.**
  `<dataDir>/device-credential` at 0600: not in `inteligir.db` (the thread log it
  uploads) and not in the vault (a git repo pushed to a remote). No separate
  "sync enabled" flag: two values that must agree can disagree. Signed out, the
  sync client opens no socket, arms no timer and makes no request, asserted in
  `apps/cli/src/server/cloud/__tests__/sync-runtime.test.ts`. Cost accepted:
  "pause sync" is signing out, which discards the queue. Still no stored flag
  for the vault either, but the folder's own facts withhold the hosted vault
  from a signed-in install: an origin of its own, or another service syncing it
  (AN OPENED FOLDER'S OWN ORIGIN, in the Vault group).
  `apps/cli/src/server/cloud/credential-store.ts` and `sync-runtime.ts`.

- **SYNC IS PERMISSIONED BY ACCOUNT; the account IS the entitlement.**
  Accountless, the app sends this project's cloud nothing; what does leave the
  machine (the desktop's update check against GitHub, the phone's against
  Expo, the agent's own provider) is `docs/privacy.md`'s to list. Signed in, the credential alone
  entitles threads, captures and the hosted vault, with no second flag, except
  that a folder with an origin of its own, or one another service syncs, never
  takes the hosted vault; its threads sync either way. The hosted vault has a
  storage ceiling the Worker states, which is a size, not a flag (the storage
  cap bullet below). The invite gate is
  account-creation policy. The BYO remote is the vault's own origin, edited in
  Settings › Advanced and `inteligir vault remote`, and stays accountless;
  `INTELIGIR_VAULT_REMOTE` only pins one over it, and config.json's
  `vaultRemote` is retired.

- **A DEVICE SIGNS IN WITH EMAIL + PASSWORD, and gets the same device
  credential** (owner decision, the Obsidian model, reversing the
  browser-approved pairing line). `POST /v1/device/login` verifies the password
  through Better Auth, mints the device credential and deletes the session the
  sign-in created, so a device holds exactly one secret. That secret also
  lists and revokes the account's devices (`GET /v1/device/list` and
  `POST /v1/device/revoke` take a session or a live device credential of the
  same account, the `igd_` prefix deciding which), so any signed-in Mac's
  Settings › Account removes a lost phone, with no password asked, as a
  sign-out asks none; the web's devices page stays as the fallback. A Mac's
  own row offers no Revoke and `cloud.revokeDevice` refuses its own id: this
  device leaves through a sign-out, which also forgets its queue. The login
  route is throttled per caller address: a login route with no throttle is a
  password oracle.
  Rejected: the browser approve page, the one-time code, PKCE and the loopback
  callback, a ceremony whose point was keeping the password out of the app.
  Residual: the password passes through the app once over HTTPS. No social
  providers: a login that must work inside the app can only be a password. A
  device can also CREATE the account (owner decision: sign up in the app, with
  the invite code): `POST /v1/device/sign-up` answers the same credential
  `mintDeviceCredential` mints for a login and deletes the session the sign-up
  created, so a person never signs in twice in a row; `loginDevice` and
  `signUpDevice` share one tail that keeps the credential or gives its slot
  back. The site's sign-up page stays, and the phone stays sign-in only; the
  CLI has no sign-up verb, since creating an account is a person's act.
  `@repo/api/cloud/device/login-flow.ts`, `apps/web/src/worker/device/login.ts`,
  `apps/web/src/worker/device/sign-up.ts`, `apps/web/src/worker/device/routes.ts`,
  `apps/desktop/src/renderer/app/account-form.tsx`,
  `apps/desktop/src/renderer/app/settings/account-section.tsx`.

- **A CREDENTIAL THIS DEVICE DROPS IS REVOKED BY THIS DEVICE, best-effort and
  never waited on.** Forgetting the file alone leaves the row active, and the
  twenty-device cap counts active rows, so repeated sign-ins would lock the
  account out. `POST /v1/device/sign-out` is the dashboard's revoke asked with
  the device's own credential. The local server's `cloud.logout` (Sign out in
  Settings or the rail; the CLI has no logout verb), a login that replaces a
  live credential, and the phone's credential drop send it on a client of
  their own, since closing the session aborts its client's requests, and clear
  local state without waiting: an unreachable cloud must not hold a sign-out
  open. A revoke the cloud did not take is said on the desktop's signed-out
  status (`revokeError`) until the next login or restart, since the row stays
  live until another Mac's Settings › Account or the devices page removes it;
  one refused as unauthorized says nothing, since that credential is already
  dead.
  `apps/web/src/worker/device/routes.ts`,
  `apps/cli/src/server/cloud/sync-runtime.ts`,
  `apps/mobile/src/sync/sync-runtime.ts`,
  `packages/api/src/cloud/device/login-flow.ts`.

- **THE HOSTED VAULT'S PATHS ARE BUDGETED PER DEVICE, and the budget buys
  time, not prevention.** The `/v1/vault/*` reads, `/v1/vault/commit` and
  `/v1/git/*` each consume a window keyed on the device, never the address: a
  stolen credential moves between addresses and the device row is what
  `/app/devices` revokes. Three families so a drained budget never takes
  another down, a looping phone writer included; each ceiling is set from the
  worst legitimate minute, which for reads includes a phone's first mirror (a
  batch per 40 notes, a tree page per 500) and for writes a queue draining one
  change set at a time, and revocation is the control
  (`apps/web/src/worker/rate-limit.ts`). A read-scoped credential is the
  deeper answer and is not built; the trigger is a second party holding a
  credential for someone else's account.

- **`@repo/api/cloud` IS THE CLIENT RUNTIME CORE, not only the wire**:
  `bytes.ts`, `device/login-flow.ts`, `sync/sync-session.ts`,
  `sync/socket-link.ts` and `sync/cloud-socket.ts`. The CLI and the phone
  inject only stores, timers and a socket dial (node's `{ headers }`, React
  Native's third argument: `apps/mobile/src/sync/rn-socket-dial.ts`); a
  security discipline with two spellings is two to audit, and the socket's
  keepalive and reconnect are one too. The core is what BOTH clients run, so the
  CLI-only browser opener sits beside its consumer
  (`apps/cli/src/server/browser-opener.ts`). The cloud vault-path
  grammar is `parseVaultPath` with the parse required to be the identity. The
  `[[Title|uuid]]` tier lives in `buildResolver` (tier 0), reached through the
  `id` the wiki-targets rows carry, and on the phone through the id and aliases
  its mirror reads from each note's frontmatter as the text lands.

- **A /CLOUD CLIENT IGNORES WHAT IT DOES NOT KNOW, and the Worker is held to
  exactly what it declares** (owner decision, reversing "final at birth").
  Every response schema under `@repo/api/cloud` strips an undeclared field, and
  an unknown refusal code reads as `internal`, a fault to retry, never a
  verdict on the credential. Strict readers made every additive change a new
  route and turned a stale client's `unauthorized` into `malformed`, so a
  revoked device kept retrying; for the same reason a 5xx, 408 or 429 with no
  error envelope reads as `unreachable`. Requests stay `.strict()`, since only
  the always-newest Worker parses them, and the Worker's tests parse every
  answer through `emitted` (`apps/web/src/worker/__tests__/cloud-helpers.ts`),
  because a stripping client would let a leaked column through. Two things
  still close the wire: 0.4.0 and older parse strictly, and a field that
  changes what a row MEANS reaches only a client whose request declares it.
  `packages/api/src/cloud/cloud-client.ts`,
  `packages/api/src/cloud/cloud-errors.ts`.

- **ON THE PHONE, THE RUNTIME THAT MOVES A VALUE IS THE ONE THAT NOTIFIES.**
  `SyncRuntime`, the login flow and the dispatch runtime publish stores the
  screens subscribe to, so a poll pass, a revocation, a refused login and where
  a request to a Mac stands are shown; a refused capture keeps its text and its
  idempotency key, and a refused request to a Mac keeps its words and the Mac's
  reason until the user dismisses it. A sign-in is ONE session: the notes store
  and the dispatch runtime read under `SyncRuntime`'s session, so a revocation
  any request hears ends the sign-in for all of them, and each checks its fence
  before recording a refusal, so one heard under an earlier sign-in never ends
  the next (`apps/mobile/src/lib/compose-runtime.ts`). Which screens exist is
  the route guard's answer (`Stack.Protected` in
  `apps/mobile/src/app/_layout.tsx`), never a per-screen branch.
  `apps/mobile/src/sync/sync-runtime.ts`,
  `apps/mobile/src/login/login-store.ts`,
  `apps/mobile/src/dispatch/dispatch-runtime.ts`.

- **A pulled event lands through the SAME ingest, marked with its origin**
  (`ThreadService.applySyncedEvents`): the thread row takes the log's id,
  nothing is re-enqueued, and a settle does not drain this device's queue. The
  cursor moves inside that transaction, which makes the apply exactly-once. A
  synced row carries its origin `(device, position)` under a unique index,
  since signing in again resets the cursor, and the planner skips every device
  id the install has signed in as (`sync_own_devices`), because each sign-in
  mints a new id and its own rows carry no origin (`@repo/db/own-synced-copies`
  removes copies an older install pulled back). Lifecycle projects over what
  landed, never what arrived. `apps/cli/src/server/cloud/sync-pass.ts`.

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

- **A SYNC PASS IS CAPPED, A CAPPED PASS IS FOLLOWED AT ONCE, AND "SYNCED"
  MEANS EVERY STEP REACHED THE CLOUD AND LEFT NOTHING.** Each step answers
  where it stopped (`SyncOutcome` in `@repo/api/cloud/sync/sync-session`). The
  cap stays because a teardown waits out the pass in flight; on `more` the
  next pass runs at once, so a backlog drains in one sync. Only a pass whose
  every step caught up stamps `lastSyncedAt`. A throw other than a row the log
  refuses fails the pass with the cursor unmoved, because moving past it would
  lose the row for good. The status reaches the renderer on the bus's
  `sync-status-changed`, so nothing polls it; the socket drops itself after two
  silent keepalives, since a half-open connection neither answers nor closes.
  `apps/cli/src/server/cloud/sync-pass.ts`, `sync-runtime.ts` and
  `packages/api/src/cloud/sync/cloud-socket.ts`.

- **The outbox stores the bytes it will send, once, at enqueue.** The log calls
  a position replayed with a different body `sync-conflict`; `deviceSeq` is its
  own counter, not `MAX()` over a shrinking queue. A body over the row cap is
  CLIPPED before it is frozen, never dropped, because a dropped
  `item/completed` leaves its item pending on every other device forever:
  `clipThreadEventForSync` (`@repo/api/cloud/sync/fit-sync-event`) elides the
  middle of the largest texts and never a type, an id, a status or a scope. An
  event the contract still refuses is dropped rather than stranding every event
  behind it, and so is every row a log refusal names; each drop is COUNTED in
  the delete's own transaction (`sync_state.dropped_events`), shown in
  Settings and `inteligir cloud status` until sign-out, because the last error
  it raises is cleared by the next good pass while the loss is not
  (`apps/cli/src/server/cloud/outbox.ts`, `packages/db/src/sync-outbox.ts`).

- **A PULLED ROW THIS BUILD CANNOT READ IS PULLED AGAIN BY THE NEXT BUILD.** The
  planner moves the cursor past a foreign row its grammar refuses, because the
  rows behind it must still land; the pass records the lowest such row with the
  running build, and a session opened under a different build rewinds to it
  (`takeRewindIfBuildChanged` in `packages/db/src/sync-outbox.ts`, from
  `apps/cli/src/server/cloud/sync-runtime.ts`). Rejected: `meta.schema_version`
  as the trigger, which counts migrations while a new event type ships without
  one, and a table of raw skipped rows, a second store beside the log. The
  phone keeps its threads in its database with the digest of the event
  grammar that parsed them, and a build whose grammar differs pulls from 0:
  its held events lost what the old grammar did not name, so a rewind to the
  skipped row would not be enough. Each pulled page is one transaction with
  the cursor, and the boot restore reads the threads back before the sign-in
  is published, so a cold launch lists them offline and pulls on from its
  cursor (`apps/mobile/src/sync/sqlite-sync-store.ts`).

- **The THREAD channel carries thread events alone, and a thread's own facts
  are events on it** (owner decision). A thread with no events never reaches
  another device; vault bytes ride the git remote. A thread states its title,
  origin note (path and `id`, so no move is ever stated), harness and archive
  as rows on its log (`thread/meta`, `thread/archived` in
  `@repo/domain/provider-event`); a fact about a thread that never made a
  request stays local, since alone it would arrive as an empty action. A stale
  install skips a type it cannot read, so a new event type needs no new route.
  The Worker keeps no per-thread row beside the log (owner decision): the
  push's `threads` half and the `thread_meta` lane it filled are gone, the
  dispatch inbox carrying what the lane was for, and a 0.4.0 install's
  `threads` is still accepted and dropped, since refusing the key would refuse
  its every push. `apps/cli/src/server/threads/service.ts`,
  `packages/api/src/cloud/sync/sync-schema.ts`.

- **Cloud state names its Durable Object from a VERIFIED credential.** Account
  deletion revokes credentials first, then purges, then writes a tombstone every
  route refuses, because the reorder alone leaves an in-flight request able to
  recreate state. The Worker calls the object by RPC with the verified deviceId
  as an argument, so no forwarded header carries identity; the socket upgrade,
  which only fetch can carry, is the one exception, and its identity lands in
  hibernation tags (`apps/web/src/worker/sync/routes.ts`, `thread-sync-do.ts`).

- **Say the delivery guarantee you implement.** Captures are at-least-once
  delivery with exactly-once deletion by the owning claim, so the apply must be
  idempotent on the capture id (`@repo/api/cloud/captures/captures-schema`).

- **Better Auth's `baseURL` is derived per-request from the request origin, and
  sign-up is invite-gated by a Worker route in front of it.** Every hostname
  reaching this Worker is one the deployment owns, and a fixed fallback would
  mint reset links at the wrong deployment; revisit if a hostname the
  deployment does not control reaches it (`apps/web/src/worker/auth/auth.ts`).
  The gate has two front doors over one atomic claim (`claimInvite`, one
  `UPDATE … WHERE redeemed_at IS NULL`, in `apps/web/src/worker/auth/invite.ts`):
  the site's page forwards into the one instance with `disableSignUp` off, so
  the browser keeps Better Auth's cookie; the app's
  (`apps/web/src/worker/device/sign-up.ts`) calls `signUpEmail` on that same
  instance and then mints a device credential. Either door releases the claim
  when no account came of it, and both spend one per-address window; every
  other instance carries the flag. `apps/web/README.md` § Auth.

- **The D1 auth schema ships via `drizzle-kit push`; there are no migration
  files.** One deployer and an additive schema; `apps/web/vitest.config.ts`
  derives the test DDL by `drizzle-kit export`. A second deployer or a
  destructive column change is the trigger for migrations. Never flip the
  timestamp mode in place: both modes read the same INTEGER column, so a
  redeploy without `UPDATE <table> SET <col> = <col> * 1000` reads every date as
  1970 and expires every session.

- **Declare D1 uniques as named unique indexes, never `.unique()`**
  (`apps/web/src/worker/db/schema.ts`). Production D1 was pushed by drizzle-kit
  0.31, which spelled every `.unique()` as `CREATE UNIQUE INDEX
  <table>_<column>_unique`. drizzle-kit 1.0 spells it as an inline `UNIQUE`
  constraint and treats the difference as a table recreate: `PRAGMA
  foreign_keys=OFF; CREATE __new; INSERT; DROP; RENAME`. D1 ignores that PRAGMA,
  so the `DROP` cascades through every `ON DELETE CASCADE` child (`session`,
  `account`, `device`), and `push` applies a recreate without asking. With
  `uniqueIndex("<table>_<column>_unique")` in the table's extra config,
  `drizzle-kit push --explain` against a 0.31-shaped database reports no
  changes; refuse any plan that recreates a table.

- **THE HOSTED TREE IS WALKED ONCE PER HEAD, and kept in ONE SLOT PER REPO.**
  Every directory is a call into the repo cell a push also waits on, and the
  phone pages the whole tree on every refresh, so a head's listing is kept in
  R2, tagged with its commit. One slot, not a key per commit, which would keep
  an object for every head any device ever listed; a cache failure is a miss,
  never a refusal. `apps/web/src/worker/vault/tree-walk.ts` (pure, over a
  `listTree` port) and `tree-listing.ts`.

- **THE HOSTED VAULT TAKES A PUSH OF AT MOST 90 MiB, AND A VAULT OVER IT SAYS
  `too-large`** (owner decision: a stated cap now, large files later).
  `VAULT_GIT_MAX_PUSH_BYTES` in `packages/api/src/cloud/vault/vault-git.ts` sits
  under the edge's 100 MB request body, so the 413 is always the Worker's own
  (`apps/web/src/worker/vault/receive-pack.ts`). Splitting the push into
  commit-sized steps was rejected: a vault's first commit is the whole tree.
  The engine skips a push while the tips a 413 refused still stand, since each
  retry would upload the cap's worth again
  (`apps/cli/src/server/vault/git-engine.ts`). The first refusal costs no
  upload either: the Worker can answer only once the body has arrived, so a
  push to the account remote is measured first (`measuredOverCap`), by an
  on-disk estimate and, at half the cap or more, by packing what the push would
  send, counted and killed at the cap (`packExceeds` in
  `apps/cli/src/server/vault/git-run.ts`). A measurement that fails pushes,
  with the 413 behind it.

- **THE WORKER WRITES THE HOSTED VAULT THROUGH THE CELL'S OWN RECEIVE-PACK.**
  durable-git's `RepoCell` answers reads alone, and its one write path, a push,
  already guards each ref with a CAS under a savepoint on a serialized chain.
  So the Worker builds a change set's git objects itself
  (`apps/web/src/worker/vault/git-objects.ts`) and pushes them like any client,
  through the one door every push takes (`receive-pack.ts`, which also runs the
  after-push ping and registry upsert). Rejected: patching a write RPC into
  durable-git, a second writer with its own locking beside the push chain. A
  set commits whole or not at all on the head it was checked against, each
  change a CAS on the blob it was computed from, and a change whose target the
  head already holds is satisfied, which is what makes a resent set harmless
  (`apps/web/src/worker/vault/commit-changes.ts`). Two things the cell cannot
  settle are refused rather than guessed: a tree whose listing does not hash
  back to its own oid, since the cell decodes names leniently and a rebuild
  would rename a sibling, and a name a sibling holds in another case or
  normalization, since a Mac cannot hold both. Author and committer both name
  the device, the committer's email marking the Worker, because a conflict
  copy names the other device from the committer.

- **A MIRROR READ IS PINNED AND BATCHED.** A phone holds every note's text, so
  the tree lists each blob's `oid` and the phone fetches only what changed,
  forty paths to a `POST /v1/vault/files` that spends one read unit. Rejected:
  one `/v1/vault/file` per note, which made a 5,000-note first mirror 5,000
  requests against the device's budget. `ref` is REQUIRED on the batch: the
  mirror diffed one listing, and a batch read at a head a push moved would
  hand it bytes that listing never named. The listing slot stays one per repo,
  keyed by the head a read resolved, and now holds the oids; a slot kept in the
  older shape fails its parse and is walked again, so it needs no migration.
  Forty because each path is a call into the repo cell and a Free invocation
  makes at most 50 subrequests; past the byte budget the rest is `deferred`,
  never the first file. `packages/api/src/cloud/vault/vault-schema.ts`,
  `apps/web/src/worker/vault/read-routes.ts` and `tree-listing.ts`.

- **A PHONE WRITE IS A CHANGE SET OF BLOB-CAS'D CHANGES, ONE COMMIT OR NONE.**
  `POST /v1/vault/commit` takes puts, deletes and moves, each naming the blob
  it was computed from (null: the path must be absent), so a rename's link
  rewrites, a photo and the note embedding it, or a merge and its conflict copy
  land together. A stale base answers 409 `vault-conflict` with what the head
  holds, its text and the device that last wrote it, beside the ordinary
  envelope, so a reader that knows only the envelope still reads a refusal it
  can name; the Worker never merges, the phone reconciles with the desktop's
  own policy and sends one new set. A replay is "the head already holds the
  target", answered with the commit that holds it, so an offline queue's
  resend is harmless with no idempotency key, which would be a second store
  the Worker must keep and expire beside the repo. The base is a blob oid, not
  a commit: a desktop push of another note between the phone's read and its
  write must not refuse it. An account whose hosted vault does not exist yet
  is refused, never created: the Mac's first push creates it. The request's
  bytes are bounded on the declared length, text as UTF-8 with no lone
  surrogate and base64 only on an attachment path, and the device row's name
  authors the commit. `packages/api/src/cloud/vault/vault-commit-schema.ts`,
  `apps/web/src/worker/vault/commit-route.ts`.

- **THE PHONE HOLDS EVERY NOTE'S TEXT IN SQLITE, AND ITS MIRRORED COMMIT MOVES
  ONLY WHEN THE MIRROR IS WHOLE.** One expo-sqlite file in Documents, never the
  purgeable cache, kept out of the iCloud device backup (owner decision: it
  downloads again) by the local module `apps/mobile/modules/backup-exclusion`.
  A row per file the tree names: its oid, the commit its blob first appeared
  at (an attachment is fetched there, so a commit that leaves the blob alone
  never fetches it again), and for a note or a comment store its text with the
  frontmatter id and aliases read once as it lands, so the resolver's alias
  and uuid tiers answer on the phone. A refresh applies the listing in one
  transaction by oid,
  copies a blob it holds under another path rather than fetching it, and fills
  the empty rows in pinned batches, each its own transaction landing only on a
  row still naming the answer's oid; the commit advances when no wanted row is
  empty, so a refresh cut short resumes from those rows. Rejected: a body
  cache keyed `(commit, path)` beside a tree held in memory, which shows
  nothing on a cold offline launch, loses every body to any commit, and holds
  no frontmatter.
  Attachments download on the first ask, named by oid, under the cache. A
  sign-in, a sign-out and a revocation wipe the rows and the attachments; the
  boot restore keeps them and serves them before any request; every await
  re-checks the session and every write a wipe generation, so a batch started
  before a wipe never lands. The phone's database has ONE `user_version`, so a
  table another module adds is a step appended to
  `apps/mobile/src/lib/phone-db.ts`. `apps/mobile/src/notes/vault-mirror.ts`,
  `apps/mobile/src/notes/notes-store.ts`.

- **A PHONE EDIT IS A QUEUED WRITE WITH ITS BASE, AND THE PHONE SETTLES ITS OWN
  CONFLICTS.** A write is durable in the phone's `outbox` table before it
  resolves, and reads, the listing and the resolver see it from then on; the
  rows go to `POST /v1/vault/commit` oldest first, one change set per row, on
  every write, resume, reconnect and a backoff. A read records the blob the
  caller's next write is computed from and a write with none throws, the
  desktop's guarded io; a write to a path whose last row writes it replaces the
  text and KEEPS THE FIRST BASE, so three offline saves are one write. The
  Worker never merges: a 409 is settled on the phone by `reconcileFile`
  (`@repo/notes/sync/reconcile-file`), the desktop's own verdict, so a far edit
  merges, an overlap keeps the phone's version and copies the other device's,
  an edit beats a delete either way, and the result and its copy land as ONE
  set. That set is kept on the row before it is sent, so an answer lost after
  the vault applied it is resent unchanged and answered as already held. A
  landing moves the mirror in the
  transaction that retires the row and stamps what it moved, and a refresh
  skips every row stamped after it read the stamp, because its tree may
  predate the write. Nothing is dropped: unreachable stops and keeps the queue,
  a refusal no resend passes PARKS its row with its bytes while other paths go
  on, and a sign-out with anything unsent asks first (owner decision: it then
  discards them, and a revocation wipes them with the mirror). Rejected: a
  merge on the Worker, a second policy beside the desktop's; and replaying the
  intent after a lost answer, which reconciles the phone against its own landed
  set and can copy it again.
  `apps/mobile/src/notes/vault-outbox.ts`,
  `apps/mobile/src/notes/outbox-reconcile.ts`,
  `tools/e2e/src/scenarios/phone-offline-edit.ts`.

- **A PHONE ASKS A MAC THROUGH A CLAIMABLE DISPATCH INBOX, AND THE MAC'S
  APPROVALS COME BACK THROUGH IT** (owner decision). The phone never pushes to
  the log, so a request cannot ride it: a `turn` row waits beside the captures
  in the account's `ThreadSyncDO`, any Mac may claim it and the first claim
  wins, and it pings the sockets of the Macs that take a phone's requests with
  the `dispatch` frame 0.4.0 already parses. A phone-started turn's approval is opened there by the Mac holding
  its waiter and listed for the phone; the phone's `answer` is a row only that
  Mac may claim. The guarantee: at-least-once delivery to a claimant, a row
  settled only by the claim that holds it, and a Mac's apply exactly-once on
  the dispatch id, which the phone mints so a resend is one row. An unclaimed
  row waits until a Mac claims it or the phone cancels it; a claim lapses
  after `DISPATCH_CLAIM_TTL_MS`, judged on read. Revoking a phone drops its
  waiting rows, revoking a Mac closes its approvals, and a settled row is kept
  a day for the phone's status poll. Rejected: the `thread_meta` lane, which
  carried no message and no claim, so two Macs would both run it, and which
  every desktop push overwrote; and the phone as a log pusher, which would
  give it an outbox and a `deviceSeq` of its own.
  `packages/api/src/cloud/dispatch/dispatch-schema.ts`,
  `apps/web/src/worker/sync/dispatch-inbox.ts`.

- **THE PHONE'S FILE VERBS PLAN WITH THE SERVER'S PURE RULES, AND EACH IS ONE
  CHANGE SET** (0.6 direction: the phone is a full editor). Create, rename,
  delete and a photo (`apps/mobile/src/notes/file-ops.ts`) run the rules the
  server does (`plan-rename`, `store-removal`, `asset-name` in `@repo/notes`),
  because a phone copy is a second spelling that drifts. A rename plans over
  the phone's own link graph, built from the text it holds, and queues the
  move, the note's own new text and every rewritten note as ONE row: the
  commit route names each path once, so a rename that changes its note's text
  deletes the old path and puts the new one under the same guards a move
  takes. A rewritten note another device changed first keeps its bytes and is
  named (`reconcileRename` in `apps/mobile/src/notes/outbox-reconcile.ts`), as
  is one past what a set carries; the old stem's alias still answers its link.
  A delete carries the note's comment store in its set, so a note the vault
  keeps because another device edited it keeps its comments. Notes only: no
  folder verbs on the phone in 0.6 (owner decision). A photo is a JPEG at most
  2048px on its long edge (`apps/mobile/src/notes/photo-ingest.ts`): a HEIC is
  no asset type the vault takes and the Mac's editor cannot draw it, and the
  re-encode writes no EXIF, so no location reaches the vault's history.
  Rejected: link rewrites as rows of their own, which could land a rename
  without the links it moved, and a typed name cleaned up rather than refused,
  which shows a title that was never saved.

- **THE HOSTED VAULT IS CAPPED ON WHAT THE CELL STORES** (owner decision: free,
  about 1 GB an account, every stored version counted, so deleting notes frees
  nothing, and no compaction in 0.6). `VAULT_STORAGE_CAP_BYTES` in
  `apps/web/wrangler.jsonc` is the ceiling, and the cell's own size is
  `RepoCell.usage()`, a pnpm patch over durable-git
  (`patches/durable-git@0.0.8.patch`): its SQLite file plus the packs it keeps
  in R2, not the gc guard's sum, which counts a SQLite-held pack twice. ONE
  gate, in `apps/web/src/worker/vault/receive-pack.ts`, meets every pack headed
  for a cell, a desktop's push and a phone's commit alike, so the two cannot
  disagree: a full vault is refused before the body is read, a declared length
  past the room left is refused, and a streamed body is cut at the tighter of
  the room and the 90 MiB push cap, the answer naming which. Pushes landing
  together may each fit and jointly cross the cap; the next is refused. The
  remote answers 507 (the push cap stays 413), the commit route `vault-full`;
  reads are never refused for size. The engine reads the 507 as `full`, not
  the offline a 5xx would be, and pushes again only once the remote's tip
  moves or the app restarts, while commits land and pulls go on
  (`apps/cli/src/server/vault/git-engine.ts`); the phone keeps the refused
  edits queued. Rejected: a Worker-side meter, which counts bytes offered, not
  kept, and the head tree's size, which ignores the history that grows.

- **AN ACCOUNT IS DELETED FROM THE APP, THE PASSWORD ASKED AGAIN, THROUGH
  BETTER AUTH'S `deleteUser`** (owner decision: someone who lost their Mac signs
  in on any Mac to delete). The app holds a device credential and no session, so
  `POST /v1/account/delete` takes the credential, spends a per-device window,
  checks the password through `signInEmail` and runs `deleteUser` under the
  session that sign-in minted: its `beforeDelete` order and tombstone stay the
  ONE purge path, where a second purge beside it would drift. The credential
  alone deletes nothing, since whoever holds a stolen one could end the account.
  The local server asks on a client of its own, because the purge revokes this
  very credential first, and a pass that meets the revocation ends the session,
  which aborts every request on the session's client; success forgets the
  sign-in as a sign-out does, minus the revoke, and leaves the vault alone. A
  deletion whose answer never came back may have happened, so the server keeps
  its credential, and a retry that meets only that credential's refusal, or
  finds the session already ended by it, is read as the account gone and signs
  this Mac out; any other refusal proves the account is there. No CLI verb:
  the password is a person's to type.
  `apps/web/src/worker/device/account.ts`,
  `apps/cli/src/server/cloud/sync-runtime.ts`,
  `apps/desktop/src/renderer/app/settings/delete-account-dialog.tsx`.

- **THE PHONE HOLDS THE ACCOUNT'S SOCKET ONLY IN THE FOREGROUND, AND A RUNNING
  TURN'S TEXT IS NEVER STORED.** A desktop pushes a running turn every second
  and a half and the cloud pings every other socket on each push, so a phone
  with the socket reads a reply as it grows; the background closes it, since
  iOS suspends the app anyway, and the poll stays for a missed ping. The
  deltas the store drops are folded in memory until each item's
  `item/completed` (`apps/mobile/src/sync/live-turns.ts`), fed only what a
  page landed, so a page pulled twice folds once. Rejected: holding the deltas
  in the phone's database, which a long turn fills with tokens its settled
  items already carry, and folding an item this launch never saw start, whose
  head was pulled before a relaunch and would draw the tail as the reply.
  `apps/mobile/src/sync/sync-runtime.ts`.

- **A PHONE COMMENT IS ITS MARKERS AND ITS ENTRY IN ONE CHANGE SET** (owner
  decision: the phone comments and replies in 0.6, superseding comments
  through the capture inbox, #684). The touch toolbar's Comment takes the row
  for the words and puts the kit's markers in only at Save, and the page's
  flush that writes them goes as `addComment`, not `write`, carrying the
  comment (`apps/mobile-editor/src/host/page-host.ts`); the phone plans the
  entry under its write lock from the texts it holds and queues the note and
  its store as ONE `comment` row (`editComments` in
  `apps/mobile/src/notes/notes-store.ts`), a note without an id minting one by
  the desktop's line cut (`@repo/notes/comments/comment-key`), every entry
  signed `user`. A reply and a resolve are rows of the store alone, their
  verbs `apps/mobile/src/notes/comment-ops.ts`. A stale set is settled per
  path (`reconcileComment` in `apps/mobile/src/notes/outbox-reconcile.ts`): the
  note as a write is, copy included, and the store by its entries, so a
  comment another device made meanwhile keeps both threads. Rejected: markers
  in at the field's opening, as the desktop's popover does, which the 600ms
  autosave writes long before there is a comment, so a pull could find markers
  with nothing behind them; and a store write in a row of its own after the
  note's, which is the same gap. Residual: a hardware chord's create on the
  phone opens the desktop's popover after its markers are in, so its entry
  lands in a set of its own; and when two devices each give one id-less note
  its first comment at once, whichever settles the overlap keeps its own id,
  and the other's thread waits under an id no note carries.

### Server process and the desktop shell

- **ONE BINARY, TWO MODES: `inteligir serve` IS the server, and `npx` is a verb**
  (reversing the launcher-boots-in-process line). `npx inteligir serve --open`
  is the developer's and the agent's zero-install path, with one exit code; a
  user installs the signed dmg and never meets it. The desktop shell still
  forks a child so the compositor never shares an event loop with
  better-sqlite3, a watcher fork and `git`, supervised with the deliberate
  absence of a restart (`apps/desktop/src/main/server-process.ts`). Whether
  `server.json`'s owner still serves has ONE reading,
  `apps/cli/src/server/server-probe.ts`, which the boot's guard and the
  shell's adoption both project; the shell refuses a server of another
  version, because `/local`'s two ends may break freely only while they ship
  together.

- **A DATA DIR HAS ONE SERVER, AND THE LOCK, NOT THE ROW, DECIDES IT.**
  `server.json` is published only after listen, so two boots started together
  would both find no row and open one db. `serve` takes `<dataDir>/serve.lock`
  (O_EXCL, holding its pid) before anything is composed; a live pid holds it
  unless its published row is judged gone, because a crash's pid can be reused
  and must not block boot forever. A server removes `server.json` only when
  the row carries its own token, so a shutdown never retracts another boot's
  address. `apps/cli/src/server/serve-lock.ts` and `claimDataDir` in `serve.ts`.

- **ONE COMPOSITION ROOT, AND THE SERVER IS SPLIT ALONG ONE-RESPONSIBILITY
  SEAMS.** `apps/cli/src/server/compose.ts` builds every service in boot order
  and returns `{ context, teardown }`; `createApp` is route wiring, `serve.ts`
  is the data-dir claim + listen + `server.json` + signals + exit code, and the
  booted suites call the same composition. `ThreadService.boot()` is called
  from it because crash recovery writes. The seams: `vault/git-run` /
  `git-porcelain` / `git-bootstrap` / `git-engine`; `cloud/sync-pass` /
  `sync-cadence` (the socket link is the client core's, shared with the phone);
  `agents/interaction-waiters` beside a
  watchdog that sweeps per-turn timestamps rather than re-arming a timer per
  frame; `writeTransaction` in `@repo/db/connection` as the one spelling of
  `BEGIN IMMEDIATE`.
  `serve.ts` injects node's socket dial and the agent driver because
  compose is reachable from the renderer's test program, and, under the desktop
  shell, the brokered watcher channel and adapter spawner
  (`child-host/node-children.ts`), because only a utility-process child has a
  parent port to ask main through. `dev-instance.ts` owns the per-checkout
  derivation; `config.ts` stays the parser.

- **THE BIN EXITS 128+n WHEN THE SERVER DIES BY SIGNAL, NEVER 0**
  (`apps/cli/bin/inteligir`). Re-raising the signal at the wrapper exited 0.

- **THE CREDENTIAL IS A FILE, NOT A CHALLENGE** (reversing the
  loopback-adoption-is-earned line). The server writes `<dataDir>/server.json`
  at 0600 and removes it on ordered shutdown; every caller reads it and sends
  the bearer. No port scan and no challenge: the address is the row's, never a
  guess; whether the row's owner still serves is one authenticated status call
  (`server-probe.ts`, under ONE BINARY). The bound is the honest one: it proves
  the caller can read the data dir, not that it is this code. A BROWSER CANNOT
  SEND A HEADER, so it holds its own per-boot secret in an HttpOnly
  SameSite=Strict cookie, set only by trading a single-use handoff nonce a
  bearer holder minted (`system.browserHandoff`); a request with neither gets a
  401 page that runs nothing and names the ways in, never the shell, which
  would fail every call with nothing saying why
  (`apps/desktop/src/renderer/app/signed-out-state.ts`). The cookie, being
  ambient, must also prove same-origin, because loopback "site" ignores the
  port, and EVERY REQUEST MUST NAME 127.0.0.1 OR localhost AS ITS HOST, so a
  rebinding page gets nothing. Residual: a cookie is port-agnostic, which is
  why it is not the bearer and dies with the boot.
  `apps/cli/src/server/server-file.ts`, `browser-session.ts`,
  `browser-request.ts` and the guard in `app.ts`.

- **Shutdown is ORDERED, per-step TIME-BOXED, and its exit code is the truth.**
  Writers stop, the vault flush runs, handles close; each step has its own
  budget because one wedged step under a single budget starves the flush. The
  listener step closes websockets by name (`wss.clients`), because an upgraded
  socket is detached from the HTTP server's tracking and one open tab can stall
  the teardown. The step list is re-read before every step, so a boot still
  composing when the signal lands adds what it brings up.
  `apps/cli/src/server/shutdown.ts` and `listen.ts`.

- **THE CSP IS STATIC, and deleting TanStack Start from the product bought
  that** (reversing the nonce CSP). A plain Vite SPA injects no inline script,
  so `script-src` is `'self'` and one fixed header serves both the protocol
  handler and the server; `connect-src` earns the most, since a script that
  cannot reach a third-party origin cannot exfiltrate the vault
  (`apps/cli/src/server/csp.ts`). The first-run page has a second policy, as
  static, that names no websocket origin (`wsOrigin: null`), since no server
  exists for it to dial. NOTHING REMOTE LOADS IN A NOTE: a remote embed
  is a beacon on every open, so it draws as a card
  (`packages/editor/src/nodes/remote-content-card.tsx`); widening the policy is
  a privacy decision. AN HTML BLOCK'S RUN IS A FRAME WITH A POLICY OF ITS OWN,
  `sandbox allow-scripts; default-src 'none'`
  (`apps/cli/src/server/html-block-frame.ts`); dropping Run was the rejected
  alternative, since interaction is what the block is for. `pnpm dev` stamps no
  CSP, so only `tools/e2e/src/scenarios/remote-content-browser.ts` sees either
  regress.

- **THE RENDERER'S ONLY DOOR IS `inteligir://app`.** The protocol handler
  carries the bundle, `/rpc/*` and `/vault/asset`, attaching the bearer in
  main, so the page is same-origin with its API, there is no CORS, and the
  renderer never holds the token (which keeps `<img src>` working). Websockets
  are the one exception, since a browser WebSocket cannot be proxied: main
  attaches the bearer to those upgrades and the preload hands the renderer the
  loopback origin. BOTH CARRIERS LEND THE BEARER ONLY TO THE PAGE
  (`carriesBearer`), so a sandboxed note frame gets a 403 and a bare upgrade.
  The pin cannot use `URL.origin`, which answers `"null"` for any non-special
  scheme. Before the first boot the same scheme serves the first-run page on a
  session of its own with no server behind it: `/rpc/*` and `/vault/asset`
  answer 503. THE BRIDGE CARRIES ONLY WHAT MAIN OWNS (the loopback origin, the
  updater, the spell checker, the vault switch, Reveal/Open, the diagnostics),
  because no server can answer for any of them; the first-run window has a
  preload of its own carrying the vault choice alone, and main answers each
  window's rows to that window only. Each channel is one row
  (`apps/desktop/src/ipc-contract.ts`) typing both ends, every frame parsed by
  the side that receives it, and its test holds both ends to every row
  (`apps/desktop/src/main/__tests__/ipc-contract.test.ts`). A refusal crosses
  as a value (`{ ok: false, reason }`), never a throw, because Electron rewords
  a thrown error. `apps/desktop/src/main/protocol.ts` over
  `protocol-handler.ts`, `origin-pin.ts`, `credential-scope.ts`,
  `apps/desktop/src/types.ts`, `apps/desktop/src/renderer/app/socket-origin.ts`.

- **UPDATES ARE electron-updater OVER THE GITHUB RELEASE, and nothing moves
  without a click** (reversing "no update feed"). The release carries the dmg,
  the zip Squirrel installs from, its blockmap and `latest-mac.yml`, uploaded
  by the owner's release step (`docs/releasing.md`), never by
  electron-builder. `autoDownload` and `autoInstallOnAppQuit` are off: a check
  15s after launch and every 4 minutes, the download and the restart each a
  click. Install stops the server child first, so the vault's pending commit
  flushes before Squirrel swaps the bundle. `apps/desktop/src/main/updates.ts`
  (the policy over an injectable port) and `apps/desktop/src/update-state.ts`
  (a union by status).

- **SPELL CHECK IS THE SESSION'S SWITCH, AND THE PAGE KEEPS THE CHOICE.** Only
  main can flip Chromium's checker, so Settings asks through the bridge and
  keeps the choice in the page's own prefs; no main-side store, because the
  choice is a page preference like the theme. On macOS the OS checker detects
  the language itself, so the row says so instead of pretending.
  `apps/desktop/src/main/spellcheck.ts`,
  `apps/desktop/src/spellcheck-state.ts`,
  `apps/desktop/src/renderer/app/desktop-spellcheck.ts`.

- **THE SHELL ASKS THE LOGIN SHELL FOR PATH BEFORE THE FIRST FORK.** A Finder
  or Dock launch inherits launchd's bare PATH. The agent's runtime needs none
  (it is bundled, and nothing about the agent reads PATH), but the agent's bash
  and the vendor's stdio MCP servers run the user's own commands by name, which
  launchd's PATH does not reach. A packaged macOS shell runs `$SHELL -ilc`
  once, capped at 5s, and prepends its PATH to main's own, which every child
  spreads. A fixed list of bin dirs alone is rejected, as is an `LSEnvironment`
  PATH in the bundle: neither can know a version manager's directory.
  `apps/desktop/src/main/login-shell-path.ts`.

- **THE PACKAGED BINARY'S FUSES ARE ALL FLIPPED, AND MAIN FORKS THE SERVER'S
  NODE CHILDREN.** electron-builder flips them before signing, so no local
  process can run the signed app as a node interpreter, `file://` pages get no
  extra privileges, the cookie store is encrypted, and only an `app.asar`
  matching its embedded hash loads (the unpacked server is the signature's to
  guard). With `runAsNode` off a
  utility process cannot fork one of its own, so the server asks main over its
  parent port for the vault watcher and each ACP adapter
  (`apps/desktop/src/main/fork-broker.ts`, `apps/cli/src/server/child-host/`).
  Rejected: a bundled node binary, a second signed interpreter to patch, and
  worker threads, which trade the watcher's sigkill recovery and an adapter's
  own process. Under plain node (`serve`, npx) the server forks both with
  `child_process`. The flip breaks Electron's ad-hoc signature, which Apple
  Silicon enforces, so `resetAdHocDarwinSignature` re-signs the app ad-hoc
  right after. `apps/desktop/electron-builder.yml`.

- **DIAGNOSTICS ARE `INTELIGIR_DEBUG`'S NAMED TRACES, SHIPPED IN EVERY BUILD.**
  The watcher, the index, the sync pass and the ACP adapter drop, skip and fence
  without a trace, and a user's "it didn't update" cannot wait for a build. So
  each decision calls its namespace's log, which is `undefined` while the
  namespace is off: an optional call evaluates no argument, so an untraced site
  costs one read. A line names paths, ids and protocol words, never a note's
  content or a credential, because it is written to be pasted into a report;
  the ACP tap drops any field that is not a protocol word
  (`packages/agent-runtime/src/acp/frame-trace.ts`). An unknown name is refused
  at boot, since a misspelt one reads as "nothing happened". A levelled
  logger was rejected: the value is these few decisions, not more volume.
  `apps/cli/src/server/debug-log.ts`, end to end in
  `tools/e2e/src/scenarios/debug-log.ts`.

- **THE RELEASE NOTES ARE THE CHANGELOG, WRITTEN FOR THE PERSON USING THE
  APP.** A release's GitHub body is `CHANGELOG.md`'s top section, so the
  release, the update it ships and the file say one thing. A list generated
  from commit subjects or issue titles was rejected: both are written for
  whoever builds the thing, and they describe an update as "something
  changed". `apps/desktop/scripts/release-notes.mjs` prints the section as
  the release's notes (`docs/releasing.md`) and refuses one not titled for the
  package's version; `tools/repo-guards/src/changelog.test.ts` holds the
  file's shape and makes a version bump date its section. Settings › About
  links the file on main
  (`apps/desktop/src/renderer/app/settings/version-row.tsx`).

- **THE PACKAGED APP'S DIAGNOSTICS ARE A SWITCH AND A FILE, BOTH MAIN'S.** A
  Finder-launched app has no env to set `INTELIGIR_DEBUG` in and drops main's
  stdout, so the traces above could not reach a user's report. Debug logging
  is Settings › Advanced's switch, kept as `diagnostics.json` in the shell's
  userData, because main reads it before the fork it changes; the page's
  prefs load after that fork, and config.json is the app's to read, never to
  write. On, the next child traces every namespace, since a report cannot
  know which decision went wrong, so a change asks for a Restart, which is
  `app.relaunch` through the ordinary quit (the child stops first and its
  commit flushes), refused in a dev shell. Whatever the child prints, traced
  or not, is appended to `<dataDir>/logs/server.log`, rotated at 5 MiB into
  one `.1`, and a write that fails costs the log, never main; the server
  writing its own file was rejected, since a crash before its logger is up is
  the line a report most needs. An adopted server is nobody's child here, so
  the switch is refused and says why. `apps/desktop/src/main/diagnostics.ts`,
  `apps/desktop/src/main/server-log.ts`, end to end in
  `tools/e2e/src/scenarios/desktop-diagnostics.ts`.

- **FIRST RUN IS DECIDED IN MAIN BEFORE ANY SERVER EXISTS** (0.6 direction: a
  knowledge worker chooses between a new vault and a folder they already
  have). A server is bound to one vault and one data dir, so the vault is
  main's to ask for before any child is forked; the agent and the account
  follow as steps in the app window, which opens on `/welcome`, a layer over
  the workspace like Settings. `planLaunch` asks only when nothing chose a
  vault (no env pin, no `vaultDir` in config.json) and the default vault's
  folder does not exist, so an upgrade, `inteligir serve` and a pinned harness
  never meet it. It replaces booting the default vault unasked, which created,
  seeded and committed `~/Inteligir` before the user said anything and left it
  behind when they opened a folder instead. The first-run window is its own: an
  in-memory partition locked down like a vault's, `inteligir://app/first-run.html`
  with no server behind the handler, and a preload of its own, built apart
  because a sandboxed preload can require no chunk beside it
  (`apps/desktop/electron.vite.config.ts`). Every folder the page names back is
  one main handed out (the proposal's parent, a pick), and a choice is resolved
  exactly as a boot would before anything is written (`planFirstRunChoice`). An
  existing folder is plain markdown where it is, shown before it opens with what
  `inspectVaultFolder` says of it: its notes, a service that syncs it (which
  keeps it, so the hosted vault stays off), an origin of its own; a picked
  switch later asks the outside-sync check alone (`folderExternalSync`), never
  the walk and the git read. Until a vault is open the updater still runs and
  the menus offer nothing that needs one. `/welcome` then offers the agent and
  an account in turn, each skippable, the step in `?step=` beside the `?note=`
  the workspace underneath mirrors (so its boot keeps the step), and composes
  the shared controls rather than spelling either flow again: `AgentSignIn`,
  or the default agent shown connected when the vendors' shared store already
  holds a sign-in, then `AccountForm` opening on Create, whose sentence follows
  where the vault already syncs, and which moves on by itself once the device
  is signed in. Finishing carries the note the workspace booted on, Welcome.md
  when the vault has one. `apps/desktop/src/main/first-run.ts`,
  `apps/desktop/src/first-run-state.ts`,
  `apps/desktop/src/renderer/first-run/vault-step.tsx`,
  `apps/desktop/src/renderer/routes/_workspace/welcome.tsx`,
  `apps/desktop/src/renderer/app/onboarding/account-step.tsx`,
  `tools/e2e/src/scenarios/desktop-onboarding.ts`,
  `tools/e2e/src/scenarios/onboarding-account-browser.ts`.

- **THE .APP SHIPS ITS OWN GIT, AND RUNS IT WHERE THE MAC HAS NONE.** Every
  vault write, sync and history read is git, and so is an agent's own
  `git status`, but a Mac without Xcode or its command-line tools, which is
  most people's, has only `/usr/bin/git`'s stub: it fails and offers the
  install, so the vault could not even initialize. The pack carries
  dugite-native's macOS arm64 build, which `apps/desktop/scripts/fetch-git.mjs`
  fetches at package time against a pinned sha-256 and `extraResources` ships
  beside the asar, its Mach-Os signed and notarized with the rest of the
  bundle. Main asks `xcode-select -p` once before the first fork: a developer
  dir holding `usr/bin/git` keeps the Mac's own git (owner decision: a user
  with the tools and an https remote of their own keeps the Keychain helper,
  which dugite-native does not build), unless the git a PATH lookup finds once
  PATH is the login shell's is older than 2.45 or will not say its version:
  an older git sets its own `Transfer-Encoding` header, which libcurl 8.7.0
  and 8.7.1 mishandle, so a push past 1 MiB goes out as its first 4 bytes
  (Homebrew's 2.39.0 does). Any other Mac gets the bundled one, as
  its `bin/` ahead of the login shell's PATH plus `GIT_EXEC_PATH`,
  `GIT_TEMPLATE_DIR` and `GIT_CONFIG_SYSTEM` on the server child's env, which
  the engine, the ACP adapters and every agent shell inherit, and on main's one
  git read, a picked folder's origin (`folderFactsContext`); built for prefix
  `/` without `RUNTIME_PREFIX`, it finds none of those on its own. Never
  `GIT_CONFIG_COUNT`: the hosted remote's bearer rides those rows per
  invocation. A dev or e2e launch keeps the host's git. The fetch drops what
  dugite-native adds beside git, Git Credential Manager (a .NET runtime) and
  Git LFS: no config names either, and they were five-sixths of the payload
  and two-thirds of its Mach-Os to sign. Git's GPLv2 `COPYING` and a `SOURCE`
  note naming both source tags ship beside it. Rejected: the dugite npm package, a
  JS API nothing calls and a postinstall download on every install.
  `apps/desktop/src/main/bundled-git.ts`; the smoke's first launch plays such
  a Mac (its own login shell puts a failing `git` first on PATH,
  `DEVELOPER_DIR` names no tools), commits an API write and proves the host's
  git never ran.

### Desktop workspace surfaces

- **WINDOW-LEVEL HOSTS MOUNT AT THE ROOT ROUTE.** `ConfirmDialogHost`, `Toaster`
  and the one `TooltipProvider` live in
  `apps/desktop/src/renderer/routes/__root.tsx`; a host mounted by one route
  leaves another route's `confirm()` parked on a dialog that never opens.

- **THE RAIL IS FLUID'S SIDEBAR ANATOMY; THE TOP BAR IS THE OPEN NOTE.** Header
  (the vault row, and Search, which opens the palette), one group, and a
  footer. The group's label names the view and opens the view menu — Recent |
  Files | Deleted, one list each, drawn by the same `SidebarMenu` rows
  (`@repo/ui/components/sidebar-menu`) so switching swaps rows and never the
  chrome. Not tabs and not stacked sections: a stack made every list short,
  and a tab row was a third line of chrome. Every other verb is a right-click,
  as in an IDE. The footer's account row runs the one `useCloudSession`
  (`app/cloud-session.ts`) Settings › Account runs too; it offers Sync now and
  no second sync for actions, which sync on their own, and its words are the
  sync state's alone (GIT IS THE ENGINE, above). The view is the
  workspace's (`railView` in `app/prefs.ts`), because a `#tag` chip, a create
  and "Deleted notes…" each switch it. THERE IS NO FOLDER SCOPE: the top bar's
  breadcrumb REVEALS rather than narrows — a segment shows Files, opens the way
  to that folder and selects it. `revealInTree` (`app/workspace.tsx`) sets a
  nonce-keyed request the rail applies in `useTreeState` and consumes once
  applied — a prop, not a request store, since both ends are one hop away. A
  second listing root was a second answer to "what is this list?". The tree's
  fold, selection and name input are the rail's state
  (`sidebar/tree-state.ts`), applied during the rail's own render, because a
  component setting its owner's state while it renders is a React error. The
  rail and the palette hide what the user did not write through one filter,
  `visibleEntries` in `app/vault-hooks.ts`; the server's listing stays complete
  because the CLI and the agent read it. Under the macOS shell the rail
  reserves the traffic-light corner
  (`apps/desktop/src/renderer/app/title-bar.ts`).
  `apps/desktop/src/renderer/app/sidebar/sidebar.tsx`.

- **THERE IS ONE SEARCH SURFACE, AND IT IS ⌘P.** The palette lists every note
  and every command in one field, and the search that is not a lookup opens
  from inside it: "Search across the vault…" (the literal scan with its
  replace). ⌘F IS NOT ONE OF THEM: it searches within the open note, not the
  vault, so it keeps its own chord and its own bar. There is no ⌘O, no ⌘⇧F, no
  quick-open page and no rail search field: four ways to type a note's name was
  three too many, and each one was a different set of rows for the same
  question. The rail's Search button's tooltip spells ⌘P from the table
  (`app/global-shortcuts.ts`), never as a literal.

- **A NOTE'S FACTS ARE READ WHERE THEY ARE CHEAP, and the count rides the
  serializer.** The Metadata tab's "About" block is folded by default because
  unfolding it is what reads the git log for the created date. Words,
  characters and reading time are counted by `@repo/editor/note-stats` beside
  the TOC's walk, so both agree on the document, and published by the
  serializer's debounce, never per keystroke.
  `apps/desktop/src/renderer/app/actions/note-facts.tsx`.

- **THE PANEL STARTS CLOSED, IS FLAT-TABBED, AND IS DRAGGED LIKE THE RAIL.**
  `panelOpen` defaults off, and every entry that shows something in it opens it
  through one `revealPanel` (`app/workspace.tsx`), because an entry that only
  picks its tab or thread shows nothing in a closed panel. Its tabs are the
  flat underline row of `@repo/ui/components/tabs`. Its width persists through
  the rail's own Fluid resize handle (`panelWidth` beside `sidebarWidth` in
  `app/prefs.ts`), because a second resize mechanism would be a second answer
  to one drag, and is reported once a drag lets go (`onWidthCommitted`), never
  per frame. Closed, a sidebar is slid off-screen rather than unmounted, so it
  is `inert` (`SidebarPanel` in `packages/ui/src/components/sidebar-core.tsx`):
  otherwise its controls answer Tab and share their names with the surface
  that is open, the ⌘K composer's sign-in included.

- **AMBIENT STATE LIVES IN THE RAIL'S FOOTER; THE NOTE KEEPS ITS COUNT.** A
  strip across the whole window was a second bar under a rail that already
  had a bottom, so the sync state, the agent's spinner and Settings live in
  Fluid's `SidebarFooter`; there is no window-wide status bar. What stays under
  the note is `app/note-footer.tsx`: the open note's word count and reading
  time alone, right-aligned, at `--app-footer-h` beside `--app-header-h`, and
  with no rule above it so it reads as the note's last line rather than
  chrome. The count is the serializer's published one, never a recount, and
  zen hides the strip with the rest. The rail's and the panel's shells take
  `h-full` from the workspace because Fluid's shell is viewport-height by
  class.

- **THE PALETTE IS FLUID'S COMMAND MENU, AND IT HAS NO PRIMITIVE UNDER IT**
  (reversing the cmdk line; the dependency is gone). The field keeps DOM focus
  and names the highlighted row through `aria-activedescendant`, and the
  highlight is the one proximity pill every other popup draws; cmdk's filter
  was already off on every page, and its keyboard beside the pill was two
  answers to "which row is live?". ROWS ARE CHILDREN, NOT DATA, diverging from
  Fluid's `items` array deliberately: eight row shapes in a data array would be
  a second answer to what a row is. The panel KEEPS the top edge a panel at its
  cap height would have, so the field never moves as rows filter down. A chord
  draws one box per key from the one modifier table
  (`@repo/ui/lib/hotkey-spelling`), so nothing cuts a spelled string back into
  keys. ONE DIALOG FOR EVERY PAGE, so a page switch never re-animates the
  backdrop; a page is a union member, so a move page cannot exist without the
  entry it moves.
  `packages/ui/src/components/command.tsx`,
  `apps/desktop/src/renderer/app/palette/command-palette.tsx` and
  `apps/desktop/src/renderer/app/palette/palette-page.tsx`.

- **THE BUS IS APPLIED ONCE PER FRAME, AND A KIND REFETCHES ONLY WHAT IT
  MOVES.** `ChangeBatch` folds every ws frame since the last animation frame
  and flushes once, so a K-note rename is one knowledge sweep rather than K.
  Thread kinds are weighed in total tables (`MOVES_THE_LIST`,
  `MOVES_THE_DETAIL`, `MOVES_THE_TIMELINE`), so a streamed turn never
  refetches the thread list. The note session hears one `files` event however
  many paths moved (`packages/editor/src/host-io.ts`) and lists through the
  rail's own tree query (`apps/desktop/src/renderer/app/vault-hooks.ts`), so a
  K-path frame is one walk. A reconnect sweeps every family the bus reaches,
  which is why no window-focus re-walk backs it up.
  `apps/desktop/src/renderer/app/workspace-context.tsx` and
  `apps/desktop/src/renderer/app/__tests__/changed-message.test.ts`.

- **THE NOTE STORE OWNS THE OPEN NOTE, THE URL MIRRORS IT, AND SETTINGS
  COVERS A WORKSPACE THAT STAYS MOUNTED** (owner decision). `?note=` is read
  once, at boot, as the deep link, and every open after that is mirrored into
  it with `replace`, so the store's back/forward stacks are the one history: a
  pushed entry per open let a browser Back move the rail's highlight off the
  note the editor still held. Settings is a layer over the workspace in the
  pathless `_workspace` layout, not a sibling route, which unmounted the note,
  its undo history, the composer and zen. Covered, the workspace is `inert`
  and its `GLOBAL_SHORTCUTS` listener detached, since inert does not stop a
  window listener; the way in flushes the open note, since the workspace stays
  mounted and nothing else settles a title mid-rename or an edit inside the
  debounce.
  `apps/desktop/src/renderer/routes/_workspace.tsx`,
  `apps/desktop/src/renderer/app/__tests__/workspace-runtime-mount.test.tsx`
  and `apps/desktop/src/renderer/app/__tests__/workspace-routing.booted.test.tsx`.

- **A PAGE PREFERENCE IS A ROW, AND SO IS AN APPEARANCE DIAL.** What the window
  remembers across a reload is one `PREFS` row (key, a zod schema that decodes
  the stored string and encodes the value back, fallback), read and written
  only through `readPref` / `writePref` / `usePref`, so a key's reader and its
  writer cannot disagree on its bytes, and bytes a row cannot decode read as
  its fallback (`apps/desktop/src/renderer/app/prefs.ts`). An appearance dial
  is one `dial()` row naming its `--editor-*` token, applied in one loop
  (`apps/desktop/src/renderer/app/appearance-options.ts`). One table shared
  with the data dir was rejected: no preference is read by both programs — the
  server never reads the page's storage, and a data-dir preference reaches the
  page through its `@repo/api/local` contract, already the one declaration both
  compile against — and a data-dir file's shape must stay readable, so it is
  not derived from a contract that may break freely. Labels and layout stay
  out of the rows, because Settings is laid out by hand. A keyed storage read
  outside the table fails `tools/repo-guards/src/page-prefs.test.ts`.

### Repo guards, vendoring and tooling

- **No coverage tooling, on purpose.** Targeted structural invariants instead:
  the dependency DAG and platform rules, ws change-kind reachability
  (`tools/repo-guards`), route-table completeness
  (`apps/cli/src/server/__tests__/http-surface.test.ts`), migration↔schema
  agreement (`packages/db/src/__tests__/schema-agreement.test.ts`), the
  per-export orphan guard and the type-role guard over `@repo/ui`, the CLI guide
  and its `--json` flags, the editor's buffer invariant. If coverage is ever
  added, `coverage.include` is mandatory in Vitest 4, and gate only
  `@repo/notes`.

- **A structural guard states its own rule in the failure**, names the file, and
  derives every value it compares. The one hand-written list is
  `dep-dag.test.ts`'s `DECLARED_EDGES`, which is the pin itself.

- **VENDORED CODE IS THIS REPO'S CODE, except for the attribution.** Rename,
  restructure and delete freely; "the next re-pull becomes a conflict" is not a
  reason. Every vendored file keeps its `// Vendored from X, MIT.` header and the
  licence texts live under `tools/licenses`, staged into the artifact as
  `dist/licenses`, with `pnpm smoke:cli` deriving the expected set from the
  directory. The one licence shipped elsewhere is the bundled git's, beside
  it in the .app, since only the .app carries it (above).
  `packages/ui/components.json` declares `rsc: true` and it is inert: every
  consumer is a plain Vite build.

- **THE ORPHAN GUARD OVER `@repo/ui` IS PER EXPORT**: every named export under
  the wildcard-exported directories needs a consumer outside the gallery or a
  reasoned allowance row (`tools/repo-guards/src/ui-orphan-exports.test.ts` says
  why neither a file guard nor knip can ask this). Base UI's `render` prop is the
  polymorphism channel; there is no Slot.

- **A ROW DOES NOT ANSWER FOR ITS OWN POSITION; ITS CONTAINER DOES.** A
  conditional row changes where its siblings sit without re-rendering them, so
  a row deriving its index from the DOM needs an effect with no dependency
  array, and that rule suppression makes the compiler skip the whole
  component. The list keeps the set and reads document order itself, through
  one registry (`useRowOrder` in `packages/ui/src/hooks/use-row-order.ts`),
  syncing once per commit in the layout phase: a sync per row mounts a
  thousand-row tree in tens of seconds, and a microtask can render a frame
  late with the pills at the old rects. The lit row rides a store, so a hover
  step re-renders two rows, not the list
  (`packages/ui/src/components/__tests__/row-registry.test.tsx`).
  `react/rule-suppression` refuses a new `exhaustive-deps` or `rules-of-hooks`
  suppression, the ones the compiler bails on.

- **THE REACT COMPILER IS ON FOR EVERY BUNDLE**: `compiler: true` on
  `@vitejs/plugin-react` in the desktop's, the web's and the phone editor
  page's vite configs, and `reactCompiler: true` in
  `apps/mobile/app.config.js`. The suites run what ships: the desktop's,
  `@repo/editor`'s, `@repo/ui`'s and the phone page's DOM tests compile their
  sources the same way (`vitest.config.ts` in each; test files excluded,
  because a fixture hook minted in a factory is hoisted with no diagnostic),
  and a `compiled-under-test` suite in each fails when the plugin goes (the
  phone page's is the last case of
  `apps/mobile-editor/src/__tests__/editor-page.test.tsx`). A node
  suite, and the desktop's booted ones, cannot run compiled: the plugin skips
  the ssr transform. The manual-memo sweep is #820.

- **TOOLING PINS, each with its reason beside it**: `vite` is a pnpm override
  because the catalog bound only the manifests that spell it; `@types/node`
  tracks `engines.node`; `compatibility_date` is the lockfile's oldest workerd,
  held by `tools/repo-guards/src/wrangler-compat-date.test.ts`; `pnpm e2e` boots
  the built Worker bundle (`tools/e2e/src/scenarios/built-worker-boot.ts`), the
  built CLI bundle (`tools/e2e/src/scenarios/built-cli-boot.ts`) and the built
  desktop shell (`tools/e2e/src/scenarios/desktop-shell.ts`);
  agent-browser is pinned by hand in `.github/workflows/ci.yml` because a global
  install rides no lockfile. The arguments are `pnpm-workspace.yaml`'s comments.

- **AN UPDATE SWEEP SKIPS THE EXPO SDK'S NAMES, NOT ITS `expo:` CATALOG**:
  `update.ignoreDeps` in `pnpm-workspace.yaml` holds `expo`, `expo-*`,
  `@expo/*`, `react-native`, `react-native-*` and `@react-native/*` still under
  `pnpm up --latest -r`. It matches by name, so `react` and `typescript` — which
  web shares — cannot be listed without freezing web too: after a sweep, revert
  the `expo:` catalog rows by hand, then `npx expo install --check` in
  `apps/mobile`. An SDK upgrade moves all of them together.

- **A TURBO CACHE KEY NAMES EVERYTHING ITS OUTPUT READS**, because a hit
  replays the output with no error, and the e2e suite and `package:*` ship what
  it replays. Another workspace's files enter a key only through a `^` edge
  (`tools/repo-guards/src/turbo-cache-keys.test.ts`); the desktop build takes
  `^topo`, since `^build` would cycle through the CLI build that stages its
  renderer (`apps/desktop/turbo.json`). A file in no workspace is a named input
  (`apps/cli/turbo.json`), which the same guard holds for a bundled import
  (`/privacy` renders `docs/privacy.md`); a followed file is a named output
  (`apps/web/turbo.json`), and `NODE_ENV` is hashed, not passed through: vite
  emits React's dev build under `development`.

- **A DESKTOP TEST THAT LOGS A console.error FAILS.** React reports a setState
  during another component's render, a missing key or an update outside `act`
  as a console.error and nothing else, so a suite that only logs it stays green
  over a real defect
  (`apps/desktop/src/renderer/app/__tests__/console-error-gate.ts`). A test
  that provokes one on purpose silences it with its own spy. The booted suites
  are not gated: the server they boot logs every refused call by design.

- **A DEPENDENCY'S COST WE CANNOT WAIT OUT UPSTREAM IS A pnpm PATCH, AND A TEST
  FAILS WITHOUT IT.** micromark merges a paragraph's text with one splice per
  line, and GFM's email autolink splits it at every word, so one long paragraph
  parsed in time quadratic in its lines. `patches/micromark@4.0.2.patch` is
  upstream's own open fix (micromark/micromark#233), applied through
  `patchedDependencies` in `pnpm-workspace.yaml`; a bump fails the install
  until the patch is re-cut or dropped. A workaround in `@repo/notes` was
  rejected: splitting the paragraph changes what it parses to.
  `packages/notes/src/__tests__/projection-cost.test.ts` compares a 20k-line
  paragraph's projection with an eighth of it. Residual: a paragraph dense with
  emphasis or inline nodes is still superlinear upstream, and not patched.
  `patches/@platejs__core@53.3.14.patch` is the second: Plate resolved a
  throwaway plugin (two deep merges) to answer the type of a key no plugin
  registers, and the markdown serializer asks that of every mark rule on every
  text node, four fifths of a long note's save; the patch answers from
  `editor.plugins`, and `packages/editor/src/__tests__/typing-budget.test.tsx`
  fails on a save that resolves one.

- **THE SHELL'S GLUE RUNS IN E2E OVER DEVTOOLS, AND ITS BRIDGE IS A GUARD.**
  The shell's policies are pure and unit-tested; what joins them (the protocol
  handler, the preload, every `ipcMain` handler, the vault switch, the quit) is
  `tools/e2e/src/scenarios/desktop-shell.ts`: the built shell, driven over
  `--remote-debugging-port` by agent-browser, never through the env pins,
  since the shell refuses a switch while either pins the launch. Linux CI keeps
  Chromium's sandbox on: `--no-sandbox` was rejected, because no user runs the
  shell that way. Not the packaged `.app`: packing is minutes, and the fuses
  and the signature stay `pnpm smoke:desktop`'s. The static half is the
  ipc-contract test (THE RENDERER'S ONLY DOOR); neither end spells a channel as
  a literal.

- **NO TYPE ASSERTION, AND NO ESCAPE COMMENT** (owner decision).
  `typescript/consistent-type-assertions` at `assertionStyle: "never"` refuses
  every `as T` and `<T>x`, tests included; `as const` and `satisfies` stay
  legal. anti-slop's `require-safety-comment-for-type-assertion` is off: it
  admitted a cast behind a `// SAFETY:` comment, so a green lint read as
  permission; documenting that escape was the rejected alternative. A
  library's wide type is narrowed by its own guard (`ElementApi.isElementList`
  in `packages/editor/src/markdown/markdown-doc.ts`) or parsed by the schema
  that names it. `oxlint.config.ts`.

- **A CLIENT VERB LOADS THE CLIENT, AND THE BUILD REFUSES A STATIC IMPORT
  PAST IT.** The CLI bundle splits on dynamic imports, so what every verb
  parses before it reads argv is the entry's static closure; the server and
  the frontmatter parser (yaml, 72 modules) sit behind `await import()` in the
  verbs that need them. A static import that reaches yaml passes every test and
  every review, so `apps/cli/scripts/build.mjs` walks the metafile's static
  closure and fails naming the importer (`LOADED_ON_EVERY_VERB_REFUSED`).

- **THE PHONE SHIPS THROUGH EAS TO TESTFLIGHT, AND AN UNSET CLOUD URL IS THE
  PRODUCTION ORIGIN ON BOTH CLIENTS.** `pnpm testflight:mobile` builds on EAS
  and submits, iPhone only (owner decision); the signing credentials live on
  EAS, never in the repo, and build numbers are EAS's
  (`appVersionSource: remote` in `apps/mobile/eas.json`), so no commit bumps
  one. The marketing version is `apps/mobile/package.json`'s, one product
  version with the CLI and the desktop, and EAS builds with the repo's node
  and pnpm (`tools/repo-guards/src/release-versions.test.ts`). A JS-only fix is
  an EAS Update to builds of the same native fingerprint, a native change a new
  build (owner decision). `PRODUCTION_CLOUD_ORIGIN` (`@repo/api/cloud/origin`)
  is the one spelling the CLI's config and the phone's `getCloudUrl` fall back
  to; the phone reads `EXPO_PUBLIC_CLOUD_URL` at bundle time and refuses a
  malformed one. Rejected: per-profile env in `eas.json`, a second spelling of
  the origin, and a fallback to a dead host, which made a misconfigured build
  one that could only fail. `apps/mobile/src/__tests__/app-config.test.ts`
  holds the store config to what App Store Connect judges: the version, the
  encryption answer, no Expo default purpose string, and every required-reason
  API a linked module's privacy manifest declares.

**Before raising a "new" finding, read
[#542](https://github.com/kyh/inteligir/issues/542)**: the decision record
carries what was rejected as well as what was chosen. The `note` issues are
the declines register: #788 (the 2026-09-22 architecture review's refuted
findings), #645 (the 2026-09-01 review), #674 (the 2026-09-05 simplify pass),
#603 (Moss parity) and #705 (the CodeMirror trade); the older ones (#446,
#453, #472, #474) catalogue findings declined against the hosted
Durable-Object architecture this rewrite replaced.
