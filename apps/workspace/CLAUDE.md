# Decisions: @repo/workspace

The library's page: the account's library over a replica in the tab, the rail,
the grid, the open item, the panel, the palette, Settings and the page's own
preferences. `AGENTS.md` § Decisions says how a bullet is written and cited.

## Shape

`src/main.tsx` opens the account's library (the session, then the replica) and
mounts the router; `src/router.tsx` makes the router and the QueryClient it
carries. `app/cloud/` holds the `/v1` client and its query utils, the replica's
queries and the page's library context; `app/workspace.tsx` owns the rail, the
grid or the open item, the panel and the palette; `app/library/` the grid, its
scope, selection, Quick Look and the verbs over items; `app/item/` the open
item, its stages and the editor's host; `app/panel/` Info, Highlights and
History; `app/agent/` the built-in agent's conversations; `app/palette/` ⌘P;
`app/sidebar/` the rail; `app/settings/` the Settings layer. Every shell answer
is parsed in `src/shell/shell-commands.ts` and mirrored through one
`app/bridge-store.ts`.

## The page over the cell

- **THE PAGE IS THE ACCOUNT'S LIBRARY OVER A REPLICA THE TAB HOLDS.** It opens
  the session the site's sign-in left, then the replica engine
  (`@repo/library-replica`) on in-memory SQLite, pulled whole on every load:
  every screen reads the replica, every write goes through its outbox and is
  laid over what the screens read until the cell takes it, and a tab with no
  session goes to the site's sign-in, which brings it back. Its calls are the
  apps' `/v1` over the session cookie, the Worker's own origin. Rejected: the
  local server's page (a second writer beside the cell); the replica in OPFS
  (one tab would hold it, and the Mac's replica is the shell's, in Rust).
  `apps/workspace/src/app/cloud/page-library.ts`, `apps/workspace/src/main.tsx`.

- **THE QUERY CLIENT IS THE ROUTER'S.** One `QueryClient` is made with the
  router and handed to it as context, its provider the router's `Wrap`, so a
  loader and a component share one cache; a loader seeds what its screen reads
  with `queryClient.query({ ..., staleTime: "static" })`, once. A replica read
  is a query that runs offline (`networkMode: "always"`, never stale), and the
  replica's change invalidates only the families it moved; a cell call is
  oRPC's TanStack utils over the same client. Rejected: a module-level client
  (a test and a second router share it); `ensureQueryData`, `fetchQuery` and
  `prefetchQuery` (deprecated for `query`). `apps/workspace/src/router.tsx`,
  `apps/workspace/src/app/cloud/replica-queries.ts`.

- **A CELL CALL PAUSES OFFLINE AND SAYS SO.** A call only the cell answers runs
  online (`networkMode: "online"`), so with no connection it waits rather than
  fails, and its screen says "Needs a connection"; a refusal says its own
  sentence. The client's one retry rule never retries a refusal the contract
  declares, so no screen spells `retry: false`, and a session that ended sends
  the tab to sign in. A write whose order matters shares a `scope`, and a write
  refetches in its own callbacks, awaited, only the family it moved. Rejected:
  every call failing at once offline (a cloud that is down and a tab that is
  offline would read alike). `apps/workspace/src/app/cloud/v1.ts`,
  `apps/workspace/src/app/cloud/needs-connection.tsx`.

- **THE PAGE IS ONE BUNDLE, AND CATCHES UP AS ITS CONNECTION RETURNS.** No route
  is split into a chunk of its own: a chunk first fetched by a tab that lost its
  connection fails, and the router reloads the tab, losing the replica it holds
  in memory and every write not yet sent. A tab in sight resumes the replica
  the moment the browser says it is online again, rather than at its next
  retry. `apps/workspace/vite.config.ts`, `apps/workspace/src/main.tsx`.

- **THE TAB SENDS WHAT IT HOLDS UNTIL IT CLOSES, AND ASKS BEFORE LOSING IT.** A
  change the tab made lives only in its memory until the cell takes it, so the
  replica's socket, check-in and outbox keep running while the tab is out of
  sight, a tab going out of sight writes the open item's edit at once, and while
  the replica or the open item holds anything unsent the browser asks before the
  tab closes, reloads or leaves, its listener there only then; a session that
  ended asks nothing, since nothing can go. Rejected: suspending the replica
  out of sight as the phone does (its outbox is on disk, the tab's is not); a
  listener always armed (it bars the back-forward cache).
  `apps/workspace/src/app/cloud/leave-guard.ts`, `apps/workspace/src/main.tsx`.

## Surfaces

- **WINDOW-LEVEL HOSTS MOUNT AT THE ROOT ROUTE.** `ConfirmDialogHost`, `Toaster`
  and the one `TooltipProvider` live in `apps/workspace/src/routes/__root.tsx`;
  a host mounted by one route leaves another route's `confirm()` parked on a
  dialog that never opens.

- **THE RAIL CHOOSES THE LIBRARY'S SCOPE, AMBIENT STATE LIVES IN ITS FOOTER.** A
  header (Library, Search), then the groups Library (All items, Unsorted),
  Folders, Tags (folding) and Deleted, each row a scope read from the replica
  with its count; a footer says where the library stands (up to date, sending,
  waiting for a connection, or a change the cell refused, with Try again and
  Let it go) beside Settings. Each row sets the grid's scope (`libraryScope`)
  and goes back to the library; a folder's other verbs are its right-click and
  its More button. Rejected: a window-wide strip (a second bar under the rail).
  `apps/workspace/src/app/sidebar/rail.tsx`, `sync-line.tsx`.

- **A FOLDER SCOPE EXISTS, BY THE FOLDER'S ID.** A folder row narrows the grid
  to the folder; nested folders indent under their parents, and a save from the
  folder's grid lands in it. A remembered folder no longer listed reads as All
  items. `apps/workspace/src/app/library/listing.ts`,
  `apps/workspace/src/app/sidebar/folder-paths.ts`.

- **THERE IS ONE SEARCH SURFACE, AND IT IS ⌘P.** One field searches the
  replica's own full-text index (titles, notes, saved articles and highlights),
  ranked as every device ranks it, beside the page's commands; a hit opens its
  item with the find bar on the words, and a typed web address offers "Save
  this link". ⌘F IS NOT ONE OF THEM: it searches the open item, with its own
  chord and bar. Rejected: searching through the cell (the replica holds the
  same index, offline); a search field of the grid's own.
  `apps/workspace/src/app/palette/command-palette.tsx`.

- **THE PANEL STARTS CLOSED, IS FLAT-TABBED, AND IS DRAGGED LIKE THE RAIL.**
  `panelOpen` defaults off, and every entry that shows something in it opens it
  on its tab. The tabs are Info, Highlights and History, about the open item or
  else the one card selected, and the Agent, about the whole library. The width
  persists through the rail's own resize handle (`panelWidth` in `app/prefs.ts`).
  Rejected: a second resize mechanism. `apps/workspace/src/app/panel/panel.tsx`,
  `apps/workspace/src/app/workspace.tsx`.

- **THE OPEN ITEM RIDES THE URL, AND SETTINGS COVERS A WORKSPACE THAT STAYS
  MOUNTED.** `?item=<id>` is the open item: every open is a history entry, so
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
  Deleted) is one set of zod arms (`packages/domain/src/library-scope.ts`),
  read by the page's `PREFS` row (`apps/workspace/src/app/prefs.ts`), the
  replica's listing and a view context's `scope`
  (`packages/domain/src/view-context.ts`), a folder named by its id as the cell
  keeps it. Rejected: a scope per surface or per wire, spellings that drift the
  first time a scope gains a kind.

- **THE LIBRARY IS HOME, AND AN ITEM IS SHOWN BY ITS KIND.** With nothing open
  the page is the grid of the rail's scope, one card per item; an empty scope
  says why and offers a next step
  (`apps/workspace/src/app/library/library-view.tsx`). An item opens full size
  in its place and takes the keyboard unless something holds it, so Escape goes
  back (`apps/workspace/src/app/item/item-view.tsx`): a file's viewer over its
  bytes at `/v1/blobs/<sha>`, a saved page's source above its text, a link not
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
  cell's own in its route's chunks, sequentially, and the closing sentence says
  only what landed (`apps/workspace/src/app/library/bulk-actions.ts`). A delete
  of more than fifty asks first; any delete toasts its Undo.

- **AN ITEM'S INFO IS ITS FIELDS.** Info reads the item's fields from the
  replica and writes each as one field op on the value it read: the open item's
  properties through its editor's session, so the pause carries them, any other
  item's pin, move, tags and title through the outbox, read again and written
  once more when another device moved the field first, never merged
  (`apps/workspace/src/app/panel/info-tab.tsx`,
  `apps/workspace/src/app/library/library-verbs.ts`). Rejected: a form over the
  item's markdown (a second reader of what the replica already parsed).

- **HISTORY IS CHANGE SETS, AND UNDO IS ONE.** History lists the cell's change
  sets that touched the item, newest first, by who and when; "Show this
  version" reads the item as a set left it, and Undo takes a whole set back in a
  change set of its own, after the open item's unsaved edit is written, so the
  undo meets the item as the person sees it and a line changed since is kept.
  History is the cell's, so it waits for a connection.
  `apps/workspace/src/app/panel/history-tab.tsx`.

- **THE AGENT PANEL IS THE ACCOUNT'S THREADS.** A conversation is the replica's
  synced thread rows and events, the same on every device, drawn from the
  contract's own union; the reply being written arrives on the socket and is
  never stored. A send carries the screen it leaves from (the open item, or the
  scope and the selection; none from Deleted); an approval's Approve or Cancel
  answers `library.agent.respond` naming the event that asked; the day's
  allowance and an agent switched off are said in the person's words. Under
  each finished turn "Undo this turn" takes its change set back, and "Undo this
  conversation" every one of the conversation's, both after the open item's
  unsaved edit is written; the conversation's sets are asked again as each turn
  ends, since a turn's set seals with it. Rejected: the local server's ⌘K
  composer and agents (no runtime on the device); a socket of the page's own to
  the conversation's object. `apps/workspace/src/app/agent/agent-panel.tsx`,
  `thread-entries.ts`, `thread-undo.ts`.

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
