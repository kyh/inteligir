# `@repo/mobile` — the Expo companion

A sync/read/light-edit companion for the vault: Expo SDK 56 + Expo Router +
NativeWind. It drives the SAME platform-neutral sync engine as desktop
(`@repo/domain/sync`) through Expo adapters, against the coordinator Worker
(`apps/cloud`). **No agent on mobile** — chat, delegation, and the rich editor
stay desktop-only.

## Layout

```
src/
  app/
    _layout.tsx      Expo Router stack shell
    index.tsx        Home — auth gate: signed out → email/password form;
                     signed in → vault file list + manual Sync + pull-to-refresh
    note/[path].tsx  Single note — READ renders GFM markdown; EDIT is a raw
                     textarea over the bytes; save writes locally, then syncs
  lib/
    auth.ts          Better Auth client (expo plugin, SecureStore session);
                     captures the bearer token from `set-auth-token`
    base-url.ts      Coordinator origin resolution (see below)
    sync/            Expo bindings for @repo/domain/sync — expo-crypto hasher,
                     expo-file-system vault IO + base store, syncOnce manager
      __tests__/     Vitest over the pure modules (no native runtime)
```

## What it deliberately is NOT

- No agent, no chat, no delegation.
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

The coordinator origin resolves in order (`lib/base-url.ts`):

1. `EXPO_PUBLIC_COORDINATOR_URL`
2. `app.config.ts` → `extra.coordinatorUrl`
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
