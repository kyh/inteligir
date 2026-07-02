# `@repo/cli` — `inteligir`, your vault in a browser

Boots `@repo/host` + `@repo/server` and opens the app in the default browser.

```
inteligir [vault-path] [--port <n>] [--no-open]
```

- `vault-path` — folder of markdown notes (default: current dir). Applied at
  boot through `HostOptions.vaultPath` → the same `VaultManager.setRoot()` the
  desktop picker uses, so its guards apply (a root inside `~/.inteligir` throws).
- `--port` — fixed TCP port (default: pick a free one).
- `--no-open` — don't launch the browser.

The server folds the host over WS on 127.0.0.1 only — the bind address plus the
Host/Origin allowlists are the auth gate (see `@repo/server`). SIGINT/SIGTERM
close the server and `host.dispose()` (releases `~/.inteligir/host.lock`, stops
agents + the executor daemon), with a watchdog so a wedged teardown can't hold
the process.

## Platform

`src/server-platform.ts` is the headless-node `HostPlatform` — no native dialogs
(the vault is fixed on the command line), file-key AES-GCM cipher instead of the
OS keychain, and a per-OS `userDataDir` that mirrors Electron's location so a
desktop install and the cli share one voice-model download. It is deliberately
**not** `~/.inteligir` (logout `rm -rf`'s that dir).

## Running

Pre-publish the workspace is source-consumed, so the bin (`bin/inteligir.js`)
and `dev` script run the TS entry through `tsx`. Flags need the `exec` form so
they aren't swallowed by pnpm's `--`:

```
pnpm build   # emits @repo/app dist-web/ that the cli resolves at runtime
pnpm --filter @repo/cli exec tsx src/main.ts <vault> --port 47990
```

Phase 7 swaps the tsx hook for a compiled dist import and publishes to npm.
