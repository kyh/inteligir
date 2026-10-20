# Decisions: @repo/web and the cloud

Accounts, the device credential, the /cloud wire, the account's socket and the
hosted vault. `AGENTS.md` § Decisions says how a bullet is written and
cited.

## Cloud, sync and accounts

- **THE DEVICE CREDENTIAL IS THE SYNC SWITCH AND THE ENTITLEMENT, and it lives
  in the data dir**: not in `inteligir.db` and not in the vault (a git repo
  pushed to a remote). No separate "sync enabled" flag, since two values that
  must agree can disagree: signed out, the app sends this project's cloud
  nothing (`docs/privacy.md` lists what does leave the machine). Signed in, the
  credential alone entitles the hosted vault and the account's socket, except
  that a folder with an origin of its own, or one another service syncs, never
  takes the hosted vault (AN OPENED FOLDER'S OWN ORIGIN, in
  `apps/cli/src/server/vault/CLAUDE.md`). Its ceiling is a size, not a flag
  (THE HOSTED VAULT IS CAPPED, below), and the BYO remote stays accountless.
  Cost accepted: "pause sync" is signing out.
  `apps/cli/src/server/cloud/credential-store.ts`, `sync-runtime.ts`.

- **A DEVICE SIGNS IN, OR SIGNS UP, WITH EMAIL + PASSWORD, and gets the same
  device credential** (owner decision, the Obsidian model). The login mints the
  credential and deletes the session the sign-in created, so a device holds
  exactly one secret, and its answer names the account beside it, so the vault's
  cross-account fence and the account's label hold from the first request.
  Rejected: a second call to learn the account, which leaves a pending state
  every reader must fail closed on. The phone keeps the bearer alone, since
  nothing it runs asks whose account it is. The login route is throttled per
  caller address, because a login route with no throttle is a password oracle.
  Rejected: the browser approve page, the one-time code, PKCE and the loopback
  callback, a ceremony whose point was keeping the password out of the app.
  Residual: the password passes through the app once over HTTPS. No social
  providers: a login that must work inside the app can only be a password.
  `@repo/contract/cloud/device/login-flow.ts`,
  `apps/web/src/worker/device/login.ts`.

- **A DEVICE CAN ALSO CREATE THE ACCOUNT** (owner decision: sign up in the app,
  with the invite code). The sign-up answers the same credential and deletes the
  session it created, so a person never signs in twice in a row. The site's
  sign-up page stays, the phone stays sign-in only, and the CLI has no sign-up
  verb, since creating an account is a person's act.
  `apps/web/src/worker/device/sign-up.ts`,
  `apps/workspace/src/app/account-form.tsx`.

- **A DEVICE CREDENTIAL LISTS AND REVOKES ITS ACCOUNT'S DEVICES**, so any
  signed-in Mac's Settings › Account removes a lost phone with no password
  asked, as a sign-out asks none; the web's devices page stays as the fallback.
  A Mac's own row offers no Revoke: this device leaves through a sign-out. `apps/web/src/worker/device/routes.ts`,
  `apps/workspace/src/app/settings/account-section.tsx`.

- **A CREDENTIAL THIS DEVICE DROPS IS REVOKED BY THIS DEVICE, best-effort and
  never waited on.** Forgetting the file alone leaves the row active, and the
  twenty-device cap counts active rows, so repeated sign-ins would lock the
  account out. A sign-out (the CLI has no logout verb), a login that replaces a
  live credential and the phone's credential drop each revoke on a client of
  their own, since closing the session aborts its client's requests, and clear
  local state without waiting: an unreachable cloud must not hold a sign-out
  open. A revoke the cloud did not take is said on the signed-out status until
  the next login or restart. `apps/cli/src/server/cloud/sync-runtime.ts`,
  `apps/mobile/src/sync/sync-runtime.ts`.

- **AN ACCOUNT IS DELETED FROM THE APP, THE PASSWORD ASKED AGAIN, THROUGH BETTER
  AUTH'S `deleteUser`** (owner decision: someone who lost their Mac signs in on
  any Mac to delete). The app holds a device credential and no session, so the
  password check mints the session `deleteUser` runs under: its `beforeDelete`
  order and tombstone stay the ONE purge path, where a second purge beside it
  would drift. Better Auth's own delete routes are shut, since they settle for a
  fresh session where this door asks the password, and Better Auth carries no
  bearer plugin, so a browser's session is its cookie alone. The credential
  alone deletes nothing, since whoever holds a stolen one could end the account.
  Success forgets the sign-in and leaves the vault alone; a deletion whose
  answer never came back may have happened, so the server keeps its credential
  and reads a retry that meets only that credential's refusal as the account
  gone. No CLI verb: the password is a person's to type.
  `apps/web/src/worker/device/account.ts`,
  `apps/cli/src/server/cloud/account-calls.ts`.

- **THE ACCOUNT'S SOCKET IS AN OBJECT THAT STORES NOTHING, NAMED FROM A
  VERIFIED CREDENTIAL.** `AccountSocketDO`, one per account, holds its devices'
  hibernating sockets and no row: a hosted-vault push pings the other devices,
  a revoke closes that device's sockets, a deletion closes them all. The Worker
  verifies the credential and stamps the device id on the upgrade, the one
  request only fetch can carry, and the object keeps it in hibernation tags;
  every other call is RPC with the verified id. With nothing stored, a request
  racing the deletion leaves nothing to purge, so there is no tombstone.
  Rejected: the socket on an object that also keeps a log nobody reads.
  `apps/web/src/worker/sync/account-socket-do.ts`, `account-socket-stub.ts`,
  `routes.ts`.

- **Better Auth's `baseURL` is derived per-request from the request origin, and
  sign-up is invite-gated by a Worker route in front of it.** Every hostname
  reaching this Worker is one the deployment owns, and a fixed fallback would
  mint reset links at the wrong deployment; revisit if a hostname the deployment
  does not control reaches it (`apps/web/src/worker/auth/auth.ts`). The gate has
  two front doors, the site's page and the app's sign-up, over one atomic claim
  either door releases when no account came of it; every other auth instance
  keeps sign-up off. `apps/web/src/worker/auth/invite.ts`, `apps/web/README.md`
  § Auth.

- **The D1 auth schema ships via `drizzle-kit push`; there are no migration
  files.** One deployer and an additive schema; `apps/web/vitest.config.ts`
  derives the test DDL by `drizzle-kit export`. A second deployer or a
  destructive column change is the trigger for migrations.

- **Declare D1 uniques as named unique indexes, never `.unique()`**
  (`apps/web/src/worker/db/schema.ts`). Production D1 holds every unique as
  drizzle-kit 0.31's `<table>_<column>_unique` index; drizzle-kit 1.0 plans the
  inline `.unique()` it now spells as a table recreate, whose `DROP` cascades
  through every `ON DELETE CASCADE` child because D1 ignores `PRAGMA
  foreign_keys=OFF`, and `push` applies it without asking. With
  `uniqueIndex("<table>_<column>_unique")`, `drizzle-kit push --explain` against
  a 0.31-shaped database reports no changes; refuse any plan that recreates a
  table (`tools/repo-guards/src/d1-unique-index.test.ts`).

- **`@repo/contract/cloud` IS THE CLIENT RUNTIME CORE, not only the wire**: the
  login flow, the sync session, the sign-in check and the socket's keepalive and
  reconnect are code
  BOTH clients run, injecting only stores, timers and a socket dial, because a
  security discipline with two spellings is two to audit. What only the CLI
  runs, such as the browser opener, sits beside its consumer. The cloud
  vault-path grammar is `parseVaultPath`, the parse required to be the identity,
  in one schema (`@repo/notes/knowledge/vault-path-schema`) the phone's editor
  page parses its wire by too, and a `[[Title|uuid]]` link resolves by the id
  each note's frontmatter carries on the phone as on the desktop
  (`buildResolver`).

- **A /CLOUD CLIENT IGNORES WHAT IT DOES NOT KNOW, the Worker is held to exactly
  what it declares, and the wire breaks only behind the client build floor**
  (owner decision). Every response schema under `@repo/contract/cloud` strips an
  undeclared field, and an unknown refusal code reads as a fault to retry, never
  a verdict on the credential: strict readers made every additive change a new
  route and turned a stale client's `unauthorized` into `malformed`, so a
  revoked device kept retrying. Requests stay `z.strictObject`, since only the
  always-newest Worker parses them, and the Worker's tests parse every answer
  through its declared schema, because a stripping client would let a leaked
  column through. The tolerant reader is forward negotiation only, so every
  request an install makes names its build and the Worker refuses an absent or
  older one below `MIN_CLIENT_BUILD`; a page the Worker served needs none, since
  it ships in the same deploy. The refusal is terminal and leaves the credential
  live, so the next build resumes as the same device. A shape retires by raising
  the floor past every build that reads it, never while one of them can still
  reach the wire. Rejected: a wire final at birth behind strict readers, and
  per-route versions, which keep every old shape a route ever served. Still
  closed above the floor: a field that changes what a row MEANS reaches only a
  client whose request declares it.
  `packages/contract/src/cloud/client-build.ts`,
  `apps/web/src/worker/client-floor.ts`.

- **A SIGN-IN IS FENCED BY SESSION IDENTITY, not by "is a session live?".**
  Every request under a sign-in re-checks the id after every await, because
  the dangerous case is a different sign-in: an old answer retires outbox rows
  a later sign-in queued, or a late refusal ends the next sign-in. `dispose`
  aborts too. The fence is `@repo/contract/cloud/sync/sync-session.ts`.

- **A REVOCATION IS HEARD BY A CHECK OF THE SIGN-IN, AND THE SOCKET ONLY HURRIES
  IT.** Only an http refusal ends a sign-in, so both clients run `checkSignIn`
  (`@repo/contract/cloud/sync/sync-session.ts`), the device list, the cheapest
  call a credential makes, as the sign-in starts, as the socket opens, when the
  cloud closes a revoked device's socket, and on a minute's timer; any other
  request that hears a refusal ends the sign-in too. The socket drops itself
  after two silent keepalives, since a half-open connection neither answers
  nor closes. Rejected: a log polled only to carry the verdict.
  `apps/cli/src/server/cloud/sync-runtime.ts`,
  `apps/mobile/src/sync/sync-runtime.ts`,
  `packages/contract/src/cloud/sync/cloud-socket.ts`.

- **THE HOSTED VAULT'S PATHS ARE BUDGETED PER DEVICE, and the budget buys time,
  not prevention.** Reads, writes and git each consume a window keyed on the
  device, never the address: a stolen credential moves between addresses and the
  device row is what revocation removes. Three families so a drained budget
  never takes another down, a looping phone writer included; each ceiling is set
  from the worst legitimate minute, and revocation is the control
  (`apps/web/src/worker/rate-limit.ts`). A read-scoped credential is the deeper
  answer and is not built; the trigger is a second party holding a credential
  for someone else's account.

- **THE HOSTED TREE IS WALKED ONCE PER HEAD INTO ONE SLOT PER REPO, AND A MIRROR
  READ IS PINNED AND BATCHED.** Every directory is a call into the repo cell a
  push also waits on, so a head's listing is kept in R2 tagged with its commit:
  one slot, not a key per commit, which would keep an object for every head any
  device ever listed, and a cache failure is a miss, never a refusal. A phone
  holds every note's text, so it fetches only what changed, forty paths a
  request, since one request per note made a 5,000-note first mirror 5,000
  requests against the device's budget. The batch names the head it reads,
  because a read at a head a push moved would hand the mirror bytes its listing
  never named. Forty because each path is a cell call and a Free invocation
  makes at most 50 subrequests; past the byte budget the rest is deferred, never
  the first file. `apps/web/src/worker/vault/tree-walk.ts`, `read-routes.ts`.

- **A PHONE WRITE IS ONE CHANGE SET OF BLOB-CAS'D CHANGES, AND THE WORKER
  COMMITS IT THROUGH THE CELL'S OWN RECEIVE-PACK.** Each change names the blob
  it was computed from, so a rename's link rewrites, a photo and the note
  embedding it, or a merge and its conflict copy land together, on the head they
  were checked against or not at all; a stale base is refused with what the head
  holds, and the Worker never merges. A change whose target the head already
  holds is satisfied, which makes an offline queue's resend harmless with no
  idempotency key, a second store the Worker would have to keep and expire. The
  base is a blob, not a commit, so a desktop push of another note between the
  phone's read and its write does not refuse it. An account with no hosted vault
  yet is refused, never created: the Mac's first push creates it. The cell's one
  write path, a push, already guards each ref with a CAS on a serialized chain,
  so the Worker builds the git objects itself and pushes them through the one
  door every push takes. Rejected: patching a write RPC into durable-git, a
  second writer with its own locking beside the push chain. A tree that does not
  hash back to its own oid, and a name a sibling holds in another case or
  normalization, are refused rather than guessed, since the cell decodes names
  leniently and a Mac cannot hold both. Author and committer name the device,
  because a conflict copy names the other device from the committer.
  `apps/web/src/worker/vault/commit-route.ts`, `commit-changes.ts`,
  `plan-change-set.ts`.

- **THE HOSTED VAULT IS CAPPED ON WHAT THE CELL STORES, AND TAKES A PUSH OF AT
  MOST 90 MiB** (owner decision: free, about 1 GB an account, every stored
  version counted, so deleting notes frees nothing, and no compaction in 0.6; a
  stated push cap now, large files later). The cell's own size is a pnpm patch
  over durable-git (`patches/durable-git@0.0.8.patch`): its SQLite file plus the
  packs it keeps in R2, not the gc guard's sum, which counts a SQLite-held pack
  twice. The push cap sits under the edge's 100 MB request body, so the refusal
  is always the Worker's own. ONE gate meets every pack headed for a cell, a
  desktop's push and a phone's commit alike, so the two cannot disagree; reads
  are never refused for size. The engine reads a full vault as `full`, not
  offline, and skips a push while the tips a refusal named still stand, since
  each retry would upload the cap's worth again, while commits land and pulls go
  on; the phone keeps the refused edits queued. The first refusal costs no
  upload either: a push to the account remote is measured first. Commits are
  budgeted (at most 32 MiB of new bytes each, a vault's first commit included,
  and no file over 10 MiB in any), so a history past the cap steps through its
  unpushed commits, each push the newest prefix under the cap, and only a single
  commit over the cap is refused as too-large. Rejected: one push of the whole
  history, which a large first commit or an import could never send; a
  Worker-side meter, which counts bytes offered, not kept; and the head tree's
  size, which ignores the history that grows.
  `apps/web/cloudflare.config.ts`, `apps/web/src/worker/vault/receive-pack.ts`,
  `apps/cli/src/server/vault/git-engine.ts`, `apps/cli/src/server/vault/git-stage.ts`.

- **THE PHONE ASKS NO AGENT, AND THE ACCOUNT CARRIES NO THREAD** (owner
  decision: the phone saves, reads and writes, as Raindrop's and Obsidian's
  do). A thread lives in the database of the Mac that ran it, and its edits
  reach other devices as the library's commits; a phone that wants the agent
  asks on a Mac. `ThreadSyncDO` is a deleted export, which removes every object
  of it and its storage on deploy, and no class of that name is exported; the
  entry stays until every deployment has applied it. Rejected: a thread log
  every device pulls and an inbox a Mac polls, a second store and sync beside
  the library's for transcripts no other device edits.
  `apps/web/cloudflare.config.ts`.

- **A VAULT READ CARRIES ITS PATH IN THE BODY, NEVER THE URL.** Cloudflare keeps
  each request's URL in the Worker's request log and in its sampled traces for
  up to seven days, and a vault path names a user's file, so the tree, file and
  asset reads POST their query, and the Worker refuses any other method before
  it reads the credential. Rejected: turning the invocation log off, which
  leaves the traces' URLs and takes the operator's one view of a failing route,
  and reads addressed by blob oid, which the asset route cannot type or
  size-gate without the path. `docs/privacy.md` says what the log keeps.
  `apps/web/src/worker/vault/read-routes.ts`.

- **A PR PREVIEW IS A WORKER PREVIEW DRIVEN BY ACTIONS, not Workers Builds**,
  and it binds preview-only resources. Workers Builds would deploy on push and
  could not wait for CI, so previews ride `workflow_run` after CI like Deploy
  does, limited to this repo's branches because that trigger holds secrets. A
  preview inherits no binding, so `apps/web/cloudflare.config.ts` binds each to
  a preview-only resource; pointing a preview at the production D1 was rejected,
  since PR code would write real accounts. The GitHub deployment on the head
  commit is created by the script (`.github/scripts/worker-preview.mjs`),
  because a job's `environment:` under `workflow_run` records the default
  branch. `.github/workflows/preview.yml`, `apps/web/README.md` § Previews.
