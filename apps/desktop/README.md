# @repo/desktop — the shipped product

The window, and the page inside it. This process owns **no vault, no agent and
no index**: those live in the server it forks, and everything here is the OS
affordances a browser tab cannot give — a dedicated window, a tray, a menu, and
a process that starts and stops the server with the app.

```
src/main/       the Electron main process: the window, the protocol, the fork, the first run
src/preload/    index.ts: the ONE bridge into the app window (the loopback ws origin, the
                updater, the spell checker, the vault switch, Reveal/Open, the diagnostics);
                first-run.ts: the first-run window's, which carries the vault choice alone
src/renderer/   the SPA — TanStack Router file routes over @repo/api/local — and
                first-run.html, the page a launch with no vault opens (first-run/)
```

## The first run is decided before any server exists

A server is bound to one vault and one data dir, so the vault is chosen before
one boots, and the agent and the account follow as steps inside the app.
`planLaunch` (`src/main/first-run.ts`, pure and unit-tested) makes the call at
launch: a first run only when nothing chose a vault (no `INTELIGIR_VAULT_DIR`,
no `INTELIGIR_DATA_DIR`, no `vaultDir` in `config.json`) and the default vault's
folder does not exist yet. Every other launch boots as it always has, so an
upgrade, `inteligir serve` and a pinned harness never meet it.

A first run opens its own window, on an in-memory partition locked down like a
vault's, loading `inteligir://app/first-run.html` over its own preload
(`window.firstRunBridge`: `getState`, `pickParent`, `pickFolder`, `finish`,
answered only to that window). The same scheme serves the page with no server
behind it: `/rpc/*` and `/vault/asset` answer 503, and the page's policy names
no websocket origin. The page offers a new vault (the default's name and place,
or another folder main's picker handed out) or an existing folder of notes,
with what the folder already is: how many notes, whether another service
(iCloud Drive, Dropbox, Obsidian Sync…) syncs it, which the app then leaves to
that service, and whether it already syncs somewhere of its own. `finish`
plans the choice exactly as a boot would resolve it (`planFirstRunChoice`),
writes the vault selector unless the choice is the default vault, boots, and
opens the app window at `/welcome` before closing the first-run window; a boot
that fails stops what it started, removes the selector it wrote, and answers
the page why (`runFirstRun`). Until a vault is open, the Dock, a second launch
and the tray show the first-run window, and Open Vault…, Open Recent Vault and
Open Data Folder are off. A picked switch (File › Open Vault…, Settings) asks
first when another service syncs the folder, in the first run's words
(`outsideSyncWarning` in `src/first-run-state.ts`).

The first-run preload is a build of its own: a sandboxed preload can require
no file beside it, and two inputs to one build share a chunk each would
require (`electron.vite.config.ts` says how).

A fresh checkout's `pnpm dev` shows the first run too, since its dev instance
has no vault yet; `INTELIGIR_VAULT_DIR` (or `INTELIGIR_DATA_DIR`) skips it.

## The renderer's only door

The window loads `inteligir://app`, a scheme registered `standard` (so Chromium
gives it a real origin), `secure`, `supportFetchAPI` and `stream`.
`src/main/protocol.ts` registers it and `src/main/protocol-handler.ts` (pure,
unit-tested over a fake fetch) answers everything on it: the built bundle,
`/html-frame` (the document a note's html block runs in, under its own sandbox
policy rather than the page's), and — proxied to the loopback server — `/rpc/*`
and `/vault/asset`.

That shape is what keeps the page same-origin with its own API without putting
CORS on the loopback server, and **the renderer never holds the device token**:
the handler attaches it in main, where the page cannot read it. An `<img src>`
inside a note therefore still renders, which is the failure that would otherwise
be invisible until integration — an image tag cannot carry an `Authorization`
header.

The one thing that does not come through the handler is a WEBSOCKET: a browser
`WebSocket` cannot be proxied by one. The invalidation bus dials the loopback
origin directly, main attaches the bearer to that upgrade with
`onBeforeSendHeaders`, and the preload hands the renderer that origin as
`window.desktopBridge.socketOrigin` — because `window.location.origin` is now
`inteligir://app` and names no server.

**Both carriers lend the bearer to the page alone.** Chromium tells main which
origin made each request (`initiatorOrigin`), and neither the page nor a frame
inside it can forge it. The handler forwards a proxied path only when that is
`inteligir://app`, or absent for a request the browser started itself, and
answers anything else 403; the socket filter attaches the header under the same
rule (`carriesBearer`). A note's own frame is the case it exists for: an
`inteligir-html` block runs sandboxed, so its origin is opaque (`"null"`), and
what a note carries must never act with the device token. The gate runs ahead
of both renderers, because `pnpm dev` serves no CSP.

## The origin pin is the whole security surface

`src/main/origin-pin.ts` is pure, unit-tested, and the only thing standing
between this shell and a browser:

- The window loads **exactly one origin** and stays on it. Any top-level
  navigation away (a crafted link in a note, agent output, injected content) is
  a phishing surface inside the product's chrome, so it is blocked; an http(s)
  target is handed to the system browser instead.
- **`window.open` is denied unconditionally**, even same-origin.
- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`. The app
  window's preload exposes the loopback origin, the updater, the spell checker,
  the vault switch, Reveal/Open and the diagnostics, nothing that holds a
  token; the first-run window's exposes the vault choice alone.

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
- **Every web permission is denied**, the check and the prompt alike, and
  every device picker. Electron's default is to grant most of them to whatever
  a window loads, and the app needs none: dictation is the operating system's
  (fn twice), typed into the field like a keyboard.
- **A page-initiated URL reaches the system browser only with a recent user
  gesture.** Electron exposes no activation flag on `setWindowOpenHandler` or
  `will-navigate`, so the shell measures it from `webContents`'s `input-event`,
  counting only HTML's activation-triggering inputs (a press, a key, a tap —
  `grantsActivation`), never a pointer passing over the page or a wheel;
  without it a script loop calling `window.open` becomes a loop of OS browser
  launches. Menu and tray items bypass the gate — the click IS the gesture.

## The server is a child process

`src/main/server-process.ts` forks the CLI's bundle with `utilityProcess`, one
argument: `serve`.

Why a child rather than in-process: the server opens `better-sqlite3`
synchronously, runs a `@parcel/watcher` child and shells out to `git`.
In-process, all of that would share the event loop that paints the window and
the lifetime of the compositor.

**Main forks the server's node children too** (`src/main/fork-broker.ts`). A
utility process cannot fork one of its own, and the packaged binary's
`runAsNode` fuse is off, so `child_process` cannot run node under it either:
nothing runs this binary as a plain Node interpreter. The server asks over its
parent port for the vault watcher and for each ACP adapter; main forks each as a
utility process, hands the server and the child the two ends of one
`MessageChannelMain` so they talk directly, reports the child's exit, and kills
whatever is still running once the server exits. The frames are the CLI's
(`inteligir/server/child-host/fork-broker-wire`), parsed on both ends; how the
server rides them is `apps/cli/README.md` § What ships. Nothing here polices
what the server asks for: it is this app's own child and already runs whatever
it likes.

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
The wait ends on the child's `exit` event, not a poll, so a quick teardown
costs a quit, a vault switch or an install nothing extra; after a SIGKILL the
shell still waits for that exit before the next child may claim the data dir.

**A running server is ADOPTED, not fought.** The shell verifies the responder by
calling `system.status` with the token from the data dir it resolved, and
adopting requires that call to succeed AND the responder to name that same data
dir AND to run the version bundled in this app — the renderer and the server
speak `/local`, whose two ends are free to break together. A port squatter has
no token; a neighbouring checkout names another dir. Quitting leaves an adopted
server running — the shell only kills the child it started.

The judgement is the CLI's own (`inteligir/server/server-probe`), the reading
`serve`'s guard runs before it boots. So a server whose pid is alive but which
does not answer in time is **silent**, live to both: the shell says so in a
dialog instead of spawning a child that server's lock would refuse. A server of
another version is refused the same way, naming both versions and its origin.

**What the child prints is kept.** Its piped stdio reaches main's console, which
a Finder launch drops, so each line is also appended, stamped, to
`<dataDir>/logs/server.log` (`src/main/server-log.ts`), rotated at 5 MiB into
one `server.log.1`; a write that fails costs the log, never main. Debug logging
is the shell's choice rather than the env's, since a Finder launch has none:
`diagnostics.json` in userData (`src/main/diagnostics.ts`), read before each
fork and handed to the child as `INTELIGIR_DEBUG` naming every namespace. The
choice reaches the next child, so Settings › Advanced offers Restart, which
relaunches the whole app through the ordinary quit (the child stops first and
its commit flushes); there is still no in-place restart of the child. A
development shell refuses it, since electron-vite owns that process. An adopted
server is not this shell's child: neither the choice nor its output reaches
the shell, and the page says so.

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

## The child's PATH is the login shell's

An app opened from Finder or the Dock inherits launchd's PATH
(`/usr/bin:/bin:/usr/sbin:/sbin`). The agent itself never needs PATH — its
runtimes are bundled — but its bash and the vendor's stdio MCP servers run the
user's own commands by name (`node`, `npx`, `uvx`, a version manager's
shims), and none of those is on launchd's PATH. So before the first fork
the packaged shell runs `$SHELL -ilc` once, reads the PATH it prints, and puts
those entries ahead of the inherited ones on main's own environment, which every
child spreads (`src/main/login-shell-path.ts`). A shell that hangs past 5s,
fails or prints nothing leaves the usual install dirs that exist
(`~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`) in its place. A dev
launch skips it: its terminal already has the user's PATH. The unit tests pin
the parse; the smoke's scratch-home launches run it for real.

## The child's git is the Mac's, or the one the app ships

The vault engine, the ACP adapters and every agent shell run `git` by name. On
a Mac without Xcode or its command-line tools, `/usr/bin/git` is a stub that
fails and offers to install them, so the vault could not initialize. The pack
therefore carries a git of its own under `Contents/Resources/git`, and before
the first fork main asks `xcode-select -p` which developer dir is selected
(`src/main/bundled-git.ts`). One holding `usr/bin/git` keeps the Mac's own git,
and with it the Keychain helper an https remote of the user's own signs in
through, which the shipped git lacks. Any other Mac gets the shipped one: its
`bin/` goes ahead of the login shell's PATH on the server child's environment,
beside `GIT_EXEC_PATH`, `GIT_TEMPLATE_DIR` and `GIT_CONFIG_SYSTEM`, because it
was built for prefix `/` and finds its helpers, templates and system config
only where those name them. `GIT_CONFIG_COUNT` is never set there: the hosted
remote's bearer rides it per invocation. A dev launch keeps the developer's own
git, as `pnpm e2e` does.

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

The shell's unit tests cover the policy, never the glue. `pnpm e2e`'s
`desktop-shell` scenario (`tools/e2e/src/scenarios/desktop-shell.ts`) is the
automated form of the same thing: it launches the built shell on a scratch home
and user-data dir with that flag, and asserts over DevTools that the window is
on `inteligir://app`, that the rail's listing and a note ride the protocol
handler's bearer, that an API write reaches the open editor (so the socket
upgrade carried the bearer), that `window.open` is denied, that Reveal refuses a
symlink out of the vault and a `..`, that a switch to a remembered vault stops
the child and boots one on the new vault's data dir, and that a SIGTERM quit
stops that child and retracts its `server.json`. `desktop-onboarding` launches
it on a home with no vault: only the first-run page, no server, then Create
boots the default vault and the app window opens on `/welcome`, and a relaunch
goes straight to the app. Both run on the checkout's build, not the packaged `.app`, so the fuses, the signature and the login
shell's PATH stay the smoke's and the unit tests'. On Linux it needs a display:
CI runs the suite under `xvfb-run`.

## Packaging

```bash
pnpm package:desktop      # → .output/bin/Inteligir-<version>-arm64.dmg
pnpm smoke:desktop        # package, boot its server, drive it, SIGTERM
```

The app is signed with the Developer ID electron-builder finds in the keychain,
under the hardened runtime with `resources/entitlements.mac.plist`, and
notarized with the App Store Connect key in `<repo>/.release/` (gitignored):
`notary.env` carries `APPLE_API_KEY` (the `.p8`'s filename, resolved against
that directory), `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`, and
`scripts/package.mjs` sets them before electron-builder starts — inside the
turbo task, because turbo's strict env mode strips an undeclared variable
before the task begins. A tree with no cert or no `.release/` still packages
— both steps are skipped with a warning — but that artifact opens only on the
machine that built it.

`package` first runs `scripts/fetch-git.mjs`, which stages the git the app
ships into `resources/git` (gitignored), and `extraResources` carries it
beside the asar, where osx-sign signs each of its Mach-Os with the rest of the
bundle. The source is dugite-native's macOS arm64 tarball, pinned by tag and
sha-256 and cached under `.cache/bundled-git`, as a file fetch rather than the
`dugite` npm package, whose JS API nothing calls and whose postinstall would
download it on every install. The fetch drops the Git Credential Manager (a
.NET runtime) and Git LFS that dugite-native adds beside git: no config names
either, and they were most of the payload and of what had to be signed. The
tarball carries no licence text, so git's own `COPYING`, pinned the same way,
ships beside it with a `SOURCE` note naming both source tags. A version bump is
the tag, the name and both hashes at the top of the script, dugite's
`script/embedded-git.json` giving the tarball's.

The smoke LAUNCHES the packaged app — the binary runs no JavaScript as plain
Node, so main is the only way in — on its own `--user-data-dir` (an installed
Inteligir neither blocks it nor sees it) and a mock keychain (an unsigned pack
must not stop on a prompt for the installed app's cookie key), with the data and
vault dirs pinned by environment. It checks that the native modules load under
Electron's runtime, that the SPA and API answer, that the watcher main forked
reports an external write, that both vendor runtimes ship in the pack and each
answers signed out over a scratch store (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`),
with no vendor CLI on PATH, that an agent turn reaches a live adapter (codex:
main forks the adapter, the adapter starts its bundled native codex, and codex
refuses the session for want of a sign-in, which only a live adapter can say),
that the bundled CLI is executable where the agent's PATH
resolver looks for it, and that SIGTERM to main stops the server cleanly and
exits 0. Its first launch plays a Mac without the developer tools:
`DEVELOPER_DIR` names a dir holding no git, and a login shell of the smoke's
own puts a `git` first on PATH that fails and logs each call. That launch
must still initialize the vault and commit an API write, and the log must stay
empty through the quit, agent turn and shutdown flush included. **The window
opens, and the smoke checks nothing in it**: the origin pin is proven by its
unit tests, and the window, the protocol handler, the bridge and the vault
switch are the `desktop-shell` scenario's, over the checkout's build. CI's `test-macos` job runs it on every push and pull request,
unsigned: `CSC_IDENTITY_AUTO_DISCOVERY=false`, which `turbo.json` passes through
to the `package` task, because turbo's strict env mode would strip it.

There is no native-rebuild step, and that is a fact rather than an omission: the
two native modules are Node-API addons shipping per-platform prebuilds, and
Node-API is ABI-stable across Node and Electron. `npmRebuild` stays off because
an in-place rebuild in a pnpm workspace clobbers the shared store's copy the
rest of the repo depends on. Re-check this if any of them goes back to a gyp
build.

`node_modules` is unpacked from the asar because a child process cannot be
spawned from inside an archive and a `.node` binary cannot be loaded from one.

The CLI ships as npm would publish it. electron-builder copies a
workspace-linked dependency as its whole directory and never reads its
`files`, so unnarrowed the CLI's sources, every `__tests__` file and its build
caches ride beside the bundle the shell forks. One exclusion in
`electron-builder.yml` keeps only the names `apps/cli/package.json`'s `files`
lists; a dependency sees only `!` patterns, so the allowlist is an extglob
inside one. Staging the CLI through `pnpm deploy` is rejected: a staging step
and a second copy of the package for what one pattern does. The smoke reads
the packaged manifest's `files` and refuses any other top-level name, and any
`__tests__`.

`electronFuses` in `electron-builder.yml` flips the binary's fuses before it is
signed: `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and `--inspect` are ignored, so
no local process can run the signed app as a node interpreter, `file://` pages
get no extra privileges, and cookies are encrypted at rest. The app loads only
from `app.asar` and only when it matches the hash in `Info.plist`, so neither a
tampered archive nor an `app/` folder planted beside it runs; the hash does not
cover `app.asar.unpacked`, where the server runs, which the code signature
guards instead. The flip invalidates
Electron's own ad-hoc signature, which Apple Silicon kills at launch, so
`resetAdHocDarwinSignature` re-signs the app ad-hoc right after it: an unsigned
build (no Developer ID, `CSC_IDENTITY_AUTO_DISCOVERY=false` or
`-c.mac.identity=null`) runs as it is, and a signed one is re-signed over it.

### The release path

1. Bump `apps/cli/package.json` and `apps/desktop/package.json` together — the
   shell reports its own version and ships the CLI's tree — and retitle
   `CHANGELOG.md`'s `## Unreleased` as `## <version> — <YYYY-MM-DD>`.
2. `pnpm format:fix && pnpm verify && pnpm smoke:cli`.
3. `pnpm smoke:desktop` — packages, notarizes with `.release/`, and boots it.
4. Tag and publish — the site's Download button reads the latest release's
   `.dmg` (`apps/web/src/lib/download-url.ts`, cached up to an hour), and every
   installed app reads its `latest-mac.yml` and zip. The notes are the
   changelog's top section, which `scripts/release-notes.mjs` prints only once
   it is titled for this version, so a refusal stops the chain before the tag:
   ```sh
   node apps/desktop/scripts/release-notes.mjs > .release/notes.md &&
     git tag v<version> && git push origin v<version> &&
     gh release create v<version> --notes-file .release/notes.md \
       apps/desktop/.output/bin/Inteligir-<version>-arm64.dmg \
       apps/desktop/.output/bin/Inteligir-<version>-arm64.zip \
       apps/desktop/.output/bin/Inteligir-<version>-arm64.zip.blockmap \
       apps/desktop/.output/bin/latest-mac.yml
   ```
   A release missing the zip or the manifest is one no installed app can
   update to.
5. `pnpm --filter inteligir publish` — the `npx inteligir serve --open` path.
   pnpm rewrites the manifest on the way out (`publishConfig.exports`).

## Updates

`src/main/updates.ts` drives electron-updater against the GitHub release.
`electron-builder.yml`'s `publish` row is what writes `app-update.yml` beside
the packaged app and `latest-mac.yml` into `.output/bin`; the release must
carry the dmg, the zip (Squirrel installs from the zip — the dmg is what a
person downloads), the zip's blockmap and that manifest. Nothing moves without
a click: `autoDownload` and `autoInstallOnAppQuit` are off, a check runs 15s
after launch and every 4 minutes, and the download and the restart are each a
button — in Settings › About, or the app menu's Check for Updates… with native
dialogs. Install stops the server child first (the same SIGTERM + grace as
quit, so the vault's pending commit flushes), then hands Squirrel a silent
forced relaunch. Squirrel installs after that call returns, so a failure there
reaches the shell only as the updater's `error` event: the install step owns
it, and the shell says so and quits, since the server is already down. One
step at a time: a poll during a download is skipped, not queued. An unpackaged
build, or one with no `app-update.yml`, reports itself disabled with the reason
instead of checking a feed it does not have. The state is one plain value
(`src/update-state.ts`), a union by status in which each status carries only
what it knows, reduced in main and parsed off the bridge by the page; the
policy is unit-tested against a fake updater (`src/main/__tests__/updates.test.ts`).

## What is deliberately not here

- **No deep-link scheme.** `inteligir://` is the renderer's own origin now; a
  cross-device link would need a second, registered scheme and there is nothing
  to receive yet.
- **No IPC for anything the server can answer.** The bridge carries what the
  page cannot ask its server: the loopback origin, because a browser
  `WebSocket` cannot be proxied; the updater, the spell checker and the vault
  switch, because each lives in main; Reveal/Open of a vault entry, because
  only main may hand the OS a path; and the diagnostics (Open data folder, the
  debug-logging choice, Restart, Show log), because main forks the server with
  that choice and keeps its log. Every other question the page
  has, it asks its own server over `/rpc`. Each channel is one row in
  `src/ipc-contract.ts`, its name beside its request and answer schemas, and a
  refusal crosses as a value rather than a throw, which Electron would reword.
  `src/main/__tests__/ipc-contract.test.ts` holds both ends to every row: main
  registers each channel exactly once, the preload calls it, and neither side
  spells a channel as a literal, because a row one end forgot fails only at
  runtime ("No handler registered", or a handler nothing calls).
