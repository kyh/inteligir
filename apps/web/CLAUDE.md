# Decisions: @repo/web and the cloud

Accounts, the device credential, the /cloud wire, the account's socket and the
hosted vault. `AGENTS.md` § Decisions says how a bullet is written and cited.

## Cloud, sync and accounts

- **THE DEVICE CREDENTIAL IS THE SYNC SWITCH AND THE ENTITLEMENT, and it lives
  in the data dir**, not in `inteligir.db` or the pushed vault. Signed out, the
  app sends this project's cloud nothing; signed in, the credential alone
  entitles the account's socket and the hosted vault (capped, below), which a
  folder with its own origin, or one another service syncs, never takes (AN
  OPENED FOLDER'S OWN ORIGIN, in `apps/cli/src/server/vault/CLAUDE.md`).
  Rejected: a separate "sync enabled" flag (two values that must agree can
  disagree). Cost accepted: "pause sync" is signing out.
  `apps/cli/src/server/cloud/credential-store.ts`, `sync-runtime.ts`.

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
  A Mac's own row offers no Revoke: this device leaves through a sign-out.
  `apps/web/src/worker/device/routes.ts`,
  `apps/workspace/src/app/settings/account-section.tsx`.

- **A CREDENTIAL THIS DEVICE DROPS IS REVOKED BY THIS DEVICE, best-effort and
  never waited on.** A sign-out (the CLI has no logout verb), a login replacing
  a live credential and the phone's credential drop each revoke on a client of
  their own, since closing the session aborts its client's requests, and clear
  local state at once, since an unreachable cloud must not hold a sign-out open;
  a revoke the cloud did not take shows on the signed-out status until the next
  login or restart. Rejected: forgetting the file alone (the row stays active
  against the twenty-device cap, so repeated sign-ins lock the account out).
  `apps/cli/src/server/cloud/sync-runtime.ts`,
  `apps/mobile/src/sync/sync-runtime.ts`.

- **AN ACCOUNT IS DELETED FROM THE APP, THE PASSWORD ASKED AGAIN, THROUGH BETTER
  AUTH'S `deleteUser`** (owner decision: whoever lost their Mac deletes from any
  Mac). The password check mints the session `deleteUser` runs under, keeping
  its `beforeDelete` order and tombstone the ONE purge path; Better Auth's
  delete routes, which settle for a fresh session, are shut, and with no bearer
  plugin a browser's session is its cookie. Success forgets the sign-in, not
  the vault; after an unanswered deletion, a retry meeting only the kept
  credential's refusal means the account is gone. No CLI verb: a person types
  the password. Rejected: a second purge path (it drifts); deleting by
  credential alone (a stolen one ends the account).
  `apps/web/src/worker/device/account.ts`,
  `apps/cli/src/server/cloud/account-calls.ts`.

- **THE ACCOUNT'S SOCKET IS AN OBJECT THAT STORES NOTHING, NAMED FROM A
  VERIFIED CREDENTIAL.** `AccountSocketDO`, one per account, holds its devices'
  hibernating sockets and no row: a hosted-vault push pings the other devices, a
  revoke closes that device's sockets, a deletion closes them all. The Worker
  stamps the verified device id on the upgrade, the one request only fetch
  carries, and the object keeps it in hibernation tags; every other call is RPC
  with that id. Storing nothing, it needs no tombstone against a request racing
  the deletion. Rejected: the socket on an object that also keeps a log nobody
  reads. `apps/web/src/worker/sync/account-socket-do.ts`,
  `account-socket-stub.ts`, `routes.ts`.

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
  files.** One deployer and an additive schema; `apps/web/vitest.config.ts`
  derives the test DDL by `drizzle-kit export`. A second deployer or a
  destructive column change is the trigger for migrations.

- **Declare D1 uniques as named unique indexes, never `.unique()`**
  (`apps/web/src/worker/db/schema.ts`). Production D1 holds every unique as
  drizzle-kit 0.31's `<table>_<column>_unique` index, which
  `uniqueIndex("<table>_<column>_unique")` matches, so `drizzle-kit push
  --explain` reports no changes; refuse any plan that recreates a table
  (`tools/repo-guards/src/d1-unique-index.test.ts`). Rejected: inline
  `.unique()`, which drizzle-kit 1.0 plans as a table recreate whose `DROP`
  cascades through every `ON DELETE CASCADE` child (D1 ignores `PRAGMA
  foreign_keys=OFF`), and `push` applies it without asking.

- **`@repo/contract/cloud` IS THE CLIENT RUNTIME CORE, not only the wire**: the
  login flow, the sync session, the sign-in check and the socket's keepalive and
  reconnect are code BOTH clients run, injecting only stores, timers and a
  socket dial, since a security discipline with two spellings is two to audit;
  what only the CLI runs sits beside its consumer. Vault paths parse by
  `parseVaultPath`, required to be the identity, in one schema
  (`@repo/notes/knowledge/vault-path-schema`) the phone's editor page parses its
  wire by too, and a `[[Title|uuid]]` link resolves by the frontmatter id on the
  phone as on the desktop (`buildResolver`).

- **A /CLOUD CLIENT IGNORES WHAT IT DOES NOT KNOW, the Worker is held to exactly
  what it declares, and the wire breaks only behind the client build floor**
  (owner decision; the floor is EVERY INSTALL'S REQUEST NAMES ITS BUILD).
  Responses under `@repo/contract/cloud` strip undeclared fields and read an
  unknown refusal code as a fault to retry, not a credential verdict; requests
  stay `z.strictObject` (only the newest Worker reads them), and the Worker's
  tests parse every answer through its declared schema, lest stripping hide a
  leaked column. A shape retires only once the floor passes every build reading
  it, and a field that changes what a row MEANS reaches only clients declaring
  it. Rejected: a wire final at birth behind strict readers (every addition a
  new route; a revoked device read `unauthorized` as `malformed` and kept
  retrying); per-route versions (every old shape kept).
  `packages/contract/src/cloud/cloud-errors.ts`.

- **EVERY INSTALL'S REQUEST NAMES ITS BUILD, AND THE WORKER REFUSES ONE BELOW
  THE FLOOR** (owner decision). The tolerant reader is forward negotiation only,
  so a request with no build or one below `MIN_CLIENT_BUILD` is refused,
  terminally and with the credential left live, so the next build resumes as the
  same device; a page the Worker served needs none, since it ships in the same
  deploy. `packages/contract/src/cloud/client-build.ts`,
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
  after two silent keepalives, since a half-open connection neither answers nor
  closes. Rejected: a log polled only to carry the verdict.
  `apps/cli/src/server/cloud/sync-runtime.ts`,
  `apps/mobile/src/sync/sync-runtime.ts`,
  `packages/contract/src/cloud/sync/cloud-socket.ts`.

- **THE HOSTED VAULT'S PATHS ARE BUDGETED PER DEVICE, and the budget buys time,
  not prevention.** Reads, writes and git each consume a window keyed on the
  device, never the address, since a stolen credential moves between addresses
  and the device row is what revocation removes. Three families, so a drained
  budget, a looping phone writer's included, never takes another down; each
  ceiling is set from the worst legitimate minute, and revocation is the
  control (`apps/web/src/worker/rate-limit.ts`). A read-scoped credential is the
  deeper answer and is not built; the trigger is a second party holding a
  credential for someone else's account.

- **THE HOSTED TREE IS WALKED ONCE PER HEAD INTO ONE SLOT PER REPO, AND A MIRROR
  READ IS PINNED AND BATCHED.** Each directory is a cell call that pushes wait
  on, so a head's listing is kept in one R2 slot, tagged by commit; a cache
  failure is a miss, not a refusal. A phone fetches only what changed, at the
  head the batch names (lest a push hand it bytes its listing lacks), forty
  paths a request, each a cell call under a Free invocation's 50 subrequests;
  past the byte budget the rest waits, never the first file. Rejected: a key
  per commit (an object per head ever listed); one request per note (5,000 for
  5,000 notes). `apps/web/src/worker/vault/tree-walk.ts`, `read-routes.ts`.

- **A PHONE WRITE IS ONE CHANGE SET OF BLOB-CAS'D CHANGES, AND THE WORKER
  COMMITS IT THROUGH THE CELL'S OWN RECEIVE-PACK.** Each change names its base
  blob, and the set lands whole on the head it was checked against or not at
  all; a stale base is refused with what the head holds, and the Worker never
  merges. A blob base survives another note's desktop push, and a change the
  head already holds is satisfied, making resends harmless. The Worker pushes
  the objects it builds through the door every push takes, a per-ref CAS on a
  serialized chain. Rejected: an idempotency key (a store to expire); a write
  RPC in durable-git (a second writer and lock).
  `apps/web/src/worker/vault/commit-route.ts`, `commit-changes.ts`,
  `plan-change-set.ts`.

- **A PHONE COMMIT IS REFUSED RATHER THAN GUESSED, AND NAMES ITS DEVICE.** An
  account with no hosted vault yet is refused, never created: the Mac's first
  push creates it. A tree that does not hash back to its own oid, and a name a
  sibling holds in another case or normalization, are refused, since the cell
  decodes names leniently and a Mac cannot hold both. Author and committer name
  the device, because a conflict copy names the other device from the
  committer. `apps/web/src/worker/vault/commit-route.ts`, `plan-change-set.ts`,
  `commit-changes.ts`.

- **THE HOSTED VAULT IS CAPPED ON WHAT THE CELL STORES, AND TAKES A PUSH OF AT
  MOST 90 MiB** (owner decision: free, about 1 GB an account counting every
  stored version, so deleting frees nothing; no compaction in 0.6; a stated push
  cap, large files later). Size is the cell's SQLite file plus its R2 packs
  (`patches/durable-git@0.0.8.patch`); the push cap sits under the edge's
  100 MB body, so the refusal is the Worker's own; ONE gate meets every pack
  bound for a cell, desktop push or phone commit; reads are never refused for
  size. Rejected: the gc guard's sum (double-counts a SQLite-held pack); a
  Worker-side meter (bytes offered, not kept); the head tree's size (ignores
  growing history). `apps/web/cloudflare.config.ts`,
  `apps/web/src/worker/vault/receive-pack.ts`.

- **A FULL HOSTED VAULT IS `full`, NOT OFFLINE, AND AN OVERSIZED HISTORY PUSHES
  IN STEPS.** The engine measures a push to the account remote first, so even
  the first refusal uploads nothing, and skips pushing while the refused tips
  stand rather than re-upload the cap; commits land, pulls go on, and the phone
  keeps refused edits queued. A commit holds at most 32 MiB of new bytes, a
  vault's first included, and no file over 10 MiB, so each push is the newest
  prefix of unpushed commits under the cap; only a single commit over it is
  refused as too-large. Rejected: one push of the whole history (a large first
  commit or an import never sends). `apps/cli/src/server/vault/git-engine.ts`,
  `git-stage.ts`.

- **THE PHONE ASKS NO AGENT, AND THE ACCOUNT CARRIES NO THREAD** (owner
  decision: the phone saves, reads and writes, as Raindrop's and Obsidian's
  do). A thread lives in the database of the Mac that ran it, its edits reach
  other devices as the library's commits, and a phone that wants the agent asks
  on a Mac. The account socket is deployed under the retired log's class name,
  `ThreadSyncDO`, and an object still holding the log's tables drops them on
  waking, since a Preview is a version of the script and a version can neither
  add nor delete a class. Rejected: a new class name (no PR's preview could bind
  it until a deploy migrated it); a thread log every device pulls and an inbox a
  Mac polls (a second store and sync for transcripts no other device edits).
  `apps/web/cloudflare.config.ts`.

- **A VAULT READ CARRIES ITS PATH IN THE BODY, NEVER THE URL.** Cloudflare keeps
  each request's URL in the Worker's request log and sampled traces for up to
  seven days, and a vault path names a user's file, so the tree, file and asset
  reads POST their query, and the Worker refuses any other method before it
  reads the credential. Rejected: turning the invocation log off (the traces
  keep their URLs, and the operator loses the one view of a failing route);
  reads addressed by blob oid (the asset route cannot type or size-gate without
  the path). `apps/web/src/worker/vault/read-routes.ts`.

- **A PR PREVIEW IS A WORKER PREVIEW DRIVEN BY ACTIONS, not Workers Builds**,
  and it binds preview-only resources. Previews ride `workflow_run` after CI, as
  Deploy does, only for this repo's branches, since that trigger holds secrets.
  A preview inherits no binding, so `apps/web/cloudflare.config.ts` binds each
  to a preview-only resource. The script creates the GitHub deployment on the
  head commit (`.github/scripts/worker-preview.mjs`), since a job's
  `environment:` under `workflow_run` records the default branch. Rejected:
  Workers Builds (it deploys on push and cannot wait for CI); a preview on the
  production D1 (PR code would write real accounts).
  `.github/workflows/preview.yml`, `apps/web/README.md` § Previews.
