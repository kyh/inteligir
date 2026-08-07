# `@repo/mobile` — the Expo shell

A signed-in shell for the hosted product: Expo SDK 57 + Expo Router. It holds an
account against the deployment and says so. It does not open a note, run the
agent, or watch a delegation — and the screen says that rather than offering a
button that would fail.

## Layout

```
src/
  app/
    _layout.tsx   Expo Router stack shell; checks the stored session once per launch
    index.tsx     The whole app — sign in, or the account and where the product lives
  lib/
    deployment.ts Which deployment this build talks to (EXPO_PUBLIC_INTELIGIR_URL)
    session.ts    Better Auth over fetch: sign in, re-derive, sign out
    external-store.ts  The tiny useSyncExternalStore store the session sits on
    theme.ts      Zinc tokens as hex for light and dark
    __tests__/    Vitest over the pure modules (no native runtime)
```

## Why it cannot drive the Bridge yet

The workspace reaches the host over `GET /v1/host/:userId/ws`, and that upgrade
**requires an allowlisted `Origin` header** — an absent one is refused with a
403 before the handshake completes. That is a deliberate decision, not an
oversight (`CLAUDE.md` § Decisions): a browser always sends Origin, so its
absence means a non-browser caller, and admitting that silently is the CSRF hole
the check exists to close.

React Native's `WebSocket` sends no Origin. So making this app a real client
needs a design for how a NATIVE client proves itself — and, separately, for what
makes a socket the narrower `mobile` client class the host already defines
(`REMOTE_ALLOWED_METHODS`/`_EVENTS` in `@repo/bridge/ipc-registry`), since a
class the client simply declares is a self-limitation rather than a boundary.
Until both exist, this app does the honest half: the account.

## What it holds

The session token, in `expo-secure-store` (the keychain) — never AsyncStorage.
Better Auth's `bearer()` plugin is what makes that work: sign-in returns the
token in a `set-auth-token` header and every later call presents it as
`Authorization: Bearer …`. Nothing else is cached: the account is re-derived
from the server on every launch, so a token the server revoked cannot leave this
app looking signed in.

No note bytes, no vault, no index, no agent.

## Local development

```bash
pnpm --filter @repo/mobile dev        # expo start (Metro)
pnpm --filter @repo/mobile ios        # expo run:ios (native build)
pnpm --filter @repo/mobile android    # expo run:android
pnpm --filter @repo/mobile typecheck  # tsc --noEmit
pnpm --filter @repo/mobile test       # vitest — pure modules only
```

Point a dev build at a local Worker with `EXPO_PUBLIC_INTELIGIR_URL`; Expo
inlines it at bundle time.

### Which Node version is authoritative

Two answers, and they disagree on purpose. The root `engines.node: ">=24"`
governs the LOCAL toolchain only — turbo, vitest, the Worker. `eas.json`
deliberately pins **no** `build.base.node`, so an EAS build runs whatever the
sdk-57 image ships (22.x today); that image, not `engines`, is authoritative
there. Don't add a `build.base.node` pin unless a build actually breaks on the
image default, and say which failure it fixes — a pin below the image's own
default is worse than either answer above.

### Why `lightningcss` is pinned in the root `pnpm.overrides`

Expo's native CSS transform prescribes `lightningcss: 1.30.1` verbatim — without
it the transform hits deserialization errors. JSON carries no comments, so the
reason lives here: the pin exists **for the mobile CSS pipeline**, nothing else.
Keep the override SCOPED to that pipeline's consumers (`react-native-css`, which
peers `lightningcss >=1.27.0`, and `@expo/metro-config`, which depends on
`^1.30.1`). An unscoped `"lightningcss": "1.30.1"` also rewrites
`@tailwindcss/node`'s **exact** `1.32.0` and `@tanstack/start-plugin-core`'s
`^1.32.0` — both below their declared minimum — in the web build, which has
nothing to do with it. Go back to a bare `lightningcss` key only if a Metro build
proves the scoped form is insufficient.
