# Decisions: the library tab

The library tab at `/library`: the account's library read and written online, the rail, the grid,
the open item, the panel, the palette, Settings and the tab's own preferences.

## Shape

The tab is the site's `/library` route (`apps/web/src/routes/library.tsx`), its children the
workspace and Settings, its code this folder. `library-tab.ts` opens the tab once a document (the
session, the wire, the account's socket, the shell's store and the QueryClient) in the route's
`beforeLoad`, and `library-layout.tsx` draws what every library route shares. `cloud/` is the `/v1`
client, the queries, the writes and the socket; `workspace.tsx` lays out the rail, the grid or the
open item, the panel and the palette, `workspace-store.ts` holds what they share and
`library-place.ts` moves where the tab is; `library/` the grid, its verbs and the commands every
screen presses; `item/` the open item; `panel/` Info; `agent/` the agent's conversations;
`palette/` ⌘P; `sidebar/` the rail; `settings/` Settings; `import/` an import's reading; `styles/`
the sheet only this route links; `shell/desktop-bridge.ts` the Mac app's update.

## The tab over the cell

- **The tab is the account's library, read and written online.** Every screen reads the cell
  through `/v1`, a listing a batch at a time, and keeps nothing on the device, since a replica is a
  second copy to keep right for a tab that cannot edit offline.
  `apps/web/src/library/library-tab.ts`.
- **The query client is the tab's, and its keys are oRPC's.** One `QueryClient` rides the library
  routes' `beforeLoad` context, so a loader and a component share one cache, and a socket frame
  reaches a family by oRPC's key, never one of ours.
  `apps/web/src/library/cloud/library-queries.ts`.
- **A write is mutation options beside the reads, and says how it went once.** A screen mounts only
  the write it asks, and its refusal is said by the write's options or by the flow that awaits it,
  never by a callback handed to `mutate`, since TanStack drops that with the screen that asked.
  `apps/web/src/library/cloud/library-writes.ts`.
- **A cell call pauses offline and says so.** Every call only the cell answers runs with
  `networkMode: "online"`, so offline it waits under `NEEDS_CONNECTION`, the one sentence every
  device says, and a read's standing is one value, `cellStanding`.
  `apps/web/src/library/cloud/needs-connection.tsx`.
- **The library is one chunk, and catches up as its connection returns.** A site page preloads none
  of it, and a loaded tab fetches only calls, files and an import's worker, which needs a connection
  anyway, since a chunk first asked for offline fails; the socket dials the moment the browser is
  online and reads every query again. `apps/web/vite.config.ts`.
- **An import is read in the tab, on a module worker, and the cell only lands it.** The worker
  unzips and plans, then asks how each note stands and lands a batch at a time, each id taken from
  the file, so closing the tab stops it and choosing the file again carries on; read in the cell, a
  zip waits in R2 as a second copy and each alarm's 30 s holds a page of it.
  `apps/web/src/library/import/import-run.ts`.
- **The account's socket says what moved, and the tab reads that again.** A frame names what moved
  and never carries it, since a dropped frame must not be a lost write.
  `packages/client/src/library-cache.ts`.
- **The tab asks before it loses the open item's edit.** One router blocker guards every way off
  the item, a click, Back, Forward and the tab's close, since the item rides the URL; only typing
  no connection carried (`OpenNote.unsent`) asks, and a leave waits for the note to say it stored
  every edit. `apps/web/src/library/item/leave-item.ts`.
- **A session's end is answered however the tab meets it.** A call's refusal, an upload's, which
  is the same error, and a keeper reading the session on a timer end it one way, to the site's
  sign-in, since an idle tab makes no call. `apps/web/src/library/cloud/v1.ts`.
- **A tab's session is one value.** Live, ended with why, or left, moved by `tabAfter`: the first
  end wins, since two hand-rolled leaves go twice. `apps/web/src/library/library-tab.ts`.

## Surfaces

- **Window-level hosts mount in the library's layout.** The confirm and ask hosts, the toaster, the
  tooltip provider, the theme and the notices sit above every library route, since a host one route
  mounts leaves another's `confirm()` parked. `apps/web/src/library/library-layout.tsx`.
- **A press is a command, made once and read by context.** Each asks or confirms first where it
  must, runs its verb and goes where it leads, one function a menu row, a chord and ⌘P call alike,
  since a verb handed down is a bag of props per screen, tested only by drawing the whole page.
  `apps/web/src/library/library/library-commands.tsx`.
- **A command asks through one host, and one ask stands at a time.** A name, a folder and a tag
  change each answer a promise as `confirm()` does, the form mounted with its ask, since a dialog
  state per verb lets two stand at once and a draft outlive the ask it was typed for.
  `apps/web/src/library/library/ask.ts`.
- **The rail chooses the library's scope.** Library, Folders, Tags and Deleted, each row a scope
  with the cell's count, and a waiting call is the layout's one notice, since an online tab has
  nothing queued to report. `apps/web/src/library/sidebar/rail.tsx`.
- **A library scope has one spelling, `@repo/contract/library-scope`.** The address, a listing's
  page on the wire and a view context read one set of zod arms, a folder by its id, since a scope
  per surface drifts and a folder by path breaks every link to it on a rename.
  `packages/contract/src/library-scope.ts`.
- **There is one search surface, and it is ⌘P.** One field over the cell's full-text index, ranked
  as the cell ranks it for every device, and ⌘F searches the open item, since an index of the tab's
  own is a second copy of the library. `apps/web/src/library/palette/command-palette.tsx`.
- **The panel starts closed, is flat-tabbed, and is dragged like the rail.** Info and the Agent,
  its width kept through the rail's own resize handle, so there is no second resize mechanism.
  `apps/web/src/library/panel/panel.tsx`.
- **What the shell holds beside its address is one store the tab makes.** The panel's tab, ⌘P and
  the agent's composer ride the page's library, since state in the workspace's hooks reaches a
  screen only as a prop handed down. `apps/web/src/library/workspace-store.ts`.
- **The panel opens through its sidebar's own handle.** A reveal and a toggle ask the provider,
  which holds the window's pref above 768px and a sheet's open below it, since a write of the pref
  alone opens nothing in a narrow window. `apps/web/src/library/workspace-store.ts`.
- **Where the tab is rides the URL, and Settings covers a workspace that stays mounted.** The scope,
  the kind and the open item are the route's search, so Back and Forward walk them, a link opens
  them and a bare `/library` is All items; a kind replaces its entry, a search's words ride beside
  the item as `?find=` until its find bar is on them, and Settings is a layer over the inert
  workspace, since a view held beside the router is one Back cannot reach and a sibling route
  unmounts the item. `apps/web/src/library/library-search.ts`.
- **What the tab remembers is a field of a persisted store, by whose it is.** The device's (the
  site's theme, the dials, spell check) reach every window, the window's layout opens the next, and
  the account's id goes with the account, each a zod field behind `usePref`, since a pref nothing
  subscribes to grows a sync of its own. `apps/web/src/library/prefs.ts`.
- **Spell check is the tab's attribute.** WKWebView has no session-wide spell-check switch, so it
  is a pref on the document root. `apps/web/src/library/document-prefs.ts`.
- **The tab's text is not selectable unless someone would copy it.** The library's body is
  `user-select: none` and what a person would copy opts in, since selectable by default makes every
  new control remember `select-none`. `apps/web/src/library/styles/globals.css`.
- **The library is home, and an item is shown by its kind.** With nothing open the tab is the grid
  of the rail's scope; an item opens full size in its place, a file in its viewer and a note in the
  editor over its live document, since a list beside an open item reads saved pages as text files.
  `apps/web/src/library/item/item-view.tsx`.
- **The grid's selection is a store, of ids or of its scope less those left out.** Finder's
  grammar, a click selecting and a double-click opening, and ⌘A names the scope, read or not, since
  the grid holds only the pages it read; an id the listing no longer shows selects nothing, so no
  effect prunes it, and the store outlives an open item, since the selection is the panel's subject
  and the agent's context. `apps/web/src/library/library/library-selection.ts`.
- **A verb that makes several calls is one run, under one toast with Stop.** A chunk of the items
  the device named or one link or file a call, in order, a failure saying how far it got beside
  Delete's Undo of what went, and a delete of more than fifty asks first, since a loop of a verb's
  own says less of what landed. `apps/web/src/library/library/bulk-actions.ts`.
- **A verb over a scope the grid read only in part is one ask, which the cell lands.** The device
  holds no id past its pages, so the toast says what the cell took and the grid follows the cell,
  with no Stop and no Undo of items it never named; Empty Deleted is one, and a selection the grid
  read whole goes by id. `apps/web/src/library/library/library-verbs.ts`.
- **A save from the window is a paste or a drop that no field claimed.** Each link and file goes
  where the grid's scope saves, and a file past 100 MB is refused before a byte is queued, since the
  grid has no save field of its own. `apps/web/src/library/library/capture/window-capture.ts`.
- **An item's Info is its fields, and a write shows before it lands.** Info reads `items.row`, which
  wakes no note, and each write shows in the listings at once and rolls back on a refusal, since a
  pin must not lag the press by a round trip. `apps/web/src/library/panel/info-tab.tsx`.
- **Info's properties are props in and an op out.** The panel draws the properties Info read and
  hands back one property op over the value a row showed, which the cell refuses once that value
  moved, since a second reading of the item's query is a second truth.
  `apps/web/src/library/panel/item-properties.ts`.
- **A property's value is typed by its control, never read out of what was typed.** Add property
  takes a name, a type and that type's control, a row is the control of the value it holds, and a
  name the item already has is refused in the form, since a value read as YAML drops
  `Meeting: Q3 review` and turns `02139` into a number.
  `apps/web/src/library/panel/property-fields.tsx`.
- **A pin is the item's `pinnedAt` field, and the cell sets it.** Every device and the agent agree,
  a pinned item leads the grid, and a press asks `items.organize` for what was asked, so nothing
  merges. `apps/web/src/library/cloud/library-writes.ts`.
- **Undo is one queue of presses, each naming a conversation's turns.** A turn goes back once the
  open note stored what was typed, so typing since stays, and every undo waits in press order;
  there is no version history, since ⌘Z and Deleted take back the person's own.
  `apps/web/src/library/agent/undo-queue.ts`.
- **The agent panel is the account's threads.** A conversation is the cell's rows, the same on
  every device, a send carrying the screen it leaves from, since an agent the device runs needs a
  model credential on every device. `apps/web/src/library/agent/agent-panel.tsx`.
- **An approval is answered when its thread says so, and its card holds only while the answer is on
  its way.** Each waiting approval owns its `respond` mutation, whose refusal hands the options
  back, since a card with a status of its own reads answered over an answer the cell refused.
  `apps/web/src/library/agent/agent-panel.tsx`.
- **Tidy my library is a request from Unsorted, and the filing rules are the cell's.** The request
  never says whether rules exist, since every turn carries the rules the cell read for it.
  `apps/web/src/library/agent/tidy-library.ts`.
- **A file in a note is drawn where the tab draws its files, and one pasted there goes up before its
  block.** The host hands the editor `/v1/blobs/<sha>`, which the cloud serves in ranges, and sends
  a pasted file up first, so the cell never meets a sha it does not hold.
  `apps/web/src/library/item/page-editor-host.ts`.
- **The editor's host is whole the moment it is installed.** A link, a tag, Ask the agent and a
  note the editor makes are answered by the router, the query client and the tab's store, handed
  over once as the library first renders, since actions bound from a component's effect leave a
  host that does nothing until they are. `apps/web/src/library/item/page-editor-host.ts`.
- **The Mac app's window keeps the system's title bar, so the tab draws the same in every host.** It
  reserves no corner and asks its shell only for the update, since an overlay title bar costs a
  branch per host for a few pixels. `apps/web/src/library/top-bar.tsx`.
- **The Mac app's update is a toast that stays while there is something to do, and Settings says
  every state.** One of the toasts, so it stacks with them and their live region announces it; a
  check that failed found no update, so only Settings says it; the updater is the shell's, so one
  store mirrors what it pushes and nothing downloads or restarts without a click.
  `apps/web/src/library/desktop-updates.ts`.
- **The agent's composer is one state the tab's store keeps, its words with it.** Moved by
  `composerAfter`, a passage quoted by the event that asks about it, since a `useState` per concern
  lets a Tidy sit beside an open conversation and drops a typed message with the tab that drew it.
  `apps/web/src/library/agent/agent-composer.ts`.

## Suites

- **A library test that logs a console.error fails.** React reports a render-phase setState, a
  missing key or an update outside `act` only there, so a suite that just logs it stays green over
  a defect. `apps/web/src/library/test-support/console-error-gate.ts`.
- **The tab is a route of the site, and its suites run beside the site's** (owner decision). The
  Worker serves it and the Mac app's window loads it from there, its suites run under jsdom over a
  memory router, and `apps/web/tsconfig.json` holds it to the Mac app's WebKit stdlib.
  `apps/web/vitest.config.ts`.
