# Decisions: @repo/workspace

The library's page: the account's library over a replica in the tab, the rail,
the grid, the open item, the panel, the palette, Settings and the page's own
preferences. `AGENTS.md` § Decisions says how a bullet is written and cited.

## Shape

`src/main.tsx` opens the account's library (in the tab the session, then the
replica; in the Mac app the shell's credential, then its replica) and mounts
the router; `src/router.tsx` makes the router and the QueryClient it
carries. `app/cloud/` holds the `/v1` client and its query utils, the replica's
queries and the page's library context; `app/workspace.tsx` owns the rail, the
grid or the open item, the panel and the palette; `app/library/` the grid, its
scope, selection, Quick Look, the verbs over items and what a paste or a drop
saves; `app/item/` the open item, its stages and the editor's host;
`app/panel/` Info, Highlights and History; `app/agent/` the built-in agent's
conversations and Tidy; `app/palette/` ⌘P; `app/sidebar/` the rail;
`app/settings/` the Settings layer. Every shell answer
is parsed in `src/shell/shell-commands.ts`.

## The page over the cell

- **THE PAGE IS THE ACCOUNT'S LIBRARY OVER A REPLICA THE TAB HOLDS.** It opens
  the session the site's sign-in left, then the replica engine
  (`@repo/library-replica`) on in-memory SQLite, pulled whole on every load:
  every screen reads the replica, every write goes through its outbox and is
  laid over what the screens read until the cell takes it, a tab with no
  session goes to the site's sign-in, which brings it back, and a tab that could
  not find out says it didn't open and offers Try again. Its calls are the
  apps' `/v1` over the session cookie, the Worker's own origin. Rejected: a
  server on the device (a second writer beside the cell); the replica in OPFS
  (one tab would hold it, and the Mac's replica is the shell's, in Rust); a
  fault of the site's read as signed out (a password asked of someone signed
  in). `apps/workspace/src/app/cloud/page-library.ts`,
  `apps/workspace/src/main.tsx`.

- **THE QUERY CLIENT IS THE ROUTER'S.** One `QueryClient` is made with the
  router and handed to it as context, its provider the router's `Wrap`, so a
  loader and a component share one cache; a loader seeds what its screen reads
  with `queryClient.query({ ..., staleTime: "static" })`, once, over the options
  its screen reads with their own freshness, waiting for one answer and not the
  retries the screen's query makes itself. A replica read is a query that runs
  offline (`networkMode: "always"`, never stale), and the replica's change
  invalidates only the families it moved; a cell call is oRPC's TanStack utils
  over the same client. Rejected: a module-level client
  (a test and a second router share it); `ensureQueryData`, `fetchQuery` and
  `prefetchQuery` (deprecated for `query`). `apps/workspace/src/router.tsx`,
  `apps/workspace/src/app/cloud/replica-queries.ts`.

- **A CELL CALL PAUSES OFFLINE AND SAYS SO.** A call only the cell answers is a
  TanStack query or mutation run online (`networkMode: "online"`), so with no
  connection it waits rather than fails: a read says "Needs a connection" where
  it would draw, and a write, whether asked from a card's menu, a button or
  Settings, in one notice the root keeps up while any waits offline. A refusal
  the contract declares says its own sentence; any other failure says the
  screen's fallback, never an error's own words. The one retry rule never
  retries a declared refusal, so no screen turns retries off itself. A write
  whose order matters shares a `scope`, and refetches in its own callbacks,
  awaited, only the family it moved. Rejected: a call outside TanStack (it fails
  at once offline); a note per button (a menu's verb has none).
  `apps/workspace/src/app/cloud/v1.ts`,
  `apps/workspace/src/app/cloud/needs-connection.tsx`, over
  `packages/contract/src/cloud/refusal-text.ts`, which the phone says too.

- **THE PAGE IS ONE BUNDLE, AND CATCHES UP AS ITS CONNECTION RETURNS.** The
  build inlines every dynamic import (`codeSplitting: false`), the editor's lazy
  nodes (KaTeX, Mermaid, the calendar, the wiki chip) with the routes, so after
  the page loads nothing is fetched but calls and files: a chunk first asked for
  by a tab that lost its connection fails, the crash screen offers a reload, and
  a reload loses the replica held in memory. The tab resumes the replica the
  moment the browser says it is online again, rather than at its next retry.
  Rejected: route splitting alone (the lazy nodes still split); warming each
  chunk at boot (a tab offline before they land still fails); a boundary per
  lazy node (nothing is left to fail to load). `apps/workspace/vite.config.ts`,
  `apps/workspace/src/main.tsx`.

- **THE TAB SENDS WHAT IT HOLDS UNTIL IT CLOSES, AND ASKS BEFORE LOSING IT.** A
  change the tab made lives only in its memory until the cell takes it, so the
  replica's socket, check-in and outbox keep running while the tab is out of
  sight, a tab going out of sight writes the open item's edit at once, and while
  the replica or the open item holds anything unsent the browser asks before the
  tab closes, reloads or leaves, its listener there only then; a session that
  ended asks nothing, since nothing can go. An open item that will not write
  asks before the page leaves it, saying why, in the tab and on the Mac
  (`apps/workspace/src/app/item/leave-item.ts`). Rejected: suspending the replica
  out of sight as the phone does (its outbox is on disk, the tab's is not); a
  listener always armed (it bars the back-forward cache).
  `apps/workspace/src/app/cloud/leave-guard.ts`, `apps/workspace/src/main.tsx`.

- **IN THE MAC APP THE PAGE OPENS THE SHELL'S REPLICA, AFTER A SIGN-IN OF ITS
  OWN.** The same build runs in the Mac's window, where `main.tsx` asks the
  shell for its config and the credential a sign-in kept: with none the page
  is the first run, a sign-in or a new account with an invite code, whose
  device credential the shell keeps in the Keychain before the library opens
  (a Keychain that refuses it gives the device's slot back, so no device is
  left signed in with no credential); with one, the replica engine runs over
  the shell's SQLite and staged files, its calls going to the cloud's origin
  with the credential as the bearer and the build in a header. What differs by
  host is one `PageLibrary`: where a file is drawn and read from, the transport an
  upload or an export rides, what the page does about what it holds before it
  goes (the tab asks; the Mac, whose outbox is on disk, writes the open item's
  edit when the shell says it is quitting) and where a sign-out goes. The
  Mac's routes ride the hash, since its document never changes. Rejected: a
  first-run window of the shell's own (a second page beside the one the shell
  carries); the tab's cookie in the window (a cross-site cookie WebKit would
  not send). `apps/workspace/src/app/cloud/shell-library.ts`,
  `apps/workspace/src/app/cloud/sign-in-page.tsx`.

- **A SESSION'S END IS ANSWERED HOWEVER THE PAGE MEETS IT.** The replica calls
  through a client of its own and stops at a session's end, so each host watches
  its status beside the wire's interceptor and gives both one answer: the tab
  goes to the site's sign-in, the Mac lets its credential go and opens on the
  sign-in, and a Mac below the build floor keeps its credential, replica and
  outbox and says to update, in a toast and in the rail's footer, since the
  next build goes on as the same device. The floor spares a page the Worker
  served, so a tab it refuses is a browser too old to mark its calls as that
  page's, and the tab says so. Rejected: waiting for a wire call (an idle page
  makes none, and a stopped replica reads as up to date); a page of its own for
  the outdated Mac, as the phone draws (the Mac's library reads and queues on
  disk, and its updater needs no person to go find it); the refused tab sent to
  sign in (the sign-in sends a signed-in tab straight back, for good).
  `apps/workspace/src/app/cloud/v1.ts`,
  `apps/workspace/src/app/cloud/shell-library.ts`,
  `apps/workspace/src/app/sidebar/sync-words.ts`, `apps/workspace/src/main.tsx`,
  over `apps/web/src/worker/client-floor.ts`.

## Surfaces

- **WINDOW-LEVEL HOSTS MOUNT AT THE ROOT ROUTE.** `ConfirmDialogHost`, `Toaster`
  and the one `TooltipProvider` live in `apps/workspace/src/routes/__root.tsx`;
  a host mounted by one route leaves another route's `confirm()` parked on a
  dialog that never opens.

- **THE RAIL CHOOSES THE LIBRARY'S SCOPE, AMBIENT STATE LIVES IN ITS FOOTER.** A
  header (Library, Search), then the groups Library (All items, Unsorted),
  Folders, Tags (folding) and Deleted, each row a scope read from the replica
  with its count; a footer says where the library stands (up to date, sending,
  waiting for a connection, a pass that keeps failing, a sign-in that ended, an
  update it needs, or a change the cell refused, with Try again and Let it go)
  beside Settings. Each row sets the grid's scope (`libraryScope`)
  and goes back to the library; a folder's other verbs are its right-click and
  its More button. Rejected: a window-wide strip (a second bar under the rail).
  `apps/workspace/src/app/sidebar/rail.tsx`, `sync-line.tsx`.

- **A FOLDER SCOPE EXISTS, BY THE FOLDER'S ID.** A folder row narrows the grid
  to the folder; nested folders indent under their parents, and a save from the
  folder's grid lands in it. A remembered folder no longer listed reads as All
  items, on the phone as here (`listedScope` in
  `packages/domain/src/library-scope.ts`).
  `apps/workspace/src/app/library/listing.ts`,
  `apps/workspace/src/app/sidebar/folder-paths.ts`.

- **THERE IS ONE SEARCH SURFACE, AND IT IS ⌘P.** One field searches the
  replica's own full-text index (titles, notes, saved articles and highlights),
  ranked as every device ranks it, beside the page's commands; a hit opens its
  item with the find bar on the words, and a typed web address offers "Save
  this link". The rows are groups of data the page hands `@repo/ui`'s palette,
  Base UI's Autocomplete, which owns the field's keys, the light and the roles
  (A PICKER IS BASE UI'S, in `packages/ui/CLAUDE.md`). ⌘F IS NOT ONE OF THEM:
  it searches the open item, with its own chord and bar. Rejected: searching
  through the cell (the replica holds the same index, offline); a search field
  of the grid's own. `apps/workspace/src/app/palette/command-palette.tsx`.

- **THE PANEL STARTS CLOSED, IS FLAT-TABBED, AND IS DRAGGED LIKE THE RAIL.**
  `panelOpen` defaults off, and every entry that shows something in it opens it
  on its tab, a click on a highlight on Highlights with that one ringed and in
  view. The tabs are Info, Highlights and History, about the open item or else
  the one card selected, and the Agent, about the whole library. The width
  persists through the rail's own resize handle (`panelWidth` in `app/prefs.ts`).
  Rejected: a second resize mechanism. `apps/workspace/src/app/panel/panel.tsx`,
  `apps/workspace/src/app/workspace.tsx`.

- **THE OPEN ITEM RIDES THE URL, AND SETTINGS COVERS A WORKSPACE THAT STAYS
  MOUNTED.** `?item=<id>` is the open item (after the hash on the Mac): every open is a history entry, so
  the browser's Back leaves the item and Forward reopens it, and a link or a
  reload opens it, once the replica holds it. Settings is a layer in the
  pathless `_workspace` layout: the covered workspace is `inert`, its
  `GLOBAL_SHORTCUTS` listener detached, and the way in flushes the open item.
  Rejected: a back/forward stack of the page's own (the tab has the browser's);
  a sibling Settings route (it unmounted the item).
  `apps/workspace/src/routes/_workspace.tsx`.

- **A PAGE PREFERENCE IS A ROW, AND SO IS AN APPEARANCE DIAL.** What the page
  remembers across a reload is one `PREFS` row (key, a zod schema decoding the
  stored string and encoding the value, fallback), read and written only
  through `readPref` / `writePref` / `usePref`; bytes a row cannot decode read
  as its fallback (`apps/workspace/src/app/prefs.ts`). An appearance dial is
  one `dial()` row naming its `--editor-*` token
  (`apps/workspace/src/app/appearance-options.ts`). Labels and layout stay out:
  Settings is laid out by hand. Rejected: a preference kept in the cell (a
  theme is the device's, not the account's).
  `tools/repo-guards/src/page-prefs.test.ts` refuses a keyed read outside it.

- **THE PAGE'S TEXT IS NOT SELECTABLE UNLESS SOMEONE WOULD COPY IT.** `body` is
  `user-select: none`, fields and the editor's editing hosts are `text`, and
  what a person would copy (a conversation, a highlight's note, an old version,
  an error) opts in with `select-text`
  (`apps/workspace/src/styles/globals.css`). Rejected: selectable by default
  with `select-none` on the chrome (every new button, label and row would have
  to remember it).

- **A LIBRARY SCOPE HAS ONE SPELLING, `@repo/domain/library-scope`.** Which
  part of the library a screen shows (all of it, Unsorted, a folder, a tag or
  Deleted) is one set of zod arms (`packages/domain/src/library-scope.ts`), a
  folder named by its id as the cell keeps it, read by the page's `PREFS` row
  (`apps/workspace/src/app/prefs.ts`), the replica's listing and a view
  context's `scope` (`agentViewContextSchema` in
  `packages/contract/src/cloud/library/library-wire.ts`), which names any of
  them but Deleted. Rejected: a scope per surface or per wire, spellings that
  drift the first time a scope gains a kind; a folder by its path (a rename
  would move it out of every remembered scope).

- **THE LIBRARY IS HOME, AND AN ITEM IS SHOWN BY ITS KIND.** With nothing open
  the page is the grid of the rail's scope, one card per item; an empty scope
  says why and offers a next step
  (`apps/workspace/src/app/library/library-view.tsx`). An item opens full size
  in its place and takes the keyboard unless something holds it, so Escape goes
  back (`apps/workspace/src/app/item/item-view.tsx`): a file's viewer over its
  bytes where its host draws them (`/v1/blobs/<sha>` in the tab, the shell's
  scheme on the Mac), a saved page's source above its text, a link not
  yet read saying so, and the item's blocks in the editor over the replica
  (`apps/workspace/src/app/item/item-stages.tsx`). Rejected: a list beside an
  always-open item (saved pages read as text files).

- **THE GRID'S SELECTION IS A STORE, A CLICK SELECTS AND A DOUBLE-CLICK OPENS.**
  Finder's grammar by item id: a click selects, ⌘-click toggles, ⇧-click
  extends from the anchor, arrows follow the columns, ⌘A takes the listing,
  Space is Quick Look, Return opens
  (`apps/workspace/src/app/library/library-selection.ts`). A double-click opens
  on the click whose `detail` is 2, never the `dblclick`
  (`apps/workspace/src/app/library/item-card.tsx`). The store is the
  workspace's, so it outlives an open item, and the panel's Info and the
  agent's view context follow it; an item that left the listing leaves the
  selection. Rejected: click-to-open (the selection is the panel's subject and
  the agent's context).

- **A BULK VERB RUNS IN CHUNKS, UNDER ONE TOAST WITH STOP.** A move or a tag of
  many items goes through the outbox fifty at a time and a purge through the
  cell's own in its route's chunks, sequentially; a chunk that fails stops the
  run and says how far it got, and the closing sentence says only what landed
  (`apps/workspace/src/app/library/bulk-actions.ts`). A delete of more than
  fifty asks first; any delete toasts its Undo.

- **A SAVE FROM THE WINDOW IS A PASTE OR A DROP THAT NO FIELD CLAIMED.** A paste
  lands where nothing takes text, a drop where no field or editor took it; a
  drop holding nothing to save keeps the browser's handling, and a drag started
  inside the page never saves (WebKit fires no paste off an editable target, so
  ⌘V there pastes into an off-screen catcher). Each link and file goes through
  the outbox where the grid's scope saves (its folder, else Unsorted, a tag's
  tag), files over links, and a folder or a file past the store's 100 MB is
  refused before a byte is queued, the file picker held to the same cap.
  Rejected: a save field of the grid's own.
  `apps/workspace/src/app/library/capture/window-capture.ts`,
  `capture-payload.ts`.

- **AN ITEM'S INFO IS ITS FIELDS.** Info reads the item's fields from the
  replica and writes each as one field op on the value it read: the open item's
  properties through its editor's session, so the pause carries them, any other
  item's pin, move, tags and title through the outbox, read again and written
  once more when another device moved the field first, never merged
  (`apps/workspace/src/app/panel/info-tab.tsx`,
  `apps/workspace/src/app/library/library-verbs.ts`). Rejected: a form over the
  item's markdown (a second reader of what the replica already parsed).

- **HISTORY IS CHANGE SETS, AND UNDO IS ONE.** History lists the cell's change
  sets that touched the item, newest first, by who and when, a page at a time
  and the older on "Show older", so every set the cell keeps is in reach;
  "Show this version" reads the item as a set left it, and Undo takes a whole
  set back in a change set of its own, after the open item's unsaved edit is
  written, so the undo meets the item as the person sees it and a line changed
  since is kept; a set a rule held back stays undoable and says so. History is
  the cell's, so it waits for a connection.
  `apps/workspace/src/app/panel/history-tab.tsx`,
  `apps/workspace/src/app/cloud/history-pages.ts`.

- **THE AGENT PANEL IS THE ACCOUNT'S THREADS.** A conversation is the replica's
  synced thread rows and events, the same on every device, drawn from the
  contract's own union; the reply being written arrives on the socket and is
  never stored. A send carries the screen it leaves from (the open item, or the
  scope and the selection; none from Deleted); an approval's Approve or Cancel
  answers `library.agent.respond` naming the event that asked; the day's
  allowance and an agent switched off are said in the person's words. A
  selection's Ask agent quotes the passage under what the composer holds, and
  the field takes the keyboard for the question. Under
  each finished turn "Undo this turn" takes its change set back, and "Undo this
  conversation" every one of the conversation's, both after the open item's
  unsaved edit is written: the sets are read from every page the cell answers,
  the whole conversation's Undo offered once all are in and sent in as few
  undos as the cell takes, and asked again as each turn ends, since a turn's
  set seals with it. Rejected: an agent the device runs (a runtime and a
  model credential on every device); a socket of the page's own to the conversation's
  object; one page of sets (a long conversation's oldest turns lost their
  Undo). `apps/workspace/src/app/agent/agent-panel.tsx`, over
  `packages/agent-panel/src/thread-entries.ts`, `thread-undo.ts`.

- **TIDY MY LIBRARY IS A REQUEST FROM UNSORTED, AND THE FILING RULES ARE THE
  CELL'S.** The grid's header and ⌘P open the agent's composer on a new
  conversation holding the request, sent from Unsorted with nothing typed or
  with what the person adds for this run; the request never says whether rules
  exist, since every turn carries the rules the cell read for it. Settings'
  Edit filing rules… opens the cell's rules, or the starter rules, which say
  Unsorted is no folder and its items are the ones to file. Rejected: the
  request typed into the field (a person could edit it away); rules in the
  request (a second read beside the turn's).
  `packages/agent-panel/src/tidy-library.ts`,
  `apps/workspace/src/app/settings/filing-rules.ts`.

- **A FILE IN A NOTE IS READ WHERE THE PAGE DRAWS ITS FILES, AND ONE PASTED
  THERE WAITS IN THE OUTBOX.** The editor's host reads a note's picture or
  file through the `PageLibrary`'s `readFile`: the tab its own unsent bytes,
  then `/v1/blobs/<sha>`, which the browser keeps under the cloud's immutable
  answer; the Mac its scheme, which serves its staged files, its cache or the
  cloud's copy. A file pasted or dropped into a note is kept by the replica's
  `keepFile`, so it draws at once and goes up ahead of the write naming it.
  Rejected: a cache of the page's own (the browser's already holds the
  answer); an `<img>` on `/v1/blobs` (a pasted file is not there until the
  outbox sends it). `apps/workspace/src/app/item/page-editor-host.ts`,
  `apps/workspace/src/app/cloud/page-library.ts`.

## Repo guards, vendoring and tooling

- **A WORKSPACE TEST THAT LOGS A console.error FAILS.** React reports a setState
  during another component's render, a missing key or an update outside `act`
  only as a console.error, so a suite that just logs it stays green over a real
  defect (`apps/workspace/src/app/test-support/console-error-gate.ts`). A test
  that provokes one on purpose silences it with its own spy.

- **THE PAGE IS ITS OWN WORKSPACE, AND THE WORKER SERVES ITS BUILD** (owner
  decision). `@repo/workspace` depends on neither app: the Worker copies its
  build into its assets and answers it at `/library` (THE LIBRARY'S PAGE IS THE
  WORKER'S, in `apps/web/CLAUDE.md`), the desktop embeds the same build
  (`frontendDist`), each through `^build`. Only the page reaches
  `@tauri-apps/*` (`SHELL_API_CLIENTS` in
  `tools/repo-guards/src/dep-dag.test.ts`), and its loop is `pnpm dev:web`,
  which rebuilds it as it changes. Rejected: the page inside `apps/web` (the
  Mac embeds it too); a dev server of the page's own (a second origin, its
  calls cross-site).
