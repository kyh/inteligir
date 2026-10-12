# Decisions: @repo/workspace

The page: the rail, the palette, the panel, the open note and the page's own
preferences. `AGENTS.md` § Decisions says how a bullet is written and cited.

## Shape

`src/app/workspace.tsx` owns the note, the rail, the palette and the panel;
`app/note/` the guarded writes; `app/palette/` the ⌘P pages; `app/sidebar/` the
rail's Recent | Files | Deleted views; `app/agents/` the one agent sign-in ⌘K,
the panel, Settings and onboarding all draw; `app/settings/` the Settings layer,
Account and Advanced included; `app/onboarding/` the agent and account steps
`/welcome` offers after a first run. Every shell answer is parsed in
`src/shell/shell-commands.ts` and mirrored through one `app/bridge-store.ts`.

## Vault: writes, git and containment

- **A MOVE IS A RENAME THAT KEEPS THE NAME, and `planMove` is its one verdict.**
  The tree's drop and the palette's "Move note to folder…" both ask `planMove`
  (`apps/workspace/src/app/sidebar/tree-ops.ts`), so both refuse for the same
  reasons. The drag's source is component state, not `dataTransfer`, so a file
  dragged in from the desktop is ignored. No second write path: the move rides
  `vault.rename`, which rewrites links for a folder as for a note
  (`apps/cli/src/server/knowledge/rename.ts`), and the vault session carries the
  open note through it (`packages/editor/src/note/vault-session.ts`). The
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
  then the scorer's rows with their reasons, then unlinked mentions
  (`apps/workspace/src/app/actions/related-section.tsx`). Outgoing links stay
  absent (they are on screen); no graph view; the route is search-shaped (a
  `limit`, no `total`) and fetched only while unfolded. A change sweeps
  `orpc.knowledge.key()` whole, because a link into a note lives in another
  note's bytes, except that `content-changed` skips the vault-wide
  `knowledge.unlinkedMentions` (`app/workspace-context.tsx`).

## Agents and threads

- **THE AGENT SURFACE IS THE ⌘K ACTION COMPOSER AND THE RIGHT PANEL** (the
  surfaces declined beside it are #645's register). An action is an ordinary
  thread attached to the note it was composed over (AN ACTION'S ORIGIN, in
  `apps/cli/src/server/agents/CLAUDE.md`). The agent edits the vault directly
  and anchored comments are the review channel; the panel's Actions | Comments |
  History | Metadata tabs are transcript, review, revision, and the note's own
  properties, related notes and delete. Each settled reply ends with the notes
  its turn edited and Undo changes, and a finish toast ("Agent edited N notes",
  Undo) sits outside the panel; a `changes-committed` frame names its thread,
  never its turn, since the bus carries no payload, so the toast diffs a
  thread's turns against what it last read
  (`apps/workspace/src/app/actions/turn-finish-toast.ts`). Both undos flush the
  open note first, so a line inside the autosave debounce is merged around
  rather than missed (`undo-turn.ts`). "Ask agent" seeds the composer through
  the editor host's agent actions (`packages/editor/src/host-io.ts`), so the
  editor never imports the shell.
  `apps/workspace/src/app/actions/actions-panel.tsx` and `action-composer.tsx`.

## Desktop workspace surfaces

- **WINDOW-LEVEL HOSTS MOUNT AT THE ROOT ROUTE.** `ConfirmDialogHost`, `Toaster`
  and the one `TooltipProvider` live in `apps/workspace/src/routes/__root.tsx`;
  a host mounted by one route leaves another route's `confirm()` parked on a
  dialog that never opens.

- **THE RAIL IS FLUID'S SIDEBAR ANATOMY, AMBIENT STATE LIVES IN ITS FOOTER, AND
  THE TOP BAR IS THE OPEN NOTE.** Header (the vault row, and Search, which opens
  the palette), one group, and a footer. The group's label names the view and
  opens the view menu — Recent | Files | Deleted, one list each, drawn by the
  same `SidebarMenu` rows (`@repo/ui/components/sidebar-menu`) so switching
  swaps rows and never the chrome. Not tabs and not stacked sections: a stack
  made every list short, and a tab row was a third line of chrome. Every other
  verb is a right-click, as in an IDE. The footer holds the sync state, the
  agent's spinner and Settings, because a strip across the whole window was a
  second bar under a rail that already had a bottom; its account row runs the
  one `useCloudSession` (`app/cloud-session.ts`) Settings › Account runs too,
  and offers Sync now and no second sync for actions, which sync on their own.
  The view is the workspace's (`railView` in `app/prefs.ts`), because a `#tag`
  chip, a create and "Deleted notes…" each switch it. THERE IS NO FOLDER SCOPE:
  the breadcrumb REVEALS rather than narrows, opening the way to that folder in
  Files (`revealInTree` in `app/workspace.tsx`, a nonce-keyed prop the rail
  applies once); a second listing root was a second answer to "what is this
  list?". The tree's fold, selection and name input are the rail's state
  (`sidebar/tree-state.ts`), applied during the rail's own render, because a
  component setting its owner's state while it renders is a React error. The
  rail and the palette hide what the user did not write through one filter,
  `visibleEntries` in `app/vault-hooks.ts`; the server's listing stays complete
  because the CLI and the agent read it. Under the note sits only its word count
  and reading time (`app/note-footer.tsx`), the serializer's published count,
  never a recount, with no rule above it so it reads as the note's last line;
  zen hides it. Under the macOS shell the rail reserves the traffic-light corner
  (`apps/workspace/src/app/title-bar.ts`).
  `apps/workspace/src/app/sidebar/sidebar.tsx`.

- **THERE IS ONE SEARCH SURFACE, AND IT IS ⌘P.** The palette lists every note
  and every command in one field, and the search that is not a lookup opens from
  inside it: "Search across the vault…" (the literal scan with its replace). ⌘F
  IS NOT ONE OF THEM: it searches within the open note, so it keeps its own
  chord and its own bar. There is no ⌘O, no ⌘⇧F, no quick-open page and no rail
  search field: four ways to type a note's name was three too many, each a
  different set of rows for the same question. The rail's Search button's
  tooltip spells ⌘P from the table (`app/global-shortcuts.ts`), never as a
  literal.

- **A NOTE'S FACTS ARE READ WHERE THEY ARE CHEAP, and the count rides the
  serializer.** The Metadata tab's "About" block is folded by default because
  unfolding it is what reads the git log for the created date. Words, characters
  and reading time are counted by `@repo/editor/note-stats` beside the TOC's
  walk, so both agree on the document, and published by the serializer's
  debounce, never per keystroke.
  `apps/workspace/src/app/actions/note-facts.tsx`.

- **THE PANEL STARTS CLOSED, IS FLAT-TABBED, AND IS DRAGGED LIKE THE RAIL.**
  `panelOpen` defaults off, and every entry that shows something in it opens it
  through one `revealPanel` (`app/workspace.tsx`), because an entry that only
  picks its tab or thread shows nothing in a closed panel. Its tabs are the flat
  underline row of `@repo/ui/components/tabs`. Its width persists through the
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
  move page cannot exist without the entry it moves.
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
  (`apps/workspace/src/app/vault-hooks.ts`). A reconnect sweeps every family the
  bus reaches, which is why no window-focus re-walk backs it up.
  `apps/workspace/src/app/workspace-context.tsx` and
  `apps/workspace/src/app/__tests__/changed-message.test.ts`.

- **THE NOTE STORE OWNS THE OPEN NOTE, THE URL MIRRORS IT, AND SETTINGS COVERS A
  WORKSPACE THAT STAYS MOUNTED** (owner decision). `?note=` is read once, at
  boot, as the deep link, and every open after that is mirrored into it with
  `replace`, so the store's back/forward stacks are the one history: a pushed
  entry per open let a browser Back move the rail's highlight off the note the
  editor still held. Settings is a layer over the workspace in the pathless
  `_workspace` layout, not a sibling route, which unmounted the note, its undo
  history, the composer and zen. Covered, the workspace is `inert` and its
  `GLOBAL_SHORTCUTS` listener detached, since inert does not stop a window
  listener; the way in flushes the open note, since nothing else settles a title
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
