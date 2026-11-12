# Decisions: the library tab

The library tab at `/library`: the account's library read and written online, the rail, the grid,
the open item, the panel, the palette, Settings and the tab's own preferences.

## Shape

The tab is the site's `/library` route (`apps/web/src/routes/library.tsx`), its children the
workspace and Settings, its code this folder. `library-tab.ts` opens the tab once a document (the
session, the wire, the account's socket and the QueryClient) in the route's `beforeLoad`, and
`library-layout.tsx` draws what every library route shares. `cloud/` is the `/v1` client, the
queries and the socket; `workspace.tsx` the rail, the grid or the open item, the panel and the
palette; `library/` the grid and its verbs; `item/` the open item; `panel/` Info; `agent/` the
agent's conversations; `palette/` ⌘P; `sidebar/` the rail; `settings/` Settings; `styles/` the
sheet only this route links; `shell/desktop-bridge.ts` the Mac app's update.

## The tab over the cell

- **The tab is the account's library, read and written online.** Every screen reads the cell
  through `/v1`, a listing a batch at a time, and keeps nothing on the device, since a replica is a
  second copy to keep right for a tab that cannot edit offline.
  `apps/web/src/library/library-tab.ts`.
- **The query client is the tab's, and its keys are oRPC's.** One `QueryClient` rides the library
  routes' `beforeLoad` context, so a loader and a component share one cache, and a socket frame
  reaches a family by oRPC's key, never one of ours.
  `apps/web/src/library/cloud/library-queries.ts`.
- **A cell call pauses offline and says so.** Every call only the cell answers runs with
  `networkMode: "online"`, so offline it waits under `NEEDS_CONNECTION`, the one sentence every
  device says, and a read's standing is one value, `cellStanding`.
  `apps/web/src/library/cloud/needs-connection.tsx`.
- **The library is one chunk, and catches up as its connection returns.** A site page preloads none
  of it, and a loaded tab fetches only calls and files, since a chunk first asked for offline fails;
  the socket dials the moment the browser is online and reads every query again.
  `apps/web/vite.config.ts`.
- **The account's socket says what moved, and the tab reads that again.** A frame names what moved
  and never carries it, since a dropped frame must not be a lost write.
  `packages/client/src/library-cache.ts`.
- **The tab asks before it loses the open item's edit.** Only typing no connection carried
  (`OpenNote.unsent`) arms the browser's ask, since an armed listener bars the back-forward cache,
  and leaving an item waits for the note to say it stored every edit.
  `apps/web/src/library/cloud/leave-guard.ts`.
- **A session's end is answered however the tab meets it.** A call's 401, an upload's 401, 410 or
  426, and a keeper reading the session on a timer end it one way, to the site's sign-in, since an
  idle tab makes no call. `apps/web/src/library/cloud/v1.ts`.
- **A tab's session is one value.** Live, ended with why, or left, moved by `tabAfter`: the first
  end wins, since two hand-rolled leaves went twice. `apps/web/src/library/library-tab.ts`.

## Surfaces

- **Window-level hosts mount in the library's layout.** The dialog host, the toaster, the tooltip
  provider, the theme and the notices sit above every library route, since a host one route mounts
  leaves another's `confirm()` parked. `apps/web/src/library/library-layout.tsx`.
- **The rail chooses the library's scope.** Library, Folders, Tags and Deleted, each row a scope
  with the cell's count, and a waiting call is the layout's one notice, since an online tab has
  nothing queued to report. `apps/web/src/library/sidebar/rail.tsx`.
- **A library scope has one spelling, `@repo/contract/library-scope`.** The pref, the grid's listing
  and a view context read one set of zod arms, a folder by its id, since a scope per surface drifts
  and a folder by path leaves every remembered scope on a rename.
  `packages/contract/src/library-scope.ts`.
- **There is one search surface, and it is ⌘P.** One field over the cell's full-text index, ranked
  as the cell ranks it for every device, and ⌘F searches the open item, since an index of the tab's
  own is a second copy of the library. `apps/web/src/library/palette/command-palette.tsx`.
- **The panel starts closed, is flat-tabbed, and is dragged like the rail.** Info and the Agent,
  its width kept through the rail's own resize handle, so there is no second resize mechanism.
  `apps/web/src/library/panel/panel.tsx`.
- **The open item rides the URL, and Settings covers a workspace that stays mounted.** `?item=<id>`
  is a history entry, so Back and Forward work, and Settings is a layer over the inert workspace,
  since a sibling route unmounted the item. `apps/web/src/library/library-search.ts`.
- **A tab preference is a row, and so is an appearance dial.** What the tab remembers is one `PREFS`
  row behind `readPref`, `writePref` and `usePref`, the site's theme among them, since a theme is
  the device's and not the account's. `apps/web/src/library/prefs.ts`.
- **The tab's text is not selectable unless someone would copy it.** The library's body is
  `user-select: none` and what a person would copy opts in, since selectable by default makes every
  new control remember `select-none`. `apps/web/src/library/styles/globals.css`.
- **The library is home, and an item is shown by its kind.** With nothing open the tab is the grid
  of the rail's scope; an item opens full size in its place, a file in its viewer and a note in the
  editor over its live document, since a list beside an open item reads saved pages as text files.
  `apps/web/src/library/item/item-view.tsx`.
- **The grid's selection is a store, a click selects and a double-click opens.** Finder's grammar by
  item id, and the store outlives an open item, since the selection is the panel's subject and the
  agent's context. `apps/web/src/library/library/library-selection.ts`.
- **A bulk verb runs in chunks, under one toast with Stop.** One cell call a chunk, in order, a
  failure saying how far it got, and a delete of more than fifty asks first.
  `apps/web/src/library/library/bulk-actions.ts`.
- **A save from the window is a paste or a drop that no field claimed.** Each link and file goes
  where the grid's scope saves, and a file past 100 MB is refused before a byte is queued, since the
  grid has no save field of its own. `apps/web/src/library/library/capture/window-capture.ts`.
- **An item's Info is its fields, and a write shows before it lands.** Info reads `items.row`, which
  wakes no note, and each write shows in the listings at once and rolls back on a refusal, since a
  pin must not lag the press by a round trip. `apps/web/src/library/panel/info-tab.tsx`.
- **Undo is one queue of the agent's change sets.** A set goes back once the open note stored what
  was typed, so typing since stays, and every undo waits in press order; there is no version
  history, since ⌘Z and Deleted take back the person's own.
  `apps/web/src/library/agent/undo-answer.ts`.
- **The agent panel is the account's threads.** A conversation is the cell's rows, the same on
  every device, a send carrying the screen it leaves from, since an agent the device runs needs a
  model credential on every device. `apps/web/src/library/agent/agent-panel.tsx`.
- **Tidy my library is a request from Unsorted, and the filing rules are the cell's.** The request
  never says whether rules exist, since every turn carries the rules the cell read for it.
  `apps/web/src/library/agent/tidy-library.ts`.
- **A file in a note is read where the tab draws its files, and one pasted there goes up before its
  block.** The host reads `/v1/blobs/<sha>` and sends a pasted file up first, so the cell never
  meets a sha it does not hold. `apps/web/src/library/item/page-editor-host.ts`.
- **The Mac app's window keeps the system's title bar, so the tab draws the same in every host.** It
  reserves no corner and asks its shell only for the update, since an overlay title bar costs a
  branch per host for a few pixels. `apps/web/src/library/top-bar.tsx`.
- **The Mac app's update is a card at the window's corner, and Settings says the same.** The updater
  is the shell's, so one store mirrors what the shell pushes and nothing downloads or restarts
  without a click. `apps/web/src/library/desktop-updates.ts`.
- **The agent's composer is one state the workspace keeps.** Moved by `composerAfter` under one
  `useReducer`, since a `useState` per concern let a Tidy sit beside an open conversation.
  `apps/web/src/library/agent/agent-composer.ts`.

## Suites

- **A library test that logs a console.error fails.** React reports a render-phase setState, a
  missing key or an update outside `act` only there, so a suite that just logs it stays green over
  a defect. `apps/web/src/library/test-support/console-error-gate.ts`.
- **The tab is a route of the site, and its suites run beside the site's** (owner decision). The
  Worker serves it and the Mac app's window loads it from there, its suites run under jsdom over a
  memory router, and `apps/web/tsconfig.json` holds it to the Mac app's WebKit stdlib.
  `apps/web/vitest.config.ts`.
