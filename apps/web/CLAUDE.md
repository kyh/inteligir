# Decisions: @repo/web and the cloud

Accounts and their sessions, `/v1`'s one wire, the connector with its OAuth
and its tools, the account's library cell and its sockets, and each
conversation with the built-in agent. The code is `@repo/service`'s, the D1
schema `@repo/db`'s, and the Worker that deploys them this app's.
`AGENTS.md` § Decisions says how a bullet is written and cited.

## Cloud, sessions and accounts

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
  `apps/workspace/src/app/settings/account-section.tsx`.

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
  `apps/workspace/src/app/settings/account-section.tsx`,
  `apps/workspace/src/app/cloud/auth-client.ts`.

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

- **Better Auth's `baseURL` is derived per-request from the request origin, and
  sign-up is invite-gated by a Worker route in front of it.** Every hostname
  reaching this Worker is the deployment's own
  (`packages/service/src/auth/auth.ts`); revisit if one it does not control
  arrives. Rejected: a fixed fallback (it mints reset links at the wrong
  deployment). The gate is one door, `POST /api/sign-up`, which the site's form
  and the phone's first run both post: one atomic claim, behind a per-address
  window, that a sign-up making no account releases; every other auth instance
  keeps sign-up off.
  `packages/service/src/auth/invite.ts`, `apps/web/README.md` § Auth.

- **The D1 auth schema ships via `drizzle-kit push`; there are no migration
  files.** One deployer and no users (`AGENTS.md` § Project Overview), so a
  push may drop a column Better Auth does not write, and the schema follows
  what its generator prints for the plugin set (`packages/db/src/d1/schema.ts`
  says how). The suites and the e2e harness derive the DDL by `drizzle-kit
  export` and send it as one D1 batch. Rejected: migration files (a history for
  installs nobody holds). The first outside tester is the trigger for
  migrations. `packages/service/vitest.config.ts`,
  `tools/e2e/src/harness/worker-host.ts`.

- **Declare D1 uniques as named unique indexes, never `.unique()`**
  (`packages/db/src/d1/schema.ts`). Production D1 holds every unique as
  drizzle-kit 0.31's `<table>_<column>_unique` index, which
  `uniqueIndex("<table>_<column>_unique")` matches, so `drizzle-kit push
  --explain` reports no changes; refuse any plan that recreates a table
  (`tools/repo-guards/src/d1-unique-index.test.ts`). Rejected: inline
  `.unique()`, which drizzle-kit 1.0 plans as a table recreate whose `DROP`
  cascades through every `ON DELETE CASCADE` child (D1 ignores `PRAGMA
  foreign_keys=OFF`), and `push` applies it without asking.

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

- **A PR PREVIEW IS A WORKER PREVIEW DRIVEN BY ACTIONS, not Workers Builds**,
  and it binds preview-only resources. Previews ride `workflow_run` after CI, as
  Deploy does, only for this repo's branches, since that trigger holds secrets.
  A preview inherits no binding, so `apps/web/cloudflare.config.ts` binds each
  to a preview-only resource, the OAuth namespace by the id the workflow found
  or made and the site's origin as the Preview's own URL, which the workflow
  derives before the deploy and checks after it. The script creates the GitHub
  deployment on the head commit (`.github/scripts/worker-preview.mjs`), since a
  job's `environment:` under `workflow_run` records the default branch, and
  deletes a closed PR's Preview before it reports it gone, Cloudflare's "Preview
  not found" alone being no failure. Rejected: Workers Builds (it deploys on push
  and cannot wait for CI); a preview on the production D1 (PR code would write
  real accounts); `cf previews delete` for the close (it exits 1 on a miss and on
  an expired token alike).
  `.github/workflows/preview.yml`, `apps/web/README.md` § Previews.

- **`/v1` IS ONE oRPC WIRE, `/v1/rpc`, ITS REFUSALS DECLARED ONCE.** The
  Worker answers `account.*` on its own RPCHandler and forwards `library.*` to
  the account's library cell; both map codes with `V1_ERROR_STATUS_MAP`, a
  refusal is an `error()` factory, oRPC's own code where it means the same, and
  the floor, credential and budget the Worker meets before any procedure are
  answered in the same protocol. Every library write takes an `opId` the cell
  keeps; only a file's bytes and the socket stay plain HTTP
  under `/v1`, and the site's sign-up form posts beside Better Auth, under
  `/api`. Rejected: REST beside RPC (two serializers, two error vocabularies)
  and oRPC's default statuses (an unmapped code answers 400).
  `packages/contract/src/v1-errors.ts`,
  `packages/service/src/wire/rpc-refusal.ts`, `packages/service/src/doors.ts`.

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

- **THE WORKER'S `Env` IS ONLY WHAT `cf workers types` GENERATES FROM
  `cloudflare.config.ts`.** Every binding is declared there: a secret with
  `bindings.secret()`, a value with `bindings.text`, the reset sender and the
  auth limiter's off switch included, and a binding one mode lacks types as
  optional. `@repo/service` is typed from its suites' own config, which binds
  what the app's does, typed alike, with the values the suites run on, and the
  suites add only `TEST_SCHEMA` and the library cell's namespace by name, which
  `listDurableObjectIds` looks up; the Worker's program checks every module of
  the service its entry reaches against the deployed `Env`, and a type test
  holds the deployed exports to the service's classes, so a binding only the
  suites declare fails the app's typecheck. Rejected: a hand-written `Env`
  beside the generated one (it drifts from what deploys, and a secret it names
  is never checked against the config). The date and flags are one module, the
  fills' queues another, the agent's allowance and prices a third, that the
  configs and suites import and the Worker's own code never does: the dev
  server cannot load a module the config loads, so the consumer reads its
  queue's settings from `FILL_DELIVERY` and the cell its limits from
  `AGENT_ALLOWANCE` and `AGENT_PRICES`, and `oxlint.config.ts` refuses the
  import. `apps/web/cloudflare.config.ts`, `packages/service/cloudflare.config.ts`,
  `apps/web/src/worker/service-exports.test-d.ts`,
  `packages/service/compatibility.ts`, `packages/service/fill-queues.ts`,
  `packages/service/agent-limits.ts`.

- **THE WORKER'S SUITES RUN INSIDE workerd THROUGH `@cloudflare/vitest-plugin`,
  ON `@repo/service`'S OWN CONFIG.** The plugin reads the service's
  `cloudflare.config.ts` (its `newConfig`), never deployed: the deployed
  Durable Objects and the Worker's doors, without the site, whose SSR needs
  what only Start's vite plugin supplies. A suite reaches the Worker by
  `exports.default.fetch()` and reads every body to the end (`drained`), as
  per-file storage isolation needs; the suites that open the account's socket
  share one storage in a project of their own, since Durable Object WebSockets
  fail under isolation; the model's pure suites run under node, and every
  suite that reaches SQL runs on the cell's own SQLite. `@repo/web` keeps the
  site's suites, which render its routes under node. Rejected: a mocked
  runtime (Better Auth, D1 and the Durable Objects run as they deploy); the
  app's config (its entry's SSR, and fill consumers that would take a suite's
  messages); bindings restated in `vitest.config.ts` (a second spelling of the
  config). `packages/service/vitest.config.ts`,
  `packages/service/cloudflare.config.ts`,
  `packages/service/src/test-support/test-worker.ts`,
  `packages/service/src/test-support/cloud-helpers.ts`.

- **EACH ACCOUNT'S LIBRARY IS ONE SQLITE DURABLE OBJECT, `LibraryDO`, REACHED
  ONLY THROUGH `ctx.exports` UNDER A NAME A VERIFIED CREDENTIAL OR ITS OWN CELL
  GIVES.** Naming an object creates it, so `library:<userId>` comes from a
  credential the Worker verified, from a fill message, which only the account's
  cell writes, from its own `ctx.id.name`, onto a queue only this Worker
  produces to, or from a conversation's own name, which names its cell back,
  and a conversation's `agent-thread:<accountId>:<threadId>` from its cell
  alone, for a thread its rows hold; `cloudflare.config.ts` declares `LibraryDO`
  and `AgentThreadDO` in `exports` with SQLite storage and binds no namespace;
  `ThreadSyncDO`, `RepoCell` and `Registry` are each a
  `state: "deleted"` tombstone, kept until a deploy's answer lets it go
  (`docs/releasing.md` § 5). The cell runs drizzle's migrator under
  `blockConcurrencyWhile` on every wake; one holding tables drizzle did not
  make, or a migration this build's journal lacks, is wiped and migrated from
  empty. Rejected: a namespace binding (anything holding `env` could name any
  cell); the cell under a deleted class's export name (nothing documents a
  preview refusing a new class); signing the fill message (no other producer exists to forge one).
  `packages/service/src/library/library-do.ts`,
  `library-cell.ts`, `cell-db.ts`, `packages/service/src/fill/fill-job.ts`.

- **A LIBRARY WRITE LANDS ONLY ON THE BASES IT NAMES, BLOCK BY BLOCK, IN ONE
  TRANSACTION.** Every op carries the base it was computed from (a block's
  hash, a field's value), and the cell lands the write in one
  `transactionSync` only while each base holds, else answers `CONFLICT` with
  each moved thing as it is, which the editor's diff3 settles. Rejected: a
  whole-item base (two devices in one note always conflict); last write wins
  (an edit lost unseen); a merge in the cell (it cannot ask the person).
  `packages/service/src/library/library-engine.ts`, `cell-landing.ts`,
  `cell-writes.ts`.

- **A CHANGE SET SEALS BY THE CELL'S ONE ALARM, AND UNDO REACHES BACK SEVEN
  DAYS** (owner decision). Each actor's set seals by its policy when its `jobs`
  row comes due. A set's after for an item is written once another set is
  about to change the item or the set seals, so it is the item as that set
  left it however the seals interleave. Seven days after a set closes the prune
  drops it, and then every part, block version and file only it named, so
  what Undo keeps of the library is a week of its changes. Rejected: a timer
  per set (eviction loses it); each seal's own after (a late seal outranks a
  newer state); a revision of the item per set to browse (the spec keeps no
  page history, and Undo needs only a set's before and after); keeping sets
  until the item is purged (an often-edited item would keep every keystroke's
  block forever).
  `packages/service/src/library/change-sets.ts`, `cell-actor.ts`,
  `change-set-prune.ts`.

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

- **THE CELL IMPLEMENTS EVERY LIBRARY ROW ONCE, OVER ITS ENGINE AND THE
  MARKDOWN CODEC.** `implement(libraryTools)`: a write lands in one transaction
  joined to its principal's change set, an agent's markdown is read and edited
  through `@repo/editor/codec/*`, a saved link or a refresh lands pending for
  the cloud's fill, and every answer is parsed through its row's output schema,
  which strips what the cell did not mean to send (about 10 ms a MiB of plain
  blocks, 45 for a table-dense one, measured). Rejected: a second markdown
  reader in the Worker; skipping that parse for speed (a leaked column ships
  unnoticed). `packages/service/src/library/library-router.ts`,
  `library-engine.ts`.

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
  article, sets a fact only where the page gave one, renames only an item still named by its
  address, and never touches the note; an item deleted, read or readdressed
  meanwhile lands nothing, so a message met twice lands once. A page whose
  redirects end at another item's address is read into the item that waited
  for it, which keeps the address it was saved at. Rejected: bases the
  consumer read (a reading nobody edited around would conflict with every save
  meanwhile); folding it onto the item at the final address (a merge with an
  undo of its own); readdressing it to the final address (a page that
  redirects to its sign-in would be kept at the sign-in's address).
  `packages/service/src/library/cell-fills.ts`.

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

- **THE CLOUD KEEPS A PAGE'S COVER AS THE SITE SERVED IT, AND EACH DEVICE DRAWS
  ITS OWN THUMBNAIL.** The consumer keeps the first candidate that is really a
  picture of a cover's size whole, within `FILL_LIMITS.coverBytes` and
  `FILL_LIMITS.coverMaxPixels`, and decodes nothing. Rejected: a wasm thumbnail
  (a decoded picture is four bytes a pixel, 48 MB for 4000 by 3000, in an
  isolate whose heap the reading already uses; not measured); the Images
  binding (it bills every picture); a
  thumbnail made in the cell (its CPU holds every write). `packages/service/src/fill/read-page.ts`,
  `packages/contract/src/items/link-fill.ts`.

- **A FILE IS LET GO ONCE NOTHING NAMES IT OR WILL.** A file stays while an
  item names it or any change set does, and `change_set_blobs` keeps which files
  each fields part and block version names, so the ask is one lookup. A file
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
  address, and asks to "read and change your library". Rejected: a Start route
  (the provider's helpers take the raw request, and the page would carry the
  site's bundle); remembering an approval (every connect asks); `form-action`
  (browsers disagree on whether it holds the 302 to the assistant's origin).
  `packages/service/src/connector/consent-route.ts`, `consent-page.ts`,
  `apps/web/src/routes/app/sign-in.tsx`, `sign-up.tsx`.

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

- **A LINK THE AGENT SAVES IS READ ONLY ONCE ITS TURN SEALS** (owner
  decision). Its fill row names the turn's change set and waits for the seal.
  Rejected: reading it at once (the agent could save a page, read it and act on
  it within the turn: a web reader it was never given).
  `packages/service/src/library/cell-fills.ts`.

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

- **THE LIBRARY'S PAGE IS THE WORKER'S, AT `/library`, FROM ITS OWN ASSETS AND
  UNDER ITS OWN POLICY.** Every path under the prefix reaches the Worker first
  (`assets.runWorkerFirst`), which answers a file the page's build holds as it
  is and any other path with the page's one document, so a deep link loads and
  the page's router draws it; only the hashed `/library/assets/*` skip the
  Worker, and no other path falls back, so a mistyped site route still answers
  the site's 404. The document carries a policy of its own: its scripts and
  no wasm, calls and the socket to this origin alone, nothing remote drawn in
  an item, no frame and no worker. The page's
  build is copied into the Worker's assets (`apps/web/vite.config.ts`), so it
  ships in the Worker's deploy and its calls meet no build floor. Rejected: a
  Start route (the site's bundle and policy on the page); the asset server's
  SPA fallback (every unknown path would answer the page); a page on an origin
  of its own (a second sign-in, CORS on every call).
  `packages/service/src/library/library-page.ts`, `apps/web/cloudflare.config.ts`.

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

- **THE CONNECT PAGE TELLS THE EXTENSION WHERE THE SITE IS, AND HANDS IT
  NOTHING.** `/connect/extension` is a site route for the person signed in
  there: a click of Connect sends the committed id alone `{ type: "connect" }`
  through `externally_connectable`, whose sender Chrome names by the page's
  origin, and the page says which account the extension answers it found this
  browser signed in to. The extension reads the browser's own sign-in (EVERY
  DEVICE SIGNS IN WITH BETTER AUTH'S OWN SESSION), so no credential crosses the
  page, and none is minted or revoked there. Rejected: a credential minted for
  the extension and handed over (a second secret per browser, which outlived
  the browser's sign-out); the id from the link (a link could name another
  extension). `apps/web/src/routes/connect/extension.tsx`,
  `apps/web/src/lib/extension-connect.ts`.

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

- **ONLY BETTER AUTH'S OWN READ SLIDES A SESSION, AND A TAB MAKES IT ON THE
  HOUR.** A session's row and its cookie slide together or not at all, and only
  `/api/auth/get-session` answers the browser with that cookie, so a read of the
  Worker's own (`/v1`, the consent page) passes `disableRefresh`, and a tab left
  open reads its session hourly, its other calls renewing nothing. Rejected: a
  slide on `/v1` (the row outlives the cookie, and an open tab is signed out
  when its cookie lapses with its row standing); forwarding `Set-Cookie` on every `/v1`
  answer (each door, a file's immutable read among them, carrying a header none
  of them owns). `packages/service/src/auth/auth.ts`,
  `apps/workspace/src/app/cloud/session-keeper.ts`.

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

- **A SIGN-IN OR SIGN-UP LANDS IN THE LIBRARY UNLESS SOMETHING ASKED IT BACK, AND
  THE SITE LINKS THE LIBRARY.** `signedInLanding` follows a `next` the
  open-redirect guard passes, else `/library`, by a document load, since the
  site's router holds neither that page nor the consent page; sign-in, sign-up
  and the reset pages hand `next` on, the reset through its mail's link, each
  page's search parsed by the same guard so none holds an off-site one. One
  link, in the site's header, serves someone signed in and someone not, since
  the page sends a signed-out tab to sign in and back; its document answers
  `noindex`, as the account pages do, since that link hands a crawler an empty
  shell. Rejected: a sign-out passing its own `next` (the landing is already
  the library); `Disallow` in robots.txt (a page it blocks can still be listed
  by its link). `apps/web/src/lib/next-path.ts`,
  `apps/web/src/components/library-link.tsx`,
  `packages/service/src/library/library-page.ts`.

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
