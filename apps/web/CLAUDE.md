# Decisions: @repo/web and the cloud

Accounts, the device credential, the /cloud wire, thread sync, the inboxes and
the hosted vault. `AGENTS.md` § Decisions says how a bullet is written and
cited.

## Cloud, sync and accounts

- **THE DEVICE CREDENTIAL IS THE SYNC SWITCH AND THE ENTITLEMENT, and it lives
  in the data dir.** `<dataDir>/device-credential` at 0600: not in
  `inteligir.db` (the thread log it uploads) and not in the vault (a git repo
  pushed to a remote). No separate "sync enabled" flag, since two values that
  must agree can disagree: signed out, the sync client opens no socket, arms no
  timer and makes no request (asserted in
  `apps/cli/src/server/cloud/__tests__/sync-runtime.test.ts`), and the app sends
  this project's cloud nothing; what does leave the machine (the update checks,
  the agent's own provider) is `docs/privacy.md`'s to list. Signed in, the
  credential alone entitles threads, captures and the hosted vault, except that
  a folder with an origin of its own, or one another service syncs, never takes
  the hosted vault (AN OPENED FOLDER'S OWN ORIGIN, in
  `apps/cli/src/server/vault/CLAUDE.md`); its threads sync either way. The
  hosted vault's ceiling is a size, not a flag (THE HOSTED VAULT IS CAPPED,
  below), and the invite gate is account-creation policy. The BYO remote is the
  vault's own origin and stays accountless; `INTELIGIR_VAULT_REMOTE` only pins
  one over it. Cost accepted: "pause sync" is signing out, which discards the
  queue. `apps/cli/src/server/cloud/credential-store.ts` and `sync-runtime.ts`.

- **A DEVICE SIGNS IN, OR SIGNS UP, WITH EMAIL + PASSWORD, and gets the same
  device credential** (owner decision, the Obsidian model). `POST
/v1/device/login` verifies the password through Better Auth, mints the device
  credential and deletes the session the sign-in created, so a device holds
  exactly one secret. The answer names the account beside it, `{ credential,
deviceId, userId, email }`, as sign-up's does, and the Mac keeps all four with
  the name it joined under: the vault's cross-account fence
  (`inteligir.account`) and the account's label hold from the first request, a
  fresh clone pins its account at once, and a stored sign-in missing any of them
  reads as signed out. Rejected: a second call to learn the account, which
  leaves a pending state every reader must fail closed on. The phone keeps the
  bearer alone, since nothing it runs asks whose account it is. The credential
  also lists and revokes the account's devices (`GET /v1/device/list` and `POST
/v1/device/revoke` take a session or a live device credential of the same
  account, the `igd_` prefix deciding which), so any signed-in Mac's Settings ›
  Account removes a lost phone with no password asked, as a sign-out asks none;
  the web's devices page stays as the fallback. A Mac's own row offers no Revoke
  and `cloud.revokeDevice` refuses its own id: this device leaves through a
  sign-out, which also forgets its queue. The login route is throttled per
  caller address, because a login route with no throttle is a password oracle.
  Rejected: the browser approve page, the one-time code, PKCE and the loopback
  callback, a ceremony whose point was keeping the password out of the app.
  Residual: the password passes through the app once over HTTPS. No social
  providers: a login that must work inside the app can only be a password. A
  device can also CREATE the account (owner decision: sign up in the app, with
  the invite code): `POST /v1/device/sign-up` answers the same credential and
  deletes the session the sign-up created, so a person never signs in twice in a
  row. The site's sign-up page stays, the phone stays sign-in only, and the CLI
  has no sign-up verb, since creating an account is a person's act.
  `@repo/contract/cloud/device/login-flow.ts`,
  `apps/web/src/worker/device/login.ts`,
  `apps/web/src/worker/device/sign-up.ts`,
  `apps/web/src/worker/device/routes.ts`,
  `apps/workspace/src/app/account-form.tsx`,
  `apps/workspace/src/app/settings/account-section.tsx`.

- **A CREDENTIAL THIS DEVICE DROPS IS REVOKED BY THIS DEVICE, best-effort and
  never waited on.** Forgetting the file alone leaves the row active, and the
  twenty-device cap counts active rows, so repeated sign-ins would lock the
  account out. `POST /v1/device/sign-out` is the dashboard's revoke asked with
  the device's own credential. A sign-out (Settings or the rail; the CLI has no
  logout verb), a login that replaces a live credential, and the phone's
  credential drop send it on a client of their own, since closing the session
  aborts its client's requests, and clear local state without waiting: an
  unreachable cloud must not hold a sign-out open. A revoke the cloud did not
  take is said on the desktop's signed-out status (`revokeError`) until the next
  login or restart; one refused as unauthorized says nothing, since that
  credential is already dead. `apps/web/src/worker/device/routes.ts`,
  `apps/cli/src/server/cloud/sync-runtime.ts`,
  `apps/mobile/src/sync/sync-runtime.ts`,
  `packages/contract/src/cloud/device/login-flow.ts`.

- **AN ACCOUNT IS DELETED FROM THE APP, THE PASSWORD ASKED AGAIN, THROUGH BETTER
  AUTH'S `deleteUser`** (owner decision: someone who lost their Mac signs in on
  any Mac to delete). The app holds a device credential and no session, so `POST
/v1/account/delete` takes the credential, spends a per-device window, checks
  the password through `signInEmail` and runs `deleteUser` under the session
  that sign-in minted: its `beforeDelete` order and tombstone stay the ONE purge
  path, where a second purge beside it would drift. Better Auth's own
  `/delete-user` routes are shut (`disabledPaths`, beside every other route no
  client calls), since they settle for a fresh session where this door asks the
  password; Better Auth carries no bearer plugin, so a browser's session is its
  cookie alone. The credential alone deletes nothing, since whoever holds a
  stolen one could end the account. The local server asks on a client of its
  own, because the purge revokes this very credential first; success forgets the
  sign-in as a sign-out does, minus the revoke, and leaves the vault alone. A
  deletion whose answer never came back may have happened, so the server keeps
  its credential, and a retry that meets only that credential's refusal, or
  finds the session already ended by it, is read as the account gone and signs
  this Mac out; any other refusal proves the account is there. No CLI verb: the
  password is a person's to type. `apps/web/src/worker/device/account.ts`,
  `apps/cli/src/server/cloud/sync-runtime.ts`,
  `apps/workspace/src/app/settings/delete-account-dialog.tsx`.

- **Cloud state names its Durable Object from a VERIFIED credential.** Account
  deletion revokes credentials first, then purges, then writes a tombstone every
  route refuses, because the reorder alone leaves an in-flight request able to
  recreate state. The Worker calls the object by RPC with the verified deviceId
  as an argument, so no forwarded header carries identity; the socket upgrade,
  which only fetch can carry, is the one exception, and its identity lands in
  hibernation tags (`apps/web/src/worker/sync/routes.ts`, `thread-sync-do.ts`).

- **Better Auth's `baseURL` is derived per-request from the request origin, and
  sign-up is invite-gated by a Worker route in front of it.** Every hostname
  reaching this Worker is one the deployment owns, and a fixed fallback would
  mint reset links at the wrong deployment; revisit if a hostname the deployment
  does not control reaches it (`apps/web/src/worker/auth/auth.ts`). The gate has
  two front doors over one atomic claim (`claimInvite` in
  `apps/web/src/worker/auth/invite.ts`): the site's page forwards into the one
  instance with `disableSignUp` off, so the browser keeps Better Auth's cookie;
  the app's (`apps/web/src/worker/device/sign-up.ts`) calls `signUpEmail` on
  that same instance and mints a device credential. Either door releases the
  claim when no account came of it, and both spend one per-address window; every
  other instance carries the flag. `apps/web/README.md` § Auth.

- **The D1 auth schema ships via `drizzle-kit push`; there are no migration
  files.** One deployer and an additive schema; `apps/web/vitest.config.ts`
  derives the test DDL by `drizzle-kit export`. A second deployer or a
  destructive column change is the trigger for migrations.

- **Declare D1 uniques as named unique indexes, never `.unique()`**
  (`apps/web/src/worker/db/schema.ts`). Production D1 holds every unique as
  drizzle-kit 0.31 spelled `.unique()`: `CREATE UNIQUE INDEX
  <table>_<column>_unique`. drizzle-kit 1.0 spells it as an inline `UNIQUE`
  constraint and treats the difference as a table recreate: `PRAGMA
  foreign_keys=OFF; CREATE __new; INSERT; DROP; RENAME`. D1 ignores that PRAGMA,
  so the `DROP` cascades through every `ON DELETE CASCADE` child (`session`,
  `account`, `device`), and `push` applies a recreate without asking. With
  `uniqueIndex("<table>_<column>_unique")` in the table's extra config,
  `drizzle-kit push --explain` against a 0.31-shaped database reports no
  changes; refuse any plan that recreates a table.

- **`@repo/contract/cloud` IS THE CLIENT RUNTIME CORE, not only the wire**:
  `bytes.ts`, `device/login-flow.ts`, `sync/sync-session.ts`,
  `sync/socket-link.ts` and `sync/cloud-socket.ts`. The CLI and the phone inject
  only stores, timers and a socket dial (node's `{ headers }`, React Native's
  third argument: `apps/mobile/src/sync/rn-socket-dial.ts`), because a security
  discipline with two spellings is two to audit, and the socket's keepalive and
  reconnect are one too. The core is what BOTH clients run, so the CLI-only
  browser opener sits beside its consumer
  (`apps/cli/src/server/browser-opener.ts`). The cloud vault-path grammar is
  `parseVaultPath` with the parse required to be the identity, one schema
  (`@repo/notes/knowledge/vault-path-schema`) the phone's editor page parses its
  wire by too. The `[[Title|uuid]]` tier lives in `buildResolver` (tier 0),
  reached through the `id` the wiki-targets rows carry, and on the phone through
  the id and aliases its mirror reads from each note's frontmatter.

- **A /CLOUD CLIENT IGNORES WHAT IT DOES NOT KNOW, the Worker is held to exactly
  what it declares, and the wire breaks only behind the client build floor**
  (owner decision). Every response schema under `@repo/contract/cloud` strips an
  undeclared field, and an unknown refusal code reads as `internal`, a fault to
  retry, never a verdict on the credential. Strict readers made every additive
  change a new route and turned a stale client's `unauthorized` into
  `malformed`, so a revoked device kept retrying; for the same reason a 5xx, 408
  or 429 with no error envelope reads as `unreachable`. Requests stay
  `.strict()`, since only the always-newest Worker parses them, and the Worker's
  tests parse every answer through `emitted`
  (`apps/web/src/worker/__tests__/cloud-helpers.ts`), because a stripping client
  would let a leaked column through. The tolerant reader is forward negotiation
  only, so every request an install makes names its build (`x-inteligir-build:
<semver>+<platform>`: the REST calls, the two that ask for a credential, the
  socket's upgrade and the hosted vault's git `extraHeader`), and the Worker
  refuses an absent or older one before it routes, below `MIN_CLIENT_BUILD`
  (`apps/web/cloudflare.config.ts`): 426 `client-outdated` in the envelope,
  plain text on the git mount, which the engine reads as `outdated`. Semver
  alone is compared; the platform is telemetry. A page the Worker served needs
  no build, since it ships in the same deploy and a browser marks its requests
  same-origin. The refusal is terminal and leaves the credential live: the
  session ends `outdated`, the CLI and the phone ask for an update and retry
  nothing, and the next build resumes as the same device. A shape retires by
  raising the floor past every build that reads it, never while one of them can
  still reach the wire. Rejected: a wire final at birth behind strict readers,
  and per-route versions, which keep every old shape a route ever served. Still
  closed above the floor: a field that changes what a row MEANS reaches only a
  client whose request declares it.
  `packages/contract/src/cloud/client-build.ts`,
  `packages/contract/src/cloud/cloud-client.ts`,
  `packages/contract/src/cloud/cloud-errors.ts`,
  `apps/web/src/worker/client-floor.ts`.

- **Say the delivery guarantee you implement.** The dispatch inbox delivers
  at-least-once to a claimant and settles a row only under the claim that holds
  it, so a Mac's apply of a turn or an answer must be exactly-once on the
  dispatch id, and is: the thread is its ledger (A PHONE ASKS A MAC, below). A
  capture's only ledger is its bullet in `Inbox.md`, which carries no id, so the
  Mac holds an ack that never reached the cloud and sends it before its next
  claim, and the inbox records it under that claim, lapsed or not, until
  another claim takes the row. A restart between the write and the ack can
  still repeat a bullet, chosen over losing one. Rejected: a table of applied
  captures, a second store that repeats a bullet all the same on a crash
  between its write and the vault's, and spares only a restart that also lost
  the ack. `@repo/contract/cloud/dispatch/dispatch-schema`,
  `apps/cli/src/server/cloud/dispatches.ts`,
  `apps/cli/src/server/cloud/sync-pass.ts`.

- **The THREAD channel carries thread events alone, and a thread's own facts are
  events on it** (owner decision). A thread with no events never reaches another
  device; vault bytes ride the git remote. A thread states its title, origin
  note (path and `id`, so no move is ever stated), harness and archive as rows
  on its log (`thread/meta`, `thread/archived` in
  `@repo/domain/provider-event`); a fact about a thread that never made a
  request stays local, since alone it would arrive as an empty action. A stale
  install skips a type it cannot read, so a new event type needs no new route.
  The Worker keeps no per-thread row beside the log (owner decision): a push is
  its events alone, and the dispatch inbox carries what a per-thread lane would.
  `apps/cli/src/server/threads/thread-send.ts`, `thread-ingest.ts`,
  `packages/contract/src/cloud/sync/sync-schema.ts`.

- **A pulled event lands through the SAME ingest, marked with its origin**
  (`ThreadService.applySyncedEvents`): the thread row takes the log's id,
  nothing is re-enqueued, and a settle does not drain this device's queue. The
  cursor moves inside that transaction, which makes the apply exactly-once. A
  synced row carries its origin `(device, position)` under a unique index, since
  signing in again resets the cursor, and the planner skips every device id the
  install has signed in as (`sync_own_devices`, recorded at every session open),
  because each sign-in mints a new id and its own rows carry no origin.
  Lifecycle projects over what landed, never what arrived.
  `apps/cli/src/server/cloud/sync-pass.ts`.

- **Only the process that owns a provider may declare it dead.** Crash recovery
  reads the `turn/started` row's provenance and leaves a remote turn alone; a
  fabricated failure would sync back to the machine still doing the work. A
  device that never returns leaves the thread active here.

- **CONVERGENCE MEANS THE SAME SET, NOT THE SAME ORDER.** `events.sequence` is
  an arrival order per device under a UNIQUE(thread, sequence), so no
  renumbering exists. Pinned: both devices hold the same set and each writer's
  turn stays contiguous. Projecting the account log's global `seq` instead is
  the change if a shared interleave is ever needed.

- **A SYNC PASS IS FENCED BY SESSION IDENTITY, not by "is a session live?".**
  Every step re-checks the id after every await, because the dangerous case is a
  different sign-in: an old ack deletes rows a later sign-in queued. `dispose`
  aborts too. The fence is `@repo/contract/cloud/sync/sync-session.ts`.

- **A SYNC PASS IS CAPPED, A CAPPED PASS IS FOLLOWED AT ONCE, AND "SYNCED" MEANS
  EVERY STEP REACHED THE CLOUD AND LEFT NOTHING.** Each step answers where it
  stopped (`SyncOutcome` in `@repo/contract/cloud/sync/sync-session`). The cap
  stays because a teardown waits out the pass in flight; on `more` the next pass
  runs at once, so a backlog drains in one sync. Only a pass whose every step
  caught up stamps `lastSyncedAt`. A throw other than a row the log refuses
  fails the pass with the cursor unmoved, because moving past it would lose the
  row for good. The status reaches the page on the bus's `sync-status-changed`,
  so nothing polls it; the socket drops itself after two silent keepalives,
  since a half-open connection neither answers nor closes.
  `apps/cli/src/server/cloud/sync-pass.ts`, `sync-runtime.ts` and
  `packages/contract/src/cloud/sync/cloud-socket.ts`.

- **The outbox stores the bytes it will send, once, at enqueue.** The log calls
  a position replayed with a different body `sync-conflict`; `deviceSeq` is its
  own counter, not `MAX()` over a shrinking queue. A body over the row cap is
  CLIPPED before it is frozen, never dropped, because a dropped `item/completed`
  leaves its item pending on every other device forever:
  `clipThreadEventForSync` (`@repo/contract/cloud/sync/fit-sync-event`) elides
  the middle of the largest texts and never a type, an id, a status or a scope.
  An event the contract still refuses is dropped rather than stranding every
  event behind it, and so is every row a log refusal names; each drop is COUNTED
  in the delete's own transaction (`sync_state.dropped_events`) and shown until
  sign-out, because the last error it raises is cleared by the next good pass
  while the loss is not (`apps/cli/src/server/cloud/outbox.ts`,
  `packages/db/src/sync-outbox.ts`).

- **A PULLED ROW THIS BUILD CANNOT READ IS PULLED AGAIN BY THE NEXT BUILD.** The
  planner moves the cursor past a foreign row its grammar refuses, because the
  rows behind it must still land; the pass records the lowest such row with the
  running build, and a session opened under a different build rewinds to it
  (`takeRewindIfBuildChanged` in `packages/db/src/sync-outbox.ts`, from
  `apps/cli/src/server/cloud/sync-runtime.ts`). A row filed under one thread
  whose event names another is skipped too, never recorded, since no build reads
  it differently. Rejected: `meta.schema_version` as the trigger, which counts
  migrations while a new event type ships without one; a table of raw skipped
  rows, a second store beside the log; and refusing a mismatched row at each
  client's apply, a second answer the phone, keying by the envelope, would not
  give. The phone keeps its threads in its database with the digest of the event
  grammar that parsed them, and a build whose grammar differs pulls from 0,
  since its held events lost what the old grammar did not name; each pulled page
  is one transaction with the cursor, so a cold launch lists the threads offline
  and pulls on from its cursor (`apps/mobile/src/sync/sqlite-sync-store.ts`).

- **THE HOSTED VAULT'S PATHS ARE BUDGETED PER DEVICE, and the budget buys time,
  not prevention.** The `/v1/vault/*` reads, `/v1/vault/commit` and `/v1/git/*`
  each consume a window keyed on the device, never the address: a stolen
  credential moves between addresses and the device row is what `/app/devices`
  revokes. Three families so a drained budget never takes another down, a
  looping phone writer included; each ceiling is set from the worst legitimate
  minute (a phone's first mirror for reads, a queue draining one change set at a
  time for writes), and revocation is the control
  (`apps/web/src/worker/rate-limit.ts`). A read-scoped credential is the deeper
  answer and is not built; the trigger is a second party holding a credential
  for someone else's account.

- **THE HOSTED TREE IS WALKED ONCE PER HEAD INTO ONE SLOT PER REPO, AND A MIRROR
  READ IS PINNED AND BATCHED.** Every directory is a call into the repo cell a
  push also waits on, so a head's listing, each blob's `oid` included, is kept
  in R2 tagged with its commit: one slot, not a key per commit, which would keep
  an object for every head any device ever listed, and a cache failure is a
  miss, never a refusal (`apps/web/src/worker/vault/tree-walk.ts`, pure over a
  `listTree` port, and `tree-listing.ts`); a slot that fails its parse is walked
  again. A phone holds every note's text, so it fetches only what changed, forty
  paths to a `POST /v1/vault/files` that spends one read unit; one
  `/v1/vault/file` per note made a 5,000-note first mirror 5,000 requests
  against the device's budget. `ref` is REQUIRED on the batch, because a batch
  read at a head a push moved would hand the mirror bytes its listing never
  named. Forty because each path is a cell call and a Free invocation makes at
  most 50 subrequests; past the byte budget the rest is `deferred`, never the
  first file. `packages/contract/src/cloud/vault/vault-schema.ts`,
  `apps/web/src/worker/vault/read-routes.ts`.

- **A PHONE WRITE IS ONE CHANGE SET OF BLOB-CAS'D CHANGES, AND THE WORKER
  COMMITS IT THROUGH THE CELL'S OWN RECEIVE-PACK.** `POST /v1/vault/commit`
  takes puts, deletes and moves, each naming the blob it was computed from
  (null: the path must be absent), so a rename's link rewrites, a photo and the
  note embedding it, or a merge and its conflict copy land together, on the head
  they were checked against or not at all. A stale base answers 409
  `vault-conflict` with what the head holds and the device that last wrote it,
  beside the ordinary envelope so an envelope-only reader still names the
  refusal; the Worker never merges. A change whose target the head already holds
  is satisfied, which makes an offline queue's resend harmless with no
  idempotency key, a second store the Worker would have to keep and expire. The
  base is a blob oid, not a commit, so a desktop push of another note between
  the phone's read and its write does not refuse it. An account with no hosted
  vault yet is refused, never created: the Mac's first push creates it.
  durable-git's `RepoCell` answers reads alone, and its one write path, a push,
  already guards each ref with a CAS on a serialized chain, so the Worker builds
  the git objects itself (`apps/web/src/worker/vault/git-objects.ts`) and pushes
  them through the one door every push takes (`receive-pack.ts`). Rejected:
  patching a write RPC into durable-git, a second writer with its own locking
  beside the push chain. A tree whose listing does not hash back to its own oid,
  and a name a sibling holds in another case or normalization, are refused
  rather than guessed, since the cell decodes names leniently and a Mac cannot
  hold both. Author and committer name the device (the committer's email marking
  the Worker), because a conflict copy names the other device from the
  committer. `packages/contract/src/cloud/vault/vault-commit-schema.ts`,
  `apps/web/src/worker/vault/commit-route.ts`,
  `apps/web/src/worker/vault/commit-changes.ts`.

- **THE HOSTED VAULT IS CAPPED ON WHAT THE CELL STORES, AND TAKES A PUSH OF AT
  MOST 90 MiB** (owner decision: free, about 1 GB an account, every stored
  version counted, so deleting notes frees nothing, and no compaction in 0.6; a
  stated push cap now, large files later). `VAULT_STORAGE_CAP_BYTES` in
  `apps/web/cloudflare.config.ts` is the ceiling and `RepoCell.usage()`, a pnpm
  patch over durable-git (`patches/durable-git@0.0.8.patch`), the cell's own
  size: its SQLite file plus the packs it keeps in R2, not the gc guard's sum,
  which counts a SQLite-held pack twice. `VAULT_GIT_MAX_PUSH_BYTES`
  (`packages/contract/src/cloud/vault/vault-git.ts`) sits under the edge's 100
  MB request body, so the 413 is always the Worker's own. ONE gate, in
  `apps/web/src/worker/vault/receive-pack.ts`, meets every pack headed for a
  cell, a desktop's push and a phone's commit alike, so the two cannot disagree:
  a full vault is refused before the body is read, a declared length past the
  room left is refused, and a streamed body is cut at the tighter of the room
  and the push cap; reads are never refused for size. The engine reads a 507 as
  `full`, not the offline a 5xx would be, and skips a push while the tips a
  refusal named still stand, since each retry would upload the cap's worth
  again, while commits land and pulls go on
  (`apps/cli/src/server/vault/git-engine.ts`); the phone keeps the refused edits
  queued. The first refusal costs no upload either: a push to the account remote
  is measured first (`packExceeds` in `apps/cli/src/server/vault/git-run.ts`).
  Rejected: splitting the push into commit-sized steps, since a vault's first
  commit is the whole tree; a Worker-side meter, which counts bytes offered, not
  kept; and the head tree's size, which ignores the history that grows.

- **A PHONE ASKS A MAC THROUGH A CLAIMABLE DISPATCH INBOX, THE REQUEST LANDS
  THROUGH THE MAC'S OWN SEND, AND THE THREAD IS ITS LEDGER** (owner decision).
  The phone never pushes to the log, so a request cannot ride it: a `turn` row
  waits in the account's `ThreadSyncDO`, any Mac may claim it and the first
  claim wins, and it pings the sockets of the Macs that take a phone's requests
  with a `dispatch` frame. A CAPTURE RIDES THE SAME INBOX: a `capture` row is a
  line for `Inbox.md`, kept in the phone's `dispatch_outbox` until a Mac says it
  wrote it, so one typed offline is sent after a relaunch; every Mac's socket is
  pinged with a thread-less `dispatch` frame, and a Mac claims captures whether
  or not it takes the phone's requests, and before its pull has caught up,
  since no log holds them. A claim names the kinds its Mac applies, so a kind a
  newer phone sends never reaches a build that would read it as another.
  Rejected: a capture lane of its own, whose phone end held the words in
  memory, so a capture typed offline was lost on relaunch, beside a second
  claim, ack and ledger that only ever appended a bullet. Delivery is
  at-least-once to a claimant and a Mac's apply of a turn or an answer
  exactly-once on the dispatch id, while a capture can repeat its bullet (Say
  the delivery guarantee you implement, above); the phone mints the id, so a
  resend is one row
  (`packages/contract/src/cloud/dispatch/dispatch-schema.ts`,
  `apps/web/src/worker/sync/dispatch-inbox.ts`). The Mac hands each claimed row
  to `ThreadService.acceptDispatch`, which runs the send's own decision, so a
  request starts, queues or is refused as a message typed here would. No table
  records a claim: the request row or the queued message carrying the
  `dispatchId` is the ledger (`threadHoldsDispatch` in `@repo/db/events`), so a
  lapsed claim handed over again, or one another Mac ran, acks with no second
  turn. A thread whose turn another device runs is refused, since the request
  would wait on a queue a remote settle never drains; a signed-out agent is
  delivered, and its `provider/error` is what the phone reads. A new thread
  binds its note by `noteIdOf`, read and never minted, because a mint waits on
  the vault's lock and a claim held past its lapse runs on a second Mac. A
  PHONE-STARTED TURN'S APPROVAL is answered on the phone (owner decision): the
  Mac holding its waiter opens it in the inbox, and the phone's `answer` is a
  row only that Mac may claim. Let my phone ask this Mac (Settings › Account,
  `<dataDir>/cloud-prefs.json`, on unless turned off, owner decision) is read
  per pass and said on the socket's upgrade (`SYNC_WS_PHONE_REQUESTS_PARAM`), so
  the phone's "a Mac is listening" counts only Macs that would claim, the status
  counting the open Macs with it off beside them (`desktopsDeclining`), so the
  phone's waiting caption names the switch rather than asking for a Mac to be
  opened. Rejected: the `thread_meta` lane, which carried no message and no
  claim, so two Macs would both run it, and which every desktop push overwrote;
  and the phone as a log pusher, which would give it an outbox and a `deviceSeq`
  of its own. Residual: a follow-up one Mac claims on a thread another Mac ran
  opens a fresh provider session there.
  `apps/cli/src/server/cloud/dispatches.ts`,
  `apps/cli/src/server/cloud/sync-pass.ts`,
  `apps/cli/src/server/threads/thread-send.ts`.

- **A VAULT READ CARRIES ITS PATH IN THE BODY, NEVER THE URL.** Cloudflare keeps
  each request's URL in the Worker's request log and in its sampled traces for
  up to seven days, and a vault path names a user's file, so the tree, file and
  asset reads POST their query (`packages/contract/src/cloud/cloud-client.ts`);
  the Worker refuses any other method `bad-request` before it reads the
  credential and parses the body alone, with one schema per read (`parseRead` in
  `apps/web/src/worker/vault/read-routes.ts`). Rejected: turning the invocation
  log off, which leaves the traces' URLs and takes the operator's one view of a
  failing route, and reads addressed by blob oid, which the asset route cannot
  type or size-gate without the path. `docs/privacy.md` says what the log keeps;
  the phone's fake vault refuses a read that is not a POST or carries a query
  string (`apps/mobile/src/notes/__tests__/fake-vault.ts`).

- **A PR PREVIEW IS A WORKER PREVIEW DRIVEN BY ACTIONS, not Workers Builds**,
  and it binds preview-only resources. Workers Builds would deploy on push and
  could not wait for CI, so previews ride `workflow_run` after CI like Deploy
  does (which also keeps them out of the CI-parity sweep), limited to this
  repo's branches because that trigger holds secrets. A preview inherits no
  binding, so `apps/web/cloudflare.config.ts` binds each, when `isPreview`,
  against `inteligir-auth-preview` / `inteligir-vault-preview`; pointing a
  preview at the production D1 was rejected, since PR code would write real
  accounts. The status is one sticky comment plus a GitHub deployment on the
  head commit (`.github/scripts/worker-preview.mjs`), created by the script
  because a job's `environment:` under `workflow_run` records the default
  branch. `.github/workflows/preview.yml`, `apps/web/README.md` § Previews.

- **THE DISPATCH INBOX'S RULES ARE ONE TABLE, AND THE CLI'S FAKE CLOUD AND THE
  WORKER BOTH ANSWER IT.** The local server's suites run against a fake cloud
  over Maps (`apps/cli/src/server/cloud/__tests__/fake-cloud.ts`), so a refusal
  or ordering rule of the dispatch inbox it spelled its own way would pass
  there and fail deployed. `INBOX_SCENARIOS`
  (`@repo/contract/cloud/test-support/inbox-scenarios`) drives each rule through
  the real cloud client and observes ids, states and texts, never a clock or a
  token; the CLI runs it against the fake and the Worker's pool-workers suite
  against the object (`apps/web/src/worker/__tests__/inbox-scenarios.test.ts`),
  holding every answer to its declared shape. A rule both sides answer goes in
  the table, not in one side's suite. Rejected for now: running
  `dispatch-inbox.ts` itself in the fake over a shared `SqlStorage` port, a
  package of its own, whose trigger is the table catching drift more than once.
