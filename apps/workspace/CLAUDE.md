# Decisions: @repo/workspace

The page: the library, the open item, the rail, the palette, the panel and the
page's own preferences. `AGENTS.md` § Decisions says how a bullet is written and cited.

## Shape

`src/app/workspace.tsx` owns the library, the open item, the rail, the palette
and the panel; `app/library/` the grid, its scope and selection, a save from the
window, Quick Look, the bulk verbs, Tidy my library and the way into a Raindrop
import; `app/import/` the import's confirming dialog; `app/item/` the item view,
its stages and its top bar; `app/note/` the guarded writes; `app/palette/` the ⌘P pages;
`app/sidebar/` the rail's scopes (the library, its folders, its tags and
Deleted); `app/agents/` the one agent sign-in ⌘K,
the panel, Settings and onboarding all draw; `app/settings/` the Settings layer,
Account and Advanced included; `app/onboarding/` the agent and account steps
`/welcome` offers after a first run. Every shell answer is parsed in
`src/shell/shell-commands.ts` and mirrored through one `app/bridge-store.ts`.

## Vault: writes, git and containment

- **A MOVE IS A RENAME THAT KEEPS THE NAME, and `planMove` is its one verdict.**
  A card dropped on a folder row, a folder row dropped on another, Info's Move…,
  a bulk move and the palette's "Move to folder…" all ask `planMove`
  (`apps/workspace/src/app/sidebar/tree-ops.ts`), so all refuse for the same
  reasons. The drag's source is the window's own drag store
  (`apps/workspace/src/app/library/drag-store.ts`), not `dataTransfer`, because a
  drag from the desktop carries files and links too: a drop with nothing in the
  store came from outside, and is a save, never a move (A SAVE FROM THE WINDOW IS
  A PASTE OR A DROP THAT NO FIELD CLAIMED). No second write path: the move rides
  `vault.rename`, which rewrites links for a folder as for an item
  (`apps/cli/src/server/knowledge/rename.ts`), and the vault session carries the
  open item through it (`packages/editor/src/note/vault-session.ts`). The
  rename's pure half (the moves, the old stem kept as an alias, the writes) is
  `@repo/notes/knowledge/plan-rename`, which the phone plans with too; only the
  guards are each caller's.

- **GIT IS THE ENGINE, NEVER THE VOCABULARY, AND ITS RAW STATE IS SETTINGS ›
  ADVANCED'S.** The rail, a sync toast, History and a note's facts say sync and
  versions. A sync state's label and its one line are spelled in
  `syncStateLabel` and `syncStateNote`
  (`apps/workspace/src/app/vault-hooks.ts`), and nothing but Settings › Advanced
  reads `lastError`, git's own stderr: a state only the engine can explain says
  "Sync paused" and offers Sync details…, which opens the one section that shows
  the remote, the raw state and the last error, the thread sync's included
  (`apps/workspace/src/app/settings/advanced-section.tsx`). History names a
  version by when and who, never by its subject or sha: the server reads
  `authorKind` off the author (the user's own edits, the agent, or `external`,
  which keeps its name and subject), so no client matches an email
  (`apps/cli/src/server/vault/git-history.ts`); a phone's edit, which the Worker
  commits under the device's own address, reads as the user's own, never
  `external`, and the commit vocabulary both ends read is spelled once in
  `@repo/contract/cloud/vault/vault-git`. Quoting the engine's error inside a
  friendlier sentence is rejected: no sentence around git's stderr makes it the
  user's. `apps/workspace/src/app/__tests__/vault-hooks.test.ts` holds the copy
  to that and refuses a `lastError` read anywhere else in the page.

## Knowledge: index, search and links

- **RELATED IS ONE PANEL SECTION**: backlinks first because they are counted,
  then the scorer's rows with their reasons
  (`apps/workspace/src/app/actions/related-section.tsx`). Outgoing links stay
  absent (they are on screen); no graph view; the route is search-shaped (a
  `limit`, no `total`) and fetched only while unfolded. A change sweeps
  `orpc.knowledge.key()` whole but for the link targets, which move only on
  `targets-changed` (A TARGET CHANGE IS ITS OWN KIND), because a link into a
  note lives in another note's bytes (`app/change-batch.ts`). It is a section of
  Info, under an item's own fields
  (`apps/workspace/src/app/actions/info-tab.tsx`), so a link's related notes are
  one fold away from its address.

## Agents and threads

- **THE AGENT SURFACE IS THE ⌘K ACTION COMPOSER AND THE RIGHT PANEL** (the
  surfaces declined beside it are #645's register). An action is an ordinary
  thread attached to the item it was composed over (AN ACTION'S ORIGIN, in
  `apps/cli/src/server/agents/CLAUDE.md`). The agent edits the library directly
  and highlights are the review channel; the panel's Info | Annotations |
  Actions | History tabs are the subject's facts and fields, its highlights,
  transcript and revisions. With no item open the composer's subject is the
  library: ONE detachable chip for the grid's selection ("3 items", "All in
  Unsorted") or, with nothing selected, its scope, and the send carries the
  library view context (scope, chip, search, how many are selected and the
  first 200 names), read as the send leaves, ⌘A's names from the listing
  (`readViewContext` in `apps/workspace/src/app/workspace.tsx`); the thread's
  attribution names the screen and the count, never the names
  (`apps/workspace/src/app/actions/timeline-rows.tsx`). TIDY MY LIBRARY IS THE
  COMPOSER OPENED ON A PRESET (A NAMED ACTION IS A PRESET ON THE SEND), its chip
  above an optional field, sent from Unsorted with nothing typed if need be;
  the header, ⌘P and the Unsorted row's menu open it, and "Edit filing rules…"
  opens the library's AGENTS.md, written from the starter rules when the
  library has none (`apps/workspace/src/app/library/tidy-library.ts`). Rejected:
  a seeded prompt in the field, which a person could edit into something the
  server's block no longer matched, and "Share with agent", which copied
  engine words. Each settled reply ends with the items its turn edited and
  Undo changes, and a finish toast ("Agent edited N items", Undo) sits outside
  the panel, both counting a turn's items as a person does, the undo's own
  sentence too: each move once at the path it made, and no cover or original
  beside the item that embeds it (the turn's `items`, by
  `packages/notes/src/items/turn-items.ts`), never its raw paths; a `changes-committed` frame names its thread, never its turn, since
  the bus carries no payload, so the toast diffs a thread's turns against what
  it last read (`apps/workspace/src/app/actions/turn-finish-toast.ts`). Both
  undos flush the open item first, so a line inside the autosave debounce is
  merged around rather than missed (`undo-turn.ts`). "Ask agent" seeds the
  composer through the editor host's agent actions
  (`packages/editor/src/host-io.ts`), so the editor never imports the shell.
  `apps/workspace/src/app/actions/actions-panel.tsx`, `action-detail.tsx` and
  `action-composer.tsx`.

## Desktop workspace surfaces

- **WINDOW-LEVEL HOSTS MOUNT AT THE ROOT ROUTE.** `ConfirmDialogHost`, `Toaster`
  and the one `TooltipProvider` live in `apps/workspace/src/routes/__root.tsx`;
  a host mounted by one route leaves another route's `confirm()` parked on a
  dialog that never opens.

- **THE RAIL CHOOSES THE LIBRARY'S SCOPE, AMBIENT STATE LIVES IN ITS FOOTER,
  AND THE TOP BAR IS THE PAGE'S.** Header (the vault row, and Search, which opens
  the palette), the stacked groups Library (All items and Unsorted), Folders,
  Tags and Deleted, and a footer. Every row is a `SidebarMenu` row
  (`@repo/ui/components/sidebar-menu`), and a click sets the grid's scope
  (`libraryScope` in `apps/workspace/src/app/prefs.ts`) and goes back to the
  library, so the rail is a list of places, each one click away. A FOLDER SCOPE
  EXISTS: a folder row and the item bar's breadcrumb both NARROW the grid to the
  folder and what is under it. The folders are `knowledge.scopes`', so a folder
  an item sits in is listed with its count though the disk holds no directory
  for it (`apps/workspace/src/app/sidebar/folder-tree.tsx`), a rename or a move
  of the shown folder, or of one above it, from any surface takes the scope
  with it (`scopeAfterMove` in `apps/workspace/src/app/sidebar/tree-ops.ts`),
  and a remembered folder no longer listed reads as All items. The Tags group folds
  (`railTagsOpen`); a folder's fold and its name input are the rail's own state.
  Rejected: the Recent | Files | Deleted view menu, where switching swapped one
  list for another and every list answered "what is this?" differently, and a
  breadcrumb that only revealed the folder in a tree. Every other verb is a
  right-click, as in Finder. The footer holds the sync state, the agent's spinner
  and Settings, because a strip across the whole window was a second bar under a
  rail that already had a bottom; its account row runs the one
  `useCloudSession` (`app/cloud-session.ts`) Settings › Account runs too, and
  offers Sync now and no second sync for actions, which sync on their own
  (`sidebar/sync-row.tsx`). The top bar is the page's, not the rail's: the
  library's header and an item's bar share its two ends, the rail's toggle with
  Back and Forward and the panel's toggle
  (`apps/workspace/src/app/topbar-lead.tsx`). Under a note sits only its word
  count and reading time (`app/note-footer.tsx`), the serializer's published
  count, never a recount, with no rule above it so it reads as the note's last
  line; zen hides it. Under the macOS shell the rail reserves the traffic-light
  corner (`apps/workspace/src/app/title-bar.ts`).
  `apps/workspace/src/app/sidebar/sidebar.tsx`.

- **THERE IS ONE SEARCH SURFACE, AND IT IS ⌘P.** The palette lists every note
  and every command in one field, and the search that is not a lookup opens from
  inside it: "Search inside every item…" (the literal scan), and "Show all
  results in the library", which hands what the field holds to the grid as its
  filter, so the grid needs no search field of its own. ⌘F IS NOT ONE OF
  THEM: it searches within the open note, so it keeps its own chord and its own
  bar. There is no ⌘O, no ⌘⇧F, no quick-open page and no rail search field: four
  ways to type a note's name was three too many, each a different set of rows
  for the same question. The rail's Search button's tooltip spells ⌘P from the
  table (`app/global-shortcuts.ts`), never as a literal. The palette saves too:
  "Save link…" opens a page that says whether the library already holds the
  address before it saves, and a web address typed into the field offers "Save
  this link" as its first row
  (`apps/workspace/src/app/palette/save-link-page.tsx`), so a save needs no
  second field.

- **A NOTE'S FACTS ARE READ WHERE THEY ARE CHEAP, and the count rides the
  serializer.** Info's "About" fold is folded by default because unfolding it is
  what reads the git log for the created date. An item's Saved and Modified are
  its index row's, so Info reads no file for them. Words, characters
  and reading time are counted by `@repo/editor/note-stats` beside the TOC's
  walk, so both agree on the document, and published by the serializer's
  debounce, never per keystroke.
  `apps/workspace/src/app/actions/note-facts.tsx`.

- **THE PANEL STARTS CLOSED, IS FLAT-TABBED, AND IS DRAGGED LIKE THE RAIL.**
  `panelOpen` defaults off, and every entry that shows something in it opens it
  through one `revealPanel` (`app/workspace.tsx`), because an entry that only
  picks its tab or thread shows nothing in a closed panel. Its first tab, Info,
  is the default, and it is about one subject, the first that holds: the open
  item, the one item selected, the selection, the scope the grid shows
  (`panelSubjectOf` in `apps/workspace/src/app/workspace.tsx`). Its tabs are the
  flat underline row of `@repo/ui/components/tabs`. Its width persists through the
  rail's own Fluid resize handle (`panelWidth` beside `sidebarWidth` in
  `app/prefs.ts`), because a second resize mechanism would be a second answer to
  one drag, and is reported once a drag lets go, never per frame. Closed, a
  sidebar is slid off-screen rather than unmounted, so it is `inert`
  (`SidebarPanel` in `packages/ui/src/components/sidebar-core.tsx`): otherwise
  its controls answer Tab and share their names with the surface that is open.

- **THE PALETTE IS FLUID'S COMMAND MENU, AND IT HAS NO PRIMITIVE UNDER IT**. The
  field keeps DOM focus and names the highlighted row through
  `aria-activedescendant`, and the highlight is the one proximity pill every
  other popup draws; cmdk was rejected: its filter was off on every page, and
  its keyboard beside the pill was two answers to "which row is live?". ROWS ARE
  CHILDREN, NOT DATA, diverging from Fluid's `items` array deliberately: eight
  row shapes in a data array would be a second answer to what a row is. The
  panel KEEPS the top edge a panel at its cap height would have, so the field
  never moves as rows filter down. A chord draws one box per key from the one
  modifier table (`@repo/ui/lib/hotkey-spelling`). ONE DIALOG FOR EVERY PAGE, so
  a page switch never re-animates the backdrop; a page is a union member, so a
  move page cannot exist without the entries it moves, a non-empty tuple of
  subjects, and the save-link page is one page more.
  `packages/ui/src/components/command.tsx`,
  `apps/workspace/src/app/palette/command-palette.tsx` and
  `apps/workspace/src/app/palette/palette-page.tsx`.

- **THE BUS IS APPLIED ONCE PER FRAME, AND A KIND REFETCHES ONLY WHAT IT
  MOVES.** `ChangeBatch` folds every ws frame since the last animation frame and
  flushes once, so a K-note rename is one knowledge sweep rather than K. Thread
  kinds are weighed in total tables (`MOVES_THE_LIST`, `MOVES_THE_DETAIL`,
  `MOVES_THE_TIMELINE`), so a streamed turn never refetches the thread list. The
  note session hears one `files` event however many paths moved
  (`packages/editor/src/host-io.ts`) and lists through the rail's own tree query
  (`apps/workspace/src/app/vault-hooks.ts`). The grid reads its listing one
  100-row window at a time, one `knowledge.items` query per window in view
  (`apps/workspace/src/app/library/library-items.ts`), never an infinite query
  whose every page refetches on one change, and it unmounts while an item is
  open, its scroll kept by the workspace, so a sweep then refetches the item's
  rows alone. A content change moves no listing row, since nothing
  reads a row's modified time from the tree, and an `import-changed` refetches
  the import's status alone. A reconnect sweeps every family the bus reaches,
  which is why no window-focus re-walk backs it up.
  `apps/workspace/src/app/change-batch.ts`, `app/actions/thread-hooks.ts`,
  `app/workspace-context.tsx`, which flushes the batch per frame, and
  `apps/workspace/src/app/__tests__/changed-message.test.ts`.

- **THE NOTE STORE OWNS THE OPEN ITEM, THE URL MIRRORS IT, AND SETTINGS COVERS A
  WORKSPACE THAT STAYS MOUNTED** (owner decision). `?item=` is read once, at
  boot, as the deep link, and every open after that is mirrored into it with
  `replace`, so the store's back/forward stacks are the one history: a pushed
  entry per open let a browser Back move the window off the item the store still
  held. Nothing open is the library, which puts no param in the url and is a step
  in that history like any item (`null` in
  `packages/editor/src/note/open-note-store.ts`); Back to library is the
  session's `closeFile`. The boot opens the deep link and nothing else, because
  home is the library: a remembered last note opened over it hid the grid on
  every launch. Settings is a layer over the workspace in the pathless
  `_workspace` layout, not a sibling route, which unmounted the item, its undo
  history, the composer and zen. Covered, the workspace is `inert` and its
  `GLOBAL_SHORTCUTS` listener detached, since inert does not stop a window
  listener; the way in flushes the open item, since nothing else settles a title
  mid-rename or an edit inside the debounce.
  `apps/workspace/src/routes/_workspace.tsx`,
  `apps/workspace/src/app/__tests__/workspace-runtime-mount.test.tsx` and
  `apps/cli/src/workspace/__tests__/workspace-routing.booted.test.tsx`.

- **A PAGE PREFERENCE IS A ROW, AND SO IS AN APPEARANCE DIAL.** What the window
  remembers across a reload is one `PREFS` row (key, a zod schema that decodes
  the stored string and encodes the value back, fallback), read and written only
  through `readPref` / `writePref` / `usePref`, so a key's reader and its writer
  cannot disagree on its bytes, and bytes a row cannot decode read as its
  fallback (`apps/workspace/src/app/prefs.ts`). An appearance dial is one
  `dial()` row naming its `--editor-*` token
  (`apps/workspace/src/app/appearance-options.ts`). One table shared with the
  data dir was rejected: no preference is read by both programs, a data-dir
  preference reaches the page through its `@repo/contract/local` contract, and a
  data-dir file's shape must stay readable, so it is not derived from a contract
  that may break freely. Labels and layout stay out of the rows, because
  Settings is laid out by hand. A keyed storage read outside the table fails
  `tools/repo-guards/src/page-prefs.test.ts`.

- **A LIBRARY SCOPE HAS ONE SPELLING, `@repo/domain/library-scope`.** Which
  part of the library a screen shows (all of it, Unsorted, a folder, a tag or
  Deleted) is one zod union, `libraryScopeSchema`
  (`packages/domain/src/library-scope.ts`): the page remembers it as a `PREFS`
  row over that schema (`apps/workspace/src/app/prefs.ts`), asks the items
  listing for it by its folder and tag, and sends it as a library view
  context's `scope` (`packages/domain/src/view-context.ts`), which the threads
  wire holds to a vault path and a tag name and refuses for Deleted
  (`packages/contract/src/local/threads/threads-schema.ts`). Rejected: a scope
  per surface (the rail's view name, the listing's request fields, the
  composer's subject), three spellings that drift the first time a scope gains
  a kind.

- **THE LIBRARY IS HOME, AND AN ITEM IS SHOWN BY ITS KIND.** With nothing open
  the window is the grid of the scope the rail chose, every item one card in one
  `@repo/ui` grid (`apps/workspace/src/app/library/library-view.tsx`); an item
  opens full size in its place (`apps/workspace/src/app/item/item-view.tsx`): the
  editor for a note, a saved page's source over its text or its sandboxed copy,
  and a viewer for a picture, a PDF, a video, a sound or any other file, each
  over the byte routes with the boot's media token, which WebKit's media loader
  needs for a video's ranges (`apps/workspace/src/app/item/item-stages.tsx`); the
  item takes the keyboard as it opens unless something already holds it, so the
  first Escape goes back. A viewer still opens its doc through the session, so History, ⌘K and Info bind
  to its path, and "Edit as note" swaps the viewer for the editor. What kind the
  open item is reads from the bytes the store last analyzed, never per
  keystroke, so the stage never swaps under typing
  (`apps/workspace/src/app/item/open-item-kind.ts`). An empty scope says why in
  one sentence and offers the one or two things worth doing from there. Rejected:
  a list beside an always-open note, which made a library of saved pages read as
  a folder of text files, and a separate reader per kind outside the session,
  which would have been a second open-item owner.

- **THE GRID'S SELECTION IS A STORE, A CLICK SELECTS AND A DOUBLE-CLICK OPENS.**
  Finder's grammar: a click selects one, ⌘-click toggles, ⇧-click extends from
  the anchor, the arrows move over the grid's own columns, ⌘A selects the whole
  scope by its count until a gesture needs its names, Space is Quick Look and
  Return opens (`apps/workspace/src/app/library/library-selection.ts`, a pure
  reducer). The grid keeps where the focus and the anchor sit in the listing,
  so the focused card's window stays loaded and its card mounted however far
  the grid scrolls, a ⇧-click whose span the loaded windows do not hold reads
  it from the listing, an arrow (and Quick Look's) steps by the focused card's
  own index in the listing, never through the loaded windows joined, which
  start wherever the grid was scrolled and leave gaps, and a right-click or a
  drag under ⌘A acts on everything selected; coming back from an item, the
  focused card takes the keyboard again, once, and never from a field or a
  dialog (`apps/workspace/src/app/library/library-grid.tsx`). A selected item
  that moved under the grid (a fill names a saved link's stub by its page's
  title) is followed by its id, its focus and Quick Look with it, as the open
  item is (`apps/workspace/src/app/workspace.tsx`). The store is the
  workspace's, made once beside the grid's scroll, so
  the panel's Info and the composer read the same selection the grid draws and
  an item opened over the grid comes back to it. Rejected: click-to-open, because
  the selection is the ⌘K context and the Info subject, and a click that opened
  could select nothing. A bulk verb runs in the chunks its route takes at once,
  sequentially, under one toast with Stop, and says only what landed
  (`apps/workspace/src/app/library/bulk-actions.ts`).

- **A SAVE FROM THE WINDOW IS A PASTE OR A DROP THAT NO FIELD CLAIMED.** A paste
  lands where nothing takes text, and a drop where no field, row, card or editor
  took it, a drop that holds nothing to save keeping the browser's own handling
  (`apps/workspace/src/app/library/capture/window-capture.ts`); both save into
  the folder the scope shows, else Unsorted, and say where with Open, or that the
  library already holds it with Show
  (`apps/workspace/src/app/library/capture/save-items.ts`). WebKit fires no paste
  on a target that is not editable, so ⌘V there moves the focus to a 1×1
  off-screen catcher without preventing the key, and the paste the key makes
  fires on the catcher, which hands the focus back, or lets it go when nothing
  had it or no paste came, so it never stays in a field nobody sees. What a transfer holds is read
  in one place, files over links, links from the uri-list with their titles
  (`apps/workspace/src/app/library/capture/capture-payload.ts`), and a folder or a
  file over the cap is refused there, before a byte is sent. Rejected: a save
  field of the grid's own, a second place to type an address beside ⌘P.

- **AN ITEM'S INFO IS READ FROM THE INDEX AND WRITTEN AS A FRONTMATTER LINE
  EDIT.** Info reads the item's index row, never its file
  (`apps/workspace/src/app/actions/info-tab.tsx`), and writes a field as one
  frontmatter edit down two paths: the open item through its live editor's
  frontmatter node, so the buffer and the autosave carry it, any other item
  through the guarded rewrite, refused when the item moved underneath, never
  merged, since an edit is one click to repeat
  (`apps/workspace/src/app/note/item-frontmatter.ts`). Tags across items ride
  `items.tag`, the server's line edit, in the chunks it takes. Rejected: a form
  over a parse of the file, a second reader of bytes the index already read.

- **A PENDING STUB OPENS AS ITS PLACEHOLDER, NEVER THE EDITOR.** A link saved a
  moment ago is a stub whose page the server is still reading; it opens as
  "Filling in…" (`PendingStage` in
  `apps/workspace/src/app/item/item-stages.tsx`), because a keystroke in it would
  race the fill that rewrites it. The fill's rename moves the stub under the open
  window, and the session follows it by its id (A RENAME HOLDS THE OPEN NOTE
  THROUGH THE MOVE), so the item stays open and its text replaces the
  placeholder.

## Repo guards, vendoring and tooling

- **A WORKSPACE TEST THAT LOGS A console.error FAILS.** React reports a setState
  during another component's render, a missing key or an update outside `act` as
  a console.error and nothing else, so a suite that only logs it stays green
  over a real defect (`apps/workspace/src/app/__tests__/console-error-gate.ts`).
  A test that provokes one on purpose silences it with its own spy. The CLI's
  suites that drive the page's modules over a booted server are gated too; its
  booted DOM suites are not (`apps/cli/vitest.config.ts`): the server they boot
  logs every refused call by design.

- **THE PAGE IS ITS OWN WORKSPACE, AND ITS SUITES THAT BOOT A SERVER LIVE IN THE
  CLI** (owner decision). The shell embeds only the first-run page and the CLI
  serves the app page, so the page inside the shell's workspace would make the
  CLI's build hand-name the desktop's, the desktop's build take `^topo` to dodge
  the cycle, and the CLI export its test harness to the page's suites.
  `@repo/workspace` depends on neither: the desktop embeds its first-run build
  (`frontendDist`) and the CLI stages its app page, each through `^build`, and
  the suites that boot a server in-process sit in
  `apps/cli/src/workspace/__tests__` over the page's exports, so no package
  exports a harness. Only it reaches `@tauri-apps/*` (`SHELL_API_CLIENTS` in
  `tools/repo-guards/src/dep-dag.test.ts`). Rejected: the page inside
  `apps/desktop` behind a test tsconfig of its own, which keeps the cycle in the
  task graph. `pnpm dev:workspace` (`apps/workspace/scripts/dev.ts`) is the
  page's loop with no Rust.
