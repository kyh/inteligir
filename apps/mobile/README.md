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

## What is missing is the SURFACE, not the admission

The host's half of a companion is built and tested. `POST /v1/host/ticket` with
a **bearer token and no browser `Origin`** mints a ticket for the `mobile`
client class, and every socket that spends one reaches exactly
`REMOTE_ALLOWED_METHODS`/`_EVENTS` (`@repo/bridge/channel-policy`) — chat plus the
delegation dock — enforced at invoke, at broadcast and at reconnect hydration.
React Native's `WebSocket` sends no Origin, which is what makes a bearer the
right credential and the absent Origin merely corroborating: the class comes
from which credential carried the session, never from a header a caller omits
for free (`CLAUDE.md` § Decisions).

What does not exist is the app half — a chat screen, a delegation list, and the
`@repo/bridge/ws-bridge` client dialled at them. Until it does, this app does
the honest half: the account, and a sentence about where the product is.

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
Keep the override SCOPED to that pipeline's consumer —
`@expo/metro-config>lightningcss`, which is the one edge in this graph
(`@expo/metro-config` depends on `^1.30.1`). An unscoped `"lightningcss":
"1.30.1"` also rewrites `@tailwindcss/node`'s **exact** `1.32.0` and
`@tanstack/start-plugin-core`'s `^1.32.0` — both below their declared minimum —
in the web build, which has nothing to do with it. A second scoped key is only
warranted when a second consumer actually appears in the lockfile; go back to a
bare `lightningcss` key only if a Metro build proves the scoped form is
insufficient.
