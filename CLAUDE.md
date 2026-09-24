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
                 no longer names a server; the updater, the spell checker and
                 the vault switch, because each lives in main; Reveal/Open of
                 a vault entry, because only main may hand the OS a path;
                 nothing that holds a token — every frame crosses as `unknown`
                 and is parsed on both sides, the page mirroring each through
                 one `bridge-store.ts`), and src/renderer/ (the SPA: TanStack
                 Router file routes over @repo/api/local; `app/workspace.tsx`
                 owns the note, the rail, the palette and the panel; `app/note/`
                 the guarded writes; `app/palette/` the ⌘P pages; `app/sidebar/`
                 the rail's Recent | Files | Deleted views, a tag being a
                 scope on Recent). The whole
                 security surface is the ORIGIN PIN (src/main/origin-pin.ts,
                 pure + unit-tested): one origin, top-level navigation away
                 goes to the system browser, window.open denied
                 unconditionally, permissions denied except origin-scoped
                 media. utilityProcess forks `inteligir serve`; a server
                 already listening is ADOPTED once it answers this instance's
                 token at the bundled version, and only a child the shell
                 started is killed on quit.
                 A vault switch (`main/vaults.ts` over the CLI's shared plan)
                 stops that child, rewrites the root config.json's `vaultDir`
                 and boots a new one on the new vault's own data dir.
  cli/           inteligir — THE PUBLISHED BINARY, and THE SERVER (issues #553,
                 #611). `serve` is the whole local process — src/server/ owns
                 the vault, the knowledge index, the agent runtime, the oRPC
                 handler at /rpc, the /ws invalidation bus and the db, built
                 by the ONE composition root (`compose.ts`); every
                 other verb but `vault open` (which writes config.json's
                 `vaultDir` and dials no server) is a citty leaf that is a
                 CLIENT of a running one,
                 with consola for the human path (raw writes for anything
                 verbatim — consola rewrites `backtick` spans). Every leaf
                 takes --json and is EXECUTED by the fitness test against the
                 refusal path, except the rows in `EXCLUDED_COMMANDS`
                 (`apps/cli/src/__tests__/json-flag-enforcement.test.ts`),
                 each with its reason. src/server/cloud/ is the sync
                 CLIENT (issue #572): the credential at rest, the frozen-body outbox, the
                 pull/apply loop and the local cloud procedures Settings and
                 `inteligir cloud` drive. src/server/voice/ is dictation (issue
                 #578): the pinned model cache under ~/.inteligir/models/, and
                 streaming Parakeet (sherpa-onnx) on a persistent session
                 worker per hold, over a dedicated /voice/stream websocket.
                 src/server/comments/ serves the anchored-comment sidecars
                 through the vault (#583). src/server/knowledge/ runs the
                 index and every route over it (search, matches, backlinks,
                 related, unlinked mentions, problems, tags, tag notes) plus
                 the two rewrite sets (note rename, tag rename) over one
                 snapshot loop, with the scan behind both on a worker thread.
                 Every app-written file in the data dir
                 (connectors, connected folders, agent prefs, vault prefs) is a
                 `json-file-store.ts` over `staged-write.ts`; `config.json` is
                 the one file read at boot and never written by the app, except
                 its `vaultDir`, the selector a switch rewrites
                 (`vault-switch.ts`). Agent memory was REMOVED (#589
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
                 @repo/notes' own parse, with each note's comment store
                 folded beside it (#683); reaches @repo/api/cloud, @repo/domain
                 and @repo/notes only.
packages/
  domain/        @repo/domain — zod-only leaf vocabulary (view context,
                 provider events, the thread-title rule), vendored-from-bb
                 shapes; every package may reach it, it reaches nothing.
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
                 CORE both consumers run (the byte primitives, the login
                 flow, the sync session; see "`@repo/api/cloud` IS THE
                 CLIENT RUNTIME CORE" under Cloud, sync and accounts).
                 apps/web SERVES every row; the CLI's sync client
                 consumes all of them; apps/mobile consumes the read half alone
                 — it pulls threads and produces captures, and never pushes or
                 claims, because the desktop runs the turns and owns applying a
                 capture to the vault. Two entries rather than one router
                 because their compatibility obligations are OPPOSITE: /local's
                 ends ship in one bundle and may break freely, /cloud is a
                 deployed Worker answering installs that may be months stale and
                 may never break: the Worker may add a field and a client
                 ignores what it does not know (see "A /CLOUD CLIENT IGNORES
                 WHAT IT DOES NOT KNOW" under Cloud, sync and accounts). A
                 dep-dag table (`CLOUD_ONLY_CLIENTS`) pins
                 apps/web and apps/mobile to /cloud alone.
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
                 the literal text scan behind matches and unlinked mentions,
                 the resolver's problems report, tags and tag families, tasks,
                 the rename and tag-rename byte-surgery) over ONE markdown scan
                 (scan-parse + wiki-links), frontmatter (the pin and id line
                 cuts included), `templates/` (the three placeholders and the
                 convention folders), the dialect's own modules
                 (markdown/remark-*, comments/, formulas/),
                 and `text/` — ONE Myers diff under diff3. No node/react/ui
                 imports — lint-enforced. `markdown/mdast-nodes.ts` is the
                 mdast NARROWING boundary: a walk asks it what a node is
                 rather than discriminating structurally at each visit.
  editor/        @repo/editor — the Plate.js WYSIWYG (resurrected, #580):
                 kits/nodes for every dialect construct, the md-rules table,
                 the fixpoint serializer + fixture matrix, the open-note
                 runtime (vault-session/note-runtime/open-note-store) the app
                 drives through two seams, plus the note-level verbs the shell
                 reaches by path (find bar, headings, extract, insert template,
                 note stats, link locate) and the action registry a deep
                 node uses to ask the shell for something (`agent-request`;
                 the comment surface keeps its own, `CommentActions` in
                 `comments/comment-store.ts`, beside that store's per-note
                 meta and pending create):
                 `VaultSessionPorts`
                 (note/vault-session.ts) and the `EditorHostIo` singleton
                 (host-io.ts), which host.ts opens to React.
                 `node-props.ts` is the SLATE DECODE BOUNDARY, and it is the
                 reason no walk here narrows structurally: a node's dialect
                 fields ride `TElement`'s open index signature, so every read
                 arrives as `unknown` and this is the one place it becomes a
                 domain value.
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
recipe. Never run `db:push:remote` or `db:studio:remote`: both hit production
D1. The bare `db:push` and `db:studio` are the local ones.

`apps/web/README.md` is the product Worker's own guide — routes, auth, the
local loop and the owner-only deploy. `AGENTS.md` is the runnable quickstart;
`CONTEXT.md` glosses the carried domain vocabulary.

## Decisions

Each bullet is the decision, what it rejected and why, and the file that
carries the mechanism. The dangling-reference guard keeps the pointers honest.

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
  on both braces. Comment thread bodies live in
  `.inteligir/comments/<note-id>.json`, keyed by the note's frontmatter `id`.

- **AN ICON BESIDE A LABEL IS A SIBLING OF THE LABEL, NEVER INSIDE IT.**
  `Button` trims its text with `text-box`, which only a block container
  honours, so the label is its own span; an inline svg in that span does not
  size the block and the line box pushes it out, which drew the icon above the
  label. `labelChildren` (`packages/ui/src/components/button.tsx`) keeps text
  runs in the trimmed span and lifts every element child out beside them, and
  the icon-only branch is a flex row for the same reason (an icon with a count
  beside it). A caller may pass the icon either way — as `leadingIcon` or as a
  child — and both lay out as one row. The one spelling of "which children are
  text" is `@repo/ui/lib/text-children`, which the sidebar's rows read too.

- **EVERY FLOATING SURFACE IS A BASE UI PRIMITIVE THROUGH `@repo/ui`, never a
  hand-positioned div.** A popup is `Popover`, `DropdownMenu`, `Tooltip`,
  `HoverCard` or `Dialog` from `@repo/ui/components`, which own dismissal,
  flipping, layering and focus; a `fixed`/`absolute` element at a measured
  `left/top` owns none of them and drifts on scroll. A surface anchored to a
  selection rather than an element hands the Positioner a virtual anchor
  (`getBoundingClientRect` over the stored rect: `comments/comment-kit.tsx`,
  `block-menu.tsx`). Base UI is reached only through `@repo/ui` (the one
  exception is `inline-combobox.tsx`); a missing primitive is added there
  first, with a gallery demo. In-flow chrome is not a popup and stays
  positioned: the TOC rail (anchored to the note column on purpose), the
  code-block language badge, the callout marker, the toggle chevron, the
  table handle. The find bar IS a popup, hung under the top bar's Find
  button: the shell registers the anchor through `setFindBarAnchor`
  (`packages/editor/src/find-bar.tsx`), since the editor never reaches the
  shell, and with no button on screen — zen — it falls back to the note
  column's corner. The wiki-link preview is the HoverCard (Base UI's
  PreviewCard): the pointer can move into it, the text selects, the title
  opens the note; Popover has no hover mode (`packages/editor/src/wiki-chip.tsx`).
  The ⌘K composer is a non-modal `Dialog` whose bare `DialogPopup` mounts in
  the note column, so it floats over the note and never the panel; Base UI
  owns its Escape, outside press and focus, and its `finalFocus` hands focus
  back through the editor's own `tf.focus()`, since a DOM focus on the
  editable drops the caret at the note's start, after a `tf.blur()` that
  only clears Slate's focus flag: a blur landing while Slate writes the DOM
  selection leaves it set, and the focus then does nothing
  (`apps/desktop/src/renderer/app/actions/action-composer.tsx`).
  The selection toolbar (`packages/editor/src/selection-toolbar.tsx`) is the
  one popup that is not a primitive: it is Plate's `@platejs/floating` toolbar,
  anchored to the selection rect and kept there by floating-ui's `autoUpdate`,
  the engine under the Positioner. It has no open/dismiss lifecycle — it shows
  while the selection is expanded and focused — so a Popover would still need
  that selection-driven `open` and the `frozen` hold while a menu or the link
  input takes focus; the `ignore-click-outside/toolbar` class on its portaled
  menus is the one seam between the two.

- **THE EDITOR COLUMN SHOWS ONE NOTE.** No second pane and no pane vocabulary:
  one `OpenNoteStore`, and every surface reads the open note. Registries keyed
  on a note's path keep that key so a late answer cannot land on the note that
  replaced it. There is no raw/rich toggle: the surface derives from
  `packages/editor/src/note/markdown-gate.ts` alone.

- **THE CHROME HAS FIVE TYPE ROLES, AND THEY ARE FLUID'S LADDER.** caption 11,
  body 12, subtitle 13, title 15, display 24 — the compact column of
  `typeScale` (`packages/ui/src/lib/size-context.tsx`), which is where the
  scale is declared, beside the control ladder it follows. The product draws
  them as the `text-caption | body | subtitle | title | display` utilities
  declared once in `packages/ui/src/styles/globals.css`, and
  `lib/__tests__/type-scale.test.ts` derives the expected numbers from the
  map, so the CSS and the map cannot drift. THE MERGE ENGINE HAS TO BE TOLD
  THEY ARE SIZES: any unknown value after `text-` reads as a colour, so
  `cn("text-body", "text-muted-foreground")` dropped the size and the line
  fell back to the inherited 16px — every role class inside a `cn` call was
  silently doing nothing. `cn` is therefore configured once
  (`packages/ui/src/lib/cn.ts`) and imported from there by every file in the
  repo, reversing the drop-the-pass-through cleanup for a reason it did not
  have: the wrapper now carries configuration, and a second unconfigured `cn`
  beside it would be the bug again. Named in the font-size group, a role also
  correctly replaces another role, which CSS ordering cannot do. `text-sm`, `text-xs` and a
  `text-[13px]` literal are gone from the shell and from `@repo/ui`'s
  components: a role says what a line IS, and four spellings of 12px said
  nothing. The utilities carry the compact step alone because the product
  pins compact at its root (`app/workspace-context.tsx`); a region on the
  default step would read the map instead. THE NOTE IS NOT CHROME: the
  editor's prose keeps the appearance dials below, and `@repo/ui/src/ai`
  keeps its own sizes until a surface draws it.

- **THE APPEARANCE DIALS ARE ONE DECLARATION, READ THROUGH `.typeset-docs`.**
  The tokens are declared once in `apps/desktop/src/renderer/styles/globals.css`.
  No accent axis: nothing in Plate consumes a hue.

- **THE PLATE SLASH MENU IS THE INSERTION SURFACE.** Slash items are grouped
  data (`GROUPS` in `packages/editor/src/slash-menu.tsx`). Every insertable
  row's markdown must re-parse to a modeled construct
  (`packages/editor/src/__tests__/slash-rows.test.ts`, which names each row not
  yet its own fixpoint); the kit-parity vocabulary pins the set. Legacy
  `<!-- inteligir:thread anc_… -->` markers parse as opaque comments and are
  preserved; nothing writes new ones.

- **Frontmatter is the ONLY property store.** No metadata table. YAML the typing
  rules cannot represent is preserved byte-exactly.

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

- **A BINDING IS SPELLED FROM THE TABLE ITS LISTENER READS, never as a
  literal.** Five tables own every chord: `GLOBAL_SHORTCUTS`
  (`apps/desktop/src/renderer/app/global-shortcuts.ts`, the window listener),
  `MARK_SHORTCUTS` (`packages/editor/src/mark-shortcuts.ts`, which the marks
  kit BUILDS Plate's `shortcuts` config from, so Plate's own defaults never
  run), `EDITOR_SHORTCUTS` (`packages/editor/src/editor-shortcuts.ts`),
  `FIND_BAR_SHORTCUTS` (`packages/editor/src/find-bar.tsx`) and
  `COMMENT_SHORTCUTS` (`packages/editor/src/comments/comment-kit.tsx`), and
  each handler matches by walking its table. The palette's "Keyboard
  shortcuts" page, every `CommandShortcut`, the selection toolbar's tooltips,
  the rail's hints and the panel's empty states are derived from those rows
  through `@repo/ui/lib/hotkey-spelling` (⌃⌥⇧⌘ on a mac keyboard,
  `Ctrl+Shift+…` elsewhere), so a rebinding cannot leave a stale label behind.
  `shortcut-tables.test.ts` refuses a chord two tables share, because a key
  both claim runs both. No listener lives outside the tables: the sidebar
  provider listens for no key and only shows the chord it is handed, and the
  rail's `[` and the panel's `]` are BARE rows in `GLOBAL_SHORTCUTS`, which
  answer only when no modifier is held and focus is not in a field, since a
  bare key is a character wherever text is typed. ⌘P is the one search
  surface and ⌘, is Settings; a browser tab may keep either for itself, the
  shell delivers both.

- **A PIN IS THE FRONTMATTER KEY `pinned: true`, AND ITS EDIT IS A LINE CUT.**
  Pinning travels with the file, so the recents agree on every device and with
  the agent. A pinned note sorts to the top of the recents and ends its row in
  a filled pin; there is no Pinned heading, because a group label for a
  handful of rows cost more height than it explained. The pin's slot is drawn
  on every row, pinned or not, so one column holds every date. `pinnedFrontmatterYaml` in
  `@repo/notes/markdown/frontmatter` cuts or appends the key's own lines like
  `removeFrontmatterId` does, rather than re-serializing through
  `serializeProperties`, which restyles every flow list it re-emits; unpinning
  removes the key, never writes `false`, and a block it empties goes with it.
  One desktop function behind the Metadata tab, the tree and list menus and
  the palette (`apps/desktop/src/renderer/app/note/pin-note.ts`): the open
  note takes the edit through the live editor's frontmatter node, the
  properties panel's own path, so the buffer and the autosave carry it; any
  other note is read, edited and written with the hash of what was read, and a
  mismatch is reported, never merged. The pinned set every surface shows is
  the index's (`usePinnedPaths`), so a pin appears after the sweep, not before.

- **GO TO HEADING IS THE PALETTE OVER THE TOC'S WALK, AND AN EXTRACT IS ONE
  HISTORY BATCH.** ⌘⇧O (a shifted row in `GLOBAL_SHORTCUTS`) opens the palette
  on the open note's outline, read through `collectHeadings` and landed through
  `goToHeading` (`packages/editor/src/toc.tsx`): the rail's own scroll, and the
  caret at the heading. "Extract to new note" (`packages/editor/src/extract-note.ts`,
  from the selection toolbar and the block menu) takes the top-level blocks the
  selection touches, serializes them with the editor's own `MD_STRINGIFY`, so
  the new note holds the bytes the file would have, names it after the first
  heading among them, else the first line, else Untitled (a name the vault
  would refuse falls back rather than being sanitized), steps past what the
  host's wiki targets already hold like the rail's Untitled does, and creates it
  through `createFileAt` before touching the buffer. The removal and the
  `[[link]]` that replaces it land in one flush, so one undo restores both; the
  created file stays, because the vault has no transaction and a note that
  exists is truer than an edit that never happened.

- **A FORMULA RECOMPUTE IS NOT AN EDIT, AND A BOUND REF'S NOTE IS FOUND BY
  ID.** `@(name#note-id#pill-id)` names its note by frontmatter `id`, which the
  index's wiki-targets rows carry, so the desktop reads the one note that id
  names, cached by path until a change event names that path
  (`apps/desktop/src/renderer/app/note/note-formulas.ts`). Reading every doc to
  find one id is rejected: a recompute runs after each typing pause. The walk
  follows refs through the notes it reads, up to 64, so a chain resolves
  (`loadFormulaGraph` in `@repo/notes/formulas/resolve-graph`). The display a
  recompute rewrites lands outside the undo history: the user never typed it,
  and one undo must reach their own last edit
  (`packages/editor/src/formulas/formula-recompute.ts`). The id has one
  reader, `noteIdOfProperties` in `@repo/notes/markdown/frontmatter`, which
  the index and the recompute share.

- **A BLOCK OVERLAY NAMES ITS BLOCK BY NODE ID AND SUBSCRIBES TO THE
  DOCUMENT.** The heading fold and the drag handle wrap each top-level block
  through `aboveNodes`, whose `path` is the one the block last rendered with:
  Plate re-renders a block only when its own node changes, so after an insert
  above it every block below names the wrong index. Their providers sit in
  `aboveEditable`, which an edit never re-renders, so each reads the document
  through `useEditorSelector` with a value equality that moves only when what
  it draws does (a fold's reach or a heading's key; a block joining, leaving
  or moving), never per keystroke. Both key a block by its NodeIdPlugin id
  (`blockId` in `packages/editor/src/node-props.ts`), which survives an edit
  and a move, where the node object survives only the move. Plate turns the
  plugin off under NODE_ENV=test, so a block without an id takes no part, and
  a suite that drives either overlay mounts the harness with `nodeIds`.
  `packages/editor/src/heading-collapse.tsx`,
  `packages/editor/src/block-draggable.tsx`.

- **AN EMBED IS ONE LEVEL OF STATIC RENDER, AND EVERY VOID HAS A STATIC ROW.**
  `![[Note]]` in the open note draws its target through `PlateStatic` over
  `BASE_KIT`; an embed inside that content stays a chip, which is the nesting
  stop, so the only cycle left to refuse is a note embedding itself
  (`packages/editor/src/transclusion-guard.ts`). PlateStatic's default element
  is a `<div>` or the plugin's own tag, which draws a pill or an image empty,
  breaks the line an inline void sits in, and throws on an `<hr>`, since every
  void carries a spacer child; so `STATIC_COMPONENTS`
  (`packages/editor/src/transclusion.tsx`) holds a row for every void, pinned
  both ways by `packages/editor/src/__tests__/transclusion-static.test.ts`. A
  url inside an embed resolves from the embedded note, not the open one.

### Vault: writes, git and containment

- **The auto-commit stages what the window's writers named.** A scheduler that
  names no paths makes the flush unscoped (the boot sweep, the post-sync drain),
  and so does a window naming more than `MAX_SCOPED_COMMIT_PATHS` paths or the
  flush after a failed one; otherwise a change nobody announced waits for a
  whole-tree caller.
  Unscoped `add -A` survives for a large vault's first commit, where a pathspec
  would exceed ARG_MAX (`apps/cli/src/server/vault/git-engine.ts`).

- **NOTE HISTORY IS LOCAL, AND A RESTORE IS A WRITE.** The history surface reads
  the vault's own git repo, so it works offline with no remote. Restoring
  revision N writes its bytes through the ordinary write path with
  `expectedHash`, never `git checkout` or `git revert`, which would bypass the
  CAS, the re-index, the `/ws` notification and the open buffer's convergence.
  There is no `vault.restore` procedure (a second server write path is a second
  CAS), so both clients run the same composition: checkpoint with
  `vault.commitNow`, then a guarded write. The desktop's base is the bytes its
  diff was computed from, never a fresh read; the CLI, which shows no diff,
  reads its base after the checkpoint, or writes `ifAbsent` when the note is
  gone. A restore's CAS refusal is reported, not diff3-merged: the user
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
  than active-user-wins, which discards concurrent body edits wholesale. A write
  ANSWERS THE BYTES THAT LANDED and the open buffer takes them, an edit made
  meanwhile rebased on top: once the merge is the base, a buffer kept over it
  passes the next save's CAS without the external edit. A reload is the same
  hazard, so it drains the editor's serialize debounce before and after its
  read and rebases an edit made during it rather than skipping the bytes it
  read. `apps/desktop/src/renderer/app/note/guarded-vault-io.ts`,
  `packages/editor/src/vault-editor.ts` and `@repo/notes/text/diff3`.

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

- **`runGit` PREPENDS `--literal-pathspecs` TO EVERY INVOCATION.** A pathspec is
  a glob, so `[a].md` names `a.md` too and a commit scoped to one note staged
  its neighbour. The one argv builder is `apps/cli/src/server/vault/git-run.ts`.

- **A MOVE IS A RENAME THAT KEEPS THE NAME, and `planMove` is its one verdict.**
  The tree's drop target and the palette's "Move note to folder…" page both ask
  `planMove` (`apps/desktop/src/renderer/app/sidebar/tree-ops.ts`) and refuse for
  the same three reasons: itself, its own descendant, the folder it is already
  in. A drop on a note row means that note's folder; a drop on the tree's empty
  area means the vault root, since the tree is the whole vault. The drag's
  source is
  component state, not `dataTransfer`, so a file dragged in from the desktop
  has no source here and is ignored. No second write path: the move rides
  `vault.rename`, which rewrites links, and the vault session carries the open
  note whether the move named it or a folder above it, and closes it only once
  a delete of its folder removed it (`packages/editor/src/note/vault-session.ts`),
  so the tree never navigates on a move's or a delete's answer.

- **WHERE A PASTE LANDS IS A STORED VAULT CHOICE, and the host resolves it, not
  the editor.** `<dataDir>/vault-prefs.json` holds `attachments`: the vault
  root, beside the note, or one named folder (default `assets/`), read per
  paste so a Settings or `inteligir vault attachments` change reaches the next
  one. The editor hands the host a base name alone; the host answers the folder
  through `attachmentDir` (`@repo/api/local/vault/attachment-location`, also
  the CLI's `root | beside-note | folder:<path>` spelling) from the open note.
  The folder is created on the first write; `setPrefs` refuses only a path that
  is a file today, which would refuse every paste. `""` is the root on the
  asset write's wire, because a vault path is never empty.
  `apps/cli/src/server/vault/vault-prefs-store.ts`.

- **THE OS SEES A VAULT ENTRY THROUGH MAIN ALONE, and main checks physically.**
  Reveal in Finder and Open with default app ride `desktop:reveal-path` /
  `desktop:open-path`: the page sends a vault-relative path, main parses it
  with the vault grammar, joins it under the current vault (main's target,
  re-read per request so a switch moves it), realpaths
  both sides and asks `pathContains` (`inteligir/server/path-containment`), so
  a `..`, an absolute path or a symlink planted in the vault reaches no
  `shell.*` call (`apps/desktop/src/main/vault-entry.ts`, tested). A browser
  tab has no bridge and draws no row. Copy path and Copy absolute path need
  no main: the listing already carries the root. The tree sorts folders first
  either way and files by name or newest-first (`prefs.ts`, persisted).

- **A SECOND VAULT GETS ITS OWN DATA DIR, AND A SWITCH IS A NEW CHILD, A NEW
  SESSION AND A NEW WINDOW.** The default vault keeps the root data dir every
  install already has; any other vault's db, index and `server.json` live in
  `<root>/vaults/<sha256(path)[:16]>/`, derived once in `config.ts` so the
  shell's child and `inteligir serve` name the same dir, and the root's
  `config.json` is the selector both read. The root refuses a vault beneath it.
  Cost accepted: the credential, the connectors and the agent default live in
  the data dir, so a second vault starts signed out and unconfigured, which is
  also what keeps it off the account's hosted remote. The shell switches only a
  child it started (an adopted server is nobody's to restart) and only when
  neither the vault nor the data dir is env-pinned: it stops the child, whose
  ordered shutdown flushes the pending commit, rewrites `vaultDir`, re-resolves
  as a boot would, boots the new child, and opens a new window on the new data
  dir's session partition, since a `BrowserWindow`'s session is fixed at
  creation; a vault revisited in one launch re-registers the app protocol on its
  old partition. Anything that fails once the old child has stopped (the
  selector write, the re-read, the new child's boot) puts the previous vault
  back. The folder is picked in main, so the page never names a path it was
  not handed; the recent-vaults list is the shell's own `userData`, never a
  vault's, and the File menu and the page offer the same rows from it
  (`offeredRecentVaults`: not the open vault, not a folder that is gone).
  `inteligir vault open <dir>` writes the same selector under the same plan
  and refusals (`apps/cli/src/server/vault-switch.ts`, the one spelling both
  run), and restarts nothing: the next `serve` is the switch.
  `apps/desktop/src/main/vaults.ts` (the shell's policy over it),
  `main/index.ts` (`switchVault`), `apps/desktop/src/vaults-state.ts`.

- **A SYNC PASS HOLDS THE REPO LOCK ONLY FOR ITS LOCAL STEPS.** The fence and
  the pre-fetch commit are one locked step, the commit and rebase a second,
  the account marker a third; the fetch and the push run between them
  unlocked. Held across the network, the lock made every save and every turn
  start wait out a dropped connection's timeout. The price is that the world
  moves during the fetch, so the rebase step re-checks first: a turn that took
  its hold, or a dispose that ran the final flush, ends the pass there, and a
  save that landed is committed before the rebase would refuse it. Saves now
  land mid-pass, so the runtime strips their watcher echoes before asking
  whether a pass is running. A recorded conflict keeps the two tips it was met
  between, and a pass where neither moved skips the rebase rather than
  rewriting the conflicted files every minute. Network git gives up early too:
  under 1KB/s for 30s, or an ssh connect past 20s
  (`apps/cli/src/server/vault/git-run.ts`). The split is
  `apps/cli/src/server/vault/git-engine.ts`.

- **THE ENGINE'S GIT IGNORES THE VAULT'S OWN GIT HABITS, AND A PASS REPORTS ONE
  OUTCOME.** Every engine commit passes `--no-verify` and every status read
  `--untracked-files=normal`: a user's commit-msg hook or
  `status.showUntrackedFiles=no` would refuse or hide each auto-commit, and a
  tree that never commits holds every sync behind it. A commit that fails
  anyway is the status's `lastError` until one lands. Git's own files are
  asked for by `rev-parse --git-path` (`gitPath`), never joined under
  `<root>/.git`, which is a file in a linked worktree or a submodule and has no
  `info/` under a hooks-only template. Before the listen the bootstrap makes
  only the empty `vault: initialize` commit a rebase needs
  (`apps/cli/src/server/vault/git-bootstrap.ts`): staging a large folder there
  outran the shell's readiness wait, and the runtime's boot sweep commits it
  after. What a pass concluded is one `SyncOutcome`, the latest verdict
  winning, except that a remote which did not answer leaves a recorded
  conflict standing: a detached HEAD says `detached`, never `clean`; a push
  the remote answered and refused says `rejected`, never `offline`; a push
  that lost a race to another device's is no failure and leaves the tree to
  say `dirty` (`classifyNetworkFailure` in
  `apps/cli/src/server/vault/git-run.ts`).

- **THE CAPTURE INBOX MERGES BY UNION.** Two signed-in desktops each append a
  phone capture to the end of the root `Inbox.md` between syncs, and the
  rebase that met both appends conflicted on a file the app wrote itself,
  stopping that device's sync until someone ran git by hand. Every boot makes
  sure `info/attributes` holds `/Inbox.md merge=union`: local like the exclude,
  never a committed `.gitattributes`, because the vault's files are the
  user's, and anchored, so a nested `Inbox.md` merges like any note. Residual:
  a bullet one device deleted beside the other's append comes back.
  `apps/cli/src/server/vault/git-bootstrap.ts`, over `CAPTURE_INBOX_PATH` in
  `apps/cli/src/server/cloud/captures.ts`.

- **A SAVE THAT FAILS IS SAID ONCE AND RETRIED; ONE WHOSE FILE IS GONE IS ASKED
  ABOUT.** A refused write leaves the buffer dirty with its reason as
  `saveError` (`packages/editor/src/vault-editor.ts`). The session says so once
  per failure, never per attempt, and the runtime retries on a backoff from 2s
  to 30s, since nothing else re-arms the autosave until the next keystroke. A
  guarded write that finds no file (`CAS_MISMATCH` with no `current`) answers
  `vanished`, a `WriteOutcome` rather than a throw so the controller cannot
  miss it, and is never retried, because it cannot land. Refusing to
  leave it, as a switch refuses to leave any unsaved note, would hold the user
  there for good, so leaving asks instead: discard the edits, or re-create the
  note from the buffer through an `ifAbsent` create, refused if anything landed
  at the path since. Discarding is the dialog's confirm, so an Escape keeps the
  edits. `packages/editor/src/note/note-runtime.ts`,
  `packages/editor/src/note/vault-session.ts` and
  `apps/desktop/src/renderer/app/note/guarded-vault-io.ts`.

- **A WATCHER EVENT IS A MUTATION'S ECHO ONLY WHILE THE ENTRY IS THE ONE IT
  LEFT, AND A PULL NAMES ITS PATHS.** Every service mutation reports what an
  lstat of its path answers right after it: inode, size and mtime, read off the
  write's own handle before the rename, or absence for a delete. The runtime
  drops a watcher event only when a fresh lstat matches exactly, and forgets
  the record after 2s. Keyed on the path and the window alone, a foreign write
  landing behind a save (an agent editing the open note) would be dropped with
  the echo: no notification, no re-index. A pass whose rebase moved HEAD
  reports `git diff --name-only --no-renames` between the two heads, and the
  drain unions it with the watcher's batches held while the pass ran; only a
  rebase that could not be aborted, or a diff that failed, asks for a
  whole-vault reconcile, because a pass that names nothing makes every push
  from another device re-read the whole vault.
  `apps/cli/src/server/vault/vault-changes.ts`,
  `apps/cli/src/server/vault/vault-runtime.ts`.

- **THE MERGE'S LINE DIFF IS BOUNDED, AND A MERGE THAT KEPT THE BUFFER OVER
  AN OVERLAP SAYS SO.** `diffLines` (`@repo/notes/text/line-diff`) runs inside
  a save's CAS retry and the editor's rebase, where copying the whole frontier
  every round cost gigabytes for two long, far-apart notes. Its trace keeps
  each round's live diagonals alone, so memory grows with the edit distance
  squared, and past `maxEditDistance` (2000) it answers `overBudget`: one hunk
  over the span between the shared ends. diff3 reads that as one changed
  region, so the other side's edits outside it still merge and one inside it
  is an overlap, `conflicted` like any other. Conflicting on every
  over-budget merge is rejected: it would warn when nothing was lost. A
  conflicted merge anywhere in the save path (the guarded write's retry, the
  rebase after a write or a reload) reaches the host through the session's
  `notifyMergeConflict`, and the desktop's toast opens that note's History
  (owner decision). History's own diff reads `overBudget` and says it could
  not pair the lines. Residual: History holds the replaced lines only once
  they were committed, and an agent's write mid-turn or an external edit
  inside the auto-commit's quiet window never was. `@repo/notes` runs its
  suites under a 512MB heap ceiling so an allocation that grows with a note
  fails there. `packages/editor/src/vault-editor.ts`,
  `apps/desktop/src/renderer/app/note/vault-provider.tsx`.

### Knowledge: index, search and links

- **The knowledge index does not persist a stat fingerprint.** A warm reconcile
  over 2000 notes is ~105ms off the critical path; a second persisted table in a
  cache whose recovery primitive is deleting the file is a crash waiting for a
  missed re-create.

- **RELATED IS ONE PANEL SECTION**: backlinks first because they are counted,
  then the scorer's rows with their reasons, then unlinked mentions with a Link
  action, no dedup between the families
  (`apps/desktop/src/renderer/app/actions/related-section.tsx`). Outgoing links
  stay absent (they are on screen as wiki-links); no graph view; the route stays
  search-shaped (a `limit`, no `total`); suggestions and mentions are fetched
  only while the section is unfolded; refresh rides the existing `files-changed`
  and `content-changed` kinds, which sweep `orpc.knowledge.key()` whole because
  a link into a note lives in another note's bytes, except that
  `content-changed` skips `knowledge.unlinkedMentions`, a vault-wide prose scan
  (`app/workspace-context.tsx`).

- **Stemming is a SHADOW of the indexed text, never a rewrite of it.** Literal
  and stem columns at equal bm25 weight; `@repo/notes/knowledge/search-query`
  owns the one policy both engines run. FTS5's `porter` tokenizer is rejected
  for a measured reason: it stems the index, so a prefix query for a half-typed
  word stops retrieving (86 of 1,555 prefixes over the labelled corpus), and it
  puts half a shared policy inside SQLite's C. Every term asks both halves, and
  that OR is the exact tier: a doc holding the literal word scores about twice a
  stem-only hit. Residual: the title/body gap is 10x, so a title collision still
  beats a body exact match. `search-query.ts` and `knowledge/search-excerpt.ts`.

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

- **A TAG IS A SCOPE ON THE RECENT LIST, NOT A VIEW, AND A TAG RENAME IS THE
  LINK RENAME'S SURGERY.** There is no tag browser in the app: `knowledge.tags`
  answers `inteligir tags` alone. A `#tag` chip asks the shell through the
  editor host registry's `showTag` (`packages/editor/src/agent-request.ts`,
  a node's channel to the shell beside the comment surface's own
  `CommentActions`), never the palette, and the rail
  answers with the Recent view scoped to that tag: the scope row (the count,
  `listed of total` while cut, Rename) and the tag's paged listing. The
  selected tag is the workspace's state, like the rail's view, and everything
  only the scope holds (the rename dialog, the paged
  query) is `apps/desktop/src/renderer/app/sidebar/tagged-notes.tsx`, mounted
  only while a tag is selected. A Tags tab was built and removed by owner
  decision: the rail's views are Recent, Files and Deleted.
  `knowledge.renameTag` moves a tag and everything nested under it, matched
  case-insensitively because the index is: inline spans are the scan's own,
  verified against the raw bytes and withheld inside verbatim ranges
  (`documentTagSpans`), frontmatter `tags` re-serialize through the properties
  panel's CST edit, and every write is `writeIfUnchanged` from a snapshot, so
  a note that changed mid-rename is reported `changed`, never overwritten. The
  one name grammar is `isTagName` in `@repo/notes/knowledge/link-extract`,
  shared by the chip, the scan and the contract.
  `@repo/notes/knowledge/rename-tags.ts`,
  `apps/cli/src/server/knowledge/rename-tag.ts`,
  `apps/desktop/src/renderer/app/sidebar/tag-scope.tsx`, and `inteligir tag
rename`.

- **VAULT SEARCH IS A LITERAL SCAN BESIDE THE RANKED INDEX, and a replace
  rewrites exactly what the rows showed.** FTS5 cannot say where inside a line
  a hit sits, so `knowledge.matches` (the palette's "Search across the vault…"
  page, `inteligir matches`) scans doc
  bodies with ONE matcher, `@repo/notes/knowledge/text-matches`, that the
  listing and the rewrite both run; the store only pre-narrows by an ascii
  substring (`docTexts`), because LIKE folds ascii case alone. A replace across
  notes is a per-file write with the hash of the bytes it read, and a mismatch
  is REPORTED by name, never diff3-merged: the user named exact bytes
  (`apps/desktop/src/renderer/app/palette/vault-replace.ts`). A cut listing
  cannot replace: it does not name every note. Nor can a listing that no longer
  answers the box and the toggles — a toggle's or a keystroke's read still in
  flight behind the rows on screen — and the request is built from the input
  that listing was read with, never the live box
  (`apps/desktop/src/renderer/app/palette/search-page.tsx`). The run reports a
  count after every note and honours a cancel between notes, never inside one,
  and the summary counts what a stop left untouched; the palette stays open on
  the run so it can show the count and offer the cancel, and a close, however
  it comes, is that cancel. The jump lands by ordinal among
  the note's matches, because a markdown column is not a Slate offset, and it
  carries the listing's needle and toggles into the find bar, which counts with
  the same matcher over each text leaf (`findTextOffsets`), so the ordinal
  names the match the row showed. ⌘⇧O (Go
  to heading) is the one shifted row in `global-shortcuts.ts`; a row claims
  shift explicitly, so an unshifted row never fires on a shifted chord.

- **AN UNLINKED MENTION IS THE STEM OR AN ALIAS IN PROSE, and Link rewrites the
  bytes the row showed.** `knowledge.unlinkedMentions` (`inteligir unlinked`)
  runs the literal scan's matcher over the target's names as whole words, any
  case, one row per note on its first mention, excluding the note itself and
  every note that already links here; a hit inside code, math, a link, a url,
  frontmatter, an html tag or a comment marker is withheld by the scan's own
  regexes as well as the editor's verbatim ranges, because those ranges come
  back empty for a doc the editor's grammar refuses. Not the H1: `[[H1 text]]`
  resolves to nothing unless it is the stem or an alias. Link wraps exactly
  that site as `[[Target]]`, or `[[Target|as written]]` when the prose differs,
  through a write with the hash of the bytes it read; a mismatch is reported,
  never merged. The target is the route's `linkTarget`, answered beside the
  rows from the index's resolver, because the bare stem may be another note's;
  a name no alias can carry is no mention, and a note no link can name offers
  no Link. `@repo/notes/knowledge/unlinked-mentions.ts`,
  `apps/desktop/src/renderer/app/actions/link-mention.ts`.

- **A PROBLEM IS THE RESOLVER'S VERDICT, never a scan's.** `knowledge.problems`
  (the palette's Problems page, `inteligir problems`) reads the resolved graph
  alone: a wiki or md link the resolver answered null is an unresolved link
  (once per source and target, on its first line), one that is embedded or
  names a file is a missing embed, a doc no other doc links to is an orphan,
  and a link name (`wikiLinkName`) spelled at two paths or a frontmatter `id` two docs carry (a byte
  copy keeps its original's) is a duplicate the resolver is quietly breaking a
  tie on; a shared id shares the comment store too. Every row disappears with
  the sweep that fixes it, so no row is ever stale against the index. Daily
  notes and templates are orphans by
  design and are left out unless asked (`includeConventionFolders`); the two
  folders are spelled once, in `@repo/notes/templates/placeholders`. A row lands
  on the link ELEMENT (`packages/editor/src/link-locate.ts`), not the find bar:
  a wiki chip is an inline void whose label is a prop, so the find bar cannot
  see it; the find bar is the fallback when the note no longer carries the
  link. Each family is capped on its own with its own total.
  `@repo/notes/knowledge/vault-problems.ts`.

- **A TAG'S NOTES ARE A LISTING, NOT A SEARCH.** `knowledge.tagNotes`
  (`inteligir tag notes <tag>`) answers the tag's family by path with the
  whole count, paged by `limit` and `offset`, from the index alone: the search
  route ranks and stops at its ceiling, so a tag on more notes than that showed
  a hundred with no sign of a cut. The family is one predicate,
  `notesInTagFamily` (`@repo/notes/knowledge/tag-notes`), which the rename's
  candidate list runs too. The rail re-reads one growing page rather than
  stitching pages, because the list it draws is sorted by recency after the
  fact, and says `listed of total` while cut.
  `apps/desktop/src/renderer/app/sidebar/tagged-notes.tsx`.

- **A DOC THE INDEX CANNOT READ OR PROJECT COSTS THAT DOC, NEVER THE INDEX.**
  A read refused for any reason but not-found or over-the-cap (EACCES, EIO)
  keeps the doc's last row and is retried by every pass, since a permission fix
  announces nothing. A doc whose projection throws (nesting deep enough to
  overflow the parser's stack) is indexed as an other, and the hash of those
  bytes is kept so an unchanged doc is not re-projected by every reconcile;
  projection runs outside the store transaction, one doc at a time, so one doc
  cannot roll back its batch. Rebuilding on either is rejected: the rebuild
  re-reads the same vault and fails the same way, so it loops. A disposed
  runtime stops its pass at the next step boundary and never rebuilds, since a
  rebuild would reopen the file dispose closed.
  `apps/cli/src/server/knowledge/knowledge-runtime.ts`.

- **THE SCAN RUNS ON A WORKER; THE SERVER'S LOOP READS BYTES AND WRITES ROWS.**
  Projecting a 20k-line note is seconds of synchronous CPU (2.9s measured),
  every autosave of it re-projects it, and the server's thread also answers
  every request, the ws bus and the watcher's liveness ping. So
  `projectDoc`, the stem shadow (`docSearchColumns` in
  `@repo/notes/knowledge/search-columns`, which the store's `upsertDoc` takes
  ready-made) and both rewrite sets' byte surgery run on one worker per
  knowledge runtime (`apps/cli/src/server/knowledge/projection-worker.ts`),
  spawned on the first job and kept warm, unref'd while idle. What stays on the
  loop is the read, the hash and the rows, which commit in 16ms slices with a
  yield between; one doc's FTS insert cannot be split, and is the residual
  stall. Every frame is parsed by zod on the side that receives it, the
  projection through the store's own row schema. `dispose()` stops the worker
  before it awaits the pass, so a pass mid-projection is released, not waited
  out. No byte cap on what the index projects: by owner decision one is added
  only if the worker cannot keep up. The build stages the worker as
  `dist/projection-worker.mjs`; a checkout runs its source under tsx's hook,
  named rather than inherited (`apps/cli/src/server/worker-entry.ts`, which the
  transcriber shares), and most suites hand the runtime the same jobs inline
  (`apps/cli/src/server/knowledge/__tests__/inline-projector.ts`) because a
  worker booted from source costs seconds. Pinned by `monitorEventLoopDelay`
  over a 20k-line note in
  `apps/cli/src/server/knowledge/__tests__/knowledge-runtime.test.ts`.

- **AN MD URL HAS ONE READING, AND THE EDITOR RESOLVES IT WITH THE INDEX'S
  RESOLVER.** `mdLinkTarget` (`@repo/notes/knowledge/link-extract`) is how the
  scan indexes an md url: a scheme, `//host` or bare `#anchor` names no vault
  path, the anchor is cut and the rest percent-decoded. The editor reads a
  link's or an image's url through it and resolves the answer from the note
  the url is written in (the open note, or the one an embed shows) with the
  index's own `buildResolver` (`resolveMdTarget` on the host's
  `LinkResolver`, filled in `vault-provider.tsx`): beside the note, then from
  the root. So an image a move re-based to `../assets/shot%201.png` still
  loads, an image Problems calls missing is the one drawn missing, a Problems
  row for a `%20` link lands (`link-locate.ts`), and a link's Open follows a
  vault url in the app instead of handing the browser a path it cannot route.
  An image the resolver misses falls back to its url as a root path, because a
  pasted asset is on disk before the listing that would resolve it.
  `useVaultLinkTarget` in `packages/editor/src/host.ts`,
  `packages/editor/src/nodes/image-node.tsx` and `link-node.tsx`.

- **A WIKI LINK NAMES WHAT THE RESOLVER ANSWERS TO, AND ONE FUNCTION BESIDE THE
  PARSER WRITES IT.** `.md` is the one extension a link leaves off
  (`IMPLIED_LINK_EXTENSION` and `wikiLinkName` in
  `@repo/notes/knowledge/doc-file`), and the resolver keys that same name, so a
  `.txt` note links as `[[todo.txt]]`; letting every doc extension go was
  rejected to keep Obsidian's reading and the pinned resolver, and `docStem`
  stays the title. Every writer (the `[[` picker, Link, extract, a rename)
  takes its target from `wikiTargetForPath` (`@repo/notes/knowledge/link-resolve`:
  the name when it resolves back, else the path) and its bytes from
  `serializeWikiBody` (`@repo/notes/markdown/remark-wiki-link`), which keeps the
  plain spelling when it parses back (`[[C# Notes]]`), escapes every `\` and `#`
  when it would not (`[[Issue\#42]]`), and answers null when nothing survives
  the parse: a bracket, a line break, a `|` the last pipe would split. A null
  writes nothing: the picker leaves that note out, Link is not offered, a rename
  leaves the link for Problems. A rename span covers a target's escaped bytes,
  so an escaped link renames like any other. `checkNoteName` refuses `[` and
  `]`, and a name typed for a new note gets `.md` unless it already ends in a
  doc extension (`withDocExtension`), so `Node.js` is a note. Pinned by the
  round trip in `packages/notes/src/__tests__/link-resolve.test.ts`.

### Agents and threads

- **A turn row's `sourceSeqEnd` names its own contributors**, not every
  turn-scoped event. A streaming assistant message is turn-scoped but lands as a
  top-level row; counting it moved the turn row and resent the whole subtree on
  every token.

- **Ingest is ONE transaction.** Append, lifecycle projection and queue touch
  happen in one immediate transaction; notifications flush after commit.
  Lifecycle CAS predicates include the turn identity so a late completion for
  turn A cannot settle turn B (`apps/cli/src/server/threads/service.ts`).

- **Agent commits stage the turn's own write set**, from the fileChange events
  and from the vault writes the agent makes through `inteligir` itself, under a
  counted commit hold that defers the vault debounce and blocks a sync.
  Committing the whole dirty tree attributes a concurrent turn's writes to
  whoever settles first (`apps/cli/src/server/agents/agent-commits.ts`). Under
  `INTELIGIR_THREAD_ID` the CLI names its thread on every call
  (`apps/cli/src/server/agent-thread-header.ts`), and the write, asset, rename
  and tag-rename handlers hand what they wrote to that thread's running turn
  (`attributeWrites` in `apps/cli/src/server/orpc.ts`); the header is
  attribution, not authority, and a thread with no turn running records
  nothing.

- **THE AGENT SURFACE IS THE ⌘K ACTION COMPOSER AND THE RIGHT PANEL** (what it
  retired is the register on #645; do not bring any of it back). An action is an
  ordinary thread attached to the note it was composed over
  (`threads.originDocPath`). The agent edits the vault directly and anchored
  comments are the review channel; the panel's Actions | Comments | History |
  Metadata tabs are transcript, review, revision, and the note's own properties,
  related notes and delete. ⌘P is the palette, ⌘F the find bar, ⌘\ is zen.
  "Ask agent" seeds the composer through
  `packages/editor/src/agent-request.ts`, so the editor never imports the shell.
  `apps/desktop/src/renderer/app/actions/actions-panel.tsx` and
  `action-composer.tsx`.

- **COMMENTS CARRY THE AUTHOR'S `source`, AND THE STORE WRITE IS A CAS.** The
  server signs `user` when a caller says nothing; the CLI signs `agent` under
  `INTELIGIR_THREAD_ID`. The store write retries once on a base mismatch, then
  answers `CONFLICT`. The comment-id grammar has one spelling in
  `@repo/notes/comments/sidecar-schema`.
  `apps/cli/src/server/comments/comments-service.ts` and
  `apps/cli/src/commands/comment.ts`.

- **THE COMMENT STORE IS ONE DOT-FOLDER KEYED BY THE NOTE'S ID, and the cloud
  was rejected for it.** `.inteligir/comments/<note-id>.json`, `<note-id>` the
  note's frontmatter `id`, so a rename or move anywhere (Finder, a pull, an
  agent's `mv`) strands nothing and one commit carries a note's anchors and its
  bodies together. Bodies in a cloud table would drift from the anchors in the
  note's bytes and would need an account, and accountless installs make zero
  cloud requests. A comment on a note without an id mints one
  (`withFrontmatterId`, a line cut like the pin's) through a guarded note
  write; a read mints nothing. An `id` that is not text (a number, a date, a
  list) is refused by name, never overwritten: it may be someone's identity
  for the note. The beside-the-note `<note>.comments.json` older
  vaults and agents wrote is folded into the store on first touch and over the
  whole tree at boot (`comments-migration.ts`); an unparseable one is reported
  by its own name and left. A deleted note's store goes with it
  (`remove-with-comments.ts`, a folder's with every note under it) unless the
  index names a note outside the deletion still carrying that id, a byte copy
  whose delete would otherwise take the original's bodies; an index that has
  not seen the copy yet errs toward removing, and the Problems page's
  duplicate ids are where a shared id surfaces. The
  deleted-notes restore brings both back from the same revision through
  `@repo/api/local/vault/restore-comment-store`, the one composition the
  dialog and `vault restore` both run after the note's own ifAbsent write.

- **A VIEW CONTEXT RIDES THE MESSAGE, and it is a statement about the past.**
  What the user was looking at travels on the send (`@repo/domain/view-context`),
  never as a thread column or a server-side "current view" that has no owner.
  It describes the screen the message left from, so navigating away mid-turn
  changes nothing. There is no tool: the agent can already read the file, and
  the one thing a tool could add, a live selection, cannot be made honest. It is
  a statement, not a grant. A queued send carries none. There is no selection
  field; real offsets need a Slate to markdown offset map.
  `apps/cli/src/server/agents/view-context-prompt.ts`.

- **THE DEFAULT HARNESS IS A STORED CHOICE, read per thread start.**
  `<dataDir>/agent-prefs.json`, edited from Settings › Agents and `inteligir
agents default`; unset falls back
  to the first harness on PATH in `HARNESS_IDS` order (claude, then codex).
  Not config.json, which is read once at boot and
  never written by the app. A thread keeps the harness it started on
  (`threads.providerId`); the choice reaches the next one. The store is
  `apps/cli/src/server/agents/agent-prefs-store.ts`; the one fallback rule is
  `defaultHarnessId` in `agent-driver.ts`. PATH is read per request, never
  once at boot: a CLI installed after launch serves the next send and turns
  `system.status`'s agent to `acp`, and with none there a send is refused
  synchronously as `PROVIDER_UNAVAILABLE`. What the CLI and Settings call a
  harness's readiness is one verdict, `harnessReadiness` in
  `@repo/api/local/agents/agents-schema`. A model is per harness
  (`INTELIGIR_CLAUDE_MODEL`, `INTELIGIR_CODEX_MODEL`, or config.json's
  `agentModels`), because a model id is vendor-specific.

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

- **THE HOST CLOSES A PROVIDER SESSION IT GIVES UP ON, AND A CHILD'S DEATH
  FAILS ITS TURN THROUGH THE PROMPT.** The watchdog and a failed dispatch call
  `closeThread` before they fail the turn, so the next send resumes on a fresh
  child instead of meeting a session still holding the abandoned prompt; a
  dispatch re-checks its turn after every await and stops once it was settled
  or the manager disposed, so it neither fails the turn that replaced it nor
  spawns a child nobody will close. The child's exit closes the ACP connection
  with an error naming the exit status and the child's last stderr lines, and
  the SDK rejects every pending request with it (stdout's end is kept from
  closing it first with a bare "connection closed"): a crash at boot fails the
  dispatch, a crash mid-turn fails the turn like a refused prompt. Rejected: an
  exit callback beside it, and per-thread exit generations under it, which fit
  a process shared by threads (one child per thread here) and would be a second
  answer to "did this turn fail?".
  `packages/agent-runtime/src/acp/acp-runtime.ts` and
  `apps/cli/src/server/agents/runtime-manager.ts`.

- **THE PROVIDER GRAMMAR IS WHAT THE ACP MAPPER EMITS, AND THE MAPPER IS PINNED
  TO THE ADAPTERS' REAL WIRE** (owner decision, reversing the kept-wide bb
  vocabulary). `ProviderEvent` carries exactly the kinds and fields
  `AcpTurnMapper` constructs; a kind nothing produces was a branch every
  consumer carried and a test hand-built. `ThreadEvent` stays its own union:
  only the emitted side shrank. The mapper is tested against turns the pinned
  adapters really sent, recorded through the runtime into
  `packages/agent-runtime/src/acp/__tests__/fixtures/<adapter>@<version>/` and
  replayed through the SDK's own client, because the fake agent encodes what
  the adapters were believed to send; the recording is what showed content
  replaces rather than appends. The adapter and SDK pins are exact and move
  together, and a bump re-records (`record:transcripts`,
  `packages/agent-runtime/scripts/record-acp-transcripts.ts`).

- **A TIMELINE DELTA MOVES A HELD TURN AS A PATCH, AND A ROW CARRIES WHAT THE
  PANEL DRAWS.** A turn holds every command, tool call and thought of its turn,
  so upserting it whole resent all of them for one streamed token; a held turn
  travels in `turnPatches` as its status, completion, `sourceSeqEnd` and only
  the children past the base, with `childOrder` sent when membership moved, and
  `applyTimelineDelta` keeps every other child the same object, which the
  panel's memoized chips skip on. A new turn, or any turn when the base is not
  a prefix, still goes whole. A turn's children are work and error rows alone,
  so the row grammar is a nested discriminated union and not recursive. A
  command row carries its first `COMMAND_OUTPUT_LINES` lines, each cut at
  `COMMAND_OUTPUT_LINE_CHARS`, and the count of the rest, never the output;
  the event log keeps every byte. Residual: a reasoning row's text and a tool
  row's result and arguments still ride whole.
  `packages/api/src/local/thread-timeline.ts`.

- **CONNECTOR OAUTH IS THE MCP AUTHORIZATION SPEC'S, AND A REFRESH TOKEN IS
  SPENT ONCE** (owner decision). The authorize URL and both token requests
  carry RFC 8707's `resource`, the row's MCP url in its canonical form
  (lowercase scheme and host, no fragment, no trailing slash), so a provider
  that binds audiences mints a token for that server alone; discovery and
  dynamic client registration are not built, so a row names its endpoints and
  client id. A rotating provider honours a refresh token once, so the refresh
  is single-flight per connector: two sessions starting together share one
  spend, and every write it makes holds only while the row still carries the
  token it spent, so a disconnect or a re-authorize that lands meanwhile wins.
  Only a 400 or 401 is the provider's verdict on the grant and marks the row
  needs-reauth; no answer, a 5xx or a captive portal's page leaves the row as
  it was and keeps it out of that one session. A callback for a row removed
  mid-flow answers the page, never a 500.
  `apps/cli/src/server/connectors/oauth-flow.ts`.

- **AN @-MENTION RIDES THE SEND AS `contextPaths`, NEVER AS TEXT.** The
  stored `client/turn/requested.text` is exactly what the user typed, so the
  timeline, the phone and a thread's title all read the message rather than a
  prefix the desktop glued on; the server names the notes to the agent in a
  block of its own (`composeContextPathsBlock` in
  `apps/cli/src/server/agents/view-context-prompt.ts`), like the view context.
  The wire holds them to the vault path grammar, one to sixteen, no repeats,
  absent rather than empty. UNLIKE the view context, a queued send KEEPS them
  (`queued_thread_messages.context_paths`): a mention is part of what the user
  asked, not a statement about a screen since left, and a drained "compare
  these" with its notes dropped asks about nothing. The panel draws them as
  chips under the user bubble. `@repo/api/local/threads/threads-schema`.

- **A THREAD IS NAMED BY ITS FIRST MESSAGE, ON THE SERVER.** A thread created
  without a title takes one from the first `client/turn/requested` that lands
  on it, local or synced, in the transaction that appends it, and announces
  `title-changed`; an explicit title, or one an earlier message set, stays.
  Naming it in the desktop left every action the CLI, an agent or another
  device started as "Untitled action". The rule is `deriveThreadTitle`
  (`@repo/domain/thread-title`: the first visible line, cut at 60 code points),
  which the phone's projection runs too, so both agree.
  `apps/cli/src/server/threads/service.ts`.

- **A LOADED SESSION IS HANDED ONLY THE INSTRUCTIONS IT DOES NOT HOLD.** ACP's
  `session/new` carries no instructions field, so they ride a turn's prompt,
  and a `session/load` replays that prompt in the agent's own history.
  `resumeThread` says whether the load happened (`loaded`); a fresh session
  gets the instructions, and a loaded one gets them again only when their hash
  differs from the last set its thread was handed (a folder connected, an
  `AGENTS.md` edited). The hashes are in memory, recorded once the prompt is on
  the wire and dropped when the host abandons the session, so a restart or a
  failed dispatch re-sends once rather than trusting a history that may lack
  them. Claude's `_meta.systemPrompt` is not used: it is one harness's channel.
  `apps/cli/src/server/agents/runtime-manager.ts`.

- **A STOP IS A CANCEL WITH A CLOSE BEHIND IT, AND THE TURN STILL ENDS THROUGH
  ITS OWN PROMPT** (owner decision: an agent writing the vault the wrong way
  needs a brake; deleting the unreachable `stopping` state was the rejected
  alternative). `threads.interrupt` (the action's Stop button, `inteligir
action stop`) applies `stop.requested`, so the thread reads `stopping` and a
  send queues, then asks the driver: a turn at a provider gets ACP's
  `session/cancel` (`AgentRuntime.cancelTurn`), which the agent answers by
  ending the prompt `cancelled`, the mapper's interrupted `turn/completed`
  settling the thread like any turn; one that has not answered within
  `stopGraceMs` has its session closed and is settled interrupted by the host,
  as the watchdog settles a silent one. A turn whose dispatch never reached a
  provider is withdrawn and its half-open session closed, and the service
  settles the stop itself (`stop.settled`), since nothing will report it. A
  queued message starts after a stop as after any settle. Archiving a running
  thread stops it, after the archive, so the drain cannot start a turn on it.
  A turn another device runs is refused (`CONFLICT`): only its own process can
  reach its provider. `interruptTurn` in
  `apps/cli/src/server/agents/runtime-manager.ts` and `interrupt` in
  `apps/cli/src/server/threads/service.ts`.

### Dictation

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
  payload. It sits behind the same loopback guard, is a declared row in the
  route table (`http-surface.test.ts`) like `/ws`, and its sockets are closed
  by name at teardown so a live hold cannot stall exit.

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

### Cloud, sync and accounts

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
  devices page, or the device's own sign-out, is what revokes it. The route is
  unauthenticated and throttled per caller address: a login route with no
  throttle is a password oracle.
  Rejected: the browser approve page, the one-time code, PKCE and the loopback
  callback, a ceremony whose point was keeping the password out of the app.
  Residual: the password passes through the app once over HTTPS. Social
  providers are gone with it: a login that must work inside the app can only be
  a password. The one flow both the CLI and the phone run is
  `@repo/api/cloud/device/login-flow.ts`; the route is
  `apps/web/src/worker/device/login.ts`.

- **`@repo/api/cloud` IS THE CLIENT RUNTIME CORE, not only the wire**:
  `bytes.ts`, `device/login-flow.ts`, `sync/sync-session.ts`. The CLI and the
  phone inject only stores, timers and sockets; a security discipline with two
  spellings is two to audit. The core is what BOTH clients run: connector
  OAuth's one-slot approval is the CLI's alone, since the phone authorizes no
  connector, so it sits beside its consumer
  (`apps/cli/src/server/connectors/approval-slot.ts`); the system browser
  opener, which `serve --open`, `inteligir open` and a connector's authorize
  all run, sits at the server's root (`apps/cli/src/server/browser-opener.ts`),
  not in the sync client. The cloud vault-path grammar is `parseVaultPath`
  with the parse required to be the identity. The `[[Title|uuid]]` tier lives in
  `buildResolver` (tier 0); the desktop reaches it through the `id` its
  wiki-targets rows carry, and the mobile listing carries none yet.

- **ON THE PHONE, THE RUNTIME THAT MOVES A VALUE IS THE ONE THAT NOTIFIES.**
  `SyncRuntime` and the login flow publish stores the screens subscribe to, so
  a poll pass, a revocation or a refused login is shown. A refused capture keeps
  its text and says why, and its retry carries the same idempotency key. A
  sign-in is ONE session: the notes store reads under `SyncRuntime`'s session
  rather than a client of its own, so a revocation any request hears ends the
  sign-in for all of them, and the composition root idles the notes and wipes
  their cache (`apps/mobile/src/lib/compose-runtime.ts`). Which screens exist
  is the route guard's answer (`Stack.Protected` in
  `apps/mobile/src/app/_layout.tsx`), never a per-screen branch, and a cold
  launch is `restoring` under the held splash until the Keychain read ends.
  `apps/mobile/src/sync/sync-runtime.ts`,
  `apps/mobile/src/login/login-store.ts`.

- **A pulled event lands through the SAME ingest, marked with its origin**
  (`ThreadService.applySyncedEvents`). The origin changes three things: the
  thread row takes the log's id, nothing is re-enqueued, and a settle does not
  drain this device's queue. The cursor moves inside that transaction, which is
  what makes the apply exactly-once. Signing in again resets the cursor, so a synced
  row also carries `events.origin_device_id` / `origin_device_seq` under a
  unique index, keyed `(device, position)` rather than the account-global `seq`.
  A row this install wrote carries no origin, so that index cannot catch its own
  rows coming back: the planner skips every device id the install has signed in
  as (`sync_own_devices`, recorded at boot and at sign-in, kept by a sign-out),
  not only the current one, because each sign-in mints a new id.
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
  `events.sequence`. A body over the row cap is CLIPPED before it is frozen,
  never dropped for its size: a dropped `item/completed` leaves its item
  pending on every other device forever. `clipThreadEventForSync`
  (`@repo/api/cloud/sync/fit-sync-event`) elides the middle of the largest
  payload texts and never a type, an id, a status or a scope, so a peer's fold
  settles every row as this device's does and only the cut text reads short;
  the local events row keeps every byte. The coalescer stores one item's
  adjacent deltas as one row rather than one per token (`mergeAdjacentDeltas`
  in `@repo/domain/provider-event`, a reset opening a new run), bounded by the
  same cap so a merge never makes a row the clip must cut. An event the
  contract still refuses (its envelope alone over the cap) is dropped rather
  than stranding every event behind it (`takePushBatch` in
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

- **A SYNC PASS IS CAPPED, A CAPPED PASS IS FOLLOWED AT ONCE, AND "SYNCED"
  MEANS EVERY STEP REACHED THE CLOUD AND LEFT NOTHING.** Each step answers
  where it stopped (`SyncOutcome` in `@repo/api/cloud/sync/sync-session`):
  caught up, `more` behind its per-pass cap (25 pull pages, 25 push batches, a
  full capture claim), `failed` on a retryable refusal or an unreachable cloud,
  or `fenced` when its session ended. The cap stays because a teardown waits
  out the pass in flight; on `more` the single flight runs the next pass at
  once, reading `repeat()` between them, so a backlog drains in one sync
  rather than one pass per poll and a dispose still waits out at most one pass.
  A failed step does not stop the rest, but only a pass whose every step
  caught up stamps `lastSyncedAt` (the phone's too), so an offline pass never
  reads as synced. A row the log refuses (`MissingTurnStartedError`,
  `ThreadEventThreadIdMismatchError`) is skipped past; any other throw fails
  the pass with the cursor where the last commit left it and lands in
  `lastError`, because moving past it would lose the row for good. The status
  reaches the renderer on the bus's `sync-status-changed` kind, fired at a
  sign-in or out, a revocation, the learned identity, the socket and every
  pass's end, never per enqueue, so nothing polls it. The socket drops itself
  after two keepalive intervals of silence, since a half-open connection
  neither answers nor closes, and every open runs a pass, since a ping sent
  while it was down reached nothing. `apps/cli/src/server/cloud/sync-pass.ts`,
  `sync-runtime.ts` and `cloud-socket.ts`.

- **A PULLED ROW THIS BUILD CANNOT READ IS PULLED AGAIN BY THE NEXT BUILD.** The
  planner moves the cursor past a foreign row its grammar refuses, because the
  rows behind it must still land, and without a way back a newer device's
  event type would be gone from this one for good. The skip step names the
  lowest such row (`firstUnparsed`), the pass records it with the running
  build, the CLI's version, in the transaction that moves the cursor, and a
  session opened under a different build puts the cursor back to just before
  it and clears the marker (`takeRewindIfBuildChanged` in
  `packages/db/src/sync-outbox.ts`, from `openSession` in
  `apps/cli/src/server/cloud/sync-runtime.ts`); a build that still cannot read
  it records it again. The replay needs no dedupe of its own: a foreign row
  lands once on its origin index and the planner skips this install's own.
  Rejected: `meta.schema_version` as the trigger, which counts migrations
  while a new event type ships without one, and a table of the raw skipped
  rows, a second store beside the log. The phone keeps no marker: its sync
  store is in memory, so every launch replays from 0.

- **A CREDENTIAL THIS DEVICE DROPS IS REVOKED BY THIS DEVICE, best-effort and
  never waited on.** Forgetting the file alone leaves the row active, and the
  twenty-device cap counts active rows, so about twenty sign-in cycles would
  lock the account out with no in-app way back. `POST /v1/device/sign-out` is
  the dashboard's revoke asked with the device's own credential (the app holds
  no session): the row, its limiter rows, its sockets. The CLI's logout, a login
  that replaces a live credential, and the phone's credential drop send it on a
  client of their own, because closing the session aborts every request the
  session's client carries, and clear local state without waiting: an
  unreachable cloud must not hold a sign-out open, and the row it leaves is the
  Devices page's to revoke. A shutdown waits for a sign-out in flight within
  the cloud step's budget. A credential the cloud already refused asks nothing.
  The login flow sends it for a credential its store could not keep. A 5xx,
  408 or 429 with no error envelope reads as `unreachable`, never `malformed`:
  every refusal the worker means rides the envelope.
  `apps/web/src/worker/device/routes.ts`,
  `apps/cli/src/server/cloud/sync-runtime.ts`,
  `apps/mobile/src/sync/sync-runtime.ts`,
  `packages/api/src/cloud/device/login-flow.ts`.

- **THE HOSTED TREE IS WALKED ONCE PER HEAD, and kept in ONE SLOT PER REPO.**
  Every directory is a call into the repo cell a push also waits on, and the
  phone pages the whole tree on every refresh. A tree read that resolved the
  head walks the vault whole and keeps the listing in R2 at `listing/<repo>/`,
  tagged with its commit, so every page pinned to that commit and every refresh
  that finds the head unmoved is one bucket read. One slot, not a key per
  commit, which would keep an object for every head any device ever listed
  until the account died. A pinned read the slot does not hold (a newer head
  took it) walks without filling, keeping only the page's `limit + 1` smallest
  paths and skipping every directory that starts past the largest. A vault
  past 50,000 entries is never kept: the fill holds the listing in memory. A
  cache failure is a miss, never a refusal; account deletion purges the slot.
  `apps/web/src/worker/vault/tree-walk.ts` (pure, over a `listTree` port) and
  `tree-listing.ts`.

- **A /CLOUD CLIENT IGNORES WHAT IT DOES NOT KNOW, and the Worker is held to
  exactly what it declares** (owner decision, reversing "final at birth").
  Every response schema under `@repo/api/cloud` strips a field it does not
  declare, and a refusal code the build does not know reads as `internal`: a
  fault to retry, in the Worker's own words, never a verdict on the
  credential. Strict readers made every additive change a new route, and a
  refusal that grew a field turned a stale client's `unauthorized` into
  `malformed`, so a revoked device kept retrying. Requests stay `.strict()`,
  since only the always-newest Worker parses them, and the Worker's tests
  parse every answer through `emitted`
  (`apps/web/src/worker/__tests__/cloud-helpers.ts`), which fails on a field
  the contract does not declare, because a stripping client would let a leaked
  column through. Two things still close the wire: 0.4.0 and older parse every
  response strictly, so a field they must read rides a new route; and a field
  that changes what a row MEANS, such as a new capture kind, reaches only a
  client whose request declares it, because stripped, the row reads as the old
  kind. `packages/api/src/cloud/cloud-client.ts`,
  `packages/api/src/cloud/cloud-errors.ts`.

### Server process and the desktop shell

- **THE SERVER IS SPLIT ALONG ONE-RESPONSIBILITY SEAMS**: `vault/git-run` /
  `git-porcelain` / `git-bootstrap` / `git-engine`; `cloud/sync-pass` /
  `socket-link` / `sync-cadence`; `agents/interaction-waiters`
  beside a watchdog that sweeps per-turn timestamps rather than re-arming a
  timer per frame; `writeTransaction` in `@repo/db/connection` as the one
  spelling of `BEGIN IMMEDIATE`. `ThreadService.boot()` is called from the
  composition root because crash recovery writes.

- **ONE BINARY, TWO MODES: `inteligir serve` IS the server, and `npx` is a verb**
  (reversing the launcher-boots-in-process line). `npx inteligir serve --open`
  is the zero-install path with one exit code. The desktop shell still forks a
  child so the compositor never shares an event loop with better-sqlite3, a
  watcher fork and `git`; `utilityProcess` supervises, with readiness, the
  SIGKILL behind a grace and the deliberate absence of a restart in
  `apps/desktop/src/main/server-process.ts`, where every wait ends on the
  child's exit event rather than a poll. The shell adopts a listening server
  and only kills the child it started. Whether `server.json`'s owner still
  serves has ONE reading, `apps/cli/src/server/server-probe.ts`, which the
  boot's guard and the shell's adoption both project: a silent owner is live
  to both, so the shell refuses to start rather than spawn a child that
  owner's lock refuses, and it refuses a server of another version too,
  because `/local`'s two ends may break freely only while they ship together.

- **ONE COMPOSITION ROOT.** `apps/cli/src/server/compose.ts` builds every
  service in boot order and returns `{ context, teardown }`; `createApp` is
  route wiring, `serve.ts` is the data-dir claim + listen + `server.json` +
  signals + exit code, and the booted suites call the same composition. The
  two dials `serve.ts` injects (the cloud socket opener, the agent driver) are
  injected because compose is reachable from the renderer's test program.
  `dev-instance.ts` owns the per-checkout derivation; `config.ts` stays the
  parser.

- **THE BIN EXITS 128+n WHEN THE SERVER DIES BY SIGNAL, NEVER 0**
  (`apps/cli/bin/inteligir`). Re-raising the signal at the wrapper exited 0.

- **THE CREDENTIAL IS A FILE, NOT A CHALLENGE** (reversing the
  loopback-adoption-is-earned line). The server writes `<dataDir>/server.json`
  at 0600 and removes it on ordered shutdown; every caller reads it and sends
  the bearer. No probing, no adoption ceremony. The bound is the honest one: it
  proves the caller can read the data dir, not that it is this code. A BROWSER
  CANNOT SEND A HEADER, so it holds its own per-boot secret in an HttpOnly
  SameSite=Strict cookie, and nothing hands that out to a plain request: the
  cookie is set only by trading a single-use, five-minute handoff nonce that a
  holder of the bearer minted (`system.browserHandoff`; `serve --open`, the
  link `serve` prints, `inteligir open` and the shell's Open in Browser) on a
  document URL carrying `?handoff=`, which answers a 303 to the same URL
  without it. A document request carrying neither credential gets a 401 page
  that runs nothing and names those ways in (`signed-out-page.ts`), never the
  shell, which would load and then fail every call with nothing saying why.
  The renderer reads the same 401 off `/rpc`'s transport as signed out
  (`apps/desktop/src/renderer/app/signed-out-state.ts`): one notice replaces
  the toast host, the workspace stays mounted, and the next answer clears it,
  so a tab signed in again from another recovers without a reload. Each
  carrier accepts only its own secret, and the cookie, being ambient, must also
  prove same-origin because loopback "site" ignores the port. EVERY REQUEST
  MUST NAME 127.0.0.1 OR localhost AS ITS HOST, refused with a 421 ahead of
  every route, /health and the sockets included: a page that rebinds its own
  hostname onto the port gets nothing. Residual: a cookie is port-agnostic, so
  a server on another loopback port the browser visits receives it; that is why
  it is not the bearer, never touches disk and dies with the boot.
  `apps/cli/src/server/server-file.ts`, `browser-session.ts`,
  `browser-request.ts` and the guard at the top of `app.ts`.

- **Shutdown is ORDERED, per-step TIME-BOXED, and its exit code is the truth.**
  Writers stop, the vault flush runs, handles close; each step has its own
  budget because one wedged step under a single budget starves the flush. The
  listener step closes websockets by name, because an upgraded socket is
  detached from the HTTP server's tracking and one open tab once stalled the
  whole teardown; the names come from `ws`'s own client set (`wss.clients`,
  which `createApp` hands out), not from a registry per socket route. SIGINT,
  SIGTERM and SIGHUP (a closed terminal) all run it, and a write error from a
  gone terminal or pipe is swallowed so it cannot turn the teardown into a
  fatal. The step list is re-read before every step, so a boot still composing
  when the signal lands adds what it brings up and each step runs once.
  `apps/cli/src/server/shutdown.ts` and `listen.ts`.

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
  single preload hands the renderer the loopback origin. BOTH CARRIERS LEND THE
  BEARER ONLY TO THE PAGE: a request's `initiatorOrigin` must be
  `inteligir://app`, or absent for one the browser started itself
  (`carriesBearer`), so a sandboxed note frame, whose origin is opaque
  (`"null"`), gets a 403 from the handler and a bare upgrade from main. The
  gate runs ahead of both renderers, because `pnpm dev` serves no CSP. The pin
  cannot use `URL.origin`, which answers `"null"` for any non-special scheme;
  scheme and host are compared as fields. A copied link names the server's
  loopback origin, never the page's. `apps/desktop/src/main/protocol.ts` (the Electron wiring)
  over `protocol-handler.ts` (pure, tested), `origin-pin.ts`,
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
  swaps the bundle; Squirrel installs after `quitAndInstall` returns, so its
  failure arrives as the updater's `error` event, which the install step owns
  once handed off: the shell says so and quits, the server being down already.
  The state is a union by status, each carrying only what it knows (an error
  names the step a click retries), and the policy runs a step only where
  `updateAction` offers it. THE BRIDGE CARRIES ONLY WHAT MAIN OWNS: the loopback
  origin, the updater, the spell checker, the vault switch and Reveal/Open,
  because no server can answer for any of them. Each channel is one row
  (`apps/desktop/src/ipc-contract.ts`): its name beside its request and answer
  schemas, typing main's handler and the preload's invoke alike, and every
  frame is parsed by the side that receives it. A refusal crosses as a value
  (`{ ok: false, reason }`), never a throw, because Electron rewords a thrown
  error; a throw is a fault, and the page words it itself. Still no token in
  the renderer. `apps/desktop/src/main/updates.ts` (the policy over an
  injectable port) and `apps/desktop/src/update-state.ts` (the one state).

- **SPELL CHECK IS THE SESSION'S SWITCH, AND THE PAGE KEEPS THE CHOICE.** Only
  main can flip Chromium's checker, so Settings › Editor asks through the bridge
  (`desktop:spellcheck-*`, every frame parsed on both sides) and stores the
  choice in the page's own prefs, re-applied before the first paint; no
  main-side store, because the choice is a page preference like the theme. The
  language list is offered only where Electron honours it: on macOS the OS
  checker detects the language itself and the setter is a no-op, so the row
  says so instead of pretending. Outside the shell there is no bridge and no
  row. `apps/desktop/src/main/spellcheck.ts` (the policy over a port),
  `apps/desktop/src/spellcheck-state.ts` (the one state),
  `apps/desktop/src/renderer/app/desktop-spellcheck.ts`.

- **THE SHELL ASKS THE LOGIN SHELL FOR PATH BEFORE THE FIRST FORK.** A Finder
  or Dock launch inherits launchd's PATH (`/usr/bin:/bin:/usr/sbin:/sbin`), and
  the server decides whether the agent runs by finding `claude` or `codex` on
  PATH (`binaryOnPath`), so the installed app opened the normal way reported
  no agent while every terminal launch found one. A packaged macOS shell runs
  `$SHELL -ilc` once (zsh when unset), reads PATH from between two markers so
  rc-file noise cannot leak in, puts those entries ahead of the inherited ones
  and assigns the union to main's own `process.env.PATH`: the first child and
  every vault switch's spread it, so `serverProcessEnv` stays the one channel
  for the child's own variables. It is asked while Electron readies and capped
  at 5s; a timeout, a failure or an empty answer adds whichever of
  `~/.local/bin`, `/opt/homebrew/bin` and `/usr/local/bin` exist instead. The
  fixed list alone is rejected, as is an `LSEnvironment` PATH in the bundle:
  neither can know a version manager's directory, and `codex` installed under
  one is invisible to both. A dev launch is left alone: it comes from a
  terminal whose PATH is already the user's. `apps/desktop/src/main/login-shell-path.ts`.

- **A DATA DIR HAS ONE SERVER, AND THE LOCK, NOT THE ROW, DECIDES IT.**
  `server.json` is published only after compose and listen, so two boots
  started together both find no row and would both open one db. `serve` takes
  `<dataDir>/serve.lock` (O_EXCL, holding its pid) before anything is composed
  and releases it as the teardown's last step, after the db closes. A lock
  whose pid is dead is broken and retaken once; a live pid holds it unless that
  pid has published a row the guard judges gone (refused, or answering for
  another data dir), because a crash's pid can be reused by an unrelated
  process and must not block boot forever. An unreadable pid counts as held:
  it is a boot between its create and its write. `assertNoLiveServer` still
  runs first for the message that names the port. A server removes
  `server.json` only when the row carries its own token, so a shutdown never
  retracts another boot's address. `apps/cli/src/server/serve-lock.ts` and
  `claimDataDir` in `serve.ts`.

- **THE PACKAGED BINARY'S FUSES ARE FLIPPED, EXCEPT RUN-AS-NODE.** electron-builder
  flips them before signing: `NODE_OPTIONS` and `--inspect` are ignored,
  `file://` pages get no extra privileges (the protocol handler's own
  `net.fetch` of the bundle is not a page and still reads it), and the cookie
  store is encrypted, a one-way change to an install's profile. `runAsNode`
  stays on because the server's watcher forks its child with `child_process`
  from inside the utility process, which runs this binary as Node, and the
  packaged smoke boots the server the same way; it goes off only once that
  fork does. `apps/desktop/electron-builder.yml`.

### Desktop workspace surfaces

- **WINDOW-LEVEL HOSTS MOUNT AT THE ROOT ROUTE.** `ConfirmDialogHost`, `Toaster`
  and the one `TooltipProvider` live in
  `apps/desktop/src/renderer/routes/__root.tsx`; a host mounted by one route
  leaves another route's `confirm()` parked on a dialog that never opens.

- **THE RAIL IS FLUID'S SIDEBAR ANATOMY; THE TOP BAR IS THE OPEN NOTE.** Header,
  one group, footer, at the app's size step. The header line is the vault row
  (its initial on a tile, the name semibold, the recent vaults and Open
  another vault… behind the chevron) with Search beside it, a 24px button
  that opens the palette. The one group's label names the view and opens the
  view menu — Recent | Files | Deleted, one list each, drawn by the same
  `SidebarMenu` rows so switching swaps rows and never the chrome around
  them — with New note as the group's action at its trailing edge. Not tabs
  and not stacked sections: a stack made every list short, and a tab row was
  a third line of chrome. Every other verb is a right-click, as in an IDE: a
  row's menu carries its own (the recents' Pin, the deleted's Restore, the
  tree's rename, move and delete), and the tree's empty area carries New
  note, New folder, the sort toggle and Collapse all. The footer is the
  workspace's ambient row: the sync state as a menu row (its dot, its label,
  the agent's spinner while a thread runs) over Sync now and the account —
  Sign in… when this device has none, the account, Sync threads now and Sign
  out when it does, through the one `useCloudSession`
  (`app/cloud-session.ts`) Settings › Devices runs too. Settings and the
  theme are the footer's 24px actions. Every row in the three views is a
  `SidebarMenu` row (`@repo/ui/components/sidebar-menu`, Fluid's row on the
  repo's proximity hover: the traveling hover pill, semibold while current
  without the row widening, a `SidebarMenuAction` revealed on hover); the
  tree's rows are those rows carrying `treeitem` and the drag handlers, so
  its keyboard walk and the menu's arrow-key walk are one rhythm — the
  menu's own walk stands down for a key the row already handled. The view is
  the workspace's (`railView` in `app/prefs.ts`) because a `#tag` chip shows
  Recent scoped to the tag, a create shows Files, and the palette's Deleted
  notes and the Metadata tab's "Deleted notes…" show Deleted; the selected
  tag is the workspace's for the same reason. THERE IS
  NO FOLDER SCOPE: the top bar's breadcrumb REVEALS rather than narrows —
  a segment shows Files, opens the way to that folder and selects it
  (`useTreeState` in `sidebar/tree-state.ts`, applied where the fold state
  lives, and the tree's one effect focuses the row that render drew, once,
  and never over an open name input, whose blur would cancel it). A
  second listing root was a second answer to "what is this list?" and made
  the recents' folder hints relative to it. The tree's fold, selection and
  name input are the rail's state (`sidebar/tree-state.ts`), not the
  tree's: Collapse all clears that set and a create lands where an IDE's
  would, in the tree's selected folder, else at the vault root, opening that
  folder in the same update. What the state follows — the listing, the open
  note, the reveal — is applied during the rail's own render; the tree only
  reads it, because a component setting its owner's state while it renders
  is a React error. Find in note, comments and the panel
  toggle live above the note; copy link, export and share sit under its ⋯
  menu. One `useVaultSwitch` and one `RecentVaultLabel`
  (`app/desktop-vaults.tsx`) serve the rail's vault row and Settings alike.
  The rail and the palette's note rows and folder pages hide what the user
  did not write through one filter, `visibleEntries` in `app/vault-hooks.ts`
  (`@repo/notes/knowledge/doc-file`'s `isVaultMetadataPath`: comment
  sidecars, dot-entries); the server's listing stays complete because the
  CLI and the agent read it. Under the macOS shell the rail reserves the
  traffic-light corner (`apps/desktop/src/renderer/app/title-bar.ts`);
  nothing else is a logo. `apps/desktop/src/renderer/app/sidebar/sidebar.tsx`.

- **THERE IS ONE SEARCH SURFACE, AND IT IS ⌘P.** The palette lists every note
  and every command in one field, and the two searches that are not a lookup
  reach the rest from inside it: "Search across the vault…" opens the literal
  scan with its replace. ⌘F IS NOT ONE OF THEM: it searches within the open
  note, not the vault, so it keeps its own chord and its own bar. ⌘O and ⌘⇧F are GONE, and with them the
  palette's quick-open page (the root with its commands folded away) and the
  rail's search field: four ways to type a note's name was three too many,
  and each one was a different set of rows for the same question. The rail's
  Search button opens the palette, and its tooltip spells ⌘P from the table
  (`app/global-shortcuts.ts`), never as a literal.

- **A NOTE'S FACTS ARE READ WHERE THEY ARE CHEAP, and the count rides the
  serializer.** The Metadata tab's "About" block is folded by default because
  unfolding it is what reads the git log for the created date (the oldest
  revision, the last row of the last page of `vault.history`, re-read only
  while it is still null). Words, characters and reading time are counted by
  `@repo/editor/note-stats` over the editor's lowest blocks, beside the TOC's
  walk so both agree on the document, and published by the serializer's
  debounce, never per keystroke; the panel reads a path-keyed store like the
  live editor's. The top bar's breadcrumb reveals a folder in the rail's tree
  (`revealInTree`); the reveal request is the workspace's state, keyed by a
  nonce, and a prop to both, not a request store: a store is for a surface
  with no route to the owner, and both are one hop away.
  `apps/desktop/src/renderer/app/actions/note-facts.tsx`.

- **THE PANEL STARTS CLOSED, IS FLAT-TABBED, AND IS DRAGGED LIKE THE RAIL.**
  `panelOpen` defaults off; its toggle opens it, and so does every entry
  that shows something in it — a comment focus, the top bar's Comments, a
  thread the composer launched or the palette picked — through one
  `revealPanel` (`app/workspace.tsx`) that leaves zen, persists the open and
  picks the tab, because an entry that only picks its tab or thread shows
  nothing in a closed panel. Its tabs are Base UI Tabs through `@repo/ui/components/tabs`,
  the flat underline row; the pill switch went with its last consumer. Its width persists through the same Fluid resize handle the
  rail uses (`panelWidth` beside `sidebarWidth` in `app/prefs.ts`), because a
  second resize mechanism would be a second answer to one drag; the provider
  reports a width once, when a drag lets go or collapses the side
  (`onWidthCommitted`), never per frame.

- **AMBIENT STATE LIVES IN THE RAIL'S FOOTER; THE NOTE KEEPS ITS COUNT.** A
  strip across the whole window was a second bar under a rail that already
  had a bottom, so the sync state, the agent's spinner and Settings moved
  into Fluid's `SidebarFooter` and the window-wide status bar
  went. What stays under the note is `app/note-footer.tsx`: the open note's
  word count and reading time alone, right-aligned, at `--app-status-h`
  beside `--app-header-h`, and with no rule above it so it reads as the
  note's last line rather than chrome. The count is the serializer's
  published one, never a recount, and zen hides the strip with the rest. The
  rail's and the panel's shells take `h-full` from the workspace because
  Fluid's shell is viewport-height by class.

- **THE PALETTE IS FLUID'S COMMAND MENU, AND IT HAS NO PRIMITIVE UNDER IT**
  (reversing the cmdk line; the dependency is gone). The field keeps DOM focus
  and names the highlighted row through `aria-activedescendant`, so the list
  is a `role="listbox"` of plain rows: the arrows and Enter are the field's
  handlers, and the highlight is the one proximity pill every other popup here
  draws (`ProximityOverlays` over `useProximityHover`), not a per-row
  `data-selected` fill. cmdk's filter was already off on every page — each page
  filters its own rows — so what it still owned was the keyboard, and one
  keyboard beside the pill was two answers to "which row is live?". ROWS ARE
  CHILDREN, NOT DATA, diverging from Fluid's `items` array deliberately: the
  pages draw eight different row shapes (a heading's depth, a match's
  before/hit/after, a problem's detail) and a data array would be a second
  answer to what a row is. A row therefore does not answer for its own
  position — the list reads document order through `useRowOrder`, like the
  dropdown and the rail. The panel opens where a panel at its cap height
  sits centered and KEEPS that top edge, so the field never moves as the rows
  filter down. The footer names Enter after the highlighted row, read off that
  row's own `data-command-action`, so nothing keeps a second copy of a label
  the page already drew; a row without one leaves Enter unnamed rather than
  guessing. A chord draws one box per key: `CommandShortcut` takes the caps
  `hotkeyCaps` draws from the one modifier table `spellHotkey` joins
  (`@repo/ui/lib/hotkey-spelling`), so ⌘ is spelled once and nothing cuts a
  spelled string back into keys.
  What went with cmdk is `input-group.tsx`: the palette's framed field was its
  last consumer, and Fluid's field is frameless over a divider. ONE DIALOG FOR
  EVERY PAGE: the dialog, the field and the footer are drawn once, their words
  read from a per-page table, and a page draws only its toolbar and its list,
  so a page switch never re-animates the backdrop or takes the caret out of
  the field. A page the palette opens onto is a union member, so a move page
  cannot exist without the entry it moves, and the open note's verbs are one
  nullable `note`, so no row can be offered without its note.
  `packages/ui/src/components/command.tsx`,
  `apps/desktop/src/renderer/app/palette/command-palette.tsx` and
  `apps/desktop/src/renderer/app/palette/palette-page.tsx`.

- **THE BUS IS APPLIED ONCE PER FRAME, AND A KIND REFETCHES ONLY WHAT IT
  MOVES.** `ChangeBatch` folds every ws frame since the last animation frame
  and flushes once, so a K-note rename is one knowledge sweep rather than K,
  and a hidden window, which runs no frames, folds a long turn into one flush
  on return. Thread kinds are weighed in two total tables beside the vault
  kinds' invalidations, `MOVES_THE_LIST` and `MOVES_THE_DETAIL`, next to
  thread-hooks' `MOVES_THE_TIMELINE`: `events-appended` moves neither, so a
  streamed turn refetches the timeline's delta and never the unpaged thread
  list. A `content-changed` under the comment store sweeps the comments, since
  a second comment rewrites an existing store and announces no row; every
  `content-changed` stamps the cached listing's `modifiedMs` with the frame's
  arrival instead of re-walking the vault, so the recents move while a note is
  edited. The note session hears the flush as `VaultChangedEvent`s
  (`packages/editor/src/host-io.ts`): ONE `files` event however many paths
  moved, which always re-lists, since a named path may have left the vault as
  easily as joined it, or a `content` event per doc, which re-lists nothing.
  Its listing is the rail's own tree query (`readVaultTree` in
  `apps/desktop/src/renderer/app/vault-hooks.ts`), read after the flush
  invalidates it, so it joins the rail's refetch and a K-path frame is one walk.
  A reconnect sweeps every family the bus reaches, declared once and checked
  against every frame's invalidations, and tells the session a `files` event
  naming nothing; that sweep is why no window-focus re-walk backs it up.
  `apps/desktop/src/renderer/app/workspace-context.tsx` and
  `apps/desktop/src/renderer/app/__tests__/changed-message.test.ts`.

- **THE NOTE STORE OWNS THE OPEN NOTE, THE URL MIRRORS IT, AND SETTINGS
  COVERS A WORKSPACE THAT STAYS MOUNTED** (owner decision). `?note=` is read
  once, at boot, as the deep link, and every open after that is mirrored into
  it with `replace` on whichever route shows, so the store's back/forward
  stacks are the one history and the rail, the top bar and the panel all read
  the store's `openPath`: a pushed entry per open let a browser Back move the
  rail's highlight off the note the editor still held. Settings is a child of
  the pathless `_workspace` layout, drawn in a full-window layer over the
  workspace rather than as a sibling route, which unmounted the note, its undo
  history, the composer and zen, and re-walked the vault on the way back.
  `search: true` carries `?note=` both ways. Covered, the workspace is `inert`
  and its `GLOBAL_SHORTCUTS` listener, the rail's `[` and the panel's `]`
  among its rows, is detached, because inert stops focus and pointer but not a
  window listener; the
  way in blurs the focused element and flushes the open note, since no unmount
  settles a title mid-rename or an edit inside the debounce any more. The layer
  is the layout's, not the page's, so a child's crash boundary lands inside it
  rather than below a workspace it left inert.
  `apps/desktop/src/renderer/routes/_workspace.tsx`,
  `apps/desktop/src/renderer/app/__tests__/workspace-runtime-mount.test.tsx`
  and `apps/desktop/src/renderer/app/__tests__/workspace-routing.booted.test.tsx`.

### Repo guards, vendoring and tooling

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

- **A ROW DOES NOT ANSWER FOR ITS OWN POSITION; ITS CONTAINER DOES.** A
  conditional row changes where its siblings sit without re-rendering them, so
  a row deriving its index from the DOM needs an effect with no dependency
  array — and a React rule suppression makes the compiler skip optimizing the
  whole component. The list keeps the set instead and reads document order
  itself, through the one registry the sidebar menu, the dropdown and the
  palette share (`useRowOrder` in `packages/ui/src/hooks/use-row-order.ts`):
  a row registers its element and asks only whether it is the lit one. A
  registration only marks the set dirty, and one sync per commit reads the
  order in the layout phase of the commit after, so a list of N rows mounts,
  grows or empties in O(N); a sync per row re-registers every row for every
  row, and mounts a thousand-row tree in tens of seconds. Not a microtask:
  an update made outside the commit can render a frame late, and that frame
  draws the pills at the old rects. A keyed reorder mounts no row, so a
  MutationObserver on the list catches it and forces the resync with
  `flushSync`, before paint, for the same reason. The lit row rides a store
  the rows read through `useSyncExternalStore` (`useHighlighted`), so a hover
  step re-renders the row it left and the row it reached, not the list.
  `packages/ui/src/components/__tests__/row-registry.test.tsx` pins the
  linear mount, the reorder and the two-row hover. No `exhaustive-deps` or
  `rules-of-hooks` suppression is left in the renderer or `@repo/ui` — those
  are the ones the compiler bails on, and `react/rule-suppression` refuses a
  new one — so the compiler optimizes both.

- **THE REACT COMPILER IS ON FOR ALL THREE APPS**: `compiler: true` on
  `@vitejs/plugin-react` in both vite configs and `reactCompiler: true` in
  `apps/mobile/app.config.js`. The suites run what ships: the desktop's,
  `@repo/editor`'s and `@repo/ui`'s DOM tests compile their sources the same
  way (`vitest.config.ts` in each; test files excluded, because a fixture hook
  minted in a factory is hoisted with no diagnostic), and a
  `compiled-under-test` suite in each fails when the plugin goes. A node
  suite, and the desktop's booted ones, cannot run compiled: the plugin skips
  the ssr transform. The manual-memo sweep is a follow-up.

- **TOOLING PINS, each with its reason beside it**: `vite` is a pnpm override
  because the catalog bound only the manifests that spell it; `@types/node`
  tracks `engines.node`; `compatibility_date` is the lockfile's oldest workerd,
  held by `tools/repo-guards/src/wrangler-compat-date.test.ts`; `pnpm e2e` boots
  the built Worker bundle (`tools/e2e/src/scenarios/built-worker-boot.ts`) and
  the built CLI bundle (`tools/e2e/src/scenarios/built-cli-boot.ts`);
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
  replays the output with no error, and the e2e suite and `package:*` test and
  ship what it replays. Another workspace's files enter a key only through a
  `^` edge, so every cached task of a workspace with dependencies carries one
  (`tools/repo-guards/src/turbo-cache-keys.test.ts`); the desktop build takes
  `^topo`, the transit node, since `^build` would cycle through the CLI build
  that stages its renderer (`apps/desktop/turbo.json`). A file in no
  workspace is a named input (the licence texts on `apps/cli/turbo.json`), a
  file a later command follows is a named output (the web build's
  `.wrangler/deploy/**`, `apps/web/turbo.json`), and `NODE_ENV` is hashed
  `globalEnv`, not a passthrough: vite emits React's dev build under
  `development`, and the dev shell hands that value to every agent shell.

- **A DESKTOP TEST THAT LOGS A console.error FAILS.** React reports a setState
  during another component's render, a missing key or an update outside
  `act` as a console.error and nothing else, so a suite that only logs it
  stays green over a real defect. The gate
  (`apps/desktop/src/renderer/app/__tests__/console-error-gate.ts`) fails the
  test that logged; a test that provokes one on purpose (every refused call
  is logged by the dev client in `app/api.ts`) silences it with its own
  `vi.spyOn(console, "error")`. The booted suites are not gated: the server
  they boot in-process logs every refused call by design.

- **A PARSER COST WE CANNOT WAIT OUT UPSTREAM IS A pnpm PATCH, AND A TEST FAILS
  WITHOUT IT.** micromark merges a paragraph's text fragments with one splice
  per line, and GFM's email autolink literal splits the text at every word, so
  one long paragraph (a pasted log, prose with no blank lines) parsed in time
  quadratic in its lines: 20k lines cost the scan seconds, and the editor's
  grammar and the verbatim-span pass run the same parser.
  `patches/micromark@4.0.2.patch` is upstream's own open fix
  (micromark/micromark#233), applied through `patchedDependencies` in
  `pnpm-workspace.yaml` to every consumer, the CLI's bundle included, which
  inlines the patched copy; a micromark bump fails the install until the patch
  is re-cut or dropped. A workaround in `@repo/notes` was rejected: the only
  lever there is splitting the paragraph, which changes what it parses to.
  `packages/notes/src/__tests__/projection-cost.test.ts` compares a 20k-line
  paragraph's projection with an eighth of it, so losing the patch fails a
  suite. Still superlinear upstream, and not patched: a paragraph dense with
  emphasis (attention's resolver splices per pair) or with inline nodes
  (mdast-util-find-and-replace looks each text node up by `indexOf`).

**Before raising a "new" finding, read
[#542](https://github.com/kyh/inteligir/issues/542)**: the decision record
carries what was rejected as well as what was chosen. The `note` issues are
the declines register: #645 (the 2026-09-01 review) and #674 (the 2026-09-05
simplify pass over the feature wave) name findings weighed and not fixed; the
older ones (#446, #453, #472, #474) catalogue findings declined against the
hosted Durable-Object architecture this rewrite replaced.
