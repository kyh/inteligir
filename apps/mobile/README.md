# @repo/mobile — the inteligir phone companion

A notes-and-capture client. **The agent and the vault ENGINE stay on the
desktop** (issue #542's re-founding): the phone holds the SYNCED THREADS,
FEEDS the CAPTURE inbox, ASKS a Mac's agent through the DISPATCH inbox and
holds a MIRROR of every note's text from the account's hosted vault, reaching
`@repo/api/cloud` (the wire), `@repo/domain` (the `ThreadEvent` grammar),
`@repo/notes` (wiki resolution, the rename and delete rules and the one
conflict verdict, guard-pure) and `@repo/mobile-editor/bridge-protocol` (the
editor page's wire). No agent, no vault checkout, no git client — notes arrive
over the /v1/vault read rows into a local SQLite file and open offline in the
desktop's own editor, and the phone's edits wait in a durable outbox beside
them until the guarded commit route takes them.

Expo + expo-router; `src/sync` is the RN implementation of the `@repo/api/cloud`
wire.

## Layout

```
src/
  capture/      capture-sender.ts: one idempotency key per unsent capture,
                kept across its retries so a lost response cannot duplicate
                it (pure, unit-tested)
  sync/         the RN sync client (pure, unit-tested)
    sync-store.ts          the storage PORT (pull cursor + applied thread log)
    sqlite-sync-store.ts   its one implementation, in the phone's database: a
                           planned page (@repo/api/cloud/sync/plan-page plans
                           it) lands as one transaction, and a restore reads
                           the threads back (unit-tested against node:sqlite)
    sync-runtime.ts        the pull loop over the contract's own session machine
                           (@repo/api/cloud/sync/sync-session); publishes the
                           status store the screens subscribe to (`restoring`
                           until the boot read ends), lends that session to
                           every other read under the sign-in, and holds the
                           account's socket (@repo/api/cloud/sync/socket-link)
                           while signed in and in the foreground
    rn-socket-dial.ts      React Native's WebSocket with the bearer on the
                           upgrade, the one platform line of the shared opener;
                           only the app's composition imports it
    live-turns.ts          what a running turn has streamed and not settled,
                           folded from the deltas the store drops, in memory
                           alone
    thread-projection.ts   fold a thread's events into display rows, its
                           stated title, its archive, whether a turn is
                           running and which of the phone's requests it holds,
                           once per snapshot; the list puts archived threads
                           last, as the desktop does
  dispatch/     asking a Mac's agent from the phone (pure, unit-tested against
                node:sqlite and a fake inbox)
    dispatch-outbox.ts     the phone's requests, durable in SQLite from the tap
                           that asks one: the body frozen as sent and the
                           cloud's last answer
    dispatch-runtime.ts    sends them under the sync runtime's session, polls
                           their fate while one waits and the app is in the
                           foreground, lists and answers a phone-started
                           turn's approvals, and hands each request to the log
                           once a pulled request carries its id
    dispatch-projection.ts what the screens draw beside the log: the pending
                           rows, a thread only this phone holds so far, the
                           approval cards, and each state's words
  credential/   the device credential at rest
    credential-codec.ts        parse/serialize + the wire pattern
    secure-store-credential.ts expo-secure-store adapter (Keychain/Keystore)
                               behind the contract's DeviceCredentialStore port
                               (@repo/api/cloud/device/login-flow)
  login/        signing this phone in to an account
    login-store.ts      the screen's state machine (idle | signing-in | failed)
                        over the contract's login flow
                        (@repo/api/cloud/device/login-flow)
    device-name.ts      the name this phone offers the device list
  editor/       the note screen's editor: the @repo/mobile-editor page in a
                WebView, the phone answering its bridge
    editor-host.ts      the native end of the bridge: frames only from the
                        page's own document and under its load's nonce, the
                        one policy for what the WebView may load, the bounded
                        flush (pure, unit-tested)
    editor-ports.ts     what the page asks, answered over the notes store and
                        the file verbs: the guarded write compared with the
                        text the phone holds, attachments on demand, the
                        change feed, and where a page event leads (platform-
                        free, unit-tested against the fake vault)
    page-source.ts      the page in the app bundle (page-folder.ts: the
                        folder's name, which plugins/with-editor-page.js puts
                        it under)
  notes/        the vault read surface over the /v1/vault rows
    vault-mirror.ts     every note's text in SQLite: the tree diffed by oid,
                        the changed texts fetched in pinned batches (pure over
                        the SQL port, unit-tested against node:sqlite)
    notes-store.ts      the listing, reads, wiki resolver and the write surface
                        (shaped like @repo/editor's VaultIO, plus rename and
                        putAsset) over the mirror and the outbox, under the
                        sync runtime's session (pure, unit-tested)
    vault-outbox.ts     the phone's unsent edits, durable in SQLite and sent
                        oldest first as change sets (outbox-ops.ts: what a row
                        holds; outbox-reconcile.ts: a stale set settled with
                        @repo/notes' reconcileFile; vault-overlay.ts: the rows
                        laid over the mirror; pure, unit-tested against
                        node:sqlite and a fake vault that CASes like the Worker)
    file-ops.ts         create, rename, delete and add a photo over the notes
                        store, planned with the rules the server runs
                        (@repo/notes' plan-rename, store-removal, asset-name;
                        platform-free, unit-tested and run by the scenario suite)
    photo-ingest.ts     the camera or the library → a JPEG at most 2048px on
                        its long edge, re-encoded without EXIF (the native half;
                        photo-plan.ts is the pure one: the size, the name, the
                        embed line)
    outbox-files.ts     the staged-attachment port; expo-outbox-files.ts is its
                        expo-file-system adapter
    attachment-files.ts the attachment-file port; expo-attachment-files.ts
                        is its expo-file-system adapter
    outbox-notices.ts   the unsent edits that need the user: a parked change
                        with Retry, Save as new note and Discard, and a
                        conflict in describeSyncConflict's words (pure,
                        unit-tested); outbox-banner.tsx draws them above the
                        list and the open note
    comments-view.tsx   a note's comment threads, read-only, in a sheet over
                        the editor
  lib/          the composition root: compose-runtime.ts (platform-free and
                unit-tested: the restore, sign-out, revocation and resume)
                and app-runtime.ts (its binding to the Keychain, the
                database, the attachment and outbox files, expo-crypto's
                random ids, SHA-1 and SHA-256, AppState and expo-network's
                reconnect, plus the hooks); the database: sql-driver.ts (the port),
                expo-sql-driver.ts (the app's), node-sql-driver.ts (the
                tests'), phone-db.ts (every table's migrations) and
                backup-exclusion.ts (over modules/backup-exclusion, the one
                native module this app carries); the external store the
                runtimes publish through, theme, cloud URL
  app/          expo-router screens: sign-in, thread list + quick-capture, a
                thread view with its composer, pending requests and approval
                cards, the notes list (New note; Rename and Delete on a long
                press) + the note in the editor (Ask agent, Comments and
                Delete in its header); _layout.tsx holds the splash and the
                route guard
plugins/        with-editor-page.js: the built page into the app bundle
```

## The storage choice

The two sync stores — the pull cursor and the applied thread log — **must
agree**, so they live in one `SyncStore`, durable in `inteligir.db`
(`sync/sqlite-sync-store.ts`): `thread_sync` holds the cursor, `thread_events`
each held event by its log seq, and `synced_threads` each thread's last seq. A
pulled page is ONE transaction — its events, the threads it moves and the
cursor past it land together or not at all — and reaches memory only once it
commits; own rows are skipped by device id and a row at or below the cursor is
passed over, so a page applied twice lands once. The screens read the memory
synchronously (`useSyncExternalStore`), and the boot restore reads the tables
back BEFORE the sign-in is published: a cold launch lists every thread offline,
and its first pull asks after the saved cursor, never 0. The write is async in
the shared contract (`pullPages` awaits `applyPlan`) rather than a synchronous
write-through over expo-sqlite's sync API: every module's writes share one
queue on the file, and a synchronous write on the JS thread while another
module's transaction holds it would fail as locked rather than wait.

**The grammar the held events were parsed with** is stored beside the cursor,
as the SHA-1 of the event schema's JSON Schema, and a build whose grammar
differs drops the tables and pulls the log from 0. It has to: the rows the old
build skipped as unreadable are behind the cursor, and every held event lost the
fields the old grammar did not name, because its objects strip unknown keys. So
the phone keeps no skipped-row marker, unlike the desktop's rewind: a grammar
change re-reads everything. A held row this build cannot read starts the store
over the same way. A sign-in, a sign-out and a revocation wipe the three
tables, and the boot restore keeps them; a page that started before a wipe
never lands (a reset generation, re-checked inside the transaction). There is
no thread outbox and no capture ledger: the phone
appends nothing to the log and claims nothing from the inbox, so neither has
anything to hold. Its own NOTE edits are another matter, below, and so are its
requests to a Mac: the `dispatch_outbox` table is durable, and it is not a log
outbox — nothing in it ever reaches the thread log (Asking a Mac, below).

The log holds what the thread view draws from and no more: a streaming delta
moves the cursor and the thread's recency and is dropped, because each
completed item carries its deltas' final text. A long streamed turn costs the
phone's disk its items, not its tokens.

**A running turn's text is transient** (`sync/live-turns.ts`). The page that
lands a delta also hands it to an in-memory fold, which draws the agent's text
and its reasoning under the running indicator until the item's
`item/completed` lands, and drops a turn's rows when the turn completes, and
all of them on a sign-in, a sign-out or a revocation. It is never persisted: a
relaunch mid-turn draws nothing for an item it did not see start, because the
deltas before its cursor are gone and a fold from the middle would show the
tail as the reply. The store feeds it only what a page landed, so a page pulled
twice folds once and a page a reset dropped folds never.

**The phone holds the account's socket while it is signed in and in the
foreground** (`sync/sync-runtime.ts`). A sync ping past the cursor pulls, so a
turn the desktop pushes every second and a half reads as it grows; a vault
ping refreshes the notes; a dispatch ping asks the inbox, which is how a Mac's
question reaches the phone. Going to the background closes it and stops the
poll; coming back opens it and pulls. A drop re-dials on a backoff; a sign-out
or a refused credential closes it for good. The 60s poll stays, since the
socket is latency and never correctness.

The **device credential** is durable in `expo-secure-store` (the Keychain /
Keystore), never AsyncStorage — it is a bearer secret and the sync switch,
mirroring the desktop's `<dataDir>/device-credential`.

**Every note's text** is durable in `inteligir.db`, one expo-sqlite file in
the app's Documents (`lib/expo-sql-driver.ts`), never `Paths.cache`, which iOS
purges under storage pressure. Its directory is kept out of the phone's iCloud
backup (owner decision: it downloads again from the hosted vault) by the local
native module `modules/backup-exclusion`. The mirror (`notes/vault-mirror.ts`)
keeps a row per file the hosted tree names — path, blob oid, size, the commit
its blob first appeared at, and for a note or a comment store its text with
the frontmatter id and aliases read once as it lands. A refresh walks the tree
at head, stops after one page when head is the mirrored commit, and otherwise
applies the whole listing in one transaction: a row whose oid is unchanged is
left alone, a blob already held under another path (a move, a copy) is copied
locally, and a path the tree no longer names goes. What is left empty is
fetched forty paths to a `POST /v1/vault/files` pinned to that commit, each
answer stored in its own transaction and only onto a row still naming the
answer's oid. The mirrored commit moves only once every wanted row holds its
text, so a refresh cut short resumes from the empty rows. So a cold launch
shows the list and opens every note before any request, and a refresh that
fails keeps the list it has and says why above it. "Loading your vault…"
shows only on a FIRST mirror, with its count.

The listing and the resolver (paths, aliases and ids, so `[[Some Alias]]` and
`[[Title|uuid]]` resolve) come from the rows. `attachmentFile(path)` downloads
an attachment on its first ask, at the commit its blob first appeared at, into
`Paths.cache/attachments/<oid><ext>`, so an image a commit leaves alone is
never fetched again; the editor page reads it from there, a photo not yet
sent from its staged file.

A sign-in, a sign-out and a revocation wipe the rows and the attachment files;
the boot RESTORE keeps them — that launch is what the mirror exists for. Which
transition it is comes from the composition root, which knows, rather than
from comparing bearers inside the store. Every await re-checks the session,
and a wipe bumps a generation every write re-checks inside its transaction,
so a batch that started before the wipe never lands. The database has ONE
`user_version` (`lib/phone-db.ts`): a table another module adds is a step
appended there.

## Unsent edits

A write lands on the phone the moment it is durable in the `outbox` table
(`notes/vault-outbox.ts`), and every read, the listing and the wiki resolver
see it from then on (`notes/vault-overlay.ts`): a pending edit reads as the
note, a create and a staged photo list before the vault holds them, a rename
moves the row and rewrites the links naming it now, and a delete hides the
note and its comment store. The rows are sent oldest first,
one change set per row, to `POST /v1/vault/commit`, on every write, on resume,
when expo-network says the phone is back online, and on a backoff after a
failure, one pass at a time (`createSingleFlight` from
`@repo/api/cloud/sync/sync-session`).

- **A write carries the blob it was computed from.** A read records the base
  the caller's next write is guarded by, and a write the caller never read
  throws, as the desktop's guarded io does. Three saves of one note before it
  is sent are ONE row: a write to a path whose last row writes it replaces the
  text and keeps the first base.
- **A stale write is reconciled here, with the desktop's own verdict.** The
  Worker never merges: its 409 carries what the head holds and who wrote it,
  and `notes/outbox-reconcile.ts` runs `reconcileFile` from
  `@repo/notes/sync/reconcile-file` on it, so a far edit merges, a true
  overlap keeps the phone's version and copies the other device's under the
  name that module gives it, a note deleted elsewhere comes back with the
  phone's edit, and a delete of a note edited elsewhere is dropped. The result
  and its copy go as ONE change set, and that set is kept on the row before it
  is sent, so an answer lost after the vault applied it is resent as the same
  set, which the vault answers as already held: nothing is duplicated.
- **A landing moves the mirror in the transaction that retires the row**, and
  stamps the paths it moved (`mirror_landings`); a refresh reads the stamp
  before it lists the tree and leaves every row stamped after it alone, since
  its listing may predate the write. A write made while its row was out stays
  queued, rebased onto what landed.
- **Nothing drops the user's text.** An unreachable vault stops the queue and
  keeps every row; a refusal no resend passes (too large, a name another note
  holds in other capitals) parks that row with its bytes, and the rows on
  other paths go on. The published status (`outbox.status`) counts what is
  unsent and lists each parked row with Retry, Save as new note and Discard,
  and each conflict in `describeSyncConflict`'s words, for the editor's UI.
- **A rename and a delete are one set each** (`notes/file-ops.ts`). A rename
  carries the move, the note's own new text (its old name kept as an alias,
  its own links rewritten) and every note whose links name it, planned over
  the phone's own link graph with `@repo/notes/knowledge/plan-rename`, the
  server's rules; a note another device changed first keeps its bytes and is
  named, and the alias still answers its link. A delete carries the note's
  comment store unless another note carries its id
  (`@repo/notes/comments/store-removal`), so a note the vault keeps, because
  another device edited it, keeps its comments too.
- **A photo lands in the default attachments folder** (`assets/`), since the
  Mac's attachment choice lives in its own data folder, under a free name
  (`@repo/notes/knowledge/asset-name`), as a JPEG: the Mac's editor cannot
  show a HEIC, and the re-encode leaves the photo's location behind.
- **Signing out asks first.** `logout` refuses while an edit is unsent or a
  request no Mac holds yet waits (a sign-out drops the phone's waiting rows
  from the inbox with its device), and the home screen's confirm names both
  counts; a discard wipes the rows and the staged photos with the mirror,
  and the requests with them, and so does a revocation.

## Who applies captures

The phone **produces** captures (quick-capture → `POST /v1/capture`,
retry-stable idempotency key) and never claims one. The desktop owns applying a
capture to the vault, so a phone claiming would take a capture the desktop then
never sees — and the consumer half therefore does not exist on this device at
all.

## Asking a Mac

The phone asks a Mac's agent the way it produces captures: it posts a
`turn` row to the account's dispatch inbox (`POST /v1/sync/dispatch`) and never
claims one, and a Mac runs the turn and writes it to the log. Ask agent on a
note opens a new thread under an id the phone mints (`thr_` and 16 random
bytes), and its first message names the note as the thread's origin and the
sha-256 of the bytes the note screen showed as its view context's revision.

- **A request is durable before it is sent.** Send writes the row to
  `dispatch_outbox` with an id minted here, the body frozen as it will be
  sent; a send the cloud never answered is resent under the same id on resume,
  on reconnect and on the poll below, and the inbox answers a resend as the row
  it already holds.
- **Its fate is polled only while it moves.** While a request waits, a
  question waits for an answer or a thread is running, and only while the app
  is in the foreground, `dispatch-runtime.ts` asks every
  `DISPATCH_STATUS_POLL_MS` (10s) for the rows' states and whether a Mac is
  listening, lists the open approvals, and pulls the log when a Mac has taken
  a request or a turn runs. The words: Not sent yet — retrying; Waiting for your
  Mac…, or, with no Mac listening, Waiting for your Mac — open inteligir on it
  to run this; Your Mac has it; and a running turn's Your Mac is working….
- **The log replaces it, once.** A row leaves when a pulled
  `client/turn/requested` carries its id, and the thread view filters the
  pending rows by the same ids, so the message is never drawn twice between
  the pull and the delete.
- **Cancel takes back only what no Mac holds**; one a Mac claimed stays, as
  Your Mac has it. A refused request keeps its words and the Mac's reason until
  Dismiss, as a refused capture keeps its text.
- **A phone-started turn's approvals are answered here** (owner decision): the
  card shows what the agent asks to do and the answers it offers, and the
  answer is an `answer` row only the Mac that asked may claim.
- **Every request rides the sync runtime's session**, and checks its fence
  before it records a refusal, so a refusal heard under an earlier sign-in
  never ends the one that replaced it. A sign-in, a sign-out and a revocation
  empty the table; the boot restore keeps it.

## The sign-in seam

A phone joins an account the way the desktop does: the account's own email
and password, posted once to `POST /v1/device/login`, answered with this
phone's own `igd_…` device credential. The contract's login flow
(`@repo/api/cloud/device/login-flow`, the same one the desktop runs) posts the
row and writes the answer through the injected credential store — here the
Keychain adapter, which also activates the sync and notes runtimes. The
password is held nowhere on the phone: it crosses the wire once and only the
device credential remains, revocable from the account's Devices page. A
refusal on the wire and a Keychain that cannot write, read or delete all land
in the one store the screen reads, so each is shown rather than dropped; a
credential the Keychain could not keep is signed out before the error shows.

Signing out is the sync runtime dropping its credential
(`sync/sync-runtime.ts`), and a live credential it drops is sent to
`POST /v1/device/sign-out` first, on a client of its own, so the account's
device slot comes back. The phone never waits on it: a sign-out the cloud
never hears leaves the row active for the Devices page to revoke.

The notes store holds no client of its own: it reads under the sync runtime's
session, so one fence covers every request a sign-in makes, and an
`unauthorized` from a vault read, a capture or a pull ends the sign-in for all
of them. The composition root then idles the tree and wipes the mirror and
the threads, and keeps the credential, so the sign-in screen can say this device was
signed out. Which screens exist is the ROUTE GUARD's answer
(`Stack.Protected` in `app/_layout.tsx`), never a per-screen branch: the
signed-in screens and `app/sign-in.tsx` each sit behind one guard, and a
revocation takes the signed-in history away with it. A cold launch is
`restoring` until the Keychain read ends, and the splash stays up and no
navigator mounts until then, so the sign-in form never flashes over a device
that is signed in.

## Verified vs device-side

- **Verified here** (`pnpm --filter @repo/mobile typecheck` + `test`, and the
  repo-wide `pnpm verify`): the sync client (pull applies by global seq
  idempotently, and a pass neither pushes a thread event nor claims a capture),
  the thread store over `node:sqlite` (a relaunch listing its threads and
  pulling on from its cursor, a page whose transaction fails, a grammar change,
  an unreadable row, a page racing a sign-out),
  the credential codec, the sign-in store, the notes store, the vault mirror
  (its SQL run for real, over `node:sqlite` on a temp file: the oid delta, a
  relaunch that cannot reach the cloud, a batch cut short, a batch that
  outlives its sign-in), the outbox (offline edits across a relaunch, the
  coalesced write, a merge, a copy, a lost answer, a parked row, a refresh
  racing a landing), the capture sender, the dispatch runtime (a resend under
  the same id across a relaunch, the log replacing a pending row once, every
  state's words, cancel, a refusal kept, a stale sign-in's refusal, an approval
  answered, the foreground poll), the socket (a ping past the cursor pulls and
  one it covers does not, the background closes it and a resume dials again,
  a sign-out and a refused credential close it for good), the live fold (a
  turn's deltas, an item settling, a turn ending, a reset), and the
  composition's restore, sign-out, revocation and resume, the file verbs (a rename's rewritten link and alias,
  a note changed under it, a delete's comment store, a new note stepping past
  a taken name, a photo's size and cap), the editor page's native end (every
  frame kind to its port, a foreign document's, another load's and a
  malformed frame dropped, a flush held until the page answers, the load
  policy) and its ports (a write landing, a sync landed since the read
  handed back, a deleted note, attachments on demand, the change feed, the
  routes) — all against faked fetch. Unit tests, no device. `tools/e2e/src/scenarios/phone-offline-edit.ts` and
  `phone-file-ops-hosted.ts` run the same composition under node against a
  real Worker and a desktop.
- **The store config** (`src/__tests__/app-config.test.ts`): it asks Expo's
  own CLIs for the resolved config and the autolinked modules, and holds the
  config to what App Store Connect judges — the marketing version is the
  package's, the encryption answer is given, no permission carries an Expo
  default purpose string, and every required-reason API a linked module's
  privacy manifest declares is declared by the app's. A new native module that
  brings a manifest or a permission fails it until `app.config.js` says why.
- **The bundle**: `pnpm build` runs `expo export --platform ios`, so every
  `pnpm verify` and CI run compiles the phone's JavaScript to Hermes bytecode,
  offline, on Linux and macOS alike.
- **Needs the owner's device / simulator** (no headless Expo boot in CI): the
  app actually booting, the held splash and the route guard's redirects, the
  Keychain, expo-sqlite and the backup exclusion, the attachment and staged
  files, the resume and the reconnect, the socket's upgrade from the device
  and a running turn's reply growing on it, a live sign-in, an EAS Update
  landing, the offline check, photos, asking a Mac and the editor on a real
  WebKit. Each is a check with how to run it and what passing looks like in
  `docs/releasing.md` § 5, run on every release's internal build; a native
  module a development build predates needs that build rebuilt
  (`pnpm --filter @repo/mobile ios`).

## Dev

```bash
pnpm --filter @repo/mobile ios                                              # builds the editor page, then the app
pnpm --filter @repo/mobile dev                                              # against the production cloud
EXPO_PUBLIC_CLOUD_URL=http://localhost:5174 pnpm --filter @repo/mobile dev  # against `pnpm dev:web`
```

The note screen's editor is `@repo/mobile-editor`'s built page, carried in the
app bundle by `plugins/with-editor-page.js`, so it changes only with a new
native build: `pnpm --filter @repo/mobile ios` builds the page first, and
`pnpm --filter @repo/mobile editor-page` rebuilds it alone. Metro serves the
JavaScript alone; there is no dev server for the page (its CSP refuses the
script a Vite dev page injects), and Safari's Web Inspector reaches it in a
development build (`webviewDebuggingEnabled`).

Unset, the phone talks to the production origin, the same rule the desktop
follows (`PRODUCTION_CLOUD_ORIGIN` in `@repo/api/cloud/origin`, the one
spelling both read). `EXPO_PUBLIC_CLOUD_URL` is read once, at bundle time,
through `src/lib/cloud-url.ts`: Metro inlines it, so a store build carries no
value and cannot point anywhere else. A value that is not an absolute http(s)
URL throws rather than guessing, and there is no LAN-host fallback: the
Worker's dev server binds localhost, so an origin derived from the Metro host
could never answer a phone. The simulator shares the Mac's localhost; a
physical phone needs a URL it can reach.

## Shipping

The phone ships through EAS Build to TestFlight, iPhone only, as one of the
release's three artifacts: `docs/releasing.md` is the release's order, its
gates and the owner's device checks, and this section is the phone's own half.
The credentials (the distribution certificate, the provisioning profile, the
App Store Connect API key) live on EAS, never in this repo, and build numbers
are EAS's (`appVersionSource: remote`, `autoIncrement`), so no commit bumps
one. The marketing version is `package.json`'s, the product version the CLI
and the desktop carry (`tools/repo-guards/src/release-versions.test.ts`).
`eas.json` names the node and pnpm the repo is checked with, and no
`.easignore`: EAS falls back to `.gitignore`, which keeps `.release/` and
every `.env*` out of the upload. The editor page is gitignored build output,
so EAS builds it in the `eas-build-post-install` hook, and `testflight` builds
it first on this machine too, since the fingerprint below is taken on both.

```bash
pnpm testflight:mobile   # eas build --platform ios --profile production --auto-submit
pnpm hotfix:mobile       # eas update to the production channel: a JS-only fix
```

### One-time setup (owner)

1. `pnpm --filter @repo/mobile exec eas login`, then
   `pnpm --filter @repo/mobile exec eas init`. EAS cannot write a dynamic
   config, so commit the owner and project id it prints into `easProject` in
   `app.config.js`; that one value also points EAS Update at the project.
2. If `apps/mobile/ios` exists from an earlier `expo run:ios`, run
   `npx expo prebuild --clean` in `apps/mobile`: it was generated for the old
   bundle id.
3. The first `pnpm testflight:mobile` logs into the Apple team that signs the
   desktop app and lets EAS create and keep the certificate, the profile and an
   App Store Connect API key. Its submit creates the App Store Connect record
   for `com.inteligir.mobile`.
4. Commit that record's id as `submit.production.ios.ascAppId` in `eas.json`,
   so later submits ask nothing.
5. In App Store Connect › TestFlight, create the internal group `Owner` and add
   yourself, and the external group `Cohort`. Every build reaches `Owner`
   first, and `Cohort` only once it has passed there (Per release, below).
6. Fill TestFlight's Test Information once: a beta description, a feedback
   email you read, `https://inteligir.com/privacy` as the privacy policy, and
   the Beta App Review sign-in below.

If EAS's install fails under pnpm 12, the fallback is a custom build,
`.eas/build/production.yml`, that installs with
`pnpm install --frozen-lockfile --filter @repo/mobile...`.

### Beta App Review account (one-time, owner)

A build going to testers outside the team waits for Apple's Beta App Review,
and the reviewer needs a sign-in that never expires into an account that
already holds notes: the phone signs in, never signs up, and shows nothing
without a vault.

1. Mint a production invite with a fresh code, the recipe in
   `apps/web/README.md` § Auth:
   ```bash
   pnpm --filter @repo/web exec wrangler d1 execute inteligir-auth --remote \
     --command "INSERT INTO invite_code (code) VALUES ('<fresh code>')"
   ```
2. Sign up with it at `https://inteligir.com/app/sign-up`: an address you
   read, and a long password.
3. Seed the account's hosted vault once, from scratch dirs, so your own
   instance never signs in to it. A new vault takes the starter notes, and
   signing in sends them to the empty account:
   ```bash
   # in each of two terminals
   export INTELIGIR_DATA_DIR=/tmp/review-seed/data INTELIGIR_VAULT_DIR=/tmp/review-seed/vault
   pnpm cli serve                                  # the first terminal
   pnpm cli cloud login --email <review address>   # the second: it asks for the password
   pnpm cli vault sync
   pnpm cli vault status                           # the account's vault, nothing left to send
   ```
   Then stop the server, revoke that seeding device at
   `https://inteligir.com/app/devices` signed in as the review account, and
   delete `/tmp/review-seed`. Passing: the internal build, signed in as the
   review account, lists the starter notes.
4. Keep the address and the password in `.release/` (gitignored), and enter
   them as Test Information's Beta App Review sign-in, with these notes:
   > Sign in with the account above; its notes are already there. Everything
   > but Ask agent works on the phone alone, offline included. Ask agent sends
   > the request to a Mac signed in to the same account, which runs the agent
   > on its owner's own plan. No Mac is online during review, so a request
   > shows "Waiting for your Mac — open inteligir on it to run this" and stays
   > queued.
5. Each review signs in as a new device, and an account holds 20: revoke the
   old review devices at `https://inteligir.com/app/devices` before the next
   submission.

### Per release (owner)

`docs/releasing.md` says when each step runs: steps 1 to 3 before anything is
published, 4 to 6 once the Mac app and the CLI are out.

1. **Pre-flight.** `docs/privacy.md` names every flow the phone makes (each
   `/v1` route it calls is a row of its table, and Expo's update check is
   named), and the release commit is green in CI.
2. **Build.** `pnpm testflight:mobile` from the release commit. Passing:
   App Store Connect's processing email carries no warning (a missing purpose
   string, an undeclared required-reason API). A warning is a fix and a new
   build, never a waiver.
3. **Internal.** Install the build from the `Owner` group on your iPhone, from
   TestFlight and never as a development build, and run `docs/releasing.md` §
   5's iPhone checks on it.
4. **Cohort.** Add the build to the `Cohort` group with its What to Test, in
   the words a tester reads (never git, commit, remote, repo, terminal, CLI,
   PATH or MCP):

   > Sign in with your Inteligir account's email and password. Your notes
   > arrive and open offline. Edit a note here and see it on your Mac, add a
   > photo, and ask your Mac's agent from a note (Inteligir needs to be open on
   > the Mac). Take a screenshot to send us feedback.

   Each version's first build for the group goes through Beta App Review
   before any tester sees it, usually within a day; later builds of that
   version usually skip it.

5. **Invite.** Per-tester email invites or one public link, the owner's call at
   this step. Either way a tester needs an account first, which takes an
   invite code (`apps/web/README.md` § Auth): the phone signs in, never signs
   up.
6. **Upkeep.** A build expires 90 days after upload, so a cohort still testing
   then needs a new build of the same version (`pnpm testflight:mobile` from a
   branch off the release tag, then step 3). Build numbers are EAS's:
   `pnpm --filter @repo/mobile exec eas build:version:get --platform ios`
   prints the latest, and no commit carries one.

### Hotfixes

A fix that touches only JavaScript ships as an EAS Update, never a new build:
`pnpm hotfix:mobile` bundles on this machine and publishes to the `production`
channel the store builds listen on. An update reaches only builds whose native
code fingerprints the same (`runtimeVersion: { policy: "fingerprint" }`), so a
change to a native module, a config plugin or the SDK needs
`pnpm testflight:mobile` instead. The script clears `EXPO_PUBLIC_CLOUD_URL`
because, unlike `eas build`, `eas update` bundles with this shell's environment,
and a leftover local origin would ship to every phone. The editor page is
native too: it ships in the binary, so `fingerprint.config.js` adds its build
to the fingerprint and `hotfix` builds the page before taking it. An update
bundled beside a changed page matches no installed build and reaches nobody;
a page change needs `pnpm testflight:mobile`, since the bridge between the
page and the JavaScript breaks freely between releases. The fingerprint also
covers the app config, `version` included, so an update bundled after a
version bump reaches nobody either: a hotfix is published from a branch off
the tag of the build testers hold (`docs/releasing.md` § Hotfixes).
