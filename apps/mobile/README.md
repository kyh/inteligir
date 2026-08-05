# `@repo/mobile` — the Expo companion

A sync/read/light-edit companion for the vault: Expo SDK 57 + Expo Router +
NativeWind. It drives the SAME platform-neutral sync engine as desktop
(`@repo/notes/sync`) through Expo adapters, against the coordinator Worker
(`apps/cloud`). **No agent RUNS on mobile** — the agent is a desktop-host
capability. Mobile can drive a PAIRED desktop host's agent remotely over the ws
transport (chat + the delegation dock); the rich editor stays desktop-only.

## Layout

```
src/
  app/
    _layout.tsx      Expo Router stack shell
    index.tsx        Home — credential gate: no device key and no session →
                     email/password form (+ "pair with your desktop"); either →
                     vault file list + manual Sync + pull-to-refresh
    pair.tsx         Paste the desktop's pairing block to join its vault
    note/[path].tsx  Single note — READ renders GFM markdown; EDIT is a raw
                     textarea over the bytes; save writes locally, then syncs
    chat.tsx         Remote chat with a PAIRED desktop host's agent
    delegations.tsx  Remote delegation dock — list, cancel, restore
    connect.tsx      Pair with a desktop host (one-time pairing token)
  lib/
    auth.ts          Better Auth client (expo plugin, SecureStore session);
                     captures the bearer token from `set-auth-token`
    base-url.ts      Coordinator origin resolution (see below)
    sync/            Expo bindings for @repo/notes/sync — expo-crypto hasher,
                     expo-file-system vault IO + base store, syncOnce manager,
                     and the device identity (key, store, enroll, credential)
      __tests__/     Vitest over the pure modules (no native runtime)
```

## What it deliberately is NOT

- No agent PROCESS. Chat and the delegation dock are remote controls over a
  paired desktop host, not a local agent — unpaired, neither screen has a
  backend. The host restricts a paired device to exactly those channels
  (`REMOTE_ALLOWED_METHODS`/`_EVENTS` in `@repo/bridge/ipc-registry`); the
  vault/settings/admin surface is local-session-only.
- No rich editor: notes render as GFM. Inteligir's custom MDX vocabulary
  (`[[wiki-links]]`, `<toggle>`, `$$` math, mermaid, alerts) has no mobile
  renderer and shows as raw source by design.
- No knowledge index — derived indexes are per-device, desktop-side.

## Sync + auth

Auth is Better Auth **email+password** against the coordinator's
`/api/auth/*`; the coordinator's bearer plugin returns the session token in the
`set-auth-token` header, which `lib/auth.ts` stashes in the secure store so the
sync client can send `Authorization: Bearer <token>` on `/v1/vault/*`. The
vault lives under the app's documents directory; `syncOnce` runs the core
engine's 3-way reconcile (conflicts preserved as sibling copies).

### Vault device keys — the account-free path

The second identity model (`apps/cloud/README.md` § Device keys), running
alongside the one above and winning when this device has enrolled. `pair.tsx`
takes the block the desktop's Settings → Sync → Devices produces: this device
generates an Ed25519 key (`lib/sync/device-key.ts`, @noble over expo-crypto's
CSPRNG — never the ambient one), redeems the one-time secret on the
unauthenticated `…/enroll` route, and keeps `{url, vaultId, publicKey}` plus the
secret key in the keychain. From then on every request carries a self-minted
5-minute assertion; `lib/sync/credential.ts` is the one seam the engine and the
SSE stream both read it through.

**Mobile never FOUNDS a vault** — it only ever enrolls into a desktop-founded
one. A phone-founded vault is a second vaultId that never converges with the
desktop's. And **"Disconnect this vault" is purely local** (forget the key, stop
syncing): the coordinator cannot tell "I am leaving" from "strand this vault",
and refuses the last-device revoke that would do the latter. Removing this
phone's key from the roster is the desktop's job.

Switching between the two models needs no local cleanup: the stored base
manifest is scoped by vaultId, so the first pass against a newly enrolled vault
reads no anchor and plans pushes only.

The coordinator origin (account path — the device path uses the URL its pairing
block carried) resolves in order (`lib/base-url.ts`):

1. `EXPO_PUBLIC_COORDINATOR_URL`
2. `app.config.js` → `extra.coordinatorUrl`
3. dev fallback — the Metro host machine on `:8787`, so a device on your LAN
   reaches `wrangler dev` on your laptop

## Local development

Run the coordinator first (`pnpm --filter @repo/cloud dev`), then:

```bash
pnpm --filter @repo/mobile dev        # expo start (Metro)
pnpm --filter @repo/mobile ios        # expo run:ios (native build)
pnpm --filter @repo/mobile android    # expo run:android
pnpm --filter @repo/mobile typecheck  # tsc --noEmit
pnpm --filter @repo/mobile test       # vitest — pure sync modules only
```

### Which Node version is authoritative

Two answers, and they disagree on purpose. The root `engines.node: ">=24"`
governs the LOCAL toolchain only — turbo, vitest, the Electron host. `eas.json`
deliberately pins **no** `build.base.node`, so an EAS build runs whatever the
sdk-57 image ships (22.x today); that image, not `engines`, is authoritative
there. Don't add a `build.base.node` pin unless a build
actually breaks on the image default, and say which failure it fixes — a pin
below the image's own default is worse than either answer above.

### Why `lightningcss` is pinned in the root `pnpm.overrides`

NativeWind v5's install guide prescribes `lightningcss: 1.30.1` verbatim —
without it the native CSS transform hits deserialization errors. JSON carries no
comments, so the reason lives here: the pin exists **for the mobile CSS
pipeline**, nothing else. Keep the override SCOPED to that pipeline's consumers
(`react-native-css`, which peers `lightningcss >=1.27.0`, and
`@expo/metro-config`, which depends on `^1.30.1`). An unscoped
`"lightningcss": "1.30.1"` also rewrites `@tailwindcss/node`'s **exact** `1.32.0`
and `@tanstack/start-plugin-core`'s `^1.32.0` — both below their declared
minimum — in the desktop and web builds, which have nothing to do with
NativeWind. Go back to a bare `lightningcss` key only if a Metro build proves
the scoped form is insufficient.
