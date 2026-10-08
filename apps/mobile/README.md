# @repo/mobile — the inteligir phone

The account's threads, on the phone. **The agent and the vault stay on the
desktop** (issue #542's re-founding): the phone holds the SYNCED THREADS and
ASKS a Mac's agent through the DISPATCH inbox, reaching `@repo/contract/cloud`
(the wire) and `@repo/domain` (the `ThreadEvent` grammar). No agent, no vault,
no git client — threads arrive over the account's merged log into a local
SQLite file and read offline, and a request to a Mac waits in a durable outbox
until the inbox takes it.

Expo + expo-router; `src/sync` is the RN implementation of the `@repo/contract/cloud`
wire.

## Layout

```
src/
  sync/         the RN sync client (pure, unit-tested)
    sync-store.ts          the storage PORT (pull cursor + applied thread log)
    sqlite-sync-store.ts   its one implementation, in the phone's database: a
                           planned page (@repo/contract/cloud/sync/plan-page plans
                           it) lands as one transaction, and a restore reads
                           the threads back (unit-tested against node:sqlite)
    sync-runtime.ts        the pull loop over the contract's own session machine
                           (@repo/contract/cloud/sync/sync-session); publishes the
                           status store the screens subscribe to (`restoring`
                           until the boot read ends), lends that session to
                           every other read under the sign-in, and holds the
                           account's socket (@repo/contract/cloud/sync/socket-link)
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
                               (@repo/contract/cloud/device/login-flow)
  login/        signing this phone in to an account
    login-store.ts      the screen's state machine (idle | signing-in | failed)
                        over the contract's login flow
                        (@repo/contract/cloud/device/login-flow)
    device-name.ts      the name this phone offers the device list
  lib/          the composition root: compose-runtime.ts (platform-free and
                unit-tested: the restore, sign-out, revocation and resume)
                and app-runtime.ts (its binding to the Keychain, the
                database, expo-crypto's random ids and SHA-1, AppState and
                expo-network's reconnect, plus the hooks); the database:
                sql-driver.ts (the port), expo-sql-driver.ts (the app's),
                node-sql-driver.ts (the tests'), phone-db.ts (every table's
                migrations); the external store the runtimes publish through,
                theme, cloud URL, and routes.ts (a route's one param)
  app/          expo-router screens: sign-in, the thread list, and a thread
                view with its composer, pending requests and approval cards;
                _layout.tsx holds the splash and the route guard
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
no thread outbox: the phone appends nothing to the log. Its requests to a Mac
are another matter: the `dispatch_outbox` table is durable, and it is not a
log outbox — nothing in it ever reaches the thread log (Asking a Mac, below).

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
turn the desktop pushes every second and a half reads as it grows; a dispatch
ping asks the inbox, which is how a Mac's
question reaches the phone. Going to the background closes it and stops the
poll; coming back opens it and pulls. A drop re-dials on a backoff; a sign-out
or a refused credential closes it for good. The 60s poll stays, since the
socket is latency and never correctness.

The **device credential** is durable in `expo-secure-store` (the Keychain /
Keystore), never AsyncStorage — it is a bearer secret and the sync switch,
mirroring the desktop's `<dataDir>/device-credential`. It is written
`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`, so a backup restored onto another phone
carries no credential and that phone signs in as a device of its own; a write
deletes the key first, since a set over an existing item keeps the
accessibility it was written with.

The database has ONE `user_version` (`lib/phone-db.ts`): a table another
module adds is a step appended there. The notes this app once mirrored, and
the outbox of its edits, are dropped by the step that retired them, so an
installed phone frees that space on its first launch of this build.

## Asking a Mac

The phone asks a Mac's agent by posting a `turn` row to the account's
dispatch inbox (`POST /v1/sync/dispatch`), and never claims one: a Mac runs
the turn and writes it to the log. A reply in a thread the log holds is such
a row, named by the thread's id.

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
  to run this, or, when a Mac is open with Let my phone ask this Mac off,
  Waiting for your Mac — turn on “Let my phone ask this Mac” in its Settings;
  Your Mac has it; and a running turn's Your Mac is working….
- **The log replaces it, once.** A row leaves when a pulled
  `client/turn/requested` carries its id, and the thread view filters the
  pending rows by the same ids, so the message is never drawn twice between
  the pull and the delete.
- **Cancel takes back only what no Mac holds**; one a Mac claimed stays, as
  Your Mac has it. A refused request keeps its words and the Mac's reason until
  Dismiss.
- **A phone-started turn's approvals are answered here** (owner decision): the
  card shows what the agent asks to do and the answers it offers, and the
  answer is an `answer` row only the Mac that asked may claim.
- **Every request rides the sync runtime's session**, and checks its fence
  before it records a refusal, so a refusal heard under an earlier sign-in
  never ends the one that replaced it. A sign-in, a sign-out and a revocation
  empty the table; the boot restore keeps it.
- **Signing out asks first.** `logout` refuses while a request no Mac holds yet
  waits (a sign-out drops the phone's waiting rows from the inbox with its
  device), and the home screen's confirm names the count; a discard wipes the
  requests, and so does a revocation.

## The sign-in seam

A phone joins an account the way the desktop does: the account's own email
and password, posted once to `POST /v1/device/login`, answered with this
phone's own `igd_…` device credential. The contract's login flow
(`@repo/contract/cloud/device/login-flow`, the same one the desktop runs) posts the
row and writes the answer through the injected credential store — here the
Keychain adapter, which also activates the sync and dispatch runtimes. The
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

The dispatch runtime holds no client of its own: it asks under the sync
runtime's session, so one fence covers every request a sign-in makes, and an
`unauthorized` from a request or a pull ends the sign-in for all of them. The
composition root then wipes the threads and the requests, and keeps the
credential, so the sign-in screen can say this device was
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
  idempotently, and a pass never pushes a thread event), the thread store over
  `node:sqlite` (a relaunch listing its threads and pulling on from its
  cursor, a page whose transaction fails, a grammar change, an unreadable row,
  a page racing a sign-out), the credential codec, the credential's Keychain
  accessibility (over a stand-in Keychain), the sign-in store, the dispatch
  runtime (a resend under the same id across a relaunch, the log replacing a
  pending row once, every state's words, cancel, a refusal kept, a stale
  sign-in's refusal, an approval answered, the foreground poll), the socket (a
  ping past the cursor pulls and one it covers does not, the background closes
  it and a resume dials again, a sign-out and a refused credential close it
  for good), the live fold (a turn's deltas, an item settling, a turn ending,
  a reset), and the composition's restore, sign-out, revocation and resume —
  all against faked fetch. Unit tests, no device.
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
  Keychain, expo-sqlite, the resume and the reconnect, the socket's upgrade
  from the device and a running turn's reply growing on it, a live sign-in,
  an EAS Update landing, the offline check and asking a Mac. Each is a check with how to run it and what passing looks like in
  `docs/releasing.md` § 5, run on every release's internal build; a native
  module a development build predates needs that build rebuilt
  (`pnpm --filter @repo/mobile ios`).

## Dev

```bash
pnpm --filter @repo/mobile ios                                              # a development build on the simulator
pnpm --filter @repo/mobile dev                                              # against the production cloud
EXPO_PUBLIC_CLOUD_URL=http://localhost:5174 pnpm --filter @repo/mobile dev  # against `pnpm dev:web`
```

Unset, the phone talks to the production origin, the same rule the desktop
follows (`PRODUCTION_CLOUD_ORIGIN` in `@repo/contract/cloud/origin`, the one
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
every `.env*` out of the upload.

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
and the reviewer needs a sign-in that never expires: the phone signs in, never
signs up.

1. Mint a production invite with a fresh code, the recipe in
   `apps/web/README.md` § Auth:
   ```bash
   pnpm --filter @repo/web exec cf d1 query 005d0e52-f102-4298-8da9-492b672ed00f \
     --sql "INSERT INTO invite_code (code) VALUES ('<fresh code>')"
   ```
2. Sign up with it at `https://inteligir.com/app/sign-up`: an address you
   read, and a long password.
3. Keep the address and the password in `.release/` (gitignored), and enter
   them as Test Information's Beta App Review sign-in, with these notes:
   > Sign in with the account above. The phone lists the conversations a Mac
   > signed in to the same account has had with its agent, offline included,
   > and a reply is sent to that Mac, which runs the agent on its owner's own
   > plan. No Mac is online during review, so a request
   > shows "Waiting for your Mac — open inteligir on it to run this" and stays
   > queued.
4. Each review signs in as a new device, and an account holds 20: revoke the
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

   > Sign in with your Inteligir account's email and password. Your
   > conversations with your Mac's agent arrive and read offline. Reply in one
   > and your Mac's agent answers (Inteligir needs to be open on the Mac).
   > Take a screenshot to send us feedback.

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
and a leftover local origin would ship to every phone. The fingerprint also
covers the app config, `version` included, so an update bundled after a
version bump reaches nobody either: a hotfix is published from a branch off
the tag of the build testers hold (`docs/releasing.md` § Hotfixes).
