# @repo/mobile — the inteligir phone companion (issue #576)

A read-and-capture content client. **The agent and the vault ENGINE stay on
the desktop** (issue #542's re-founding): the phone holds the SYNCED THREADS,
FEEDS the CAPTURE inbox and — since #618 — carries a READ surface over the
account's hosted vault, reaching `@repo/api/cloud` (the wire), `@repo/domain`
(the `ThreadEvent` grammar) and `@repo/notes` (the dialect's parse + wiki
resolution, guard-pure). No Codex, no vault checkout, no git client — notes
arrive over the /v1/vault read rows, rendered read-only.

Expo + expo-router, recovered from the pre-purge app's shape (`3a62a4cb`) with a
brand-new transport: the old sync engine spoke to the deleted hosted platform, so
`src/sync` is the RN implementation of today's `@repo/api/cloud` wire.

## Layout

```
src/
  sync/         the RN sync client (pure, unit-tested)
    sync-store.ts          the storage PORT (pull cursor + applied thread log)
    memory-sync-store.ts   the in-memory implementation (v1 runtime + the test fake)
    thread-log.ts          execute a planned page (@repo/api/cloud/sync/plan-page plans it)
    sync-runtime.ts        the pull loop over the contract's own session machine
                           (@repo/api/cloud/sync/sync-session); publishes the
                           status store the screens subscribe to
    thread-projection.ts   fold a thread's events into display rows
  credential/   the device credential at rest
    credential-codec.ts        parse/serialize + the wire pattern
    credential-store.ts        the port
    secure-store-credential.ts expo-secure-store adapter (Keychain/Keystore)
  pairing/      browser-approve pairing, from the phone
    pairing-flow.ts     the screen's state machine (idle | pairing | failed) over
                        the contract's pairing machine
                        (@repo/api/cloud/pairing/pairing-flow)
    expo-pairing.ts     expo-crypto / expo-linking / expo-web-browser wiring
  notes/        the vault read surface (#618)
    notes-store.ts      tree + cached note reads + wiki resolver (pure, unit-tested)
    note-cache.ts       the note-body cache port + its memory implementation
    expo-note-cache.ts  expo-file-system adapter ((commit, path)-keyed, durable)
    note-projection.ts  dialect markdown → typed blocks (pure, unit-tested)
    markdown-view.tsx   projected blocks → RN elements (the thin half)
  lib/          composition root + hooks (app-runtime.ts), the external
                store the runtimes publish through, theme, cloud URL
  app/          expo-router screens: thread list + quick-capture, a thread
                view, the notes list + read-only note view
```

## The storage choice

The two sync stores — the pull cursor and the applied thread log — **must
agree**, so they live in one `SyncStore`, and v1's concrete implementation keeps
both **in memory**. This is correct, not degraded: a cold launch re-pulls the
account log from cursor 0 and re-applies it idempotently (own rows skipped by
device id, every row deduped on its `(deviceId, deviceSeq)` origin), rebuilding
the readable state. Persisting the cursor beside an in-memory log would claim
rows the log never saw. There is no outbox and no capture ledger: the phone
appends nothing to the log and claims nothing from the inbox, so neither has
anything to hold.

The **device credential** is durable in `expo-secure-store` (the Keychain /
Keystore), never AsyncStorage — it is a bearer secret and the sync switch,
mirroring the desktop's `<dataDir>/device-credential`.

**Note bodies** are durable in an expo-file-system cache
(`notes/expo-note-cache.ts`) behind the `NoteCache` port, keyed
`(commit, path)` — immutable content, so rows never expire; a refresh that
moves the tree's commit makes old rows unreachable and sweeps them. The TREE
stays in memory on purpose: the resolver and the commit must be current before
any read is pinned, so a cold launch re-fetches the listing and then reads
note bodies from disk. A pairing and an unpair wipe the rows; the boot
RESTORE keeps them — that launch is what the cache exists for. Which
transition it is comes from the composition root, which knows, rather than
from comparing bearers inside the store. Image BYTES are the stated residual:
an embed's fetch lands in the platform's own image caches, which an unpair
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

## The pairing seam

A phone has no loopback callback, so browser-approve redirects to the app's own
custom scheme `inteligir://pair/callback` instead of
`http://127.0.0.1:<port>/pair/callback`. The contract's `pairRedirectUrlSchema`
(`@repo/api/cloud/pairing/pairing-schema`) admits exactly those two shapes, each
judged field-by-field with no wildcards, so the production approve page
completes this redirect. The flow:

1. The contract's pairing machine (`@repo/api/cloud/pairing/pairing-flow`,
   the same one the desktop runs) mints a single-use `state` and a PKCE
   verifier (the secret stays on the phone), and builds the account's approve
   URL with the S256 challenge.
2. `expo-web-browser` opens it; the browser redirects back to the deep-link (the
   global `expo-linking` listener and `openAuthSessionAsync` both route into
   the flow's `complete`).
3. `complete` verifies the state (constant-time, consumed **before** the
   redeem) and redeems the code with the verifier — so an intercepted code alone
   cannot be spent. A failure on either path lands in the one store the screen
   reads, so it is shown rather than dropped.

**The residual, stated:** the allowlist cannot stop another app from registering
the `inteligir://` scheme on the same OS — a squatter can receive the redirect,
code included. The PKCE verifier, which never leaves this app, is what keeps
that code unredeemable — the same property that keeps the desktop's
deliberately-open loopback port safe. In Expo Go the callback composes to
Metro's `exp://…/--/pair/callback`, which the allowlist refuses; end-to-end
pairing needs a build that owns the scheme, and the dev loop hand-feeds the
listener a deep link instead.

## Verified vs device-side

- **Verified here** (`pnpm --filter @repo/mobile typecheck` + `test`, and the
  repo-wide `pnpm verify`): the sync client (pull applies by global seq
  idempotently, and a pass neither pushes a thread event nor claims a capture),
  the credential codec, and the PKCE + pairing handshake — all against faked
  storage / crypto / fetch. Unit tests, no device.
- **Needs the owner's device / simulator** (no headless Expo boot in CI): the app
  actually booting, the expo-secure-store Keychain round trip, and the live
  pairing browser flow against a running cloud Worker.

## Dev

```bash
pnpm --filter @repo/mobile dev          # expo start
EXPO_PUBLIC_CLOUD_URL=… pnpm --filter @repo/mobile dev   # point at a cloud
```

The cloud origin is REQUIRED: `EXPO_PUBLIC_CLOUD_URL` in the shell, or
`extra.cloudUrl` in `app.config.js`. With neither, the first cloud read throws
rather than guessing — the Worker's dev server binds localhost, so an origin
derived from the Metro host could never answer a phone on the LAN.
