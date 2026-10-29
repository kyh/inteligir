# Decisions: @repo/workspace

The page: the library, the open item, the rail, the palette, the panel and the
page's own preferences. `AGENTS.md` § Decisions says how a bullet is written and cited.

## Shape

`src/app/workspace.tsx` owns the library, the open item, the rail, the palette
and the panel; `app/library/` the grid, its scope and selection, a save from the
window, Quick Look, the bulk verbs, Tidy my library and the way into a Raindrop
import; `app/import/` the import's dialog; `app/item/` the item view, its stages
and top bar; `app/note/` the guarded writes; `app/palette/` the ⌘P pages;
`app/sidebar/` the rail's scopes; `app/agents/` the one agent sign-in ⌘K, the
panel, Settings and onboarding draw; `app/settings/` the Settings layer;
`app/onboarding/` the steps `/welcome` offers after a first run. Every shell
answer is parsed in `src/shell/shell-commands.ts` and mirrored through one
`app/bridge-store.ts`.

## Vault: writes, git and containment

- **A MOVE IS A RENAME THAT KEEPS THE NAME, and `planMove` is its one verdict.**
  Every move (a card or folder row dropped on a folder row, Info's Move…, a bulk
  move, the palette's) asks `planMove`
  (`apps/workspace/src/app/sidebar/tree-ops.ts`), so all refuse alike, and rides
  `vault.rename` (`apps/cli/src/server/knowledge/rename.ts`), which rewrites
  links for a folder as for an item, the session holding the open item (A
  RENAME HOLDS THE OPEN NOTE). Its pure half,
  `@repo/notes/knowledge/plan-rename`, plans the phone's renames too; only the
  guards are each caller's. A drag's source is the window's drag store
  (`apps/workspace/src/app/library/drag-store.ts`); a drop it lacks is a save
  (A SAVE FROM THE WINDOW). Rejected: `dataTransfer` as the source (a desktop
  drag carries files and links); a second write path.

- **GIT IS THE ENGINE, NEVER THE VOCABULARY, AND ITS RAW STATE IS SETTINGS ›
  ADVANCED'S.** The rail, a sync toast, History and a note's facts say sync and
  versions (`syncStateLabel`, `syncStateNote` in
  `apps/workspace/src/app/vault-hooks.ts`). Only Settings › Advanced reads
  `lastError`; a state only the engine can explain says "Sync paused" with Sync
  details…, which opens it (`apps/workspace/src/app/settings/advanced-section.tsx`).
  History names a version by when and who, never subject or sha, by the server's
  `authorKind` (an `external` one keeps its name and subject), so no client
  matches an email (`apps/cli/src/server/vault/git-history.ts`); a phone's edit
  is the user's own (one commit vocabulary,
  `@repo/contract/cloud/vault/vault-git`). Rejected: git's
  stderr inside a friendlier sentence (none makes it the user's).
  `apps/workspace/src/app/vault-hooks.test.ts` holds the copy and the one
  `lastError` reader.

## Knowledge: index, search and links

- **RELATED IS ONE PANEL SECTION**: a fold of Info under the item's own fields
  (`apps/workspace/src/app/actions/info-tab.tsx`), so a link's related notes are
  one fold from its address: backlinks first because they are counted, then the
  scorer's rows with their reasons
  (`apps/workspace/src/app/actions/related-section.tsx`). Its route is
  search-shaped (a `limit`, no `total`) and fetched only while unfolded. A change
  sweeps `orpc.knowledge.key()` whole but for the link targets, which move only
  on `targets-changed` (A TARGET CHANGE IS ITS OWN KIND), since a link into a
  note lives in another note's bytes (`app/change-batch.ts`). Rejected: outgoing
  links (they are on screen); a graph view.

- **THE PAGE REFETCHES `knowledge.wikiTargets` ONLY ON A TARGET CHANGE, AT MOST
  ONCE PER 5 S** (A TARGET CHANGE IS ITS OWN KIND, in
  `apps/cli/src/server/knowledge/CLAUDE.md`), outside the knowledge sweep a body
  edit or a listing change makes, since that answer holds every doc and asset
  (about 7.5 MB at 50k items) and a fill storm is one body change per item; a
  fill that gives a stub its first heading marks once, and the throttle folds a
  storm of those. Rejected: the knowledge-family sweep on every content change
  (it refetched every target per keystroke and per fill).
  `apps/workspace/src/app/change-batch.ts`.

## Agents and threads

- **THE AGENT SURFACE IS THE ⌘K ACTION COMPOSER AND THE RIGHT PANEL** (declines:
  #912). An action is an ordinary thread on the item it was composed over (AN
  ACTION'S ORIGIN); the agent edits the library directly, highlights are the
  review channel, and the panel's tabs are Info | Annotations | Actions |
  History. With no item open the subject is the library: ONE detachable chip for
  the selection or the scope, the send carrying the library view context (scope,
  chip, search, count, first 200 names; none from Deleted) as it leaves
  (`readViewContext`); its attribution names only screen and count. "Ask agent"
  seeds the composer through `packages/editor/src/host-io.ts`, so the editor
  never imports the shell. Rejected: "Share with agent" (engine words).
  `apps/workspace/src/app/actions/action-composer.tsx`.

- **TIDY MY LIBRARY IS THE COMPOSER OPENED ON A PRESET** (A NAMED ACTION IS A
  PRESET ON THE SEND, in `apps/cli/src/server/agents/CLAUDE.md`): its chip sits
  above an optional field, sent from Unsorted with nothing typed if need be. The
  library's header, ⌘P and the Unsorted row's menu open it, and "Edit filing
  rules…" opens the library's AGENTS.md, written from the starter rules when the
  library has none (`apps/workspace/src/app/library/tidy-library.ts`). Rejected:
  a seeded prompt in the field (a person could edit it into something the
  server's block no longer matched).

- **A SETTLED TURN ENDS WITH THE ITEMS IT EDITED AND UNDO.** Each settled reply
  ends with them and Undo changes (`apps/workspace/src/app/actions/action-detail.tsx`),
  and a finish toast ("Agent edited N items", Undo) sits outside the panel
  (`apps/workspace/src/app/actions/turn-finish-toast.ts`). Both, and the undo's
  own sentence, count a turn's `items` as a person does, never its raw paths: a
  move once at the path it made, no cover or original beside the item embedding
  it (`packages/notes/src/items/turn-items.ts`). A `changes-committed` frame names
  its thread, never its turn, so the toast diffs the thread's turns against what
  it last read. Both undos flush the open item first, so a line inside the
  autosave debounce is merged around, not missed (`undo-turn.ts`).

- **THE COMPOSER MINTS THE OPEN NOTE'S ID THROUGH THE LIVE EDITOR** (AN ACTION'S
  ORIGIN IS ITS NOTE'S ID, in `apps/cli/src/server/agents/CLAUDE.md`), since a
  server mint under the buffer would make the revision name bytes no longer on
  disk, and outside the undo history, since an undo would unbind the action just
  sent. `apps/workspace/src/app/note/open-note-id.ts`.

## Desktop workspace surfaces

- **WINDOW-LEVEL HOSTS MOUNT AT THE ROOT ROUTE.** `ConfirmDialogHost`, `Toaster`
  and the one `TooltipProvider` live in `apps/workspace/src/routes/__root.tsx`;
  a host mounted by one route leaves another route's `confirm()` parked on a
  dialog that never opens.

- **THE RAIL CHOOSES THE LIBRARY'S SCOPE, AMBIENT STATE LIVES IN ITS FOOTER, AND
  THE TOP BAR IS THE PAGE'S.** A header (the vault row, Search), the groups
  Library (All items, Unsorted), Folders, Tags (folding) and Deleted, then a
  footer of the sync state, the agent's spinner and Settings. Each `SidebarMenu`
  row sets the grid's scope (`libraryScope`) and goes back to the library; every
  other verb is a right-click, as in Finder. The library's header and an item's
  bar share the top bar's ends (`apps/workspace/src/app/topbar-lead.tsx`); under
  the macOS shell the rail keeps the traffic-light corner
  (`apps/workspace/src/app/title-bar.ts`). Rejected: the Recent | Files |
  Deleted view menu (each list answered "what is this?" differently); a
  window-wide strip (a second bar under the rail).
  `apps/workspace/src/app/sidebar/sidebar.tsx`.

- **THE RAIL'S ACCOUNT ROW IS SETTINGS › ACCOUNT'S SESSION, AND SYNCS ONLY THE
  LIBRARY.** It runs the one `useCloudSession` (`app/cloud-session.ts`) that
  Settings › Account runs, and its Sync now is the library's: actions stay on
  this Mac, so they get no second sync
  (`apps/workspace/src/app/sidebar/sync-row.tsx`).

- **A FOLDER SCOPE EXISTS.** A folder row and the item bar's breadcrumb narrow
  the grid to the folder and what is under it. The folders are
  `knowledge.scopes`', so one with no directory on disk is still listed with its
  count (`apps/workspace/src/app/sidebar/folder-tree.tsx`); a rename or move of
  the shown folder, or one above it, from any surface takes the scope with it
  (`scopeAfterMove` in `apps/workspace/src/app/sidebar/tree-ops.ts`), and a
  remembered folder no longer listed reads as All items. A folder's fold and its
  name input are the rail's own state. Rejected: a breadcrumb that only revealed
  the folder in a tree.

- **UNDER A NOTE SITS ONLY ITS WORD COUNT AND READING TIME**
  (`apps/workspace/src/app/note-footer.tsx`): the serializer's published count,
  never a recount, with no rule above it, so it reads as the note's last line;
  zen hides it.

- **THERE IS ONE SEARCH SURFACE, AND IT IS ⌘P.** One field holds every note and
  command, and the searches that are not lookups: "Search
  inside every item…" (the literal scan) and "Show all results in the library",
  the grid's filter. ⌘F IS NOT ONE OF THEM: it searches the open note, with its
  own chord and bar. The rail's Search tooltip spells ⌘P from the table
  (`app/global-shortcuts.ts`), never a literal. The palette saves too: "Save link…" first says
  whether the library holds the address, and a typed web address offers "Save
  this link" (`apps/workspace/src/app/palette/save-link-page.tsx`). Rejected: ⌘O,
  ⌘⇧F, a quick-open page and a rail search field (four ways to type a name); a
  search or save field of the grid's own.

- **A NOTE'S FACTS ARE READ WHERE THEY ARE CHEAP, and the count rides the
  serializer.** Info's "About" fold starts folded, since unfolding it reads the
  git log for the created date; Saved and Modified are the index row's, so Info
  reads no file for them. Words, characters and reading time are counted by
  `@repo/editor/note-stats` beside the TOC's walk, so both agree, and published
  by the serializer's debounce, never per keystroke.
  `apps/workspace/src/app/actions/note-facts.tsx`.

- **THE PANEL STARTS CLOSED, IS FLAT-TABBED, AND IS DRAGGED LIKE THE RAIL.**
  `panelOpen` defaults off, and every entry that shows something in it opens it
  through one `revealPanel`, since an entry that only picks a tab shows nothing.
  Info, the first tab and the default, is about the first subject that holds:
  the open item, the one item selected, the selection, the grid's scope
  (`panelSubjectOf`; both in `apps/workspace/src/app/workspace.tsx`). The tabs
  are `@repo/ui/components/tabs`' underline row. The width persists through the
  rail's own Fluid resize handle (`panelWidth` in `app/prefs.ts`), reported once
  a drag lets go. A closed sidebar is slid off-screen and `inert` (`SidebarPanel`
  in `packages/ui/src/components/sidebar-core.tsx`), so its controls never
  answer Tab. Rejected: a second resize mechanism.

- **THE PALETTE IS FLUID'S COMMAND MENU, AND IT HAS NO PRIMITIVE UNDER IT**. The
  field keeps DOM focus and names the lit row through `aria-activedescendant`,
  the one proximity pill drawing it. ROWS ARE CHILDREN, NOT DATA. The panel keeps
  its cap-height top edge, so the field never moves as rows filter; a chord draws
  one box per key (`@repo/ui/lib/hotkey-spelling`). ONE DIALOG FOR EVERY PAGE, so
  no switch re-animates the backdrop; a page is a union member, so a move page
  cannot exist without a non-empty tuple of subjects. Rejected: cmdk (its filter
  off on every page, its keyboard a second answer to which row is live); Fluid's
  `items` array (eight row shapes in data). `packages/ui/src/components/command.tsx`,
  `apps/workspace/src/app/palette/command-palette.tsx`, `palette-page.tsx`.

- **THE BUS IS APPLIED ONCE PER FRAME, AND A KIND REFETCHES ONLY WHAT IT
  MOVES.** `ChangeBatch` folds every ws frame since the last animation frame and
  flushes once, so a K-note rename is one knowledge sweep. Thread kinds weigh in
  total tables (`MOVES_THE_LIST`, `MOVES_THE_DETAIL`, `MOVES_THE_TIMELINE`); the
  note session hears one `files` event however many paths moved
  (`packages/editor/src/host-io.ts`) and lists through the rail's tree query; a
  content change moves no listing row; `import-changed` only the import's
  status. The grid reads one 100-row `knowledge.items` window per window in view
  (`apps/workspace/src/app/library/library-items.ts`) and unmounts while an item
  is open, so a sweep refetches the item's rows alone. A reconnect sweeps every
  family. Rejected: an infinite query (every page refetches); a window-focus
  re-walk. `apps/workspace/src/app/change-batch.ts`,
  `app/actions/thread-hooks.ts`, `app/workspace-context.tsx`.

- **A WRITE FROM THE PAGE REFETCHES ONLY WHAT IT MOVES.** A reply, a stop or an
  archive refetches the thread's detail and the lists, an answer the detail
  alone (`apps/workspace/src/app/actions/action-detail.tsx`), and an annotation
  write nothing: its answer is the item's fresh listing, held as that path's
  list, and a refusal re-reads that list alone
  (`apps/workspace/src/app/actions/annotation-hooks.ts`). Rejected: a
  family-wide sweep after a write (every thread, or every item's highlights,
  re-read for one card's change).

- **THE NOTE STORE OWNS THE OPEN ITEM, THE URL MIRRORS IT, AND SETTINGS COVERS A
  WORKSPACE THAT STAYS MOUNTED** (owner decision). `?item=` is read once, as
  the boot's deep link, and the boot opens nothing else: home is the library.
  Every later open is mirrored into it with `replace`, so the store's
  back/forward stacks are the one history, the library being `null`
  (`packages/editor/src/note/open-note-store.ts`). Settings is a
  layer in the pathless `_workspace` layout
  (`apps/workspace/src/routes/_workspace.tsx`): the covered workspace is `inert`,
  its `GLOBAL_SHORTCUTS` listener detached, and the way in flushes the open item.
  Rejected: a pushed entry per open (Back left the store's item); reopening the
  last note at boot (it hid the grid); a sibling Settings route (it unmounted
  the item).

- **A PAGE PREFERENCE IS A ROW, AND SO IS AN APPEARANCE DIAL.** What the window
  remembers across a reload is one `PREFS` row (key, a zod schema decoding the
  stored string and encoding the value, fallback), read and written only through
  `readPref` / `writePref` / `usePref`; bytes a row cannot decode read as its
  fallback (`apps/workspace/src/app/prefs.ts`). An appearance dial is one
  `dial()` row naming its `--editor-*` token
  (`apps/workspace/src/app/appearance-options.ts`). Labels and layout stay out:
  Settings is laid out by hand. Rejected: one table shared with the data dir (no
  preference is read by both programs, and a data-dir preference reaches the
  page through `@repo/contract/local`).
  `tools/repo-guards/src/page-prefs.test.ts` refuses a keyed read outside it.

- **THE WINDOW'S TEXT IS NOT SELECTABLE UNLESS SOMEONE WOULD COPY IT.** `body`
  is `user-select: none`, fields and the editor's editing hosts are `text`, and
  what a person would copy (the thread, a highlight's note, an old version, a
  path, an error, Settings › Advanced's raw state) opts in with `select-text`
  (`apps/workspace/src/styles/globals.css`); a read-only editor renders
  `contenteditable="false"`, so it opts in too. Rejected: selectable by default
  with `select-none` on the chrome (the chrome is most of the window, and every
  new button, label and row would have to remember it).

- **A LIBRARY SCOPE HAS ONE SPELLING, `@repo/domain/library-scope`.** Which
  part of the library a screen shows (all of it, Unsorted, a folder, a tag or
  Deleted) is one set of zod arms (`packages/domain/src/library-scope.ts`),
  read by the page's `PREFS` row (`apps/workspace/src/app/prefs.ts`), the items
  listing and a view context's `scope` (`packages/domain/src/view-context.ts`).
  A folder is a path in `libraryScopeSchema` and an id in `cellItemScopeSchema`,
  which the cell's view context reads
  (`packages/contract/src/cloud/library/library-wire.ts`): the one arm that
  differs, so a new kind reaches both; the path goes with `/local`'s last
  client. Rejected: a scope per surface or per wire, spellings that drift the
  first time a scope gains a kind.

- **THE LIBRARY IS HOME, AND AN ITEM IS SHOWN BY ITS KIND.** With nothing open
  the window is the grid of the rail's scope, one card per item; an empty scope
  says why and offers a next step or two
  (`apps/workspace/src/app/library/library-view.tsx`). An item opens full size in
  its place and takes the keyboard unless something holds it, so Escape goes
  back (`apps/workspace/src/app/item/item-view.tsx`): the editor for a note, a
  saved page's source over its text or sandboxed copy, a viewer for any other
  file, each over the byte routes with the boot's media token
  (`apps/workspace/src/app/item/item-stages.tsx`). Rejected: a list beside
  an always-open note (saved pages read as text files).

- **A VIEWER OPENS ITS DOC THROUGH THE SESSION, AND THE KIND READS FROM THE
  ANALYZED BYTES.** History, ⌘K and Info bind to a viewer's path, and "Edit as
  note" swaps in the editor. The open item's kind reads from the bytes the store
  last analyzed, never per keystroke
  (`apps/workspace/src/app/item/open-item-kind.ts`). Rejected: a
  reader per kind outside the session (a second open-item owner).

- **THE GRID'S SELECTION IS A STORE, A CLICK SELECTS AND A DOUBLE-CLICK OPENS.**
  Finder's grammar: a click selects, ⌘-click toggles, ⇧-click extends from the
  anchor, arrows follow the columns, ⌘A takes the scope by its count until a
  gesture needs names, Space is Quick Look, Return opens
  (`apps/workspace/src/app/library/library-selection.ts`). A double-click opens
  on the click whose `detail` is 2, never the `dblclick`
  (`apps/workspace/src/app/library/item-card.tsx`). The store is the workspace's,
  made once beside the grid's scroll, so it outlives an open item and Info and
  ⌘K share it; a selected item a change moved is followed by its id
  (`apps/workspace/src/app/library/selection-follow.ts`). Rejected: click-to-open
  (the selection is ⌘K's context and Info's subject); a cell keeping its element
  across a column change (it leaves its row).

- **THE GRID KEEPS ITS FOCUS AND ANCHOR BY THEIR PLACE IN THE LISTING.** The
  focused card's window stays loaded and its card mounted however far the grid
  scrolls; a ⇧-click span the loaded windows lack is read from the listing; an
  arrow, Quick Look's too, steps by the focused card's index in the listing; a
  right-click or a drag under ⌘A acts on everything selected; back from an item,
  the focused card takes the keyboard again, once, never from a field or a
  dialog (`apps/workspace/src/app/library/library-grid.tsx`). Rejected: stepping
  through the loaded windows joined (they start wherever the grid was scrolled,
  and leave gaps).

- **A BULK VERB RUNS IN ITS ROUTE'S CHUNKS, UNDER ONE TOAST WITH STOP.** The
  chunks run sequentially, each the size its route takes at once, and the
  closing sentence says only what landed
  (`apps/workspace/src/app/library/bulk-actions.ts`).

- **A SAVE FROM THE WINDOW IS A PASTE OR A DROP THAT NO FIELD CLAIMED.** A paste
  lands where nothing takes text, a drop where no field, row, card or editor took
  it; a drop holding nothing to save keeps the browser's handling, and a drag
  started inside the page never saves
  (`apps/workspace/src/app/library/capture/window-capture.ts`; WebKit fires no
  paste off an editable target, so ⌘V there pastes into an off-screen catcher).
  Both save into the scope's folder, else Unsorted, and say where (Open) or that
  the library holds it (Show) (`apps/workspace/src/app/library/capture/save-items.ts`). A transfer
  is read in one place, files over links, a folder or an oversized file refused
  before a byte is sent (`apps/workspace/src/app/library/capture/capture-payload.ts`).
  Rejected: a save field of the grid's own.

- **AN ITEM'S INFO IS READ FROM THE INDEX AND WRITTEN AS A FRONTMATTER LINE
  EDIT.** Info reads the item's index row, never its file
  (`apps/workspace/src/app/actions/info-tab.tsx`), and writes a field as one
  frontmatter edit: the open item through its live editor's frontmatter node, so
  the buffer and the autosave carry it, any other item through the guarded
  rewrite, refused, never merged, when the item moved underneath, since an edit
  is one click to repeat (`apps/workspace/src/app/note/item-frontmatter.ts`).
  Tags across items ride `items.tag`, the server's line edit, in its chunks.
  Rejected: a form over a parse of the file (a second reader of bytes the index
  read).

- **AN UNREAD STUB OPENS AS ITS PLACEHOLDER, NEVER THE EDITOR.** A stub's page
  is read by the device that saved it, maybe a phone that is closed or offline,
  so it opens as "Not read yet" with Read it on this Mac, and its card says the
  same (`PendingStage` in `apps/workspace/src/app/item/item-stages.tsx`); a
  keystroke in it would race the fill that rewrites it. The fill's rename moves
  the stub under the open window, and the session follows it by id (A MOVE THE
  PAGE DID NOT MAKE IS FOLLOWED BY THE ITEM'S ID, in
  `packages/editor/CLAUDE.md`). Rejected: "Filling in…" on every stub (it
  claimed a read no Mac would make).

## Repo guards, vendoring and tooling

- **A WORKSPACE TEST THAT LOGS A console.error FAILS.** React reports a setState
  during another component's render, a missing key or an update outside `act`
  only as a console.error, so a suite that just logs it stays green over a real
  defect (`apps/workspace/src/app/test-support/console-error-gate.ts`). A test
  that provokes one on purpose silences it with its own spy. The CLI's suites
  that drive the page's modules over a booted server are gated too; its booted
  DOM suites are not, since their server logs every refused call
  (`apps/cli/vitest.config.ts`).

- **THE PAGE IS ITS OWN WORKSPACE, AND ITS SUITES THAT BOOT A SERVER LIVE IN THE
  CLI** (owner decision). `@repo/workspace` depends on neither app: the desktop
  embeds its first-run build (`frontendDist`) and the CLI stages its app page,
  each through `^build`. The suites that boot a server in-process sit in
  `apps/cli/src/workspace`, beside the harness in its `test-support/`, so no
  package exports a harness. Only the page reaches `@tauri-apps/*`
  (`SHELL_API_CLIENTS` in `tools/repo-guards/src/dep-dag.test.ts`), and
  `pnpm dev:workspace` (`apps/workspace/scripts/dev.ts`) is its loop with no
  Rust. Rejected: the page inside `apps/desktop` (the CLI's build hand-naming the
  desktop's, `^topo` to dodge the cycle, the CLI exporting its harness), even
  behind a test tsconfig of its own (the cycle stays in the task graph).
