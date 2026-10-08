# @repo/desktop — the shipped product

The window, and the page inside it. This app owns **no thread, no agent and no
database**: those live in the server it starts, and everything here is what a
browser tab cannot give — a dedicated window, a menu-bar icon, a menu, the
updater, and a process that starts and stops the server with the app. It is a
Tauri 2 shell: Rust over the system's own WebKit (WKWebView on the Mac), which
runs the CLI's server on the node it ships beside itself (issue #889).

```
src-tauri/      the shell, in Rust: the window and its pin, the server it starts and stops,
                the updater, the menus and the menu-bar icon
src/renderer/   the page — TanStack Router file routes over @repo/contract/local — which the
                server answers
src/*.ts        what the page and the shell say to each other: the command rows
                (ipc-contract.ts) and the states they carry, parsed on the page's side
```

## The shell asks the CLI, and spells none of its rules

Every rule the shell acts by that is the server's own lives in TypeScript once,
in the CLI, and the shell asks it through the CLI's desktop entry
(`apps/cli/src/desktop/desktop-entry.ts`, built as `dist/desktop.js`): one
question per process, answered as one JSON line, `{"answer": …}` or
`{"reason": …}` for a refusal in the person's words. `launch` answers the data
dir the launch serves and the login shell's PATH (below); `handoff` mints a
browser's sign-in; and `serve` is the server itself. A question costs a node
start, about 0.2s, paid once a launch. The wire breaks freely, since both ends ship in one
bundle, and `tools/repo-guards/src/desktop-shell-wire.test.ts` holds the
words the two languages share.

## A launch goes straight to the server's page

There is no first run: every launch asks the door which data dir it serves,
starts (or adopts) that server, and opens the window on it. `/welcome`
(`src/renderer/routes/_workspace/welcome.tsx`) still draws the account step
over the workspace like Settings, with Skip for now, for whoever links to it.

## The window is the server's own page

The app window loads the server's origin, `http://127.0.0.1:<port>`, through a
one-time handoff the server minted: the server trades the nonce for an
HttpOnly, SameSite=Strict cookie and drops the nonce from the URL, exactly as
it signs a browser tab in. So the page, its API and its socket are one origin,
there is no proxy in front of the server, and **the page never holds the
device token**. The server's own policy and headers are the page's
(`apps/cli/src/server/csp.ts`). Under `tauri dev` the window loads the same
origin, and that server answers the page's files from Vite's dev server
(`apps/cli/src/server/ui-dev-server.ts`), so an edit reloads in place on the
sign-in a release runs.

The window gets **a web store keyed by its data dir** (`data_store_identifier`
on the Mac, a `data_directory` on Linux), so two data dirs never read each
other's cookies or localStorage, as Electron's partitions kept them apart. The page's preferences are that store's localStorage, so the move from
Electron started each one's from its defaults once.

The page reaches the shell through Tauri's commands, one row each in
`src/ipc-contract.ts` (its name beside its argument and answer schemas), over
`src/renderer/shell-commands.ts`, which parses every answer and every event.
`window.desktopBridge` is installed before the first render only when the page
runs inside the shell; a browser tab on the same server has none, and every
surface that needs it draws nothing. The commands are granted when the shell
opens the window, to that window and the server's exact origin alone
(`grant_app_window` in `src-tauri/src/window.rs`), since the port is the
server's to choose; `src-tauri/capabilities/app-window.json` grants nothing,
and lists them only so the build keeps them (`removeUnusedCommands`). A
refusal is an answer, never a rejected promise: a rejection is a fault.

## The origin pin is the whole security surface

`src-tauri/src/navigation.rs` is pure, unit-tested, and the policy every window
runs (`pinned` in `window.rs`):

- A window loads **exactly one origin** and stays on it: the server's. A
  top-level navigation anywhere else (a crafted link, agent output, injected
  content) is refused; an http(s) target is handed to
  the system browser instead, at most once a second, since WebKit tells the
  shell nothing of a user gesture and a script loop would otherwise be a loop
  of browser launches.
- **No window opens a second one.** `window.open` and `target="_blank"` are
  refused; a web URL among them goes to the browser.
- **Every permission request is refused**: dictation is the operating
  system's (fn twice), typed into the field like a keyboard, so the page needs
  no microphone, camera or location.
- A file dropped from Finder is the page's, not the shell's.

Origins are compared **by their parts** — scheme, host and port, with each
scheme's default port filled in — and a URL that carries a login is never one.
Closing a window hides it: the app lives on in the menu bar, and Show brings
the same page back.

## The server is a child process

`src-tauri/src/server.rs` starts `node dist/desktop.js serve` and is its one
supervisor. Why a child rather than in-process: the server opens
`better-sqlite3` synchronously and holds the sync socket, and the rebuild's
server reads tmux and the agents' hooks too; none of that belongs in the
process that owns the window.

The child prints one marked line once it answers (`inteligir-desktop:` and a
JSON body): ready, with its origin, the window's handoff and how long a stop
may take; adopted, when a server already serving this data dir at this version
was found, and the entry exits leaving it running; or refused, in the person's
words, when one holds the data dir but cannot be adopted (silent, or another
version). The judgement is the CLI's own (`inteligir/server/server-probe`),
the reading `serve`'s guard runs before it boots. Quitting leaves an adopted
server running: the shell stops only the child it started.

**The child's stdin is its lifeline.** The shell holds the pipe's other end
and never writes to it, so it closes only when the shell is gone; a server
whose app crashed or was killed then stops itself rather than go on holding
the data dir. That is also why the child runs in a process group of its own:
a signal to the shell's group (Ctrl-C under `tauri dev`, a supervisor's
`killpg`) reaches the shell alone, which stops the server once, where a
second signal mid-shutdown would read to the server as impatience and skip
the flush.

**Quit stops the server first**: Quit, a `kill` (SIGTERM or SIGINT, which the
shell takes as Quit) and an update's install both send the child SIGTERM and wait the grace the server announced (its own
`SHUTDOWN_TIMEOUT_MS` plus headroom, never spelled here), so the server's
pending writes flush; a child still running after it gets SIGKILL. There is no
restart: a fresh child mints a fresh session the window does not hold, so an
unexpected exit says so in a dialog and quits.

**What the child prints is kept.** Each line is appended, stamped, to
`<dataDir>/logs/server.log` (`src-tauri/src/server_log.rs`), rotated at 5 MiB
into one `server.log.1`, beside the shell's own notes of the child's start and
exit and of each window it loads; a write that fails costs the log, never the
shell. Debug logging is the shell's choice rather than the env's, since a
Finder launch has none: `diagnostics.json` in the shell's own folder
(`src-tauri/src/diagnostics.rs`), read before each start and handed to the
child as `serve --debug`, every namespace. The choice reaches the next child,
so Settings › Advanced offers Restart, which relaunches the whole app through
the ordinary quit. A development shell refuses it, since `tauri dev` owns that
process, and a server the shell adopted is not its child: neither the choice
nor its output reaches it, and the page says so.

## The node children run on the node the app ships

`src-tauri/src/runtime.rs` decides what runs, and nothing in the environment
can move it: an app launched with another `PATH` or `open --env` must not run
another program inside a process the OS counts as this one. Inside
`Inteligir.app/Contents/MacOS` the bundle carries both halves: the official
node build beside the shell (`bundle.externalBin`, fetched and pinned by
`scripts/fetch-node.mjs`) and the CLI with its production dependencies as
`Contents/Resources/server`; a missing one is a broken install, said as one. A
shell outside a bundle (`tauri dev`, the scenario suite's build) runs the
checkout's CLI on the developer's own node, as `pnpm cli serve` does. Every
`NODE_*` variable but `NODE_ENV` is dropped from every child's environment, so
no `NODE_OPTIONS` reaches the server, the role Electron's fuses played.

## The child's PATH is the login shell's

An app opened from Finder or the Dock inherits launchd's PATH
(`/usr/bin:/bin:/usr/sbin:/sbin`). The rebuild's server finds the user's own
tmux and agent binaries by name, and hands that PATH to the agents it starts
(`node`, `npx`, a version manager's shims), and none of those is on launchd's
PATH. So the launch question runs `$SHELL
-ilc` once, reads the PATH it prints, and every node child the shell starts
after runs with those entries ahead of the inherited ones
(`apps/cli/src/desktop/login-shell-path.ts`). A shell that hangs past 5s,
fails or prints nothing leaves the usual install dirs that exist
(`~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`) in its place. A dev
launch skips it: its terminal already has the user's PATH.

## Spell check

Spell check is the page's own: the `spellcheck` attribute on the document
root, a page preference, which WebKit's checker honours and every field
inherits unless it sets its own (`src/renderer/app/spellcheck.ts`). macOS
picks the languages, as it always did under Electron on the Mac.

## Running it

```bash
pnpm dev              # tauri dev: the page's Vite server, the shell compiled and
                      # launched, and the CLI bundle rebuilt first
```

The shell RUNS that bundle, which is why the dev task depends on
`inteligir#build` — a stale `dist/` is a window on last week's server with no
error anywhere. Iterating on the SERVER is `pnpm cli serve` in its own
terminal: that runs the TypeScript source under tsx, and a shell started
afterwards adopts it. A debug build's window has WebKit's inspector (right
click, Inspect Element).

The shell's unit tests (`cargo test`, beside the page's vitest suites in
`pnpm test`) cover the policy, never the glue. `pnpm e2e`'s shell scenarios are
the glue (`tools/e2e/README.md`): they launch the checkout's unbundled shell
(`pnpm turbo run build:shell --filter=@repo/desktop`) on a scratch home through
`tauri-driver` and WebKitGTK's WebDriver, and `desktop-shell` asserts that the
window is the server's page, that the rail's actions ride its cookie and an
action the API creates reaches the rail through the socket, that
`window.open` and every permission request are refused, and that a SIGTERM
quit stops the server and retracts its `server.json`. They run on Linux, under
`xvfb-run` in CI: WebKit's WebDriver is WebKitGTK's alone.

## Packaging

```bash
pnpm package:desktop      # → src-tauri/target/release/bundle/macos/Inteligir.app,
                          #   and the release's assets in .output/bin
pnpm smoke:desktop        # package, boot it, drive its server, quit
```

`scripts/package.mjs` runs on a Mac and does it in order:

1. `scripts/fetch-node.mjs` stages the node into `src-tauri/binaries` with its
   licence in `resources/node`, shipped as `notices/node` (both gitignored), a
   file fetch pinned by sha-256 and cached under `.cache/`: the official
   darwin-arm64 build. A version bump is the tag and the hashes at the top of
   the script.
2. `scripts/stage-server.mjs` stages the CLI as `.output/server`: the package
   as npm would publish it (its `files`) and its production dependencies,
   through `pnpm deploy` with a hoisted linker, so the lockfile's versions ship
   and no symlink rides into the bundle.
3. `scripts/sign-resources.mjs` signs every Mach-O those resources carry (the
   native addons) with the hardened runtime and
   `resources/entitlements.mac.plist`: Tauri signs the shell, the node and the bundle, but
   notarization refuses any binary inside that is not itself signed.
4. `scripts/rust-notices.mjs` writes `.output/notices/rust-crates.txt`: every
   crate the shell's binary links on the Mac, read from cargo's own resolve,
   with its version, licence and source, and each licence text the crates ship,
   once, since their licences ask that the notices travel with the binary.
5. `tauri build` with a config of the script's own that names the resources,
   the node and the signing: they live there and never in
   `src-tauri/tauri.conf.json`, because tauri-build copies resources and
   checks the external binary on every cargo build, so a clippy run would copy
   the 700 MB server, and a checkout that never packaged could not typecheck.

The identity is the Developer ID the keychain holds; with none, or with
`INTELIGIR_PACK_UNSIGNED=1` (CI's), the pack is signed ad-hoc, without the
hardened runtime, whose library validation would refuse the pack's own
unsigned-by-a-team addons, and it opens only on the Mac that built it. It is
notarized with the App Store Connect key in `<repo>/.release/` (gitignored):
`notary.env` carries `APPLE_API_KEY` (the `.p8`'s filename, resolved against
that directory), `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`, which the script
hands Tauri under its own names — inside the turbo task, because turbo's strict
env mode strips an undeclared variable before the task begins. The minimum
macOS is 13.5, node 24's own floor.

There is no native-rebuild step, and that is a fact rather than an omission:
the one native module, better-sqlite3, is a Node-API addon shipping
per-platform prebuilds, which the node the app ships loads as any node does.
Re-check this if it, or a native module added later, needs a gyp build.

The smoke LAUNCHES the packaged app, with the data dir pinned by environment
and a home of its own, so the shell's folder lands in the scratch,
and then again under a scratch home with nothing pinned.
It refuses to start while an Inteligir answers on the single-instance socket,
which is machine-wide and would take the launch over. It checks that the
packaged CLI is the package npm would publish, that node and the Rust crates
carry their licences, that the native module loads on the shipped node, that
the page and the API answer, that the server reports no agent runtime rather
than claiming one it does not carry, that the unpinned launch serves the
home's own data dir, and that each
SIGTERM quit stops the server cleanly (the shell's note in the server's log
says `server exited (code 0)`) and exits 0. **The window opens, and
the smoke checks nothing in it** but that it loaded: the pin is proven by its
unit tests and the window by the shell scenarios. CI's `test-macos` job runs
it on every push and pull request, on an ad-hoc pack.

### The release path

`docs/releasing.md`: the version the three artifacts share, the gates, the
signed and notarized pack, the GitHub release with its assets, the npm
publish, and the owner's checks on the packaged app.

## Updates

`src-tauri/src/updater.rs` drives Tauri's updater against the GitHub release's
`latest.json`, whose archive is signed with the updater key in `.release/`
(minisign; the app carries the public half). Nothing moves without a click: a
check runs 15s after launch and every 4 minutes, and the download and the
install are each a button — in Settings › About, or the app menu's Check for
Updates… with native dialogs. Install stops the server child first (the same
SIGTERM and grace as quit, so the server's pending writes flush), installs and
relaunches; an install that fails says so and quits, since the server is
already down. One step at a time: a check during a download is skipped, not
queued. A shell outside a bundle, or a pack with no updater key, reports
itself disabled with the reason instead of checking a feed it does not have.
The state is one plain value, a union by status in which each status carries
only what it knows, reduced in the shell (`src-tauri/src/update_state.rs`) and
parsed off the bridge by the page (`src/update-state.ts`).

The Electron builds update through electron-updater, which reads the release's
`latest-mac.yml` and zip, so the package step writes both too, around this
app: same bundle id and team, so they move onto it. This app needs macOS 13.5,
node 24's floor, where the Electron builds ran on older ones, so the manifest names
that floor as the Darwin release electron-updater compares (22.6.0), and an
older Mac is offered nothing it could not open.

## What is deliberately not here

- **No custom scheme.** Electron's `inteligir://app` and the protocol handler
  that carried the bearer in front of the server are gone: the window is the
  server's own page, signed in like a tab. A cross-device link would need a
  registered scheme, and there is nothing to receive yet.
- **No command for anything the server can answer.** The shell answers what
  the page cannot ask its server: the updater, because it replaces the app;
  and the diagnostics (Open data folder,
  the debug choice, Restart, Show log), because the shell starts the server
  with that choice and keeps its log. Every other question the page has, it
  asks its own server over `/rpc`.
