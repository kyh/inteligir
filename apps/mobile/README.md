# `@repo/mobile` — Inteligir mobile remote

Expo / React Native app. A **remote surface** for the desktop product, not a
standalone agent: it pairs to a running desktop over the dispatch relay and
mirrors the agent transcript. There is no agent on the phone.

## How it works

The desktop shows a pairing string (`roomId.token`). The phone scans/enters it,
then connects to the relay Worker (`apps/server`) as the `mobile` peer. While an
authenticated `desktop` peer is present in the same room, the desktop streams
its agent events down; the phone renders them and can send messages back. The
wire contract is dispatch protocol v1 — see
[`packages/dispatch/PROTOCOL.md`](../../packages/dispatch/PROTOCOL.md).

```
phone (mobile peer) ── partysocket/WSS ──▶ relay Worker ◀── WSS ── desktop peer
            └── PairingCredential (roomId + token), parsed locally ──┘
```

## Layout

```
src/
  app/                 expo-router screens
    index.tsx          Entry — restores a saved session or routes to pairing
    pair.tsx           Enter / scan a pairing credential
    dispatch.tsx       Connected view — agent transcript + input
    _layout.tsx        Router layout
  hooks/
    use-dispatch-connection.ts   Socket lifecycle, presence, reconnect, fatal states
  utils/
    session-store.ts   Persists the pairing credential (expo-secure-store)
    base-url.ts        Resolves the relay host (dev vs. EXPO_PUBLIC_SERVER_HOST)
  styles.css           NativeWind / Tailwind
app.config.ts          Expo config (bundle ids, scheme, splash)
```

Styling is NativeWind (Tailwind for RN). The pairing credential lives in
`expo-secure-store`; only `parsePairingString` (pure) runs on-device — the phone
never touches WebCrypto.

## Dev

```bash
pnpm --filter @repo/mobile dev          # expo start
pnpm --filter @repo/mobile dev-ios      # expo start --ios
pnpm --filter @repo/mobile dev-android  # expo start --android
```

Point the app at a local relay with `EXPO_PUBLIC_SERVER_HOST` (defaults to the
deployed `inteligir-server` in packaged builds, `localhost:8787` in dev).

## Native builds

```bash
pnpm --filter @repo/mobile ios       # expo run:ios
pnpm --filter @repo/mobile android   # expo run:android
```

OTA updates are intentionally disabled (`expo-updates` is not installed).
