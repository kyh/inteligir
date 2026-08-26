# @repo/mobile — the inteligir phone companion (issue #576)

A read-and-capture content client. **The agent and the vault ENGINE stay on
the desktop** (issue #542's re-founding): the phone holds the SYNCED THREADS,
the CAPTURE inbox and — since #618 — a READ surface over the account's hosted
vault, reaching `@repo/api/cloud` (the wire), `@repo/domain` (the
`ThreadEvent` grammar) and `@repo/notes` (the dialect's parse + wiki
resolution, guard-pure). No Codex, no vault checkout, no git client — notes
arrive over the /v1/vault read rows, rendered read-only.

Expo + expo-router, recovered from the pre-purge app's shape (`3a62a4cb`) with a
brand-new transport: the old sync engine spoke to the deleted hosted platform, so
`src/sync` is the RN implementation of today's `@repo/api/cloud` wire.

## Layout

```
src/
  sync/         the RN sync client (pure, unit-tested)
    sync-store.ts          the storage PORT (outbox, cursor, thread log, capture ledger)
    memory-sync-store.ts   the in-memory implementation (v1 runtime + the test fake)
    outbox.ts              freeze-at-enqueue + per-device counter (push)
    thread-log.ts          plan/apply a pulled page by global seq, idempotent
    captures.ts            produce + the claim/ack idempotent apply
    cloud-client.ts        the typed face over the Worker (a refusal is a value)
    sync-runtime.ts        the session-fenced, single-flight pass loop
    thread-projection.ts   fold a thread's events into display rows
  credential/   the device credential at rest
    credential-codec.ts        parse/serialize + the wire pattern
    credential-store.ts        the port
    secure-store-credential.ts expo-secure-store adapter (Keychain/Keystore)
  pairing/      browser-approve pairing, from the phone
    pkce.ts             pure PKCE assembly over injected crypto
    pairing-manager.ts  beginPair/completePair (state + PKCE, pure)
    expo-pairing.ts     expo-crypto / expo-linking / expo-web-browser wiring
  notes/        the vault read surface (#618)
    notes-store.ts      tree + bounded note cache + wiki resolver (pure, unit-tested)
    note-projection.ts  dialect markdown → typed blocks (pure, unit-tested)
    markdown-view.tsx   projected blocks → RN elements (the thin half)
  lib/          composition root + hooks (app-runtime.ts), theme, cloud URL
  app/          expo-router screens: thread list + quick-capture, a thread
                view, the notes list + read-only note view
```

## The storage choice (v1: in-memory)

The four sync stores — outbox, pull cursor, applied thread log, applied-capture
ledger — **must agree**, so they live in one `SyncStore`, and v1's concrete
implementation keeps all four **in memory**. This is correct, not degraded: a
cold launch re-pulls the account log from cursor 0 and re-applies it
idempotently (own rows skipped by device id, every row deduped on its
`(deviceId, deviceSeq)` origin), rebuilding the readable state. Persisting the
cursor beside an in-memory log would claim rows the log never saw.

The ONE durable thing is the **device credential**, in `expo-secure-store` (the
Keychain / Keystore), never AsyncStorage — it is a bearer secret and the sync
switch, mirroring the desktop's `<dataDir>/device-credential`.

The durable follow-up is an **expo-sqlite** `SyncStore` that persists all four
together; the port exists precisely so that swap touches nothing else.

## Who applies captures

The phone **produces** captures (quick-capture → `POST /v1/capture`, retry-stable
idempotency key). The claim/ack **idempotent apply** is implemented and
unit-tested (`captures.ts`, `runCapturePass`) for completeness and for a
phone-only account — but the default runtime does **not** claim, because in a
desktop-present account the desktop owns applying captures to the vault, and a
phone claiming would take a capture the desktop then never sees.

## The pairing seam (FLAGGED — needs a reviewed web-side change)

A phone has no loopback callback, so browser-approve redirects to the app's own
custom scheme `inteligir://pair/callback` instead of
`http://127.0.0.1:<port>/pair/callback`. The mobile side is complete:

1. `pairing-manager.beginPair` mints a single-use `state` and a PKCE verifier
   (the secret stays on the phone), and builds the account's approve URL with the
   S256 challenge.
2. `expo-web-browser` opens it; the browser redirects back to the deep-link.
3. `completePair` verifies the state (constant-time, consumed **before** the
   redeem) and redeems the code with the verifier — so an intercepted code alone
   cannot be spent.

**What is NOT done here, on purpose:** the contract's `pairRedirectUrlSchema`
(`@repo/api/cloud/pairing/pairing-schema`) admits `127.0.0.1` and nothing else, carrying
the anti-open-redirect guards #573 hardened. Accepting one registered
custom-scheme callback — with the same exact-scheme / exact-host / no-wildcard
rigor — is a **separate reviewed change**, because it reopens that surface. Until
it lands, the production approve page refuses this redirect. The flow is
dev-testable by handing the app a deep-link it accepts (the global `expo-linking`
listener and `openAuthSessionAsync` both route into `completePair`); it is not
yet wired to a production approve.

## Verified vs device-side

- **Verified here** (`pnpm --filter @repo/mobile typecheck` + `test`, and the
  repo-wide `pnpm verify`): the sync client (push freezes bodies + advances the
  per-device counter; pull applies by global seq idempotently; a capture
  delivered twice applies once), the credential codec, and the PKCE + pairing
  handshake — all against faked storage / crypto / fetch. 24 unit tests, no
  device.
- **Needs the owner's device / simulator** (no headless Expo boot in CI): the app
  actually booting, the expo-secure-store Keychain round trip, and the live
  pairing browser flow against a running cloud Worker.

## Dev

```bash
pnpm --filter @repo/mobile dev          # expo start
EXPO_PUBLIC_CLOUD_URL=… pnpm --filter @repo/mobile dev   # point at a cloud
```
