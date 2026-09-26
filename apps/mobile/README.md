# @repo/mobile — the inteligir phone companion

A read-and-capture content client. **The agent and the vault ENGINE stay on
the desktop** (issue #542's re-founding): the phone holds the SYNCED THREADS,
FEEDS the CAPTURE inbox and holds a MIRROR of every note's text from the
account's hosted vault, reaching `@repo/api/cloud` (the wire), `@repo/domain`
(the `ThreadEvent` grammar) and `@repo/notes` (the dialect's parse + wiki
resolution, guard-pure). No agent, no vault checkout, no git client — notes
arrive over the /v1/vault read rows into a local SQLite file, and open
offline, rendered read-only.

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
    memory-sync-store.ts   the in-memory implementation (v1 runtime + the test fake)
    thread-log.ts          execute a planned page (@repo/api/cloud/sync/plan-page plans it)
    sync-runtime.ts        the pull loop over the contract's own session machine
                           (@repo/api/cloud/sync/sync-session); publishes the
                           status store the screens subscribe to (`restoring`
                           until the boot read ends), and lends that session to
                           every other read under the sign-in
    thread-projection.ts   fold a thread's events into display rows, its
                           stated title and its archive, once per snapshot;
                           the list puts archived threads last, as the
                           desktop does
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
  notes/        the vault read surface over the /v1/vault rows
    vault-mirror.ts     every note's text in SQLite: the tree diffed by oid,
                        the changed texts fetched in pinned batches (pure over
                        the SQL port, unit-tested against node:sqlite)
    notes-store.ts      the listing, reads and wiki resolver over the mirror,
                        under the sync runtime's session (pure, unit-tested)
    attachment-files.ts the attachment-file port; expo-attachment-files.ts
                        is its expo-file-system adapter
    note-projection.ts  dialect markdown → typed blocks (pure, unit-tested)
    markdown-view.tsx   projected blocks → RN elements (the thin half)
  lib/          the composition root: compose-runtime.ts (platform-free and
                unit-tested: the restore, sign-out, revocation and resume)
                and app-runtime.ts (its binding to the Keychain, the
                database, the attachment files and AppState, plus the
                hooks); the database: sql-driver.ts (the port),
                expo-sql-driver.ts (the app's), node-sql-driver.ts (the
                tests'), phone-db.ts (every table's migrations) and
                backup-exclusion.ts (over modules/backup-exclusion, the one
                native module this app carries); the external store the
                runtimes publish through, theme, cloud URL
  app/          expo-router screens: sign-in, thread list + quick-capture, a
                thread view, the notes list + read-only note view;
                _layout.tsx holds the splash and the route guard
```

## The storage choice

The two sync stores — the pull cursor and the applied thread log — **must
agree**, so they live in one `SyncStore`, and v1's concrete implementation keeps
both **in memory**. This is correct, not degraded: a cold launch re-pulls the
account log from cursor 0 and re-applies it idempotently (own rows skipped by
device id, a row at or below the cursor passed over, since the two move in one
call), rebuilding the readable state. Persisting the cursor beside an in-memory
log would claim rows the log never saw. It is also why the phone keeps no
skipped-row marker: an app update is a relaunch, which re-reads every row the
old build skipped. There is no outbox and no capture ledger: the phone appends
nothing to the log and claims nothing from the inbox, so neither has anything
to hold.

The log holds what the thread view draws from and no more: a streaming delta
moves the cursor and the thread's recency and is dropped, because the thread
view draws completed items alone and each carries its deltas' final text. A
long streamed turn costs the phone its items, not its tokens.

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

The listing, the resolver (paths, aliases and ids, so `[[Some Alias]]` and
`[[Title|uuid]]` resolve) and each asset URL come from the rows. An asset URL
pins the commit its blob first appeared at, so an image a commit leaves alone
keeps its URL and its cached bytes. `attachmentFile(path)` downloads an
attachment on its first ask into `Paths.cache/attachments/<oid><ext>`, for the
editor to come; the read-only view still draws embeds from asset URLs, whose
bytes land in the platform's own image caches, which a sign-out cannot clear —
safe to serve (the URL pins a commit sha), but at rest until the OS evicts
them.

A sign-in, a sign-out and a revocation wipe the rows and the attachment files;
the boot RESTORE keeps them — that launch is what the mirror exists for. Which
transition it is comes from the composition root, which knows, rather than
from comparing bearers inside the store. Every await re-checks the session,
and a wipe bumps a generation every write re-checks inside its transaction,
so a batch that started before the wipe never lands. The database has ONE
`user_version` (`lib/phone-db.ts`): a table another module adds is a step
appended there.

The durable follow-up is a `SyncStore` in the same database that persists both
sync stores together; the port exists precisely so that swap touches nothing
else.

## Who applies captures

The phone **produces** captures (quick-capture → `POST /v1/capture`,
retry-stable idempotency key) and never claims one. The desktop owns applying a
capture to the vault, so a phone claiming would take a capture the desktop then
never sees — and the consumer half therefore does not exist on this device at
all.

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
of them. The composition root then idles the tree and wipes the mirror,
and keeps the credential, so the sign-in screen can say this device was
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
  the credential codec, the sign-in store, the notes store, the vault mirror
  (its SQL run for real, over `node:sqlite` on a temp file: the oid delta, a
  relaunch that cannot reach the cloud, a batch cut short, a batch that
  outlives its sign-in), the capture sender, and the composition's restore,
  sign-out, revocation and resume — all against faked fetch. Unit tests, no
  device.
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
- **Needs the owner's device / simulator** (no headless Expo boot in CI): the app
  actually booting, the held splash and the route guard's redirects, the
  expo-secure-store Keychain round trip, expo-sqlite and the backup exclusion
  (both native: a dev client built before them must be rebuilt), the
  attachment files, the AppState resume, a live sign-in against a running
  cloud Worker, an EAS Update landing on an installed build, and the offline
  check: sync once, airplane mode, cold launch, the list and any note open.

## Dev

```bash
pnpm --filter @repo/mobile dev                                              # against the production cloud
EXPO_PUBLIC_CLOUD_URL=http://localhost:5174 pnpm --filter @repo/mobile dev  # against `pnpm dev:web`
```

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

The phone ships through EAS Build to TestFlight, iPhone only. The credentials
(the distribution certificate, the provisioning profile, the App Store Connect
API key) live on EAS, never in this repo, and build numbers are EAS's
(`appVersionSource: remote`, `autoIncrement`), so no commit bumps one. The
marketing version is `package.json`'s, the product version the CLI and the
desktop carry (`tools/repo-guards/src/release-versions.test.ts`). `eas.json`
names the node and pnpm the repo is checked with, and no `.easignore`: EAS
falls back to `.gitignore`, which keeps `.release/` and every `.env*` out of
the upload.

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
   yourself. Builds go to that group alone until 0.6.

If EAS's install fails under pnpm 12, the fallback is a custom build,
`.eas/build/production.yml`, that installs with
`pnpm install --frozen-lockfile --filter @repo/mobile...`.

### Hotfixes

A fix that touches only JavaScript ships as an EAS Update, never a new build:
`pnpm hotfix:mobile` bundles on this machine and publishes to the `production`
channel the store builds listen on. An update reaches only builds whose native
code fingerprints the same (`runtimeVersion: { policy: "fingerprint" }`), so a
change to a native module, a config plugin or the SDK needs
`pnpm testflight:mobile` instead. The script clears `EXPO_PUBLIC_CLOUD_URL`
because, unlike `eas build`, `eas update` bundles with this shell's environment,
and a leftover local origin would ship to every phone.
