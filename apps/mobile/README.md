# `@repo/mobile` — the Expo companion

A remote control for a paired desktop host: Expo SDK 57 + Expo Router +
NativeWind. **No agent RUNS on mobile** — the agent is a desktop-host
capability. Mobile drives a PAIRED desktop host's agent over the ws transport
(chat + the delegation dock), and nothing else.

## Layout

```
src/
  app/
    _layout.tsx      Expo Router stack shell
    index.tsx        Home — the connection's live status, and the way into the
                     surfaces a paired desktop serves (or into pairing)
    chat.tsx         Remote chat with a PAIRED desktop host's agent
    delegations.tsx  Remote delegation dock — list, cancel, restore
    connect.tsx      Pair with a desktop host (one-time pairing token)
  lib/
    host/            The ws connection: pure connection core + pairing, the
                     Expo-backed environment store, status presentation
    chat/            The durable chat outbox (queued offline, drained on
                     connect) over the app's documents directory
      __tests__/     Vitest over the pure modules (no native runtime)
```

## What it deliberately is NOT

- No agent PROCESS. Chat and the delegation dock are remote controls over a
  paired desktop host, not a local agent — unpaired, neither screen has a
  backend. The host restricts a paired device to exactly those channels
  (`REMOTE_ALLOWED_METHODS`/`_EVENTS` in `@repo/bridge/ipc-registry`); the
  vault/settings/admin surface is local-session-only.
- No local vault, and no account. The phone holds no note bytes: everything it
  shows comes over the paired connection, and the pairing token is the only
  credential it carries.
- No rich editor and no knowledge index — both are desktop-side.

## Local development

Run the desktop host (`pnpm dev:desktop`) and enable Settings → Remote access,
then:

```bash
pnpm --filter @repo/mobile dev        # expo start (Metro)
pnpm --filter @repo/mobile ios        # expo run:ios (native build)
pnpm --filter @repo/mobile android    # expo run:android
pnpm --filter @repo/mobile typecheck  # tsc --noEmit
pnpm --filter @repo/mobile test       # vitest — pure modules only
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
