# Decisions: the library's page

The library's page: the account's library read and written online, the rail,
the grid, the open item, the panel, the palette, Settings and the page's own
preferences. `AGENTS.md` § Decisions says how a bullet is written and cited.

## Shape

The page is the site's `/library` route (`apps/web/src/routes/library.tsx`),
its children the workspace and Settings, and its code this folder.
`library-tab.ts` opens the tab once a document (the session, the wire, the
account's socket and the QueryClient), in the route's `beforeLoad`, and
`library-layout.tsx` draws the layout every library route shares over what it
opened. `cloud/` holds the `/v1` client and its query utils, the library's
queries, the account's socket and the page's library context; `workspace.tsx`
owns the rail, the grid or the open item, the panel and the palette;
`library/` the grid, its scope, selection, Quick Look, the verbs over items
and what a paste or a drop saves; `item/` the open item, its leave, its
stages and the editor's host; `panel/` Info; `agent/` the built-in
agent's conversations and Tidy; `palette/` ⌘P; `sidebar/` the rail;
`settings/` the Settings layer; `styles/` the page's stylesheet, which only
its route links. The Mac app's update, the one thing the page asks its shell,
is parsed in `shell/desktop-bridge.ts`.

## The page over the cell

- **THE PAGE IS THE ACCOUNT'S LIBRARY, READ AND WRITTEN ONLINE.** It opens
  the session the site's sign-in left, then the account's socket, and every
  screen reads the cell through `/v1` over the session cookie, the Worker's own
  origin: a listing a page at a time (`library.listing.page`), the rail's
  counts, the titles a link resolves by and each item's row (`items.row`),
  while the open note's body is its live document, on a socket of its own.
  The page keeps nothing on the device, so a reload reads again. A tab with no
  session goes to the site's sign-in, which brings it back, and a tab that could
  not find out says it didn't open and offers Try again. Rejected: a replica in
  the tab (a second copy of the library to keep right, for a page that cannot
  edit offline anyway); a server on the device (a second writer beside the
  cell); a fault of the site's read as signed out (a password asked of someone
  signed in). `apps/web/src/library/library-tab.ts`,
  `apps/web/src/library/cloud/library-queries.ts`.

- **THE QUERY CLIENT IS THE TAB'S, AND ITS KEYS ARE oRPC'S.** One
  `QueryClient` is made as the tab opens and handed to the library's routes in
  the context their `beforeLoad` returns, its provider the library's layout, so
  a loader and a component share one cache; a loader seeds what its screen
  reads with `queryClient.query({ ..., staleTime: "static" })`, once, over the
  options its screen reads with their own freshness, waiting for one answer and
  not the retries the screen's query makes itself. Every read is oRPC's
  TanStack utils over the same client, under the key oRPC gives it, so the
  socket and a mutation reach a family by its key alone. Rejected: a client in
  the router's own context (every site page would make one it never reads);
  keys of the page's own (a second spelling of every procedure);
  `ensureQueryData`, `fetchQuery` and `prefetchQuery` (deprecated for
  `query`). `apps/web/src/library/library-tab.ts`,
  `apps/web/src/routes/library.tsx`,
  `apps/web/src/library/cloud/library-queries.ts`.

- **A CELL CALL PAUSES OFFLINE AND SAYS SO.** A call only the cell answers is a
  TanStack query or mutation run online (`networkMode: "online"`), so with no
  connection it waits rather than fails: a read says "Needs a connection" where
  it would draw, and a write, whether asked from a card's menu, a button or
  Settings, in one notice the library's layout keeps up while any waits
  offline. A refusal
  the contract declares says its own sentence; any other failure says the
  screen's fallback, never an error's own words. The one retry rule never
  retries a declared refusal, so no screen turns retries off itself. A write
  whose order matters shares a `scope`, and refetches in its own callbacks,
  awaited, only the family it moved. A read a press must act on is a mutation
  too, so it waits under that notice and in that scope, retried as a query is.
  The words are one constant, `NEEDS_CONNECTION`, beside the refusal rule, and
  the editor's item and the phone say it too, so every device says one thing
  of a call that waits. Rejected: a call outside TanStack (it fails at once
  offline); a note per button (a menu's verb has none); the words spelled per
  surface (each a copy to keep in step).
  `apps/web/src/library/cloud/v1.ts`,
  `apps/web/src/library/cloud/needs-connection.tsx`, over
  `packages/contract/src/refusal-text.ts`.

- **THE LIBRARY IS ONE CHUNK, AND CATCHES UP AS ITS CONNECTION RETURNS.**
  Every module only the library's routes reach, the tab's open and the
  editor's lazy nodes (KaTeX, Mermaid, the calendar) among them,
  is one chunk group, so a site page preloads none of it and, once the page
  loads, nothing is fetched but calls and files: a chunk first asked for by a
  tab that lost its connection fails, and the crash screen offers a reload. The
  account's socket dials again the moment the browser says it is online,
  rather than at its next wait, and every time it opens every query is read
  again. What the group reaches through a shared barrel (lucide-react, Base
  UI) stays in chunks of rolldown's own, which the document preloads, so every
  chunk runs in source order. Residual: a lazy node keeps an entry of a few
  bytes over the group (the calendar's), fetched on first use, and wrapping
  every module for that order costs the build about 3%. Rejected: no splitting
  at all (the site would load the library); route splitting alone (the lazy
  nodes split into chunks of their own); a group that takes its dependencies
  (it takes what the site shares, so the site loads the library); warming each
  chunk at boot (a tab offline before they land still fails); a boundary per
  lazy node (the group leaves almost nothing to fail to load).
  `apps/web/vite.config.ts`,
  `apps/web/src/library/cloud/use-library-socket.ts`.

- **THE ACCOUNT'S SOCKET SAYS WHAT MOVED, AND THE PAGE READS THAT AGAIN.** A
  moved frame invalidates the listings and the rail's counts for any item it
  names, an item's row only when the copy held is older than the sequence it
  names, the scopes for a folder, and a thread's list and events for a turn;
  a list the cell cut short (`"all"`) invalidates the family. A note's typing
  moves its item only when it changes what a row holds (its card, links, tags
  or files), and the open note's body never rides the frame: it is live on its
  own socket. The editor's embeds hear which items moved; a thread frame not a
  preview reads its events again, and every frame goes on to the agent panel
  for the reply being written. Residual: an embed reads another note again
  only when that note's row moves, so a change that leaves its card as it was
  shows at the next one. Rejected: state in the frames (a dropped frame would
  be a lost write); partysocket (the contract's hint already redials, pings and
  backs off). `apps/web/src/library/cloud/use-library-socket.ts`.

- **THE TAB ASKS BEFORE IT LOSES THE OPEN ITEM'S EDIT.** An edit reaches the
  note as it is typed, so the one thing the tab holds that the note has not is
  what was typed while no connection could carry it (`OpenNote.unsent`), which
  the next sync hands over; while it holds that, the browser asks before the
  tab closes, reloads or leaves, its listener there only then, and a session
  that ended asks nothing, since nothing can go. Leaving the item for another
  asks the note whether it stored every edit made here and goes once it says
  so; a socket that drops meanwhile answers by what was unsent, and only an
  edit no connection carried asks first
  (`apps/web/src/library/item/leave-item.ts`). Residual: an edit typed into a
  socket that died unseen, before the ping finds it, counts as carried, so a
  leave in that window loses it. Rejected: a listener always armed (it bars
  the back-forward cache); waiting on the note's save alone (it is never
  answered on a socket that is gone).
  `apps/web/src/library/cloud/leave-guard.ts`,
  `apps/web/src/library/workspace.tsx`.

- **A SESSION'S END IS ANSWERED HOWEVER THE PAGE MEETS IT.** Every call goes
  through the wire's interceptor, and a file sent up reads its upload's 401,
  410 and 426 the same way, so a session's end has one answer: the page goes to
  the site's sign-in, and a keeper reads the session on a timer so an idle page
  finds out too. The floor spares a page the Worker served, so a tab it refuses
  is a browser too old to mark its calls as that page's, and the tab says so.
  Rejected: waiting for a wire call alone (an idle page makes none); an upload's
  end said as a failed file (the tab stayed on a library it could no longer
  reach); the refused tab sent to sign in (the sign-in sends a signed-in tab
  straight back, for good). `apps/web/src/library/cloud/v1.ts`,
  `apps/web/src/library/cloud/library-files.ts`,
  `apps/web/src/lib/auth-client.ts`, `apps/web/src/library/library-tab.ts`,
  over `packages/service/src/client-floor.ts`.

## Surfaces

- **WINDOW-LEVEL HOSTS MOUNT IN THE LIBRARY'S LAYOUT.** `ConfirmDialogHost`,
  `Toaster`, the one `TooltipProvider`, the theme and the notices live in the
  layout above every library route; a host mounted by one route leaves another
  route's `confirm()` parked on a dialog that never opens. Rejected: the root
  route (every site page would carry the library's hosts).
  `apps/web/src/library/library-layout.tsx`.

- **THE RAIL CHOOSES THE LIBRARY'S SCOPE.** A header (Library, Search), then
  the groups Library (All items, Unsorted), Folders, Tags (folding) and Deleted,
  each row a scope with the count the cell answers for it
  (`library.listing.scopes`), and Settings at its foot. The footer says nothing
  of where the library stands: a call waiting for a connection is the
  layout's one notice. Each row sets the grid's scope (`libraryScope`) and goes back to
  the library; a folder's other verbs are its right-click and its More button.
  Rejected: a window-wide strip (a second bar under the rail); a sync line (an
  online page has nothing queued to report).
  `apps/web/src/library/sidebar/rail.tsx`.

- **A FOLDER SCOPE EXISTS, BY THE FOLDER'S ID.** A folder row narrows the grid
  to the folder; nested folders indent under their parents, and a save from the
  folder's grid lands in it. A remembered folder no longer listed reads as All
  items, on the phone as here (`listedScope` in
  `packages/contract/src/library-scope.ts`).
  `apps/web/src/library/library/listing.ts`,
  `apps/web/src/library/sidebar/folder-paths.ts`.

- **THERE IS ONE SEARCH SURFACE, AND IT IS ⌘P.** One field searches the
  cell's full-text index (titles, notes and saved articles) through
  `library.listing.page` with `words`, ranked as the cell ranks it for every
  device, beside the page's commands; the hits typed before stay up while the
  next words are asked, and a hit opens its item with the find bar on the
  words, and a typed web address offers "Save this link". The rows are groups
  of data the page hands `@repo/ui`'s palette, Base UI's Autocomplete, which
  owns the field's keys, the light and the roles (A PICKER IS BASE UI'S, in
  `packages/ui/CLAUDE.md`). ⌘F IS NOT ONE OF THEM: it searches the open item,
  with its own chord and bar. Residual: each word typed waits on a call.
  Rejected: an index of the page's own (a second copy of the library); a search
  field of the grid's own. `apps/web/src/library/palette/command-palette.tsx`.

- **THE PANEL STARTS CLOSED, IS FLAT-TABBED, AND IS DRAGGED LIKE THE RAIL.**
  `panelOpen` defaults off, and every entry that shows something in it opens it
  on its tab. The tabs are Info, about the open item or else the one card
  selected, and the Agent, about the whole library. The width
  persists through the rail's own resize handle (`panelWidth` in `prefs.ts`).
  Rejected: a second resize mechanism. `apps/web/src/library/panel/panel.tsx`,
  `apps/web/src/library/workspace.tsx`.

- **THE OPEN ITEM RIDES THE URL, AND SETTINGS COVERS A WORKSPACE THAT STAYS
  MOUNTED.** `?item=<id>` is the open item: every open is a history entry, so
  the browser's Back leaves the item and Forward reopens it, and a link or a
  reload opens it as the cell answers it. Settings is a child of the
  library's layout, drawn in a full-window layer over the workspace the layout
  keeps mounted: the covered workspace is `inert`, its `GLOBAL_SHORTCUTS`
  listener detached, and the open note stays open beneath. Rejected: a
  back/forward stack of the page's own (the tab has the browser's); a sibling
  Settings route (it unmounted the item).
  `apps/web/src/library/library-layout.tsx`.

- **A PAGE PREFERENCE IS A ROW, AND SO IS AN APPEARANCE DIAL.** What the page
  remembers across a reload is one `PREFS` row (key, a zod schema decoding the
  stored string and encoding the value, fallback), read and written only
  through `readPref` / `writePref` / `usePref`; bytes a row cannot decode read
  as its fallback (`apps/web/src/library/prefs.ts`). An appearance dial is
  one `dial()` row naming its `--editor-*` token
  (`apps/web/src/library/appearance-options.ts`). Labels and layout stay out:
  Settings is laid out by hand. The site's theme is the page's `PREFS.theme`,
  which the document's no-flash script reads before any module loads, so the
  site's toggle and Settings › Appearance are one choice
  (`apps/web/src/components/theme-provider.tsx`). Rejected: a preference kept
  in the cell (a theme is the device's, not the account's); a theme key of the
  site's own (two choices for one document, the page painted by the one it did
  not make). `tools/repo-guards/src/page-prefs.test.ts` refuses a keyed read
  outside it.

- **THE PAGE'S TEXT IS NOT SELECTABLE UNLESS SOMEONE WOULD COPY IT.** The
  `body` holding the library's root (`[data-library]`) is `user-select: none`,
  so the site's pages keep theirs, fields and the editor's editing hosts are
  `text`, and what a person would copy (a conversation, an error) opts in with
  `select-text` (`apps/web/src/library/styles/globals.css`). Rejected:
  selectable by default with `select-none` on the chrome (every new button,
  label and row would have to remember it).

- **A LIBRARY SCOPE HAS ONE SPELLING, `@repo/contract/library-scope`.** Which
  part of the library a screen shows (all of it, Unsorted, a folder, a tag or
  Deleted) is one set of zod arms (`packages/contract/src/library-scope.ts`), a
  folder named by its id as the cell keeps it, read by the page's `PREFS` row
  (`apps/web/src/library/prefs.ts`), the grid's listing query
  (`apps/web/src/library/library/listing.ts`) and a view context's `scope`
  (`agentViewContextSchema` in
  `packages/contract/src/library/library-wire.ts`), which names any of
  them but Deleted. Rejected: a scope per surface or per wire, spellings that
  drift the first time a scope gains a kind; a folder by its path (a rename
  would move it out of every remembered scope).

- **THE LIBRARY IS HOME, AND AN ITEM IS SHOWN BY ITS KIND.** With nothing open
  the page is the grid of the rail's scope, one card per item; an empty scope
  says why and offers a next step
  (`apps/web/src/library/library/library-view.tsx`). An item opens full size
  in its place and takes the keyboard unless something holds it, so Escape goes
  back (`apps/web/src/library/item/item-view.tsx`): a file's viewer over its
  bytes (`/v1/blobs/<sha>`), a saved page's source above its text, a link not
  yet read saying so (`apps/web/src/library/item/item-stages.tsx`), and the
  item's body in the editor over its note's live document, which another tab,
  another device or the agent edits beside you as you type. It turns read-only
  and says "Needs a connection" the moment the browser is offline, an edit
  typed before the drop reaching the note once it returns; a note in Deleted,
  or one as long as a note can be, reads but takes no edit and says why. A long
  scope reads its next page as the grid scrolls near its end. Rejected: a list
  beside an always-open item (saved pages read as text files).

- **THE GRID'S SELECTION IS A STORE, A CLICK SELECTS AND A DOUBLE-CLICK OPENS.**
  Finder's grammar by item id: a click selects, ⌘-click toggles, ⇧-click
  extends from the anchor, arrows follow the columns, ⌘A takes the listing,
  Space is Quick Look, Return opens
  (`apps/web/src/library/library/library-selection.ts`). A double-click opens
  on the click whose `detail` is 2, never the `dblclick`
  (`apps/web/src/library/library/item-card.tsx`). The store is the
  workspace's, so it outlives an open item, and the panel's Info and the
  agent's view context follow it; an item that left the listing leaves the
  selection. Rejected: click-to-open (the selection is the panel's subject and
  the agent's context).

- **A BULK VERB RUNS IN CHUNKS, UNDER ONE TOAST WITH STOP.** A move, a tag or
  a purge of many items calls the cell once per chunk its route takes,
  sequentially; a chunk that fails stops the run and says how far it got, the
  closing sentence says only what landed, and a run where none landed says that
  in place of a count (`apps/web/src/library/library/bulk-actions.ts`). A
  delete of more than fifty asks first; any delete toasts its Undo.

- **A SAVE FROM THE WINDOW IS A PASTE OR A DROP THAT NO FIELD CLAIMED.** A paste
  lands where nothing takes text, a drop where no field or editor took it; a
  drop holding nothing to save keeps the browser's handling, and a drag started
  inside the page never saves (WebKit fires no paste off an editable target, so
  ⌘V there pastes into an off-screen catcher). Each link and file goes to the
  cell where the grid's scope saves (its folder, else Unsorted, a tag's tag), a
  file's bytes up first, files over links, and a folder or a file past the
  store's 100 MB is
  refused before a byte is queued, the file picker held to the same cap.
  Rejected: a save field of the grid's own.
  `apps/web/src/library/library/capture/window-capture.ts`,
  `capture-payload.ts`.

- **AN ITEM'S INFO IS ITS FIELDS, AND A WRITE SHOWS BEFORE IT LANDS.** Info
  reads the item's row as the cell holds it (`items.row`), which wakes no note
  and is read again as the row moves. Any item's properties, but one in
  Deleted's, are each one field op (`library.write`) over the value Info
  showed, and its pin, move, tags and title, like every verb over cards, one
  `items.organize`; each is laid over the listings and the item's row the
  moment it is asked, rolled back if the cell refuses it, and read again once
  it settles; a delete, a restore and a purge are laid over the same way, all
  of them in one queue so they land in the order asked
  (`apps/web/src/library/panel/info-tab.tsx`,
  `apps/web/src/library/library/library-verbs.ts`). Rejected: a form over the
  item's markdown (a second reader of what the cell already parsed); waiting for
  the cell before a card moves (a pin would lag the press by a round trip);
  reading the item whole for Info (every projection of the open note's typing
  would read its body back through the note).

- **UNDO IS ONE QUEUE OF THE AGENT'S CHANGE SETS.** Undo takes a whole change
  set back in a set of its own, once the open note says it stored what was
  typed in it, so the undo meets the note as the person sees it and typing
  since stays, but for typing inside the agent's own words, which goes with
  them, and the sentence names each note it went from; a set a rule held back,
  and one of which only kept items remain, stays undoable and says so, in one
  sentence both of the agent panel's Undo buttons say. An undo reads the
  conversation's sets again however it ended, since an
  open list hears nothing of what another device took back and a refusal can be
  the first it learns of it. Undo is the cell's, so it waits for a connection.
  Every undo waits in one queue, joined at the press with the wait for the open
  note inside it, so the queue is the order of the presses, and while anything waits
  in it both Undo buttons stay down, through leaving and coming back, since a
  set goes back once and the cell refuses a whole undo that names one already
  undone. Rejected: a History tab listing an item's sets and its versions (the
  spec keeps no page history, and ⌘Z and Deleted already take back the
  person's own); holding each button by its own undo (a press before leaving
  left it live to a refusal); leaving Undo this conversation live to read
  behind what waits (a long conversation's undos join a batch at a time, so its
  read ran ahead of the next batch and named it); waiting for the open note
  before joining the queue (a file still being kept let a later press overtake
  it).
  `apps/web/src/library/cloud/change-set-pages.ts`,
  `apps/web/src/library/agent/undo-answer.ts`,
  `apps/web/src/library/agent/agent-panel.tsx`.

- **THE AGENT PANEL IS THE ACCOUNT'S THREADS.** A conversation is the cell's
  thread rows and stored events, read as queries the account's socket keeps
  fresh, the same on every device, drawn from the contract's own union; the
  reply being written arrives on the socket and is never stored. A send carries
  the screen it leaves from (the open item, or the scope and the selection;
  none from Deleted); an approval's Approve or Cancel
  answers `library.agent.respond` naming the event that asked; the day's
  allowance and an agent switched off are said in the person's words. A
  selection's Ask agent quotes the passage under what the composer holds, and
  the field takes the keyboard for the question. Under
  each finished turn "Undo this turn" takes its change set back, and "Undo this
  conversation" every one of the conversation's, both once the open note has
  stored what was typed in it: the sets are read from every page the cell answers,
  the whole conversation's Undo offered once all are in and sent in as few
  undos as the cell takes, and asked again as each turn ends, since a turn's
  set seals with it. Its press reads them once more, and when none is left to
  take back it sends nothing and says so. While a turn
  is open, a turn waiting on an approval among them, every device draws Stop,
  which turns down what it asked and ends the answer, and the page no Undo of
  the conversation, since the open turn's set is out of its reach. Rejected: an
  agent the device runs (a runtime and a model credential on every device); a
  socket of the page's own to the conversation's object; one page of sets (a
  long conversation's oldest turns lost their Undo); the list on screen at the
  press (it can be a turn short of the cell, or hold what another device took
  back). `apps/web/src/library/agent/agent-panel.tsx`, `thread-undo.ts`, over
  `packages/agent-panel/src/thread-entries.ts`.

- **TIDY MY LIBRARY IS A REQUEST FROM UNSORTED, AND THE FILING RULES ARE THE
  CELL'S.** The grid's header and ⌘P open the agent's composer on a new
  conversation holding the request, sent from Unsorted with nothing typed or
  with what the person adds for this run; the request never says whether rules
  exist, since every turn carries the rules the cell read for it. Settings'
  Edit filing rules… opens the cell's rules, or the starter rules, which say
  Unsorted is no folder and its items are the ones to file. Rejected: the
  request typed into the field (a person could edit it away); rules in the
  request (a second read beside the turn's).
  `apps/web/src/library/agent/tidy-library.ts`,
  `apps/web/src/library/settings/filing-rules.ts`.

- **A FILE IN A NOTE IS READ WHERE THE PAGE DRAWS ITS FILES, AND ONE PASTED
  THERE GOES UP BEFORE ITS BLOCK.** The editor's host reads a note's picture or
  file from `/v1/blobs/<sha>`, which the browser keeps under the cloud's
  immutable answer, and an embed's blocks from `items.get`. A file pasted or
  dropped into a note is sent up by its SHA-256 first, and only then does the
  editor write the block naming it, so the cell never meets a sha it does not
  hold. Rejected: a cache of the page's own (the browser's already holds the
  answer); the bytes held for a later send (the page keeps nothing).
  `apps/web/src/library/item/page-editor-host.ts`,
  `apps/web/src/library/cloud/library-files.ts`.

- **THE MAC APP'S WINDOW KEEPS THE SYSTEM'S TITLE BAR, SO THE PAGE DRAWS THE
  SAME IN EVERY HOST.** macOS draws the window's title bar above the page and
  drags the window by it, so the page reserves no corner and marks nothing to
  drag by, and the Mac app shows the page a tab shows. The one thing the page
  asks its shell is the update (THE MAC APP'S UPDATE IS A CARD, below), over
  three commands and one event (`apps/web/src/library/shell/desktop-bridge.ts`,
  `apps/desktop/src-tauri/src/updater.rs`). Rejected: an overlay title bar the
  page draws around (drag strips, an inset top bar and a branch per host for a
  few pixels of chrome). `apps/web/src/library/top-bar.tsx`.

- **THE MAC APP'S UPDATE IS A CARD AT THE WINDOW'S CORNER, AND SETTINGS SAYS
  THE SAME.** The updater is the shell's, since it replaces the app, so the
  page mirrors the state the shell pushes in one store, which its first screen
  starts with a check, and asks the shell to move it
  (`apps/web/src/library/desktop-updates.ts`). kyh/init's banner draws it on
  `@repo/ui`'s Card and Progress at the bottom right while there is something
  to do about it: Download, a bar filling as it downloads, Restart, and Try
  again under the updater's own words; Settings' Updates row reads the same
  store (`apps/web/src/library/settings/updates-row.tsx`). Nothing downloads or
  restarts without a click. The card has no anchor and no dismissal of its
  own, so it is no popup, and it leaves when the update does. A tab has no
  updater: no card, and the row says updates come with the Mac app. Rejected:
  a toast (a download's share said in words alone, under notices of what
  already happened); a store per screen (the card and the row would disagree).
  `apps/web/src/library/desktop-update-banner.tsx`.

## Repo guards, vendoring and tooling

- **A LIBRARY TEST THAT LOGS A console.error FAILS.** React reports a setState
  during another component's render, a missing key or an update outside `act`
  only as a console.error, so a suite that just logs it stays green over a real
  defect (`apps/web/src/library/test-support/console-error-gate.ts`). A test
  that provokes one on purpose silences it with its own spy.

- **THE PAGE IS A ROUTE OF THE SITE, AND ITS SUITES RUN BESIDE THE SITE'S**
  (owner decision). The Worker serves it as it serves the site (THE LIBRARY'S
  PAGE IS A ROUTE OF THE SITE, in `apps/web/CLAUDE.md`), and the Mac app's
  window loads it from there. Only this folder reaches `@tauri-apps/*`
  (`SHELL_API_PAGE` in `tools/repo-guards/src/dep-dag.test.ts`). Its suites run
  under jsdom, compiled as they ship (`apps/web/vitest.config.ts`), over a
  memory router holding the library's routes alone
  (`apps/web/src/library/test-support/library-router.tsx`), and
  `apps/web/tsconfig.page.json` holds what ships to the stdlib of the Mac app's
  WebKit. Its loop is `pnpm dev:web`. Rejected: a workspace of its own whose
  build the Worker copies (a second build, and a door and a policy of its
  own); a dev server of the page's own (a second origin, its calls
  cross-site).
