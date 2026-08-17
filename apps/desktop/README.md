# @repo/desktop — the Electron shell

One window on the local server, and nothing else. This process owns **no
vault, no agent, no index and no renderer of its own**: the product runs in the
server it supervises, and everything here is the OS affordances a browser tab
cannot give it — a dedicated window, a tray, a menu, and a process that starts
and stops the server with the app.

## The origin pin is the whole security surface

`src/main/origin-pin.ts` is pure, unit-tested, and the only thing standing
between this shell and a browser:

- The window loads **exactly one origin** — `http://127.0.0.1:<port>` — and
  stays on it. Any top-level navigation away (a crafted link in a note, agent
  output, injected content) is a phishing surface inside the product's chrome,
  so it is blocked; an http(s) target is handed to the system browser instead.
- **`window.open` is denied unconditionally**, even same-origin. The shell
  never grants a second window.
- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`. There is
  no preload and no IPC surface, because there is nothing for the page to ask
  this process for.

Origins are compared as **origins**, never as string prefixes: `127.0.0.1:4664`
must not match `127.0.0.1:46640`, and `localhost` is a different origin from
`127.0.0.1` (the name resolves to `::1` on some machines).

## The server is a child process

`src/main/server-supervisor.ts` spawns the bundled Node entry, waits for its
health route, restarts it if it crashes or wedges, and stops it on quit.

Why a child rather than in-process: the server opens `better-sqlite3`, forks a
`@parcel/watcher` child and shells out to `git`. In-process, all of that would
share the event loop that paints the window and the lifetime of the compositor.
As a child, a crash restarts and a quit kills, and neither takes the other
down. (`npx inteligir` is the opposite case and runs the server **in-process** —
one process, one exit code; see `apps/launcher`.)

Two consequences worth knowing:

- **A running server is adopted, not fought.** The shell probes the origin
  before it spawns. If `npx inteligir` is already listening, the window opens on
  it and quitting the app leaves it running — the shell only kills the child it
  started (`planServerStart` in `src/main/server-target.ts`).
- **Quit sends SIGTERM first.** That is the signal the server's graceful
  shutdown listens for: it flushes the vault's pending git commit and closes the
  database. SIGKILL is the deadline behind it, never the first move.

## One config resolution

The shell owns **no** copy of the app's configuration. `resolveServerTarget`
(`src/main/server-target.ts`) calls `@repo/app/node/config`'s own
`resolveAppConfig` — the same module `apps/cli`'s discovery reuses — and hands
the answer (port, data dir, vault dir) to the child as environment. The layering
is env → `<dataDir>/config.json` → default, and reading only part of it is what
puts a window on a dead port: a shell that knew `INTELIGIR_PORT` alone would
probe 4664, find nothing, and spawn a child that bound the configured port
instead.

The origin is still a **pin**: fixed for the whole launch, and the child is told
exactly which port to bind, so it can never land somewhere the window is not.

Which mode that resolution runs in is decided by `app.isPackaged`, never by the
ambient `NODE_ENV`: a packaged install is the production one (`~/.inteligir`,
`~/Inteligir`, port 4664) and a checkout gets the same **per-checkout dev
instance** `pnpm dev` derives, so `pnpm dev:desktop` never drives your real
vault. The child's own `NODE_ENV` stays `production` because it always runs a
built bundle — that flag decides which fallback the server mounts (`dist/client`
vs Vite middleware) and nothing about where its data lives.

## Running it

```bash
pnpm install
pnpm dev:desktop      # builds the launcher + the main bundle, then `electron .`
```

In a checkout the shell runs the server with **your** `node`, because the
workspace's native modules are built for it. It resolves the server entry
through `node_modules/inteligir` — pnpm's link to `apps/launcher` — so
`pnpm package:app` (or any `turbo run build`) has to have run at least once;
`pnpm dev:desktop` does it for you.

The window exposes CDP on 9222, so it is drivable like any page:

```sh
agent-browser connect 9222
agent-browser snapshot
```

That is the only way to check a change to the window itself — the shell's unit
tests cover the policy, never the rendering.

## Packaging

```bash
pnpm package:desktop      # → apps/desktop/.output/bin/Inteligir-<version>-arm64.dmg
```

The artifact is **unsigned and un-notarized**, deliberately: the signing
identity is owner-gated and not present in a working tree. macOS will refuse to
open the dmg's app on another machine until it is signed; on the build machine,
right-click → Open.

```bash
pnpm --filter @repo/desktop smoke   # after packaging
```

The smoke boots the packaged server exactly as the supervisor does — the app's
own Electron binary with `ELECTRON_RUN_AS_NODE=1` — and checks that the native
modules load under Electron's runtime, that the SPA and API answer, that the
bundled CLI is executable where the agent's PATH resolver looks for it, and that
SIGTERM exits 0. **It does not open the window**: `BrowserWindow` needs a
display, so the origin pin is proven by its unit tests and by nothing here.

The packaged app runs the server through **its own Electron binary** with
`ELECTRON_RUN_AS_NODE=1`, so no `node` on the user's PATH is assumed. There is
no native-rebuild step, and that is a fact rather than an omission: both native
modules the server loads (`better-sqlite3` 13 and `@parcel/watcher`) are
Node-API addons shipping per-platform prebuilds inside the package, and
Node-API is ABI-stable across Node and Electron. `npmRebuild` stays off because
an in-place rebuild in a pnpm workspace clobbers the shared store's copy that
the rest of the repo depends on. Re-check this if either module ever goes back
to a gyp build.

`node_modules` is unpacked from the asar because a child process cannot be
spawned from inside an archive and a `.node` binary cannot be loaded from one.

### The release path (documented, not run)

1. Bump `apps/launcher/package.json` and `apps/desktop/package.json` together —
   the shell reports its own version and ships the launcher's tree.
2. `pnpm format:fix && pnpm verify && pnpm smoke:package`.
3. Sign and notarize: set `CSC_LINK`/`CSC_KEY_PASSWORD` and an Apple API key,
   flip `mac.identity`, `mac.hardenedRuntime` and `mac.notarize` in
   `electron-builder.yml`, then re-run `pnpm package:desktop`.
4. Publish the dmg. **There is no update feed.** The old one was yanked, and a
   shell that checks an empty channel is worse than one that does not check —
   it reports failures the user cannot act on. Wiring `electron-updater` starts
   with choosing the channel; `publish: null` says so until then.

## What is deliberately not here

- **No auto-update.** See above.
- **No deep-link scheme.** `inteligir://` belonged to the hosted product; a
  local-first shell has no cross-device link to receive yet.
- **No preload, no IPC.** The page talks to its own server over HTTP and the
  invalidation socket. Adding an IPC channel means adding a preload and an
  attack surface; it needs a reason first.
