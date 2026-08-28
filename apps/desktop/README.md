# @repo/desktop — the shipped product

The window, and the page inside it. This process owns **no vault, no agent and
no index**: those live in the server it forks, and everything here is the OS
affordances a browser tab cannot give — a dedicated window, a tray, a menu, an
in-app browser, and a process that starts and stops the server with the app.

```
src/main/       the Electron main process: the window, the protocol, the fork
src/preload/    the ONE bridge into the app window (the loopback ws origin)
src/renderer/   the SPA — TanStack Router file routes over @repo/api/local
```

## The renderer's only door

The window loads `inteligir://app`, a scheme registered `standard` (so Chromium
gives it a real origin), `secure`, `supportFetchAPI` and `stream`.
`src/main/protocol.ts` answers everything on it: the built bundle, and — proxied
to the loopback server — `/rpc/*` and `/vault/asset`.

That shape is what keeps the page same-origin with its own API without putting
CORS on the loopback server, and **the renderer never holds the device token**:
the handler attaches it in main, where the page cannot read it. An `<img src>`
inside a note therefore still renders, which is the failure that would otherwise
be invisible until integration — an image tag cannot carry an `Authorization`
header.

The one thing that does not come through the handler is a WEBSOCKET: a browser
`WebSocket` cannot be proxied by one. The invalidation bus and the dictation
stream dial the loopback origin directly, main attaches the bearer to those
upgrades with `onBeforeSendHeaders`, and the preload hands the renderer that
origin as `window.desktopBridge.socketOrigin` — because `window.location.origin`
is now `inteligir://app` and names no server.

## The origin pin is the whole security surface

`src/main/origin-pin.ts` is pure, unit-tested, and the only thing standing
between this shell and a browser:

- The window loads **exactly one origin** and stays on it. Any top-level
  navigation away (a crafted link in a note, agent output, injected content) is
  a phishing surface inside the product's chrome, so it is blocked; an http(s)
  target is handed to the system browser instead.
- **`window.open` is denied unconditionally**, even same-origin.
- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`. The one
  preload exposes one string.

Origins are compared **field by field** — scheme, host, and port only where the
scheme has one — never with `URL.origin`: Node's parser answers the opaque
string `"null"` for any non-special scheme, so `inteligir://app` and
`inteligir://evil` would compare EQUAL and the pin would collapse to nothing.
Chromium's own parser knows better, but this module runs in Node.

Two more, on the window's session:

- **Its own storage partition**, keyed to the DATA DIR rather than the port
  (`sessionPartition`). The shell's scheme is ONE origin whatever vault is
  behind it, so on a shared session two different vaults would read each other's
  localStorage, IndexedDB and cookies.
- **Every web permission is denied** except `media`, origin-scoped, which
  dictation needs. Electron's default is to grant most of them to whatever a
  window loads.
- **A page-initiated URL reaches the system browser only with a recent user
  gesture.** Electron exposes no activation flag on `setWindowOpenHandler` or
  `will-navigate`, so the shell measures it from `webContents`'s `input-event`;
  without it a script loop calling `window.open` becomes a loop of OS browser
  launches. Menu and tray items bypass the gate — the click IS the gesture.

## The server is a child process

`src/main/server-process.ts` forks the CLI's bundle with `utilityProcess`, one
argument: `serve`.

Why a child rather than in-process: the server opens `better-sqlite3`
synchronously, forks a `@parcel/watcher` child and shells out to `git`.
In-process, all of that would share the event loop that paints the window and
the lifetime of the compositor.

Why `utilityProcess` rather than a supervisor of our own: it IS a managed Node
child with owned bookkeeping, so the process handle, the piped stdio and the
SIGTERM `kill()` sends are the runtime's. Three things are this module's.
WHEN the server is ready — when it has published `<dataDir>/server.json` and
answered its own token. The SIGKILL that follows an overrun grace, so quitting
cannot hang on a wedged child. And the absence of a RESTART: a fresh child
mints a fresh token, and the protocol handler and the socket-credential filter
are bound to the current one, so an unexpected exit surfaces a dialog and
quits instead.

**Quit sends SIGTERM first**, because that is the signal the server's graceful
shutdown listens for: it flushes the vault's pending git commit and closes the
database. `kill()` sends it on POSIX, and the grace behind it is DERIVED from
the server's own `SHUTDOWN_TIMEOUT_MS` rather than written down twice — a shell
that kills early lands SIGKILL on the commit the ordering exists to protect.

**A running server is ADOPTED, not fought.** The shell verifies the responder by
calling `system.status` with the token from the data dir it resolved, and
adopting requires that call to succeed AND the responder to name that same data
dir. A port squatter has no token; a neighbouring checkout names another dir.
Quitting leaves an adopted server running — the shell only kills the child it
started.

## One config resolution

The shell owns **no** copy of the app's configuration. `resolveServerTarget`
(`src/main/server-instance.ts`) calls the server's own `resolveAppConfig` — the
same module the CLI's discovery reuses — and hands the answer (data dir, vault
dir) to the child as environment. Reading only part of the layering is
what puts a window on a dead port.

Which mode that resolution runs in is decided by `app.isPackaged`, never by the
ambient `NODE_ENV`: a packaged install is the production one (`~/.inteligir`,
`~/Inteligir`, port 4664) and a checkout gets the same per-checkout dev instance
`pnpm cli serve` derives, so developing never drives your real vault.

## Running it

```bash
pnpm dev              # electron-vite: the renderer with HMR, main, and the
                      # CLI bundle rebuilt first
```

The shell FORKS that bundle, which is why the dev task depends on
`inteligir#build` — a stale `dist/` is a window on last week's server with no
error anywhere. Iterating on the SERVER is `pnpm cli serve` in its own terminal:
that runs the TypeScript source under tsx, and a shell started afterwards adopts
it. (Forking the source directly does not work: `utilityProcess` gives its child
no module-customization loader thread, so `--import tsx` registers nothing.)

To drive the window itself, start it with Chromium's own flag and connect:

```sh
pnpm dev -- --remote-debugging-port=9222
agent-browser connect 9222
```

That is the only way to check a change to the window — the shell's unit tests
cover the policy, never the rendering.

## Packaging

```bash
pnpm package:desktop      # → .output/bin/Inteligir-<version>-arm64.dmg
pnpm smoke:desktop        # package, boot its server, drive it, SIGTERM
```

The artifact is **unsigned and un-notarized**, deliberately: the signing
identity is owner-gated and not present in a working tree. macOS will refuse to
open the dmg's app on another machine until it is signed; on the build machine,
right-click → Open.

The smoke boots the packaged server exactly as the shell does — the app's own
Electron binary with `ELECTRON_RUN_AS_NODE=1` — and checks that the native
modules load under Electron's runtime, that the SPA and API answer, that the
bundled CLI is executable where the agent's PATH resolver looks for it, and that
SIGTERM exits 0. **It does not open the window**: `BrowserWindow` needs a
display, so the origin pin is proven by its unit tests and by nothing here.

There is no native-rebuild step, and that is a fact rather than an omission: the
three native modules are Node-API addons shipping per-platform prebuilds, and
Node-API is ABI-stable across Node and Electron. `npmRebuild` stays off because
an in-place rebuild in a pnpm workspace clobbers the shared store's copy the
rest of the repo depends on. Re-check this if any of them goes back to a gyp
build.

`node_modules` is unpacked from the asar because a child process cannot be
spawned from inside an archive and a `.node` binary cannot be loaded from one.

### The release path (documented, not run)

1. Bump `apps/cli/package.json` and `apps/desktop/package.json` together — the
   shell reports its own version and ships the CLI's tree.
2. `pnpm format:fix && pnpm verify && pnpm smoke:cli && pnpm smoke:desktop`.
3. Sign and notarize: set `CSC_LINK`/`CSC_KEY_PASSWORD` and an Apple API key,
   flip `mac.identity`, `mac.hardenedRuntime` and `mac.notarize` in
   `electron-builder.yml`, then re-run `pnpm package:desktop`.
4. Publish the dmg. **There is no update feed.** The old one was yanked, and a
   shell that checks an empty channel is worse than one that does not check —
   it reports failures the user cannot act on. Wiring `electron-updater` starts
   with choosing the channel; `publish: null` says so until then.

## What is deliberately not here

- **No auto-update.** See above.
- **No deep-link scheme.** `inteligir://` is the renderer's own origin now; a
  cross-device link would need a second, registered scheme and there is nothing
  to receive yet.
- **No IPC beyond the socket origin.** The bridge exposes one string, computed
  in main, because a browser `WebSocket` cannot be proxied. Every other question
  the page has, it asks its own server over `/rpc`.
