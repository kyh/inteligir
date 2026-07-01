# `@repo/server` — the browser host

The loopback HTTP + WebSocket shell over `@repo/host`, the browser counterpart
of the Electron desktop's preload. `createServer({ host, assetsDir, port })`
(`src/create-server.ts`):

- serves the `@repo/app` static build (`dist-web/`) with an SPA fallback (sirv,
  `single: true`);
- folds `host.handlers` into the bridge-wire protocol (`@repo/core/bridge-wire`)
  over a `/bridge` WebSocket — JSON envelopes for the registry, tagged binary
  frames for voice PCM (STT `0x01` in, TTS `0x02` out);
- fans `host.events` out to every connected client (single local user, possibly
  several tabs).

## Security posture — loopback is the auth gate

Local single-user; no accounts, no tokens. Three layers, all defense against a
browser the user points at a hostile page:

1. **Bind 127.0.0.1 only** — asserted after `listen`; a non-loopback bind throws.
2. **Host-header allowlist** — every HTTP request and WS upgrade must carry a
   loopback Host (`127.0.0.1` / `localhost` / `[::1]`). Guards DNS rebinding.
3. **Origin allowlist on the WS upgrade** — a WebSocket handshake bypasses CORS,
   so any page could otherwise open `ws://127.0.0.1/bridge` and drive the vault.
   Browsers attach an unforgeable Origin; it must be loopback. A missing Origin
   is a non-browser local client (already machine-trusted) and passes.

## Wire protocol

Derived from the IPC registry at runtime (`@repo/core/bridge-wire`) — a new
channel needs no change here. The browser client is `@repo/core/bridge-ws-client`
(`createWsBridge`), which reconnects forever with capped backoff and resyncs on
reopen. The `UPDATE_METHODS` trio never crosses the wire (no self-update over a
WS host); the client answers it locally.
