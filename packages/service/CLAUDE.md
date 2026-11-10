# Decisions: @repo/service and the cloud

Accounts and their sessions, `/v1`'s one wire, each account's library cell
with its SQL, undo and search, the fill, the connector with its OAuth and its
tools, and each conversation with the built-in agent: the cloud's code, which
`apps/web`'s Worker serves and deploys. `AGENTS.md` § Decisions says how a
bullet is written and cited.

## Shape

The service runs on workerd alone: no DOM, no node or react import
(`oxlint.config.ts`), and the library model's modules here (`src/library/`'s
SQL and undo, `src/knowledge/`, `src/items/`, `src/imports/`, `src/text/`)
take no `crypto` or `URL` global, the clock, random bytes and fresh ids
injected. Its doors are fetch-shaped functions `apps/web`'s server routes hand
a request to (`packages/service/src/doors.ts`), its Durable Objects the ones
`apps/web`'s entry exports, and the cell's SQL its Durable Object's own SQLite,
through drizzle's durable-sqlite driver and the raw port beside it
(`packages/service/src/library/cell-storage.ts`), so every suite that reaches
it runs in workerd. The model it keeps is `@repo/contract`'s
(`packages/contract/CLAUDE.md`), the markdown it reads and writes
`@repo/editor`'s codec, and its schemas `@repo/db`'s
(`packages/db/CLAUDE.md`).

## Accounts and sessions

- **THE ACCOUNT'S DEVICES ARE ITS SESSIONS, IN ONE LIST ANY OF THEM READS AND
  ENDS**, so Settings › Account, in the library's page, a browser tab or the
  Mac app's window, removes a lost phone with no password asked, as a sign-out
  asks none. A session is listed from Better Auth's own row, named at read
  time from the user agent it signed in with, its token never selected; ending
  one by its id goes through Better Auth's adapter, so its
  `session.delete.after` closes its sockets, and an id the account does not
  hold is `NOT_FOUND`. The list marks the session asking as This device, and
  that row offers no Sign out: this device leaves through a sign-out, which
  on the phone asks before it drops a save still waiting. Rejected: Better
  Auth's own list and revoke routes (each hands a session's token to the
  page); a device-name column (a second spelling of what the user agent
  already says); a devices page on the site beside Settings (a second list of
  one account's devices).
  `packages/service/src/wire/account-router.ts`,
  `packages/service/src/auth/session-devices.ts`,
  `apps/web/src/library/settings/account-section.tsx`.

- **A DEVICE SIGNS OUT THROUGH BETTER AUTH'S OWN `/api/auth/sign-out`, AND NO
  UNREACHABLE CLOUD HOLDS THAT SIGN-OUT OPEN.** The phone takes its copy away
  first and only then signs out, unawaited once its Expo client has let the
  Keychain's session go, and a phone whose copy would not go keeps the
  session, still the account's; a sign-in it could not keep is signed out the
  same way. Settings › Account in a tab, the Mac app's window among them, goes
  the other way, since a tab holds nothing to drop: the sign-out ends the
  session and clears its cookie first, so it needs a connection, and the tab
  wipes once the cloud has answered. A session no sign-out reached stays
  listed until another device ends it, the cap retires it or it lapses.
  Rejected: forgetting the session alone (its row stays live in the list and
  against the cap, a bearer nobody ends); signing out before the wipe on a
  local drop (a failed wipe left a library on a dead session, whose edits
  nothing could send). `apps/mobile/src/lib/compose-runtime.ts`,
  `apps/mobile/src/login/login-store.ts`, `apps/mobile/src/auth/phone-auth.ts`,
  `apps/web/src/library/settings/account-section.tsx`,
  `apps/web/src/library/cloud/auth-client.ts`.

- **AN ACCOUNT IS DELETED FROM ANY SIGNED-IN DEVICE, THE PASSWORD ASKED AGAIN,
  THROUGH BETTER AUTH'S `deleteUser`** (owner decision: whoever lost their Mac
  deletes from any Mac). The call hands `deleteUser` the password in its body,
  which it checks against the account in place of the session's freshness,
  under the session the call came with, by whichever door; its `beforeDelete`
  and tombstone are the ONE purge path, and Better Auth's delete routes, which
  settle for a fresh session, are shut. Success drops what this device holds of
  the library and forgets the sign-in; after an unanswered deletion, a retry
  meeting only its session's refusal means the account is gone. Rejected: a
  second purge path (it drifts); deleting by session alone (a stolen one ends
  the account). `packages/service/src/auth/delete-account.ts`,
  `packages/service/src/wire/account-router.ts`.

- **Better Auth's `baseURL` is derived per-request from the request origin, and
  sign-up is invite-gated by a Worker route in front of it.** Every hostname
  reaching this Worker is the deployment's own
  (`packages/service/src/auth/auth.ts`); revisit if one it does not control
  arrives. Rejected: a fixed fallback (it mints reset links at the wrong
  deployment). The gate is one door, `POST /api/sign-up`, which the site's form
  and the phone's first run both post: one atomic claim, behind a per-address
  window, that a sign-up making no account releases; every other auth instance
  keeps sign-up off.
  `packages/service/src/auth/invite.ts`, `packages/service/README.md` § Auth.

- **ONLY BETTER AUTH'S OWN READ SLIDES A SESSION, AND A TAB MAKES IT ON THE
  HOUR.** A session's row and its cookie slide together or not at all, and only
  `/api/auth/get-session` answers the browser with that cookie, so a read of the
  Worker's own (`/v1`, the consent page) passes `disableRefresh`, and a tab left
  open reads its session hourly, its other calls renewing nothing. Rejected: a
  slide on `/v1` (the row outlives the cookie, and an open tab is signed out
  when its cookie lapses with its row standing); forwarding `Set-Cookie` on every `/v1`
  answer (each door, a file's immutable read among them, carrying a header none
  of them owns). `packages/service/src/auth/auth.ts`,
  `apps/web/src/lib/auth-client.ts`.

- **EVERY DEVICE SIGNS IN WITH BETTER AUTH'S OWN SESSION, AND `/v1` READS IT
  BY THE DOOR THE REQUEST CAME THROUGH** (owner decision: the extension rides
  the browser's sign-in). The site's page sends its cookie same-origin, the
  phone its cookie under `expo-origin`, Better Auth's Expo plugin's header,
  naming `PHONE_ORIGIN`, and the extension the browser's signed cookie value as
  a bearer, which the bearer plugin takes only signed; a request through none
  of those doors meets no cookie, and the session's door names its writes. A
  sign-in lasts 60 days, slid a day at a time, and the twentieth live session
  is the last: a sign-in past it ends the one used longest ago, in
  `session.create.before`, so its sockets close. Better Auth's answers never
  carry `set-auth-token`, since no client reads one, and a password reset signs
  every session out. Rejected: a credential of our own beside the session (a
  second secret, verifier, cap and list, which outlived the browser's
  sign-out); the bearer plugin unsigned (a leaked row's token would be a
  credential); `trustedOrigins` by pattern (a custom scheme matches
  by its authority, so the two exact origins are spelled out); a cookie cache
  (a revoked session would live on to its expiry); refusing the twenty-first
  sign-in (a lost phone would lock its person out).
  `packages/service/src/auth/auth.ts`, `packages/service/src/auth/session-devices.ts`,
  `packages/service/src/wire/v1-principal.ts`,
  `packages/service/src/library/library-principal.ts`.

## The wire

- **A /V1 CLIENT IGNORES WHAT IT DOES NOT KNOW, the Worker is held to exactly
  what it declares, and the wire breaks only behind the client build floor**
  (owner decision; the floor is EVERY INSTALL'S REQUEST NAMES ITS BUILD). The
  Worker parses every answer through its row's output schema, which strips
  what the row did not declare, and a client reads only the fields it names; a
  refusal is narrowed by its code, one a build does not know is no verdict on
  its session, and an error no row declares is a fault to retry, but for
  `BAD_REQUEST`, which says the call can never land as it is. Requests stay
  `z.strictObject`, since only the newest Worker reads them. A shape
  retires only once the floor passes every build reading it, and a field that
  changes what a row MEANS reaches only clients declaring it. Rejected: a wire
  final at birth behind strict readers (every addition a new row); per-row
  versions (every old shape kept). `packages/contract/src/v1-errors.ts`,
  `packages/contract/src/library/call-outcome.ts`.

- **EVERY INSTALL'S REQUEST NAMES ITS BUILD, AND THE WORKER REFUSES ONE BELOW
  THE FLOOR** (owner decision). The tolerant reader is forward negotiation only,
  so a request with no build or one below `MIN_CLIENT_BUILD` is refused,
  terminally and with the session left live, so the next build resumes signed
  in; a page the Worker served needs none, since it ships in the same
  deploy, and neither does a socket opened by ticket, since a browser socket
  sends no header and its ticket came from a call that met the floor.
  `packages/contract/src/client-build.ts`,
  `packages/service/src/client-floor.ts`.

- **`/v1` IS ONE oRPC WIRE, `/v1/rpc`, ITS REFUSALS DECLARED ONCE.** The
  Worker answers `account.*` on its own RPCHandler and forwards `library.*` to
  the account's library cell; both map codes with `V1_ERROR_STATUS_MAP`, a
  refusal is an `error()` factory, oRPC's own code where it means the same, and
  the floor, credential and budget the Worker meets before any procedure are
  answered in the same protocol. Every library write takes an `opId` the cell
  keeps; only a file's bytes and the sockets, the account's and each note's,
  stay plain HTTP under `/v1`, and the site's sign-up form posts beside Better Auth, under
  `/api`. Rejected: REST beside RPC (two serializers, two error vocabularies)
  and oRPC's default statuses (an unmapped code answers 400).
  `packages/contract/src/v1-errors.ts`,
  `packages/service/src/wire/rpc-refusal.ts`, `packages/service/src/doors.ts`.

- **A LIBRARY CALL REACHES ITS CELL WITH THE PRINCIPAL THE WORKER VERIFIED,
  AND NOTHING THE CALLER SENT IN ITS PLACE.** The Worker reads the session
  once a request, by the door it came through (EVERY DEVICE SIGNS IN WITH
  BETTER AUTH'S OWN SESSION), and a bearer that fails is refused, never retried
  as the cookie. It drops the request's `x-library-principal`, `authorization` and `cookie`,
  stamps the principal and forwards the request whole by `stub.fetch()`; the
  cell refuses one naming another account. Rejected: the cell verifying the
  session (a second verifier, a D1 read inside every cell call); a stub
  method per procedure (oRPC's handler takes a request).
  `packages/service/src/wire/v1-rpc.ts`, `v1-principal.ts`,
  `packages/service/src/library/library-principal.ts`, `library-do.ts`.

- **EVERY PAGE THAT CALLS `/v1` IS ONE THE WORKER SERVED, SO IT ANSWERS NO
  CORS.** The site's page and the Mac app's window call on their own
  origin, the phone is no browser, and the browser extension's worker calls
  the site under its host permission, which needs none (ACTIVETAB AND THE
  CLOUD'S SITE, in `apps/extension/CLAUDE.md`); the socket opens on a ticket.
  CORS added later lets no `expo-origin` through: the phone's cookie is read
  under that header, so a page allowed to send it would hold the phone's door.
  `vite dev` answers no preflight of its own, so the Worker answers as
  deployed. Rejected: CORS for the extension's origin (its host permission
  already reaches the site, and an allowed origin is one more door to keep); a
  reflected origin (any page could read what a cookie opened).
  `packages/service/src/wire/v1-principal.ts`, `apps/web/vite.config.ts`.

- **THE APPS READ WHAT THEY SHOW FROM THE CELL, THROUGH ROWS NO TOOL CARRIES.**
  `library.items.get` answers an item whole, its fields and every block, one in
  Deleted included; `library.listing.page` a page of a screen's listing,
  `scopes` the rail's counts and `titles` every live item a note's links resolve
  against, each over the in-memory listing
  (`@repo/contract/library/library-index`), built over the cell's rows for the one
  read. A listing's words search the query's side, the library or Deleted,
  through the agent's own search: the ranked index, then the live items holding
  the exact text it misses, a person's typing its set has not sealed into the
  index among them. A folder write answers each folder it changed, as it left
  it. Rejected: tool meta on these rows (an assistant reads through
  `items.list`, `items.read` and `search`, and a page of cards would only fill
  its context); SQL
  listing queries (a tag family and a folder tree read from memory without a
  join a page); a search of the apps' own beside the agent's (two rankings of
  one library).
  `packages/service/src/library/cell-listing.ts`, `library-router.ts`.

## The library cell

- **THE ACCOUNT'S SOCKETS ARE ITS LIBRARY CELL'S, EACH TAGGED WITH THE HOLDER
  THE WORKER VERIFIED.** The cell accepts each hibernating socket under the
  session the Worker stamps on the upgrade, on one exact path
  only `socket-routes.ts` forwards to; every other forwarded call has any holder
  header dropped, and a path the cell does not know is a 404, so no other
  credential reaches that door. A committed write sends every socket a `moved`
  frame naming what it moved: each item at its sequence, whether the folders
  moved, each thread, a list past `MOVED_IDS_MAX` ids saying `all`,
  and an alarm's import run saying `all` of each; a client refetches what it
  shows of those, and everything on a reconnect, since a frame missed while away
  is gone. Every client's socket opens on `/v1/socket` with a minute's HMAC ticket a
  `/v1` call minted, since a browser's sends no header, its holder checked in D1
  again; that check is the upgrade's alone, read before the cell accepts and
  once more after, since a sever closes only sockets already accepted, so
  every session's end (a sign-out, another device's end of it, the cap, a
  password reset) closes that holder's sockets.
  Rejected: a socket object beside the cell (every ping crossing to it); the
  bearer in the URL (it outlives a minute in any log); a bearer on the upgrade
  for the clients that can send one (a second door to keep); the upgrade as the
  cell's default answer (any path it did not match became a socket); the rows
  themselves in a frame (a dropped frame would be a lost write); a frame per
  landed row (an import's run would send thousands).
  `packages/service/src/library/cell-sockets.ts`, `cell-moved.ts`,
  `socket-ticket.ts`, `socket-routes.ts`.

- **EACH ACCOUNT'S LIBRARY IS ONE SQLITE DURABLE OBJECT, `LibraryDO`, REACHED
  ONLY THROUGH `ctx.exports` UNDER A NAME A VERIFIED CREDENTIAL OR ITS OWN CELL
  GIVES.** Naming an object creates it, so `library:<userId>` comes from a
  credential the Worker verified, from a fill message, which only the account's
  cell writes, from its own `ctx.id.name`, onto a queue only this Worker
  produces to, or from a conversation's own name, which names its cell back,
  and a conversation's `agent-thread:<accountId>:<threadId>` from its cell
  alone, for a thread its rows hold; `apps/web/cloudflare.config.ts` declares
  `LibraryDO` and `AgentThreadDO` in `exports` with SQLite storage and binds no
  namespace, and each item's `NoteDO` likewise (EACH NOTE'S BODY IS A LIVE
  DOCUMENT IN AN OBJECT OF ITS OWN); `ThreadSyncDO`, `RepoCell` and `Registry` are each a
  `state: "deleted"` tombstone, kept until a deploy's answer lets it go
  (`docs/releasing.md` § 5). The cell migrates its schema as it wakes (THE
  CELL'S SCHEMA IS DRIZZLE'S, in `packages/db/CLAUDE.md`). Rejected: a namespace binding (anything holding `env` could name any
  cell); the cell under a deleted class's export name (nothing documents a
  preview refusing a new class); signing the fill message (no other producer exists to forge one).
  `packages/service/src/library/library-do.ts`,
  `library-cell.ts`, `cell-db.ts`, `packages/service/src/fill/fill-job.ts`.

- **A LIBRARY WRITE CHANGES FIELDS ALONE, ONLY ON THE BASES IT NAMES, IN ONE
  TRANSACTION.** `library.write` carries field ops, each naming the value it
  was computed from (a list merges as a set), and the cell lands them in one
  `transactionSync` only while each base holds, else answers `CONFLICT` with
  each moved field as it is; a body is its note's, written live, and an edit
  by passages goes through the note (AN EDIT BY PASSAGES GOES TO THE NOTE BY
  BLOCK ID). Rejected: block ops on the wire beside the live document (two
  writers of one body, and a diff3 to settle them); a whole-item base (two
  devices always conflict); last write wins (an edit lost unseen).
  `packages/service/src/library/library-engine.ts`, `cell-landing.ts`,
  `cell-writes.ts`.

- **A CHANGE SET SEALS BY THE CELL'S ONE ALARM, AND UNDO REACHES BACK SEVEN
  DAYS** (owner decision). Each actor's set seals by its policy when its `jobs`
  row comes due. A set's after for an item is written once another set is
  about to change the item or the set seals, so it is the item as that set
  left it however the seals interleave. Seven days after a set closes the prune
  drops it, and then every part and file only it named, and each note drops
  the turn's log it kept, so
  what Undo keeps of the library is a week of its changes. Rejected: a timer
  per set (eviction loses it); each seal's own after (a late seal outranks a
  newer state); a revision of the item per set to browse (the spec keeps no
  page history, and Undo needs only a set's before and after); keeping sets
  until the item is purged (an often-edited item would keep every keystroke's
  block forever).
  `packages/service/src/library/change-sets.ts`, `cell-actor.ts`,
  `change-set-prune.ts`.

- **UNDO RUNS A CHANGE SET'S FIELDS BACKWARDS THREE WAYS, AND EACH NOTE
  TAKES ITS TURN BACK FIRST.** `@repo/service/library/revert-change`: the set's
  after is the base, the item now is mine, its before is theirs, field by
  field, and an overlap keeps the item whole and named. What an agent's set
  wrote in a note's body that note takes back before the fields' write,
  outside any transaction, as a forward edit from the turn's stored log
  (`packages/service/src/note/turn-log.ts`), so every later edit, a person's
  typing inside the agent's own words included, stays; a turn whose added
  block someone typed in says it took their text (`lostText`). An item the set
  made goes to Deleted unless a person's part changed since (a fill is not a
  person), told by each fill's own change set and by whether anyone but an
  agent wrote in its note. Sets undo newest first. Rejected: a three-way merge
  of the body (a live document already merged it); Yjs's UndoManager (it lives
  in memory, which an eviction ends); a list of the fields a fill owns (it
  drifts from what a fill writes, and a title is a fill's on an unread link
  and a person's after). `packages/service/src/library/revert-change.test.ts`,
  `packages/service/src/library/cell-undo.ts`,
  `packages/service/src/note/note-live.test.ts`.

- **EACH NOTE'S BODY IS A LIVE DOCUMENT IN AN OBJECT OF ITS OWN, WHICH THE
  CELL SEEDS AND READS BACK** (owner decision). `NoteDO`, a y-partyserver
  `YServer` named `note:<accountId>:<itemId>` by `note-stub.ts` alone, which
  only the account's cell, its purge and the note's door and object import
  (`oxlint.config.ts`), keeps its Yjs state in its own SQLite, every update
  stored in the event that took it, so the output gate holds the broadcast
  until the row commits. Its first load reads the body the cell kept, a seed
  until then, persists it, then confirms, so an abort in between loses
  nothing and a note the cell says already took its body never seeds over
  it; each debounced save (1 s, at most 5 s) folds the rows into a snapshot
  and pushes the body's projection, which lands the card, the index, the text
  and the links only over an older version and joins no change set. Every
  call that reads the document starts the server itself, since an eviction
  between two calls hands the next a fresh instance; the cell awaits a note
  only between its `transactionSync` blocks, never inside
  `blockConcurrencyWhile` or an async transaction, since a cold note's load
  calls back into it (`oxlint.config.ts`). One alarm backs every deadline. A
  note past 1 MiB an update or 8 MiB whole turns read-only and says why;
  presence is off, its frames dropped; two devices moving one block at once
  leave one copy. Deleted, a note takes no edit; purged, it is emptied by the
  cell's alarm and closes every socket for good. Rejected: block rows merged
  by diff3 (every device a merge to settle); the note in the cell (every
  keystroke through the account's one object); Yjs 14 (a beta
  `@slate-yjs/core` predates). `packages/service/src/note/note-do.ts`,
  `packages/service/src/library/cell-notes.ts`,
  `packages/service/src/note/note-live.test.ts`.

- **A NOTE'S SOCKET OPENS THROUGH ITS DOOR ON THE ACCOUNT SOCKET'S TICKET, AND
  THE CELL SAYS HOW.** `/v1/notes/<itemId>` reads the ticket and the holder's
  standing as `/v1/socket` does, asks the cell how that session's socket opens
  (writable, read-only for an item in Deleted, or closed at once with 4404 for
  one the library does not hold, since a browser shows a failed upgrade to no
  page), records it so the session's end closes it, and forwards a fresh
  upgrade carrying only the holder and mode it verified. Rejected: a ticket per
  note (a second credential for the same session); the note reading the
  client's headers (a forged mode would write in Deleted).
  `packages/service/src/note/note-routes.ts`,
  `packages/contract/src/library/library-socket.ts`.

- **AN EDIT BY PASSAGES GOES TO THE NOTE BY BLOCK ID, OUTSIDE ANY TRANSACTION.**
  The cell reads the note's blocks, the codec answers the edit as changes by
  block id, and the note applies them through a headless editor bound to its
  document under the writer's origin, an agent's logged around its update
  under the turn's change set; a block someone changed since the read is read
  again once, then refused with the block as it is. The write that follows
  re-checks the op, the item and the turn, and lands the note's whole answered
  projection only when it is newer. Rejected: a base sequence on the edit (a
  person typing anywhere in the note refused every edit); landing the
  version alone (the note's next push would be stale and the edit's words
  never reach the index). `packages/service/src/library/cell-edits.ts`,
  `packages/service/src/note/note-do.ts`.

- **AN ACCOUNT'S DELETION RUNS IN ITS CELL, THE TOMBSTONE FIRST AND THE
  SESSIONS LAST.** Better Auth's `beforeDelete` asks the cell to purge, step
  by step, each step idempotent, so a failure aborts the deletion and the retry
  runs from the top on a session still live; Better Auth deletes the sessions
  with the user once the purge is done. The tombstone outlives the deletion, so
  a call verified a moment before meets it rather than founding a library
  nobody reaches. Rejected: sessions first (a failed step leaves no device to
  retry from); a bare `deleteAll` (an in-flight write rebuilds the cell).
  `packages/service/src/library/account-purge.ts`,
  `packages/service/src/auth/auth.ts`.

- **A FILE ROW NEVER NAMES AN OBJECT R2 NO LONGER HOLDS, AND R2 KEEPS NOTHING
  THE CELL REFUSED OR NOBODY SETTLED.** Such an upload becomes a stray, a job
  the alarm runs between two transactions to delete it from R2; while it waits
  a settle of that sha lands nothing, and so does one that read R2 before a
  removal ended, by the count of removals it read first. Rejected: deleting
  right after the refusal (a settle landing meanwhile names a deleted object);
  keeping strays (the 1 GiB cap would not bound R2).
  `packages/service/src/library/cell-blobs.ts`, `cell-library.ts`.

- **THE CELL IMPLEMENTS EVERY LIBRARY ROW ONCE, OVER ITS ENGINE AND THE
  MARKDOWN CODEC.** `implement(libraryTools)`: a write lands in one transaction
  joined to its principal's change set, a body's edit after its note answered, an agent's markdown is read and edited
  through `@repo/editor/codec/*`, a saved link or a refresh lands pending for
  the cloud's fill, and every answer is parsed through its row's output schema,
  which strips what the cell did not mean to send (about 10 ms a MiB of plain
  blocks, 45 for a table-dense one, measured). What that markdown names, the
  cell answers from its own rows (`libraryLinks`): a page link's id an item it
  holds, a `[[Title]]` the one live item it names by title or alias, and an
  `assets/<sha>` a file it holds; anything else stays the text it was, on a
  create and an edit alike. Rejected: a second markdown reader in the Worker;
  skipping that parse for speed (a leaked column ships unnoticed); linking a
  title two items share to either (the agent's words would land on a guess).
  `packages/service/src/library/library-router.ts`, `library-engine.ts`,
  `cell-codec.ts`.

- **A FILE'S BYTES ARE R2'S, ADDRESSED BY THEIR SHA, AND R2 CHECKS IT.** A
  `PUT /v1/blobs/<sha>` takes room in the cell at the length it declares, at
  most 100 MB, streams into `BLOBS` with `sha256`, so R2 keeps nothing that
  hashes otherwise, and settles the row at the size R2 holds. Only R2's own
  checksum refusal answers 400, which a device parks for good; any other failed
  put answers 500, which it sends again on its doubling wait, since R2 said
  nothing of the bytes. A read hands R2
  the request's range and preconditions: 206 from `object.range` for any single
  range, one spanning the file included, 416 for one past the end, a
  multi-part ask whole, 304 and 412; every file but a PDF is served under a
  script-less sandbox. An app's read, by any door but the site's own page,
  answers `no-store`, since it keeps what it reads where a sign-out empties it,
  and an HTTP cache under it would hold those bytes and the credential past
  that; the site's page answers immutable. A file's row is the cell's alone: a device asks for a
  file by the sha an item's row names, and takes its type from the answer.
  Rejected: a byte-range parser of our own (R2 parses the header); a signed
  URL (a credential in a logged address); a file's row synced to every device
  (nothing there reads it). `packages/service/src/library/blob-routes.ts`.

- **A SAVE OF A URL THE LIBRARY HOLDS ANSWERS THAT ITEM AS IT STANDS.** One
  url, one item: a save whose `urlKey` a live item holds writes nothing and
  answers that item with `created: false`, its tags, folder and note left
  behind, so tagging, filing or adding to it is organize's and the
  editor's. The one write is a device's read of a page whose item has no
  article yet, its reading waiting or failed: the read lands on it as a reading
  does, its article and the fields a fill owns, and nothing else of the save.
  Rejected: merging the save into the item (two writers of one item's tags,
  folder and note); answering `exists` (a refusal for what is a success).
  `packages/service/src/library/cell-saves.ts`.

- **AN IMPORT IS A CELL JOB RUN A PAGE AT A TIME, ITS PLAN IN ROWS.**
  `library.imports.start` names a file the device uploaded, and each alarm run
  does one page (a hundred bookmarks, fifty notes or 512 KiB of their markdown,
  64 MiB of the zip, or ten seconds waiting on R2) in transactions that move
  the job's cursor with what they land. A run is counted before it starts, so
  one the platform ends counts, and five in a row that move nothing stop it. A
  note past 1 MiB is left out (reading costs about 11 s of CPU a MiB,
  measured), and so is an entry or bookmark past a plan row (`fitsImportRow`,
  since a row the platform refuses would stop the import). Pass one puts every
  file in the library, the plan is made once, then the notes and the files no
  live item names land in one change set. A note whose id or address a live
  item holds is counted, and one whose item sits in Deleted brings that item
  back as it stands. Rejected: one run per import (an alarm's 30 s of CPU);
  counting a run in its catch (the platform's kill skips it); a fresh item
  beside one in Deleted (one id names one item, and its twin would stay in
  Deleted).
  `packages/service/src/library/cell-imports.ts`,
  `packages/service/src/library/cell-import-markdown.ts`.

- **A FILE IS LET GO ONCE NOTHING NAMES IT OR WILL.** A file stays while an
  item names it or any change set does, and `change_set_blobs` keeps which files
  each fields part names, so the ask is one lookup. A file
  that lands, or that an item stops naming, waits a day under an `unnamed`
  job, which an item naming it drops; a purge, or a prune dropping the last
  change set naming it, hands it to the alarm's next run, since Delete forever
  frees room at once; an import that ends however it ended lets its files go, a
  reading that lands nowhere hands its cover to the alarm's next run, and none
  goes while an import runs, whose plan may name it.
  Rejected: releasing by `refs` alone (a file only a change set holds would
  go); a sweep of rows with no refs (the same); searching the parts' JSON for
  the sha (a read of every part per file, whose CPU holds every write);
  releasing inside the purge (it cannot wait out a running import).
  `packages/service/src/library/cell-blobs.ts`, `cell-parts.ts`,
  `change-set-prune.ts`, `cell-imports.ts`, `cell-fills.ts`.

- **FILING RULES ARE THE PERSON'S OWN WORDS, AND ONLY THE PERSON WRITES THEM.**
  They reach the agent as a system message, above anything a saved page or a
  note can say, so `library.agent.setRules` is their one writer: an import
  reads an `AGENTS.md` as a note like any other. The one file an import passes
  over is an `AGENTS.md` at the zip's root, below any folder `unwrapExport`
  takes off, that says exactly what the library's rules say, which it counts as
  already saved. An export of notes alone, zipped again under its
  folder, carries no mark of one, so it stays that folder and its rules a note
  there. A
  running conversation hears of a change at its next reply, and of a clearing
  too, in a system message of its own, since the rules it holds outlive the
  turn that sent them.
  Rejected: adopting a folder's rules while the library keeps none (a zip is
  anyone's text, and it would become instructions no person wrote); clearing by
  sending nothing (the old message replays on every call).
  `packages/service/src/library/library-rules.ts`,
  `packages/service/src/library/cell-import-markdown.ts`,
  `packages/service/src/agent/thread-loop.ts`,
  `packages/editor/src/codec/import-plan.ts`.

- **A QUERY ON A TABLE THAT OUTLIVES THE BLOCK ROWS IS DRIZZLE'S SYNC
  BUILDER, AND THE REST ARE PLANS.** Items, folders, tags, links, files,
  uploads, imports, jobs and `meta` are read and written through drizzle's
  `.all()`, `.get()` and `.run()` inside the cell's `transactionSync`, a
  multi-row insert cut by its table's width under a Durable Object's 100 bound
  parameters (`insertChunks`); seed blocks, change sets, snapshot
  parts, answered ops, threads, the agent's tables and the search index stay
  raw plans (`library-sql`), one statement yielded at a time under 100
  parameters and 100 KB. `library-queries` matches text with instr() and lays
  an item, its body and derived rows with it, only over an older `seq`.
  Rejected: SQLite's version pragma and pattern-match operators (a Durable
  Object refuses the one and caps the other at 50 bytes); SQLite's wasm build
  under node for the suites (a second engine, held to a Durable Object's
  limits by hand).
  `packages/service/src/library/library-queries.test.ts`.

## Fills

- **A SAVED LINK IS READ OFF THE FILL QUEUE, ASKED FOR IN THE WRITE THAT MADE IT
  WAIT.** The write lands a `fill` job row in its own transaction, and the cell
  sends it to `inteligir-fill` once the write commits; a row no send took is
  sent again by the alarm a minute on. The consumer reads a page only while its
  item still waits, asks again a page a later try may pass (30 s, doubling,
  three retries), and the dead-letter queue's consumer says the failure, so no
  link waits unread for good. A link in Deleted asks nothing, and the restore or
  undo that brings it back still waiting asks again. Rejected: sending inside
  the write (a reading asked for a write that rolled back); fetching on the
  cell's alarm (a page's seconds of CPU hold every write).
  `packages/service/src/library/cell-fills.ts`,
  `packages/service/src/fill/fill-consumer.ts`.

- **THE CLOUD'S FETCH IS THE PLATFORM'S, EACH HOP JUDGED BY HOW ITS ADDRESS IS
  SPELLED.** A Worker resolves no name, so `fetchPage` refuses any scheme but
  http and https, any port but a page's own, a name for this machine or one
  only a private resolver answers, and an address written out in private space
  (RFC 1918, loopback, link-local and metadata, CGNAT, ULA, an IPv4 one carried
  in IPv6) or in space no host holds, read from the one spelling the WHATWG
  parser gives it; a public address is asked like a name. It judges the saved
  address and every redirect alike, follows at most five, counts bytes as they
  arrive and gives the read 20 s; `global_fetch_strictly_public` sends even
  this zone through its front door. Rejected: a lookup first (the platform
  dials by name anyway); refusing every address written out (a public page's
  refusal said a private network it was not on); leaving it to the platform (a
  refusal said at once beats three vague retries).
  `packages/service/src/fill/page-fetch.ts`, `address-space.ts`.

- **A READING LANDS ONLY THE ARTICLE AND THE FACTS A FILL OWNS, AS ITS OWN
  CHANGE SET, ON AN ITEM STILL WAITING FOR IT.** `landFill` replaces the
  article, in the note once the body is its note's, once per reading by the
  fill's id, sets a fact only where the page gave one, renames only an item still named by its
  address, and never touches the note; an item deleted, read or readdressed
  meanwhile lands nothing, so a message met twice lands once. A page whose
  redirects end at another item's address is read into the item that waited
  for it, which keeps the address it was saved at. Rejected: bases the
  consumer read (a reading nobody edited around would conflict with every save
  meanwhile); folding it onto the item at the final address (a merge with an
  undo of its own); readdressing it to the final address (a page that
  redirects to its sign-in would be kept at the sign-in's address).
  `packages/service/src/library/cell-fills.ts`.

- **THE CLOUD KEEPS A PAGE'S COVER AS THE SITE SERVED IT, AND EACH DEVICE DRAWS
  ITS OWN THUMBNAIL.** The consumer keeps the first candidate that is really a
  picture of a cover's size whole, within `FILL_LIMITS.coverBytes` and
  `FILL_LIMITS.coverMaxPixels`, and decodes nothing. Rejected: a wasm thumbnail
  (a decoded picture is four bytes a pixel, 48 MB for 4000 by 3000, in an
  isolate whose heap the reading already uses; not measured); the Images
  binding (it bills every picture); a
  thumbnail made in the cell (its CPU holds every write). `packages/service/src/fill/read-page.ts`,
  `packages/contract/src/items/link-fill.ts`.

- **A LINK THE AGENT SAVES IS READ ONLY ONCE ITS TURN SEALS** (owner
  decision). Its fill row names the turn's change set and waits for the seal.
  Rejected: reading it at once (the agent could save a page, read it and act on
  it within the turn: a web reader it was never given).
  `packages/service/src/library/cell-fills.ts`.

## Search

- **Stemming is a SHADOW of the indexed text, never a rewrite of it.** Each of
  the four literal columns (title, headings, meta, body) has a stem shadow at
  equal bm25 weight, and `@repo/service/knowledge/search-query` owns the one
  policy every index runs. Every term asks both halves, and that OR is the exact
  tier: a doc holding the literal word scores about twice a stem-only hit.
  Rejected: FTS5's `porter` tokenizer (it stems the index, so a prefix query for
  a half-typed word stops retrieving, 86 of 1,555 labelled prefixes, and it puts
  half a shared policy in SQLite's C). Residual: the title/body gap is 10x, so a
  title collision still beats a body exact match. `search-query.ts`,
  `knowledge/search-excerpt.ts`.

## The connector

- **THE LIBRARY'S ROWS BECOME THE CONNECTOR'S TOOLS IN THE WORKER, BY META
  CHAINED ON THE CONTRACT'S OWN ROWS.** A tool row gets `.meta(openapi(…),
  mcp.tool(…))`: its name, title, description and the verb whose read-only and
  idempotent hints oRPC infers, then the hints no verb implies (closed-world
  but `save_link`, destructive where it changes what is there). A row without
  tool meta is no tool, and `library.history`'s rows carry none: Undo is the
  person's press under the built-in agent's turn, and what an assistant changed
  it changes back when asked. The cell implements the decorated contract while
  clients type against the plain one, held equal by a `*.test-d.ts`.
  Rejected: the meta in `@repo/contract` (every client would bundle MCP and
  OpenAPI; `oxlint.config.ts` refuses both outside `@repo/service`); a
  walker decorating by path (it rebuilds oRPC's internals); an assistant's own
  undo tool (with no listing it names no set, and an agent undoing a turn would
  undo it under the person).
  `packages/service/src/connector/library-tools.ts`.

- **THE CONNECTOR'S OAUTH IS `@cloudflare/workers-oauth-provider`'S, ON KV,
  NAMED FROM ONE ORIGIN PER DEPLOYMENT** (owner decision). The provider owns
  every OAuth surface, a registration spending its address's window first,
  since each is a KV record; `SITE_ORIGIN` names issuer and resource, never the
  request's Host, so one deployment's tokens open no other's. A grant is
  `library` or `library:read`, the person's choice, and the handler refuses a
  token holding neither: the provider advertises scopes but enforces none. A
  grant the person disconnected is a row in D1, written before the KV delete and
  read by the token exchange, every call and the account's list, since a refresh
  that read the grant before the delete writes it back after. Rejected: the MCP
  SDK's bearer middleware or an authorization server of our own (a second
  verifier to audit); the Host header (the workers.dev name and the domain would
  be two servers whose tokens refuse each other); the KV delete alone (KV has no
  compare-and-swap, and the provider's token check never reads the grant).
  `packages/service/src/connector/connector-auth.ts`, `revoked-grants.ts`,
  `apps/web/cloudflare.config.ts`.

- **THE CONSENT PAGE IS THE WORKER'S, AT `/connect/authorize`, OVER THE SITE'S
  SESSION.** It reads Better Auth's session, or sends the person to sign in or
  sign up and back, either returning by a document load since the site's router
  holds no such page; the provider parses the request, binds the form to the
  browser by a cookie and keeps the request server-side until the answer, so
  the form carries the account it named and an Allow from any other session is
  refused, since a browser can change accounts while the page stays open.
  The page runs no script (`default-src 'none'`, no framing), escapes every
  field a client sent, says where access is sent and warns of a loopback
  address, and asks to "read and change your library". Its route is a server
  route that hands the raw request to its door, as every door's is. Rejected:
  a Start page (the provider's helpers take the raw request, and the page would
  carry the site's bundle); remembering an approval (every connect asks);
  `form-action` (browsers disagree on whether it holds the 302 to the
  assistant's origin).
  `packages/service/src/connector/consent-route.ts`, `consent-page.ts`,
  `apps/web/src/routes/connect/authorize.ts`,
  `apps/web/src/routes/_site/app/sign-in.tsx`, `sign-up.tsx`.

- **THE CONNECTOR IS SERVED IN THE ACCOUNT'S CELL, A FRESH SERVER A REQUEST
  OVER ONE OF TWO REGISTRARS, ITS PRINCIPAL AN ASSISTANT'S.** The Worker
  refuses a Host or Origin not this deployment's, the provider checks the
  token, the grant spends its budget, and the request goes on whole by
  `stub.fetch`, stamped with an assistant's principal, which the cell takes
  only here. The read-only registrar holds the
  GET rows; each server is stateless, its tools/list private to the client,
  and it advertises no `listChanged`, since a grant's tools never change and a
  `subscriptions/listen` would hold the cell open. A JSON-RPC batch is refused,
  so a budget slot is one call. Rejected: a session object per client (state
  nothing needs); a registrar per request (it rebuilds the same schemas); an
  app's session here (the door is an assistant's); a slot per message of a
  batch (the Worker would read every body to count it); scopes on every
  principal (only a grant has a limit, and a read-only device would parse and
  still write).
  `packages/service/src/connector/connector-route.ts`, `connector-server.ts`,
  `packages/service/src/library/library-principal.ts`.

## The built-in agent

- **THE BUILT-IN AGENT IS OUR OWN LOOP, ONE `AgentThreadDO` A CONVERSATION,
  WOKEN BY THE AGENTS SDK'S LIFECYCLE** (owner decision: the Agents SDK, Claude
  through AI Gateway). Named `agent-thread:<accountId>:<threadId>`, reached
  only through `ctx.exports` from its account's cell, which alone names one,
  and reaching only that cell back; it imports `agents/lifecycle` alone, for
  the job queue and the one alarm the cell's own never shares. The definition
  (model, effort, prompt from `@repo/agent-skills`, the tools) is code, the
  same bytes for every account. Rejected: the loop in the cell (Lifecycle takes
  its host's one alarm); ThinkHarness (its recovery re-sends a cut reply as a
  prefill Opus 5.5 refuses, and it takes an approval answered after a later
  turn); PiHarness (`drop_block` on every request, a compaction that drops
  every kept thinking block, a hook that cannot refuse a call); Managed Agents
  (its credential vault, a public connector, a webhook and an account-wide turn lock to
  attribute writes). `packages/service/src/agent/agent-thread.ts`,
  `library-agent.ts`.

- **A CONVERSATION'S TRANSCRIPT IS CLAUDE'S REPLIES AS RETURNED, ONLY EVER
  APPENDED TO, AND A CUT CALL IS SENT AGAIN WHOLE.** A reply lands only once
  its stream ends, in one transaction with its usage; a call stamped by an
  instance that died, or whose reply sent no byte, pings included, for three
  minutes, is cut and its step re-sent byte for byte, its cap the first
  call's; the model, effort, system and tools a turn started under are
  replayed byte for byte; `cache_control` goes on a copy; per-account words
  ride a system message after the person's, landing with the turn's first
  reply, so a turn that ends unanswered leaves none last. Rejected: continuing
  the partial reply (a prefill, a 400 on Opus 5.5); rebuilding messages from
  rows (one changed byte before a thinking block is a 400); a timeout on the
  SDK's events (it never hands on a ping, and a long unshown thought is no lost
  call).
  `packages/service/src/agent/thread-schema.ts`, `thread-request.ts`,
  `thread-loop.ts`.

- **THE AGENT'S TOOLS ARE THE LIBRARY'S PROCEDURES, RUN BY ITS CELL UNDER A
  PRINCIPAL ONLY `agentTool` MINTS.** The registrar's tool rows, each by its
  `operationId` with its input less `opId`; the cell
  runs one through its own router as `agent{threadId, turn}` only while that
  turn is open, its write's op id derived from `agent:<threadId>:<toolUseId>`,
  so a call run again lands once; no header carries an agent. Rejected: the
  connector over HTTP (a credential to mint and refresh, a turn lock to
  attribute it); the API's MCP connector (no permission policy, a public URL).
  `packages/service/src/agent/agent-tools.ts`,
  `packages/service/src/library/library-principal.ts`.

- **THE BUILT-IN AGENT'S RESULTS FIT IN 40,000 CHARACTERS.** A result is
  replayed into every later call of its conversation and written to the cache
  once, so a paged list is asked again at half its rows until it fits, and
  what still does not is refused, a read told to ask for less and a write that
  it landed; a stored event carries 2,000 characters of it. Rejected: the
  connector's budget (claude.ai takes 150,000); refusing every long page.
  `packages/service/src/agent/agent-tools.ts`.

- **AN APPROVAL WAITS ON THE PERSON TEN MINUTES IN THE THREAD'S OWN ROWS, AND A
  CANCEL DENIES BEFORE IT STOPS.** `delete_items` and `save_link` are journaled
  awaiting the person under a Lifecycle job that denies at ten minutes; an
  answer decides once; a cancel marks the turn durably, cuts the model call
  whether it is still being reserved or already streaming, and answers every
  open call `is_error`, so the next request is valid. Rejected: a tool that
  waits in memory (it dies with an eviction); the platform's `auto` judgment
  (not the person). `packages/service/src/agent/agent-thread.ts`,
  `thread-loop.ts`.

- **EVERY TURN IS COUNTED BEFORE IT STARTS AND EVERY CALL RESERVED BEFORE IT
  GOES** (owner decision: about fifty free turns a month, a day's share first).
  A send that finds the day's turns or list cost spent is refused
  `AGENT_BUDGET`; each call's `max_tokens` is what the turn's ceiling and the
  day's remainder buy after its input, priced as the cache will likely bill
  it and counted at no fewer tokens than Claude bills: the last call's billed
  prompt and reply, and what was added since at a token an id's character and
  a UTF-8 byte beyond ASCII. A call whose estimate reaches the compaction
  trigger reserves the summary's pass too (the whole prompt read,
  `max_tokens` written, the summary the answer's input); each reply books its
  exact usage at list price in micro-cents, a cut call its reservation against
  the day but not its turn's ceiling, and a turn that cost nothing is
  refunded. The one pass no reservation holds is a fallback's: it books past
  what the call reserved, and past the turn's ceiling by one call at most,
  since the next call then finds nothing left. Rejected: the gateway's spend
  limit (eventually consistent, a backstop); an estimate booked as spend; one
  pass priced for a compaction that makes two (a turn would book past what it
  reserved); reserving the fallback too (a cold first call at the 50-cent
  ceiling buys under the smallest cap, so every new conversation is refused);
  characters / 3 (it counted CJK at a quarter of its tokens and ids at a third).
  `packages/service/src/agent/agent-allowance.ts`, `thread-request.ts`.

- **A THREAD IS THE ACCOUNT'S: ITS EVENTS ARE THE CELL'S ROWS ITS OBJECT'S
  OUTBOX PUSHES** (owner decision: the phone asks the agent too). The cell stores each
  push once by its seq, in one transaction, as events of our own union, and
  frames each on the sockets after it commits; previews ride the sockets
  alone. An object that starts over on tables of another version keeps its seq
  going, and the cell's watch hands it again a turn it lost. Rejected: the
  Agents SDK's client socket to the thread (a second socket and auth beside
  the account's); Anthropic's event shapes (a vendor's union on every device); an
  epoch a push (a fence that resets, which a late push of the old one moves
  back). `packages/service/src/agent/agent-turns.ts`, `thread-schema.ts`,
  `packages/contract/src/library/agent-events.ts`.

- **CLAUDE IS REACHED THROUGH ONE AI GATEWAY A TARGET, WHICH HOLDS THE KEY**
  (owner decision). The provider-native `/anthropic` route, its key stored on
  the gateway with provider credentials required, the gateway authenticated by
  `AI_GATEWAY_TOKEN`, every request asking it to keep no payload; the SDK sends
  no key and retries nothing, and a Worker with no gateway fails closed, so
  Deploy refuses a Build Output that names none. Rejected: the key on the
  Worker; Unified Billing (a fee, and its fallback is silent); the AI binding
  (it reaches the account in local development); `@ai-sdk/anthropic` (a second
  conversion of every block). `packages/service/src/agent/anthropic-client.ts`,
  `apps/web/cloudflare.config.ts`, `.github/workflows/deploy.yml`.

- **THE LOCAL WORKER, THE E2E AND THE SUITES RUN THE ONE THREAD PATH AGAINST A
  SCRIPTED MESSAGES API.** `ANTHROPIC_FAKE_URL`, which `vite dev` alone
  declares and the e2e harness binds, must name this machine, and points the
  client at `tools/messages-fake`, which refuses what Opus 5.5 refuses and
  counts every dropped thinking block; the suites reach it through their
  outbound service, which refuses every other address, and every suite and
  scenario expects no drop. Rejected: a mock model (the SDK's stream, the
  API's refusals and the transcript rules would be ours to imitate); a
  recorded replay (it cannot answer a request it never saw).
  `tools/messages-fake/src/messages-fake.ts`, `packages/service/messages-service.ts`.

- **A LONG CONVERSATION IS COMPACTED BY THE API AT 50,000 TOKENS, AND A DEPLOY'S
  DEFINITION IS TAKEN UP BETWEEN TURNS.** Every request asks for server-side
  compaction at 50,000 input tokens, the API's least (beta
  `compact-2026-01-12`), since a turn after a pause is reserved with its prompt
  written to the cache again and the summary's pass beside its answer, which a
  turn's ceiling holds there in any script, its prompt counted from the last
  call's billed one; the first call after a deploy moved its definition is
  counted whole, so past about 66,000 tokens counted (about 37,000 real in a
  conversation mostly CJK) it is refused, every turn, since no call under the
  new definition lands to count from. Its `compaction` block lands in the reply
  and is replayed, each request carrying the conversation from the last one that
  kept a summary, where the prefix the API checks starts. A thread whose
  definition a deploy changed moves onto the new one at a turn's start, its
  requests from then on leaving out every thinking block before that turn, the
  leading run the API lets go. Rejected: the API's default, 150,000 (a resumed
  turn's input alone would pass a turn's ceiling, so the thread would end every
  send `budget`); keep-tail compaction of our own (every kept thinking block is
  invalid after it); on-demand compaction (its retention standing unsettled);
  sending what a compaction summarized (the reservation would price input the
  API ignores); a thread on its first definition for good (its tools drift from
  the procedures they call). `packages/service/src/agent/thread-request.ts`.

- **SAVING A LINK IS THE AGENT'S ONE WAY OUT OF THE LIBRARY, AND THE PERSON
  SEES THE WHOLE ADDRESS BEFORE IT GOES.** The cloud reads a saved page, so a
  link's address reaches that site, and a saved page the agent read can ask it
  to carry the person's words there; `save_link` asks first, and its card shows
  the address as the library would read it, the host named beside it, since
  the model's own reply is what such a page writes. Nothing a
  device draws is the same door: the library's page, in a tab and the Mac app alike, and the phone's editor page
  each draw no remote image, frame or media
  (`tools/repo-guards/src/remote-media.test.ts`).
  Rejected: holding the read until the person confirms it after the turn (a
  second gate beside the one approvals are); trusting the prompt's rule against
  following a page (a request sent cannot be undone).
  `packages/service/src/agent/library-agent.ts`,
  `packages/agent-panel/src/thread-entries.ts`.

## The program and its suites

- **THE WORKER'S PROGRAM HAS NO DOM, SO A DEPENDENCY'S TYPES THAT REFERENCE IT
  ARE MAPPED TO A STUB.** The codec's code-block kit reaches highlight.js,
  whose declarations carry `/// <reference lib="dom" />`, which would type the
  Worker against a stdlib it never runs on (`BufferSource` alone breaks Web
  Crypto's calls). Each program that holds the codec, the service's and the
  Worker's entry's, maps `highlight.js` by `paths` to the one type lowlight
  takes from it (`LanguageFn`). Rejected: `lib.dom` in the Worker
  (two `BodyInit`s); dropping code blocks from the headless kits (the codec
  reads every block a note holds). A sibling package is never mapped: the page
  reader publishes the one entry the fill calls with a `types` condition, its
  DOM-free signature, which its own program holds the implementation to.
  `packages/service/tsconfig.json`, `apps/web/src/worker/tsconfig.json`,
  `packages/service/src/types/highlight-js.d.ts`,
  `packages/page-reader/src/read-html-api.ts`.

- **THE SERVICE'S SUITES RUN INSIDE workerd ON THE SERVICE'S OWN WORKER, NEVER
  DEPLOYED.** `@cloudflare/vitest-plugin` reads `cloudflare.config.ts` here (its
  `newConfig`), the one config the service's `Env` is generated from too
  (EACH PROGRAM'S `Env` IS WHAT `cf workers types` GENERATES, in
  `apps/web/CLAUDE.md`): its entry is the suites' Worker, the deployed Durable
  Objects and the Worker's doors, dispatched by the path table the site's door
  routes are held to, without the site, whose SSR needs what only Start's vite
  plugin supplies. `vitest.config.ts` adds only what a config cannot hold: the
  D1 schema's DDL (`TEST_SCHEMA`), the cell's namespace by the name
  `listDurableObjectIds` reads, the cell's migrations as text and the outbound
  service. A suite reaches the Worker by `exports.default.fetch()` and reads
  every body to the end (`drained`), as per-file storage isolation needs; the
  suites that open the account's socket share one storage in a project of
  their own (a note's among them), since Durable Object WebSockets fail under
  isolation, and a note's client is stock `YProvider` over a socket fetched
  through the Worker (`packages/service/src/test-support/fetch-web-socket.ts`); the model's
  pure suites run under node, and every suite that reaches SQL runs on the
  cell's own SQLite. Rejected: a mocked runtime (Better Auth, D1 and the
  Durable Objects run as they deploy); the app's config (its entry's SSR, and
  fill consumers that would take a suite's messages); bindings restated in
  `vitest.config.ts` (a second spelling of the config).
  `packages/service/vitest.config.ts`,
  `packages/service/cloudflare.config.ts`,
  `packages/service/src/test-support/test-worker.ts`,
  `packages/service/src/test-support/cloud-helpers.ts`.
