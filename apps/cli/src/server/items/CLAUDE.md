# Decisions: items (apps/cli/src/server/items)

Saving links, pages and files as items, and filling a saved link from its page.
`AGENTS.md` § Decisions says how a bullet is written and cited.

## Items: capture and fill

- **ONE GUARDED DIAL FOR EVERY SAVE.** Every page, cover, oEmbed answer and
  page-copy resource is fetched through `createGuardedFetch`, whose lookup hook
  vets every address an answer holds and hands the socket only that list, so
  nothing resolves twice; an IP literal, an IPv6 address carrying an IPv4 one,
  every redirect hop and every subresource are vetted too. A body cut off or
  held past the deadline ends the read, and a lookup gives up at the deadline or
  the caller's signal. No env var widens the guard: a suite injects the lookup,
  the policy or the fetch (`CapturePorts`). Rejected: pre-resolving then
  `fetch()` (a rebinding window) and undici (a new dependency for the same
  hook). `apps/cli/src/server/items/capture/guarded-fetch.ts`.

- **THIS MAC IS NEVER DIALED, AND PRIVATE SPACE ONLY FROM A PRIVATE SAVE.**
  Refused: this Mac (`localhost` by name too, and any address its interfaces
  hold that reads as public, re-read at every hop, its private ones staying
  private space), link-local and reserved space, the server's own port on any
  address, and an answer mixing private and public addresses. Private space is
  reachable only from a saved address that is itself private, the first hop
  deciding. Rejected: the LAN open to any page (a public page could redirect the
  Mac at the router or at a service on this Mac's own address, which browsers'
  Private Network Access refuses).
  `apps/cli/src/server/items/capture/address-guard.ts`.

- **A PAGE THIS MAC DID NOT FETCH OPENS PRIVATE SPACE ONLY FROM A PRIVATE
  HOST.** A browser's capture, or an import's link whose page failed, reaches
  private space for its covers and copy only when its host is a private address
  or a name no public resolver answers (`isPrivateUseName` in
  `packages/notes/src/items/host-names.ts`), since a public name's answer a
  moment later is its owner's to choose and the page's bytes came from wherever
  the browser loaded them.

- **THE FILL WORKER HAS NO NETWORK AND IS RETIRED WHEN IDLE.** A page's DOM, the
  extractor, turndown and the editor's fixpoint run in one worker thread that
  the first fill starts, idleness retires and a job past its 30 s replaces; it
  takes one job at a time, so a wedge or crash fails only that job. `fetch` is
  refused, nothing it imports reaches a socket, resolver or process
  (`apps/cli/src/server/items/capture/fill/no-network.test.ts`, and the build's
  `FILL_WORKER_REFUSED_BUILTINS`), and the host fetched every byte it reads
  through the guard. A page that breaks the extractor answers `failed`.
  Rejected: parsing on the server's thread (a hostile page stalls every request)
  and a worker kept for the process's life (a DOM held for nothing).
  `apps/cli/src/server/items/capture/fill-runner.ts`.

- **A MAC FILLS WHAT IT SAVED OR IMPORTED, AT ONCE; A FILL ONLY ADDS, NEVER
  WRITES `url`/`saved`, AND RENAMES ONLY AN UNTRACKED STUB OF ITS OWN.** Its
  `pending_fills` rows run two at a time, one per site, saves first, and survive
  a restart; another device's stub is that device's to fill
  (`apps/mobile/CLAUDE.md`), read here only for a Refresh or Keep a copy. A fill
  writes `FILL_OWNED_KEYS` and the body in one CAS write against the bytes it
  read. Rejected: adopting other devices' stubs (a second filler racing the
  first) and a JSON pending file. Residual: a stub left unread by a phone's
  sign-out or revocation, or a replaced database, waits for a Refresh.
  `apps/cli/src/server/items/capture/fill-queue.ts`, `fill-item.ts`.

- **A FAILED FILL IS SAID IN THE FILE**: `fetched` and a plain `fetch-error`
  sentence (`packages/notes/src/items/fill-sentences.ts`), with the waiting
  highlights placed in the same write; a transient failure is retried three
  times first. As `fetch-error` marks the text unread, and a refresh of unread
  text adds the article again, no failure lands on a read item: a copy too big
  to keep is only logged, a refresh or copy that cannot read the page again
  leaves the file and answers `unread`, and a fill on an unread item that
  another fill read meanwhile gives way, writing neither its failure nor a
  second file (`land` in `apps/cli/src/server/items/capture/fill-item.ts`).
  Rejected: a failed state in the database alone (the phone and another Mac
  would see a stub forever).

- **HIGHLIGHTS WAIT ONLY ON A STUB.** A refresh or copy of an item already read
  places none, and a selection added to one places only itself, since a
  highlight with no passage in a read item's text is one the person took out.
  `apps/cli/src/server/items/capture/fill-item.ts`.

- **A SAVE OF A URL THE LIBRARY HOLDS ADDS WHAT IT CARRIES** (tags, a selection
  as a highlight, a page copy) to that item and never rewrites its text (R22); a
  stub found to hold another item's url folds into it. A selection the item
  already holds is not added again, since the popup resends the page for Keep a
  copy. A copy is kept only for a link, a video or a song, as a refresh would
  refuse the rest, and one asked for mid-fill is made right after it, before its
  waiters hear. Rejected: answering `exists` and dropping the rest (the popup's
  Keep a copy and Save as a highlight did nothing on a saved page).
  `apps/cli/src/server/items/capture/capture.ts`, `fold-duplicate.ts`.

- **AN ITEM IS A STUB ONLY WHEN THE APP MADE IT** (`id` and `saved` present,
  `isItemStub` in `packages/notes/src/items/item-frontmatter.ts`), so neither a
  link note an opened folder already held nor a stub no row of this Mac's holds
  is ever filled unasked. A stub the person writes back through this Mac (a
  restore, an Undo) is this Mac's own again and gains a row, since its first row
  went with it (`adoptOwn` in `capture.ts`).

- **A COVER IS DOWNSCALED BY THE SYSTEM'S `sips` AND STORED BY ITS HASH**, at
  most 640 px, through one bounded queue, and off macOS a small raster passes
  through as it is. Rejected: sharp (a native module per arch inside the .app).
  `apps/cli/src/server/media/image-downscale.ts`,
  `apps/cli/src/server/items/capture/cover.ts`.

- **A PAGE COPY IS OPT-IN, SINGLE-FILE, SCRIPT-FREE AND SERVED SANDBOXED.** Its
  stylesheets, fonts and pictures are fetched under the page's own reach and
  inlined; its scripts, frames, handlers and base are dropped, its links
  disarmed, and a meta policy loads nothing. It is bounded in bytes, requests
  and time (`page-copy.ts`), and the server's thread reads its stylesheets' urls
  in one forward pass, since a backtracking pattern over a hostile sheet holds
  every request for minutes (`css-urls.ts`). Rejected: a copy on every save
  (about 300 saves fill the hosted library) and single-file-core (AGPL).
  `apps/cli/src/server/items/capture/page-copy.ts`,
  `apps/cli/src/server/items/capture/fill/copy-page.ts`,
  `apps/cli/src/server/vault/page-copy-route.ts`.
