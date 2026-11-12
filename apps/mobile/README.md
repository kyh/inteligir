# @repo/mobile — the inteligir phone

The account's library on the iPhone, online first: it reads the cloud through
`/v1` with TanStack Query, whose cache it keeps between launches, edits a note
live in `@repo/editor` inside an Expo DOM component, keeps a share from another
app in its outbox until it lands, and draws the built-in agent from
`@repo/client`. Expo and expo-router, styled with nativewind. Its decisions are
this app's [`CLAUDE.md`](CLAUDE.md).

## Why it is built this way

The runtime the screens use is composed platform-free
(`src/lib/compose-runtime.ts`), so its suites run it under node; only its
binding to the device (`src/lib/app-runtime.ts`) needs a phone. One sign-in is
one library, made and closed together, and the route guard in
`app/_layout.tsx` alone decides which screens exist.

## Layout

```
src/
  lib/       the composition root and its device binding, the /v1 transport, the screens' queries,
             the palette and theme
  auth/      Better Auth's Expo client and its Keychain storage
  login/     signing in, or making an account with an invite code
  files/     the library's files by their hash, cached with their thumbnails
  editor/    an item's note: page/ is the DOM component, beside it its native half
  items/     saves, photos, what a share hands over, the outbox, an item's Info
  library/   the Library screen: its listing, cards and the saves waiting
  ui/        controls the screens share
  app/       expo-router screens
  styles.css the classes every screen writes, compiled for React Native by nativewind
modules/     the native module this app carries (backup exclusion)
```

## Testing

`pnpm --filter @repo/mobile test` covers the composition (restore, sign-in,
sign-out, revocation, an outdated build) over the contract's fake cell, the
socket's re-reads and the cache, the Keychain's accessibility over a stand-in,
the transport, the file cache, the editor's actions, host and policies, the
share outbox and the Library's query. `src/app-config.test.ts` holds the
resolved config to what App Store Connect judges, and `src/styles.test.ts`
compiles the sheet as Metro does. `pnpm build` runs `expo export --platform
ios`, so `pnpm verify` bundles the phone and its editor's DOM bundle. What
needs a device or the simulator is the phone's smoke list in
`docs/releasing.md` § 5.

## Dev

```bash
pnpm --filter @repo/mobile ios                                              # a development build
pnpm --filter @repo/mobile dev                                              # against the production cloud
EXPO_PUBLIC_CLOUD_URL=http://localhost:5174 pnpm --filter @repo/mobile dev  # against `pnpm dev:web`
```

An edit to the editor's DOM component or to `@repo/editor` reloads like any
other, and Safari's Web Inspector reaches the page in a development build. On a
physical phone Metro's address is plain http, no secure context, so the editor
fails: run `pnpm --filter @repo/mobile exec expo start --tunnel`, or use the
simulator, whose localhost is one. A class just added that draws nothing under
a running `dev` needs `pnpm --filter @repo/mobile dev --clear`. Unset,
`EXPO_PUBLIC_CLOUD_URL` is the production origin (`src/lib/cloud-url.ts`).
Shipping is `docs/releasing.md`.
