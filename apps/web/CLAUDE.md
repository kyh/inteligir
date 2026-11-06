# Decisions: @repo/web and the cloud

Accounts, the device credential, `/v1`'s one wire, the connector with its OAuth
and its tools, the account's library cell and its sockets, and each
conversation with the built-in agent. `AGENTS.md` § Decisions says how a bullet is written and cited.

## Cloud, sync and accounts

- **A DEVICE SIGNS IN, OR SIGNS UP, WITH EMAIL + PASSWORD, and gets the same
  device credential** (owner decision, the Obsidian model). The login mints the
  credential, deletes its session and names the account, so a device holds one
  secret and the cross-account fence and account label hold at once; the phone
  keeps the bearer alone. The route is throttled per caller address, else it is
  a password oracle. No social providers: an in-app login can only be a
  password. Rejected: a second call to learn the account (a pending state
  readers must fail closed on); a browser approve page with one-time code, PKCE
  and loopback callback (a ceremony to keep the password out of the app).
  Residual: the password crosses the app once, over HTTPS.
  `apps/web/src/worker/device/login.ts`, `apps/web/src/worker/wire/account-router.ts`.

- **A DEVICE CAN ALSO CREATE THE ACCOUNT** (owner decision: sign up in the app,
  with the invite code). The sign-up answers the same credential and deletes the
  session it created, so a person never signs in twice in a row. The site's
  sign-up page stays, and the phone stays sign-in only.
  `apps/web/src/worker/device/sign-up.ts`.

- **A DEVICE CREDENTIAL, OR THE SITE'S SESSION, LISTS AND REVOKES ITS
  ACCOUNT'S DEVICES**, so Settings › Account, in a signed-in Mac or the library's
  browser tab, removes a lost phone with no password asked, as a sign-out asks
  none; the web's devices page stays as the fallback. A Mac's own row offers no
  Revoke: this device leaves through a sign-out.
  `apps/web/src/worker/wire/account-router.ts`, `apps/web/src/worker/device/devices.ts`,
  `apps/workspace/src/app/settings/account-section.tsx`.

- **A CREDENTIAL THIS DEVICE DROPS IS REVOKED BY THIS DEVICE, best-effort and
  never waited on.** A sign-out and the phone's credential drop each revoke on
  a client of their own, since closing the session aborts its client's
  requests, and clear local state at once, since an unreachable cloud must not
  hold a sign-out open. Rejected: forgetting the credential alone (the row
  stays active against the twenty-device cap, so repeated sign-ins lock the
  account out). `apps/mobile/src/lib/compose-runtime.ts`.

- **AN ACCOUNT IS DELETED FROM THE APP, THE PASSWORD ASKED AGAIN, THROUGH BETTER
  AUTH'S `deleteUser`** (owner decision: whoever lost their Mac deletes from any
  Mac). The password check mints the session `deleteUser` runs under, keeping
  its `beforeDelete` order and tombstone the ONE purge path; Better Auth's
  delete routes, which settle for a fresh session, are shut, and with no bearer
  plugin a browser's session is its cookie. Success wipes this device's
  replica and forgets the sign-in; after an unanswered deletion, a retry
  meeting only the kept credential's refusal means the account is gone. Rejected: a
  second purge path (it drifts); deleting by credential alone (a stolen one
  ends the account). `apps/web/src/worker/device/account.ts`.

- **THE ACCOUNT'S SOCKETS ARE ITS LIBRARY CELL'S, EACH TAGGED WITH THE HOLDER
  THE WORKER VERIFIED.** The cell accepts each hibernating socket under the
  device or browser session the Worker stamps on the upgrade, the one call
  fetch carries; a committed write sends every socket the head. Every client's
  socket opens on `/v1/socket` with a minute's HMAC ticket a `/v1` call
  minted, since a browser's sends no header, its holder checked in D1 again;
  that check is the upgrade's alone, so a device's revocation and every
  session's end (a sign-out, a password reset) close that holder's sockets.
  Rejected: a socket object beside the cell (every ping crossing to it); the
  bearer in the URL (it outlives a minute in any log); a bearer on the upgrade
  for the clients that can send one (a second door to keep).
  `apps/web/src/worker/library/cell-sockets.ts`, `socket-ticket.ts`,
  `socket-routes.ts`.

- **Better Auth's `baseURL` is derived per-request from the request origin, and
  sign-up is invite-gated by a Worker route in front of it.** Every hostname
  reaching this Worker is the deployment's own
  (`apps/web/src/worker/auth/auth.ts`); revisit if one it does not control
  arrives. Rejected: a fixed fallback (it mints reset links at the wrong
  deployment). The gate's two front doors, the site's page and the app's
  sign-up, share one atomic claim either releases when no account came of it;
  every other auth instance keeps sign-up off.
  `apps/web/src/worker/auth/invite.ts`, `apps/web/README.md` § Auth.

- **The D1 auth schema ships via `drizzle-kit push`; there are no migration
  files.** One deployer and no users (`AGENTS.md` § Project Overview), so a
  push may drop a column Better Auth does not write, and the schema follows
  what its generator prints for the plugin set (`apps/web/src/worker/db/schema.ts`
  says how). The suites and the e2e harness derive the DDL by `drizzle-kit
  export` and send it as one D1 batch. Rejected: migration files (a history for
  installs nobody holds). The first outside tester is the trigger for
  migrations. `apps/web/vitest.config.ts`, `tools/e2e/src/harness/worker-host.ts`.

- **Declare D1 uniques as named unique indexes, never `.unique()`**
  (`apps/web/src/worker/db/schema.ts`). Production D1 holds every unique as
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
  its credential, and an error no row declares is a fault to retry. Requests
  stay `z.strictObject`, since only the newest Worker reads them. A shape
  retires only once the floor passes every build reading it, and a field that
  changes what a row MEANS reaches only clients declaring it. Rejected: a wire
  final at birth behind strict readers (every addition a new row); per-row
  versions (every old shape kept). `packages/contract/src/cloud/v1-errors.ts`,
  `packages/library-replica/src/call-outcome.ts`.

- **EVERY INSTALL'S REQUEST NAMES ITS BUILD, AND THE WORKER REFUSES ONE BELOW
  THE FLOOR** (owner decision). The tolerant reader is forward negotiation only,
  so a request with no build or one below `MIN_CLIENT_BUILD` is refused,
  terminally and with the credential left live, so the next build resumes as the
  same device; a page the Worker served needs none, since it ships in the same
  deploy, and neither does a socket opened by ticket, since a browser socket
  sends no header and its ticket came from a call that met the floor.
  `packages/contract/src/cloud/client-build.ts`,
  `apps/web/src/worker/client-floor.ts`.

- **A PR PREVIEW IS A WORKER PREVIEW DRIVEN BY ACTIONS, not Workers Builds**,
  and it binds preview-only resources. Previews ride `workflow_run` after CI, as
  Deploy does, only for this repo's branches, since that trigger holds secrets.
  A preview inherits no binding, so `apps/web/cloudflare.config.ts` binds each
  to a preview-only resource, the OAuth namespace by the id the workflow found
  or made and the site's origin as the Preview's own URL, which the workflow
  derives before the deploy and checks after it. The script creates the GitHub
  deployment on the head commit (`.github/scripts/worker-preview.mjs`), since a
  job's `environment:` under `workflow_run` records the default branch.
  Rejected: Workers Builds (it deploys on push and cannot wait for CI); a
  preview on the production D1 (PR code would write real accounts).
  `.github/workflows/preview.yml`, `apps/web/README.md` § Previews.

- **`/v1` IS ONE oRPC WIRE, `/v1/rpc`, ITS REFUSALS DECLARED ONCE.** The
  Worker answers `account.*` on its own RPCHandler and forwards `library.*` to
  the account's library cell; both map codes with `V1_ERROR_STATUS_MAP`, a
  refusal is an `error()` factory, oRPC's own code where it means the same, and
  the floor, credential and budget the Worker meets before any procedure are
  answered in the same protocol. Every library write takes an `opId` the cell
  keeps; only a file's bytes, an export's zip and the socket stay plain HTTP
  under `/v1`, and the site's sign-up form posts beside Better Auth, under
  `/api`. Rejected: REST beside RPC (two serializers, two error vocabularies)
  and oRPC's default statuses (an unmapped code answers 400).
  `packages/contract/src/cloud/v1-errors.ts`,
  `apps/web/src/worker/wire/rpc-refusal.ts`, `apps/web/src/worker/index.ts`.

- **THE LIBRARY'S ROWS BECOME THE CONNECTOR'S TOOLS IN THE WORKER, BY META
  CHAINED ON THE CONTRACT'S OWN ROWS.** A tool row gets `.meta(openapi(…),
  mcp.tool(…))`: its name, title, description and the verb whose read-only and
  idempotent hints oRPC infers, then the hints no verb implies (closed-world
  but `save_link`, destructive where it changes what is there). A row without
  tool meta is no tool. The cell implements the decorated contract while
  clients type against the plain one, held equal by a `*.test-d.ts`.
  Rejected: the meta in `@repo/contract` (every client would bundle MCP and
  OpenAPI; `oxlint.config.ts` refuses both outside `apps/web/src/worker`) and a
  walker decorating by path (it rebuilds oRPC's internals).
  `apps/web/src/worker/connector/library-tools.ts`.

- **THE WORKER'S `Env` IS ONLY WHAT `cf workers types` GENERATES FROM
  `cloudflare.config.ts`.** Every binding is declared there: a secret with
  `bindings.secret()`, a value with `bindings.text`, the reset sender and the
  auth limiter's off switch included, and a binding one mode lacks types as
  optional; the suites add only `TEST_SCHEMA`, the library cell's namespace by
  name, which `listDurableObjectIds` looks up, and `REPLICA_SQL`, a replica's
  SQLite held on their node side, since workerd loads no sqlite-wasm
  (`apps/web/replica-sql-service.ts`). Rejected: a hand-written `Env`
  beside the generated one (it drifts from what deploys, and a secret it names
  is never checked against the config). The date and flags are one module, the
  fills' queues another, the agent's allowance and prices a third, that the
  configs and suites import and the Worker's own code never does: the dev
  server cannot load a module the config loads, so the consumer reads its
  queue's settings from `FILL_DELIVERY` and the cell its limits from
  `AGENT_ALLOWANCE` and `AGENT_PRICES`, and `oxlint.config.ts` refuses the
  import. `apps/web/cloudflare.config.ts`, `apps/web/compatibility.ts`,
  `apps/web/fill-queues.ts`, `apps/web/agent-limits.ts`.

- **THE WORKER'S SUITES RUN INSIDE workerd THROUGH `@cloudflare/vitest-plugin`,
  ON THE BINDINGS `cloudflare.config.ts` DECLARES, RESTATED.** A suite reaches
  the Worker by `exports.default.fetch()` and reads every body to the end
  (`drained`), as per-file storage isolation needs; the suites that open the
  account's socket share one storage in a project of their own, since Durable
  Object WebSockets fail under isolation. The plugin documents reading only a
  Wrangler file, hence the restated bindings. Rejected: a mocked runtime
  (Better Auth, D1 and the Durable Objects run as they deploy).
  `apps/web/vitest.config.ts`, `apps/web/src/worker/test-support/cloud-helpers.ts`.

- **EACH ACCOUNT'S LIBRARY IS ONE SQLITE DURABLE OBJECT, `LibraryDO`, REACHED
  ONLY THROUGH `ctx.exports` UNDER A NAME A VERIFIED CREDENTIAL OR ITS OWN CELL
  GIVES.** Naming an object creates it, so `library:<userId>` comes from a
  credential the Worker verified, or from a fill message, which only the
  account's cell writes, from its own `ctx.id.name`, onto a queue only this
  Worker produces to, and a conversation's `agent-thread:<accountId>:<threadId>`
  from its cell alone, for a thread its rows hold; `cloudflare.config.ts`
  declares `LibraryDO` and `AgentThreadDO` in `exports` with SQLite storage and
  binds no namespace; `ThreadSyncDO`, `RepoCell` and `Registry` are each a
  `state: "deleted"` tombstone, kept until a deploy's answer lets it go
  (`docs/releasing.md` § 5). The schema opens under
  `blockConcurrencyWhile`; one of another version wipes the cell under a new
  epoch. Rejected: a namespace binding (anything holding `env` could name any
  cell); the cell under a deleted class's export name (nothing documents a
  preview refusing a new class); signing the fill message (no other producer exists to forge one).
  `apps/web/src/worker/library/library-do.ts`,
  `library-cell.ts`, `cell-schema.ts`, `apps/web/src/worker/fill/fill-job.ts`.

- **A LIBRARY WRITE LANDS ONLY ON THE BASES IT NAMES, BLOCK BY BLOCK, IN ONE
  TRANSACTION.** Every op carries the base it was computed from (a block's
  hash, a field's value, a highlight's note), and the cell lands the write in
  one `transactionSync` only while each base holds, else answers `CONFLICT`
  with each moved thing as it is, which the editor's diff3 settles. A
  highlight's id is the library's, so one another item holds conflicts.
  Rejected: a whole-item base (two devices in one note always conflict); last
  write wins (an edit lost unseen); a merge in the cell (it cannot ask the
  person). `apps/web/src/worker/library/library-engine.ts`, `cell-landing.ts`,
  `cell-annotations.ts`.

- **A CHANGE SET SEALS BY THE CELL'S ONE ALARM, AND AN ITEM'S REVISIONS RUN IN
  THE ORDER ITS STATES HELD.** Each actor's set seals by its policy when its
  `jobs` row comes due. A set's after for an item, with the item's revision, is
  written once another set is about to change the item or the set seals, so
  the newest revision is the item as it stands. Rejected: a timer per set
  (eviction loses it); each seal's revision of its own after (a late seal
  outranks a newer state); a revision per write (typing makes thousands).
  `apps/web/src/worker/library/change-sets.ts`, `cell-actor.ts`,
  `history-prune.ts`.

- **AN ACCOUNT'S DELETION RUNS IN ITS CELL, THE TOMBSTONE FIRST AND THE
  CREDENTIALS LAST.** Better Auth's `beforeDelete` asks the cell to purge, step
  by step, each step idempotent, so a failure aborts the deletion and the retry
  runs from the top on a credential still live. The tombstone outlives the deletion, so a
  call verified a moment before meets it rather than founding a library nobody
  reaches. Rejected: credentials first (a failed step leaves no device to retry
  from); a bare `deleteAll` (an in-flight write rebuilds the cell).
  `apps/web/src/worker/library/account-purge.ts`,
  `apps/web/src/worker/auth/auth.ts`.

- **A FILE ROW NEVER NAMES AN OBJECT R2 NO LONGER HOLDS, AND R2 KEEPS NOTHING
  THE CELL REFUSED OR NOBODY SETTLED.** Such an upload becomes a stray, a job
  the alarm runs between two transactions to delete it from R2; while it waits
  a settle of that sha lands nothing, and so does one that read R2 before a
  removal ended, by the count of removals it read first. Rejected: deleting
  right after the refusal (a settle landing meanwhile names a deleted object);
  keeping strays (the 1 GiB cap would not bound R2).
  `apps/web/src/worker/library/cell-blobs.ts`, `cell-library.ts`.

- **A LIBRARY CALL REACHES ITS CELL WITH THE PRINCIPAL THE WORKER VERIFIED,
  AND NOTHING THE CALLER SENT IN ITS PLACE.** The Worker verifies a bearer in
  D1, or the session cookie on a request the site's own page made, once a
  request; a bearer that fails is refused, never retried as the cookie. It
  drops the request's `x-library-principal`, `authorization` and `cookie`,
  stamps the principal and forwards the request whole by `stub.fetch()`; the
  cell refuses one naming another account. Rejected: the cell verifying the
  credential (a second verifier, a D1 read inside every cell call); a stub
  method per procedure (oRPC's handler takes a request).
  `apps/web/src/worker/wire/v1-rpc.ts`, `v1-principal.ts`,
  `apps/web/src/worker/library/library-do.ts`.

- **THE CELL IMPLEMENTS EVERY LIBRARY ROW ONCE, OVER ITS ENGINE AND THE
  MARKDOWN CODEC.** `implement(libraryTools)`: a write lands in one transaction
  joined to its principal's change set, an agent's markdown is read and edited
  through `@repo/editor/codec/*`, a saved link or a refresh lands pending for
  the cloud's fill, and every answer is parsed through its row's output schema,
  which strips what the cell did not mean to send (about 10 ms a MiB of plain
  blocks, 45 for a table-dense one, measured). Rejected: a second markdown
  reader in the Worker; skipping that parse for speed (a leaked column ships
  unnoticed). `apps/web/src/worker/library/library-router.ts`,
  `library-engine.ts`.

- **A FILE'S BYTES ARE R2'S, ADDRESSED BY THEIR SHA, AND R2 CHECKS IT.** A
  `PUT /v1/blobs/<sha>` takes room in the cell at the length it declares, at
  most 100 MB, streams into `BLOBS` with `sha256`, so R2 keeps nothing that
  hashes otherwise, and settles the row at the size R2 holds. A read hands R2
  the request's range and preconditions: 206 from `object.range` for any single
  range, one spanning the file included, 416 for one past the end, a
  multi-part ask whole, 304 and 412; every file but a PDF is served under a
  script-less sandbox. Rejected: a byte-range parser of our own (R2 parses the
  header); a signed URL (a credential in a logged address).
  `apps/web/src/worker/library/blob-routes.ts`.

- **THE WORKER'S PROGRAM HAS NO DOM, SO A DEPENDENCY'S TYPES THAT REFERENCE IT
  ARE MAPPED TO A STUB.** The codec's code-block kit reaches highlight.js,
  whose declarations carry `/// <reference lib="dom" />`, which would type the
  Worker against a stdlib it never runs on (`BufferSource` alone breaks Web
  Crypto's calls). The program's `paths` maps `highlight.js` to the one type
  lowlight takes from it (`LanguageFn`). Rejected: `lib.dom` in the Worker
  (two `BodyInit`s); dropping code blocks from the headless kits (the codec
  reads every block a note holds). A sibling package is never mapped: the page
  reader publishes the one entry the fill calls with a `types` condition, its
  DOM-free signature, which its own program holds the implementation to.
  `apps/web/src/worker/tsconfig.json`,
  `apps/web/src/worker/types/highlight-js.d.ts`,
  `packages/page-reader/src/read-html-api.ts`.

- **A SAVED PAGE OF A URL THE LIBRARY HOLDS FOLDS ONTO ITS ITEM, ITS ARTICLE
  REPLACING THE ITEM'S AND THE ITEM'S HIGHLIGHTS PLACED AGAIN.** One url, one
  item (R22): a device's read lands its article in place of the item's, leaves
  the person's note alone, sets the facts the fill owns and adds its tags, and
  in the same write places every highlight that keeps a quote by that quote,
  since the markers went with the old article; one the note holds stays where
  it is, a selection the item keeps adds nothing, and a read with no article
  leaves the item's. Rejected: keeping the first article (a resave never shows
  the page as it reads now); answering `exists` (the popup's highlight did
  nothing). `apps/web/src/worker/library/cell-saves.ts`.

- **A SAVED LINK IS READ OFF THE FILL QUEUE, ASKED FOR IN THE WRITE THAT MADE IT
  WAIT.** The write lands a `fill` job row in its own transaction, and the cell
  sends it to `inteligir-fill` once the write commits; a row no send took is
  sent again by the alarm a minute on. The consumer reads a page only while its
  item still waits, asks again a page a later try may pass (30 s, doubling,
  three retries), and the dead-letter queue's consumer says the failure, so no
  link waits unread for good. Rejected: sending inside the write (a reading
  asked for a write that rolled back); fetching on the cell's alarm (a page's
  seconds of CPU hold every write). `apps/web/src/worker/library/cell-fills.ts`,
  `apps/web/src/worker/fill/fill-consumer.ts`.

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
  `apps/web/src/worker/fill/page-fetch.ts`, `address-space.ts`.

- **A READING LANDS ONLY THE ARTICLE AND THE FACTS A FILL OWNS, AS ITS OWN
  CHANGE SET, ON AN ITEM STILL WAITING FOR IT.** `landFill` replaces the
  article and places the item's highlights again by their quotes, sets a fact
  only where the page gave one, renames only an item still named by its
  address, and never touches the note; an item deleted, read or readdressed
  meanwhile lands nothing, so a message met twice lands once. A page whose
  redirects end at another live item's address folds onto it, the stub's tags
  and note with it. Rejected: bases the consumer read (a reading nobody edited
  around would conflict with every save meanwhile).
  `apps/web/src/worker/library/cell-fills.ts`.

- **AN IMPORT IS A CELL JOB RUN A PAGE AT A TIME, ITS PLAN IN ROWS.**
  `library.imports.start` names a file the device uploaded, and each alarm run
  does one page (a hundred bookmarks, fifty notes or 512 KiB of their markdown,
  64 MiB of the zip, or ten seconds waiting on R2) in transactions that move
  the job's cursor with what they land. A run is counted before it starts, so
  one the platform ends counts, and five in a row that move nothing stop it. A
  note past 1 MiB is left out (reading costs about 11 s of CPU a MiB,
  measured). Pass one puts every file in the library, the plan is made once,
  then the notes and the unembedded files land in one change set. Rejected:
  one run per import (an alarm's 30 s of CPU); counting a run in its catch
  (the platform's kill skips it). `apps/web/src/worker/library/cell-imports.ts`,
  `apps/web/src/worker/library/cell-import-markdown.ts`.

- **AN EXPORT IS A ZIP THE CELL WRITES INTO R2 OVER MANY ALARM RUNS, AND LETS
  GO SEVEN DAYS ON.** Each run is counted before it starts and does one page (a
  thousand items planned, 2 MiB of their markdown, 128 MiB of their files, or
  ten seconds on R2), ending in one transaction that keeps the plan's rows, the
  entries' records, the parts' etags and the bytes past its last 8 MiB part, so
  a run the platform ends is written again from there. A link is spelled from
  the items filed under the keys it tries, which a seeded property holds equal
  to the whole plan's resolver. Rejected: one run per export (a large
  library's CPU outruns the alarm's 30 s); an R2 lifecycle rule (by prefix
  only); fflate (no ZIP64 writer) and zip.js (timers and a worker pool).
  `apps/web/src/worker/library/cell-exports.ts`, `cell-export-rows.ts`,
  `packages/notes/src/knowledge/link-resolve.test.ts`.

- **THE CLOUD KEEPS A PAGE'S COVER AS THE SITE SERVED IT, AND EACH DEVICE DRAWS
  ITS OWN THUMBNAIL.** The consumer keeps the first candidate that is really a
  picture of a cover's size whole, within `FILL_LIMITS.coverBytes`, and decodes
  nothing. Rejected: a wasm thumbnail (a decoded picture is four bytes a
  pixel, 48 MB for 4000 by 3000, in an isolate whose heap the reading already
  uses; not measured); the Images binding (it bills every picture); a
  thumbnail made in the cell (its CPU holds every write). `apps/web/src/worker/fill/read-page.ts`,
  `packages/notes/src/items/link-fill.ts`.

- **A FILE NO ITEM HAS NAMED IS LET GO ONCE NOTHING WILL, AND ONE AN ITEM NAMED
  STAYS.** A file's row that lands waits a day under an `unnamed` job, which an
  item naming it drops; an import that ends however it ended lets its files
  go, a reading that lands nowhere hands its cover to the alarm's next run,
  and none goes while an import runs, whose plan may name it. Once named, a
  revision may hold it, so it stays. Rejected: releasing by `refs` alone (a
  file only history holds would go); a sweep of rows with no refs (the same).
  `apps/web/src/worker/library/cell-blobs.ts`, `cell-imports.ts`,
  `cell-fills.ts`.

- **THE CONNECTOR'S OAUTH IS `@cloudflare/workers-oauth-provider`'S, ON KV,
  NAMED FROM ONE ORIGIN PER DEPLOYMENT** (owner decision). The provider owns
  every OAuth surface, a registration spending its address's window first,
  since each is a KV record; `SITE_ORIGIN` names issuer and resource, never the
  request's Host, so one deployment's tokens open no other's. A grant is
  `library` or `library:read`, the person's choice, and the handler refuses a
  token holding neither: the provider advertises scopes but enforces none.
  Rejected: the MCP SDK's bearer middleware or an authorization server of our
  own (a second verifier to audit); the Host header (the workers.dev name and
  the domain would be two servers whose tokens refuse each other).
  `apps/web/src/worker/connector/connector-auth.ts`,
  `apps/web/cloudflare.config.ts`.

- **THE CONSENT PAGE IS THE WORKER'S, AT `/connect/authorize`, OVER THE SITE'S
  SESSION.** It reads Better Auth's session, or sends the person to sign in
  and back, the sign-in returning by a document load since the site's router
  holds no such page; the provider parses the request, binds the form to the
  browser by a cookie and keeps the request server-side until the answer.
  The page runs no script (`default-src 'none'`, no framing), escapes every
  field a client sent, says where access is sent and warns of a loopback
  address, and asks to "read and change your library". Rejected: a Start route
  (the provider's helpers take the raw request, and the page would carry the
  site's bundle); remembering an approval (every connect asks).
  `apps/web/src/worker/connector/consent-route.ts`, `consent-page.ts`,
  `apps/web/src/routes/app/sign-in.tsx`.

- **THE CONNECTOR IS SERVED IN THE ACCOUNT'S CELL, A FRESH SERVER A REQUEST
  OVER ONE OF TWO REGISTRARS, ITS PRINCIPAL AN ASSISTANT'S.** The Worker
  refuses a Host or Origin not this deployment's, the provider checks the
  token, the grant spends its budget, and the request goes on whole by
  `stub.fetch`, stamped with an assistant's principal, which the cell takes
  only here. The read-only registrar holds the
  GET rows; each server is stateless, its tools/list private to the client,
  and it advertises no `listChanged`, since a grant's tools never change and a
  `subscriptions/listen` would hold the cell open. Rejected: a session object
  per client (state nothing needs); a registrar per request (it rebuilds the
  same schemas); a device credential here (the door is an assistant's).
  `apps/web/src/worker/connector/connector-route.ts`, `connector-server.ts`,
  `apps/web/src/worker/library/library-principal.ts`.

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
  (a vault, a public connector, a webhook and an account-wide turn lock to
  attribute writes). `apps/web/src/worker/agent/agent-thread.ts`,
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
  `apps/web/src/worker/agent/thread-schema.ts`, `thread-request.ts`,
  `thread-loop.ts`.

- **THE AGENT'S TOOLS ARE THE LIBRARY'S PROCEDURES, RUN BY ITS CELL UNDER A
  PRINCIPAL ONLY `agentTool` MINTS.** The registrar's tool rows minus
  `undo_change`, each by its `operationId` with its input less `opId`; the cell
  runs one through its own router as `agent{threadId, turn}` only while that
  turn is open, its write's op id derived from `agent:<threadId>:<toolUseId>`,
  so a call run again lands once; no header carries an agent. Rejected: the
  connector over HTTP (a credential to mint and refresh, a turn lock to
  attribute it); the API's MCP connector (no permission policy, a public URL).
  `apps/web/src/worker/agent/agent-tools.ts`,
  `apps/web/src/worker/library/library-principal.ts`.

- **THE BUILT-IN AGENT'S RESULTS FIT IN 40,000 CHARACTERS.** A result is
  replayed into every later call of its conversation and written to the cache
  once, so a paged list is asked again at half its rows until it fits, and
  what still does not is refused, a read told to ask for less and a write that
  it landed; a synced event carries 2,000 characters of it. Rejected: the
  connector's budget (claude.ai takes 150,000); refusing every long page.
  `apps/web/src/worker/agent/agent-tools.ts`.

- **AN APPROVAL WAITS ON THE PERSON TEN MINUTES IN THE THREAD'S OWN ROWS, AND A
  CANCEL DENIES BEFORE IT STOPS.** `delete_items` is journaled awaiting the
  person under a Lifecycle job that denies at ten minutes; an answer decides
  once; a cancel marks the turn durably, cuts the model call whether it is
  still being reserved or already streaming, and answers every open call
  `is_error`, so the next request is valid. Rejected: a tool that waits in
  memory (it dies with an eviction); the platform's `auto` judgment (not the
  person). `apps/web/src/worker/agent/agent-thread.ts`, `thread-loop.ts`.

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
  refunded. Rejected: the gateway's spend limit (eventually consistent, a
  backstop); an estimate booked as spend; one pass priced for a call that may
  make two (a turn would book past what it reserved); characters / 3 (it
  counted CJK at a quarter of its tokens and ids at a third).
  `apps/web/src/worker/agent/agent-allowance.ts`, `thread-request.ts`.

- **A THREAD IS THE ACCOUNT'S: ITS EVENTS ARE SYNCED ROWS ITS OBJECT'S OUTBOX
  PUSHES** (owner decision: the phone asks the agent too). The cell stores each
  push once by its seq, in one transaction, as events of our own union, and
  frames each on the sockets after it commits; previews ride the sockets
  alone. An object that starts over on tables of another version keeps its seq
  going, and the cell's watch hands it again a turn it lost. Rejected: the
  Agents SDK's client socket to the thread (a second socket and auth, nothing
  offline); Anthropic's event shapes (a vendor's union in every replica); an
  epoch a push (a fence that resets, which a late push of the old one moves
  back). `apps/web/src/worker/agent/agent-turns.ts`, `thread-schema.ts`,
  `packages/contract/src/cloud/library/agent-events.ts`.

- **A LINK THE AGENT SAVES IS READ ONLY ONCE ITS TURN SEALS** (owner
  decision). Its fill row names the turn's change set and waits for the seal.
  Rejected: reading it at once (the agent could save a page, read it and act on
  it within the turn: a web reader it was never given).
  `apps/web/src/worker/library/cell-fills.ts`.

- **CLAUDE IS REACHED THROUGH ONE AI GATEWAY A TARGET, WHICH HOLDS THE KEY**
  (owner decision). The provider-native `/anthropic` route, its key stored on
  the gateway with provider credentials required, the gateway authenticated by
  `AI_GATEWAY_TOKEN`, every request asking it to keep no payload; the SDK sends
  no key and retries nothing, and a Worker with no gateway fails closed, so
  Deploy refuses a Build Output that names none. Rejected: the key on the
  Worker; Unified Billing (a fee, and its fallback is silent); the AI binding
  (it reaches the account in local development); `@ai-sdk/anthropic` (a second
  conversion of every block). `apps/web/src/worker/agent/anthropic-client.ts`,
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
  `tools/messages-fake/src/messages-fake.ts`, `apps/web/messages-service.ts`.

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
  the procedures they call). `apps/web/src/worker/agent/thread-request.ts`.

- **THE LIBRARY'S PAGE IS THE WORKER'S, AT `/library`, FROM ITS OWN ASSETS AND
  UNDER ITS OWN POLICY.** Every path under the prefix reaches the Worker first
  (`assets.runWorkerFirst`), which answers a file the page's build holds as it
  is and any other path with the page's one document, so a deep link loads and
  the page's router draws it; only the hashed `/library/assets/*` skip the
  Worker, and no other path falls back, so a mistyped site route still answers
  the site's 404. The document carries a policy of its own: its scripts and
  SQLite's wasm (`'wasm-unsafe-eval'`), calls and the socket to this origin
  alone, nothing remote drawn in an item, no frame and no worker. The page's
  build is copied into the Worker's assets (`apps/web/vite.config.ts`), so it
  ships in the Worker's deploy and its calls meet no build floor. Rejected: a
  Start route (the site's bundle and policy on the page); the asset server's
  SPA fallback (every unknown path would answer the page); a page on an origin
  of its own (a second sign-in, CORS on every call).
  `apps/web/src/worker/library/library-page.ts`, `apps/web/cloudflare.config.ts`.

- **TWO PAGES THE WORKER NEVER SERVED CALL `/v1` ACROSS ORIGINS, AND IT ANSWERS
  CORS FOR THOSE ORIGINS ALONE.** The Mac's shell serves its page on
  `tauri://localhost` (`MAC_APP_ORIGIN`) and the browser extension's worker
  calls from its own id's origin (`EXTENSION_ORIGIN`), so each call is
  cross-origin; the Worker answers the preflight and lets each exact origin read
  the routes it calls (the Mac's `/v1/rpc`, `/v1/blobs` and `/v1/exports`, the
  extension's first two), with no credentials, since both send a device
  credential as a bearer and never a cookie. The socket opens on a ticket and
  asks no CORS, and every other origin meets none; `vite dev` answers no
  preflight of its own, so the Worker answers as deployed. Rejected: the
  shell's HTTP plugin carrying the page's calls (a proxy in Rust for every
  call); host permissions for the extension (an install warning, and the store
  build's activeTab alone); a reflected origin (any page could read what a
  cookie opened). `apps/web/src/worker/cors.ts`, `apps/web/vite.config.ts`.

- **THE EXTENSION'S CREDENTIAL IS MINTED FOR THE SITE'S SESSION, ON A CLICK OF
  THE CONNECT PAGE.** `/connect/extension` is a site route that asks the person
  to Connect, then `account.connectExtension` mints a device credential for the
  session's account, never a device's (a stolen bearer would mint credentials
  outliving its own revocation), and leaves the session alone; the page hands it
  to the committed id only and revokes one the extension did not take.
  Rejected: connecting on load (any page linking there could fill the device
  cap); the id from the link (a link could name another extension).
  `apps/web/src/routes/connect/extension.tsx`,
  `apps/web/src/worker/wire/account-router.ts`.
