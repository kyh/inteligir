# @repo/mobile — the inteligir phone companion

A read-and-capture content client. **The agent and the vault ENGINE stay on
the desktop** (issue #542's re-founding): the phone holds the SYNCED THREADS,
FEEDS the CAPTURE inbox and carries a READ surface over the
account's hosted vault, reaching `@repo/api/cloud` (the wire), `@repo/domain`
(the `ThreadEvent` grammar) and `@repo/notes` (the dialect's parse + wiki
resolution, guard-pure). No agent, no vault checkout, no git client — notes
arrive over the /v1/vault read rows, rendered read-only.

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
    notes-store.ts      tree + cached note reads + wiki resolver over the sync
                        runtime's session (pure, unit-tested)
    note-cache.ts       the note-body cache port + its memory implementation
    expo-note-cache.ts  expo-file-system adapter ((commit, path)-keyed, durable)
    note-projection.ts  dialect markdown → typed blocks (pure, unit-tested)
    markdown-view.tsx   projected blocks → RN elements (the thin half)
  lib/          the composition root: compose-runtime.ts (platform-free and
                unit-tested: the restore, sign-out, revocation and resume)
                and app-runtime.ts (its binding to the Keychain, the disk
                cache and AppState, plus the hooks); the external store the
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

**Note bodies** are durable in an expo-file-system cache
(`notes/expo-note-cache.ts`) behind the `NoteCache` port, keyed
`(commit, path)` — immutable content, so rows never expire; a refresh that
moves the tree's commit makes old rows unreachable and sweeps them. The TREE
stays in memory on purpose: the resolver and the commit must be current before
any read is pinned, so a cold launch re-fetches the listing and then reads
note bodies from disk. A refresh that fails keeps the listing it has, still
pinning every read and embed to its commit, and the list says why above it.
A sign-in, a sign-out and a revocation wipe the rows, and a write that started
before the wipe never lands;
the boot RESTORE keeps them — that launch is what the cache exists for. Which
transition it is comes from the composition root, which knows, rather than
from comparing bearers inside the store. Image BYTES are the stated residual:
an embed's fetch lands in the platform's own image caches, which a sign-out
cannot clear — safe to serve (the URL pins a commit sha), but at rest until
the OS evicts them.

The durable follow-up is an **expo-sqlite** `SyncStore` that persists both sync
stores together; the port exists precisely so that swap touches nothing else.

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
of them. The composition root then idles the tree and wipes the note cache,
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
  the credential codec, the sign-in store, the notes store, the note cache's
  clear fence (the expo adapter over stand-ins for its two native modules), the
  capture sender, and the composition's restore, sign-out, revocation and
  resume — all against faked storage / fetch. Unit tests, no device.
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
  expo-secure-store Keychain round trip, the AppState resume, a live sign-in
  against a running cloud Worker, and an EAS Update landing on an installed
  build.

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
