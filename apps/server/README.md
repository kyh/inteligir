# `@repo/server` — `inteligir`, your vault in a browser

The headless run mode: pick a vault, boot `@repo/host`, serve `@repo/app` over a
loopback HTTP + WebSocket bridge, and open the browser. This is the browser
counterpart of the Electron desktop shell — the launcher and the transport in
one shippable app (the `inteligir` bin).

```
inteligir [vault-path] [--port <n>] [--no-open]
```

- `vault-path` — folder of markdown notes (default: current dir). Applied at
  boot through `HostOptions.vaultPath` → the same `VaultManager.setRoot()` the
  desktop picker uses, so its guards apply (a root inside `~/.inteligir` throws).
- `--port` — fixed TCP port (default: pick a free one).
- `--no-open` — don't launch the browser.

`src/main.ts` boots the host, folds it over WS, and opens the browser.
SIGINT/SIGTERM close the server and `host.dispose()` (releases
`~/.inteligir/host.lock`, stops agents + the executor daemon), with a watchdog
so a wedged teardown can't hold the process.

## The transport — `src/create-server.ts`

`createServer({ host, assetsDir, port })` is the loopback shell over `@repo/host`:

- serves the `@repo/app` static build (`dist-web/`) with an SPA fallback (sirv,
  `single: true`);
- folds `host.handlers` into the bridge-wire protocol (`@repo/features/bridge-wire`)
  over a `/bridge` WebSocket — JSON envelopes for the registry, tagged binary
  frames for voice PCM (STT `0x01` in, TTS `0x02` out);
- fans `host.events` out to every connected client (single local user, possibly
  several tabs).

The browser client is `@repo/features/bridge-ws-client` (`createWsBridge`), which
reconnects forever with capped backoff and resyncs on reopen. The wire is
derived from the IPC registry at runtime, so a new channel needs no change here.

### Security posture — loopback is the auth gate

Local single-user; no accounts, no tokens. Three layers, all defense against a
browser the user points at a hostile page:

1. **Bind 127.0.0.1 only** — asserted after `listen`; a non-loopback bind throws.
2. **Host-header allowlist** — every HTTP request and WS upgrade must carry a
   loopback Host (`127.0.0.1` / `localhost` / `[::1]`). Guards DNS rebinding.
3. **Origin allowlist on the WS upgrade** — a WebSocket handshake bypasses CORS,
   so any page could otherwise open `ws://127.0.0.1/bridge` and drive the vault.
   Browsers attach an unforgeable Origin; it must be loopback. A missing Origin
   is a non-browser local client (already machine-trusted) and passes.

## Platform — `src/server-platform.ts`

The headless-node `HostPlatform` — no native dialogs (the vault is fixed on the
command line), file-key AES-GCM cipher instead of the OS keychain, and a per-OS
`userDataDir` that mirrors Electron's location so a desktop install and the
server share one voice-model download. It is deliberately **not** `~/.inteligir`
(logout `rm -rf`'s that dir).

## Running

Pre-publish the workspace is source-consumed, so the bin (`bin/inteligir.js`)
and `dev` script run the TS entry through `tsx`. Flags need the `exec` form so
they aren't swallowed by pnpm's `--`:

```
pnpm build   # emits @repo/app dist-web/ that the server resolves at runtime
pnpm --filter @repo/server exec tsx src/main.ts <vault> --port 47990
```

Phase 7 swaps the tsx hook for a compiled dist import and publishes to npm.
