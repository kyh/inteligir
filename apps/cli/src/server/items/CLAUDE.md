# Decisions: items (apps/cli/src/server/items)

Saving links, pages and files as items, and filling a saved link from its page.
`AGENTS.md` § Decisions says how a bullet is written and cited.

## Items: capture and fill

- **ONE GUARDED DIAL FOR EVERY SAVE.** Every page, cover, oEmbed answer and
  page-copy resource is fetched through `createGuardedFetch`, whose lookup hook
  vets EVERY address an answer holds (node's `autoSelectFamily` tries them all)
  and hands the socket only that vetted list, so nothing resolves twice; an IP
  literal is vetted before the dial, since node skips the lookup for one; an
  IPv6 address that carries an IPv4 one (mapped, compatible, translated, NAT64,
  6to4, Teredo) is judged as that address; every redirect hop (at most five) and
  every subresource is checked again; a compressed body is decoded through
  `pipeline`, so a body cut off or held past the deadline ends the read. This Mac (and `localhost` by name, before
  any lookup), link-local and reserved space are refused, so is the server's own
  port on any address, and so is an answer mixing private and public addresses;
  an address one of this Mac's interfaces holds that would read as public (its
  global IPv6, a public IPv4 it was handed), read again at every hop, is this
  Mac's too, while its private ones stay private space; private space is
  reachable only from a saved address that is itself private, the first hop
  deciding. A page this Mac did not fetch (the browser's capture, an import's
  link whose page failed) opens private space for its covers and copy only when
  its host is an address in private space or a name no public resolver answers
  (one label, `.local`, `.home.arpa`, `.internal`, `.lan`, …), since a public
  name's answer a moment later is its owner's to choose and the page's bytes
  came from wherever the browser loaded them (`isPrivateUseName` in
  `address-guard.ts`). A lookup gives up when the request's deadline or its
  caller's signal fires, and a stopped request asks for none. No env var widens
  it: a suite injects the lookup, the policy or the whole fetch
  (`CapturePorts`), and the guard's own suite this Mac's addresses. Rejected: pre-resolving then
  `fetch()` (a rebinding window), undici (a new dependency for the same hook),
  and the LAN open to any page (a public page could then redirect the Mac at the
  router or at a service bound on this Mac's own address, which browsers'
  Private Network Access refuses).
  `apps/cli/src/server/items/capture/guarded-fetch.ts`,
  `apps/cli/src/server/items/capture/address-guard.ts`.

- **THE FILL WORKER HAS NO NETWORK AND IS RETIRED WHEN IDLE.** A page's DOM,
  the readable-content extractor, turndown and the editor's fixpoint run in one
  worker thread that the first fill starts, a minute idle retires and a job past
  30 s replaces; the runner hands it one job at a time, as it reads them, so a
  job's 30 s are its own and the jobs behind one that wedged or crashed it go to
  a fresh worker rather than failing with it; `fetch` is refused before any job
  runs, nothing the entry reaches imports a socket, a resolver or a process
  (the suite walks its imports here and the build reads the bundle's own,
  `FILL_WORKER_REFUSED_BUILTINS` in `apps/cli/scripts/build.ts`), and every
  byte it reads the host fetched through the guard.
  A page that breaks the extractor answers `failed` rather than taking the
  thread down, and a page nested past 256 elements skips the extractor for the
  text rung. Rejected: parsing on the server's own thread (a hostile page's
  parse would stall every request) and a worker kept for the process's life (a
  DOM held for nothing). `apps/cli/src/server/items/capture/fill-runner.ts`,
  `apps/cli/src/server/items/capture/item-fill-worker.ts`,
  `apps/cli/src/server/items/capture/fill/no-network.test.ts`.

- **A SAVED PAGE IS THE EDITOR'S OWN FIXPOINT.** The article is converted down a
  ladder (rich, plain, text) and the first rung the editor's
  `canonicalizeImported` calls canonical with at least 97% of the converted
  letters kept is written, so an item opens rich and its first edit is a minimal
  diff; a page's `{{x}}`, `@2026-01-02`, `%%`, `:::`, `$$`, `[[x]]` and raw tags
  are escaped so they stay text, and a code block that names one of the
  dialect's own fences (`@repo/notes/markdown/fence-langs`) as its language
  keeps its code and loses the name, so a page never writes a runnable block. Rejected: defuddle's markdown, Plate's
  `deserializeHtml`, and canonicalizing on first open.
  `apps/cli/src/server/items/capture/fill/extract-page.ts`,
  `apps/cli/src/server/items/capture/fill/html-to-markdown.ts`.

- **A MAC FILLS WHAT IT MADE AT ONCE, A PHONE'S STUB WITHIN A MINUTE AND ANOTHER
  MAC'S AFTER 15 MINUTES; A FILL ONLY ADDS, NEVER WRITES `url`/`saved`, AND
  RENAMES ONLY AN UNTRACKED STUB OF ITS OWN, BEFORE IT WRITES.** This Mac's own
  rows (its saves, `own`, and its import's, `import`) run at once, two at a
  time and one per site, a save and a phone's share ahead of an import and
  another device's stubs, and each site's rows waiting behind its own first, so
  a save made during an import of thousands starts at the next free slot. Only
  a library that syncs with the account's hosted vault fills another device's
  stubs (`syncsWithAccount`), since there they are the person's own devices'
  and anywhere else a stub-shaped note is just a file the folder held. A phone
  stub is one whose adding commit the Worker made (`creatorOf`), since no Mac
  holds it in a pending store; it waits 0 to 60 s, shuffled by a per-install
  seed so two Macs rarely race, and its own address decides its reach as an own
  save's does; another Mac's waits 15 minutes and is read under public reach,
  so a stub this Mac did not make never leads it into private space. One such
  fill runs at a time,
  syncs before it fetches (and drops a stub the sync filled) and commits and
  syncs after it writes, so a second Mac rarely enriches it, and the url-item
  verdict settles the rare double. The sweep that finds them polls every 10 s,
  since the capture's index port carries no settle event. A fill writes only
  `FILL_OWNED_KEYS` and the composed body in one CAS write against the bytes it
  read, follows an item that moved by its id, never removes a key the page did
  not give, and renames a provisional, untracked stub of this Mac's to the
  page's title before that write, with no alias. The pending fills are rows of
  the vault's own database (`pending_fills`), written per transition; transient
  failures retry after 1, 10 and 60 minutes, a fill still running after five
  minutes is stopped and retried on that schedule, so a dial that never ends
  holds no slot, and a restart picks every row up.
  Rejected: a claim through the dispatch inbox (a new /cloud protocol), filling
  every pending stub at boot, a 15-minute wait for a phone's share (it has no
  other filler), and a JSON pending file (rewritten whole on every transition of
  an 8,500-item import). A copy the person asks for of another device's stub
  makes that row due at once, still syncing first, and is made as a refresh
  would make it when another device filled the stub meanwhile, so the copy
  never rides on a row that drops. `apps/cli/src/server/items/capture/fill-queue.ts`,
  `apps/cli/src/server/items/capture/pending-fills-store.ts`,
  `apps/cli/src/server/items/capture/fill-item.ts`,
  `apps/cli/src/server/items/capture/link-fill.ts`.

- **A FAILED FILL IS SAID IN THE FILE**: `fetched` and a plain `fetch-error`
  sentence, and the waiting highlights placed under `## Highlights` in the same
  write. Highlights wait only on a stub: a refresh or a copy of an item already
  read places none, and a selection added to one places only itself, since a
  highlight with no passage in a read item's text is one the person took out; a transient failure (offline, a timeout, 429, 503) is retried three
  times before the fourth is written. A copy too big to keep is only logged,
  since `fetch-error` marks the text unread and a refresh would add the article
  twice; for the same reason a refresh (or a copy) of an item already read that
  cannot read its page again leaves the file as it is and answers the failure
  (`unread`), and a fill that began on an unread item gives way when another
  fill read the page while it ran, writing neither its failure nor a second
  file at the link (`land` in `apps/cli/src/server/items/capture/fill-item.ts`). Rejected: a failed state in the database alone (the phone and
  another Mac would see a stub forever). `apps/cli/src/server/items/capture/fill-sentences.ts`.

- **A SAVE OF A URL THE LIBRARY HOLDS ADDS WHAT IT CARRIES** (tags, a selection
  as a highlight placed in the text or under `## Highlights` when the passage is
  gone, a page copy) to that item and never rewrites its text (R22); a stub that
  turns out to hold a url another item holds folds into it. A selection the
  item already holds as a highlight is not added again (the popup sends the
  page again, selection and all, for Keep a copy of the page); a copy asked for
  while the item's first fill is under way is made right after it, before its
  waiters hear; and a copy is kept only for a link, a video or a song, so a
  note or a file that carries the url keeps its own text, as a refresh would
  refuse it. Rejected: answering `exists` and dropping the rest, which made the popup's "Keep a copy of the
  page" and "Save as a highlight" on a saved page do nothing.
  `apps/cli/src/server/items/capture/capture.ts`,
  `apps/cli/src/server/items/capture/fold-duplicate.ts`.

- **AN ITEM IS A STUB ONLY WHEN THE APP MADE IT** (`id` and `saved` present,
  `isItemStub` in `packages/notes/src/items/item-frontmatter.ts`), so a link
  note an opened folder already held is never filled unasked; and since a
  folder's files can say anything, a stub no row of this Mac's holds is filled
  only in a library that syncs with the account, never under private reach
  unless the account's Worker made it. A stub the person writes back through
  this Mac (a restore from Deleted or History, an Undo) is this Mac's own again
  and gains an own row (`adoptOwn` in `capture.ts`, from the vault's write
  route and the turn's Undo), since its first row went with it.

- **A COVER IS DOWNSCALED BY THE SYSTEM'S `sips` AND STORED BY ITS HASH**: at
  most 640 px, a picture with transparency kept PNG and the rest JPEG at 80, a
  picture under 200 px skipped, two `sips` at once and 64 waiting, and off macOS
  a raster under 1 MiB passed through as it is. Rejected: sharp (a native module
  per arch inside the .app). `apps/cli/src/server/media/image-downscale.ts`,
  `apps/cli/src/server/items/capture/cover.ts`.

- **A PAGE COPY IS OPT-IN, SINGLE-FILE, SCRIPT-FREE AND SERVED SANDBOXED.** Its
  stylesheets, fonts and pictures are fetched under the page's own reach and
  inlined as data, its scripts, frames, handlers and base dropped, its links
  disarmed, and a meta policy loads nothing; over 10 MiB it drops fonts, then
  the largest pictures. It asks for at most 64 stylesheets, 64 they import and
  400 pictures and fonts, and nothing more once its 45 s are up. The server's
  own thread reads up to 3 MiB of the page's stylesheets for the urls they
  name, so that reading is one forward pass with no backtracking pattern
  (`css-urls.ts`), since a backtracking pattern over a hostile sheet holds
  every request for minutes. Rejected: a copy on every save (about 300 saves fill the
  hosted library), and single-file-core (AGPL).
  `apps/cli/src/server/items/capture/page-copy.ts`,
  `apps/cli/src/server/items/capture/fill/copy-page.ts`,
  `apps/cli/src/server/vault/page-copy-route.ts`.
