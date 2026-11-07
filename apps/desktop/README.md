# @repo/desktop — the Mac app

The window around the library's page `@repo/workspace` builds
([`apps/workspace`](../workspace/README.md)), bundled into the .app. The page is
the same one the Worker serves at `/library`; inside the app it opens the
account's library over **the Mac's own replica**, which the shell keeps in
SQLite, so the Mac reads every item and queues every write with no connection.
The shell is Tauri 2: Rust over the system's own WebKit (WKWebView on the Mac).
It runs no node and no server: what it holds is what a browser tab cannot give,
the replica's file, the device's credential in the Keychain, the cache of the
library's files, the updater, a menu and a menu-bar icon.

```
src-tauri/      the shell, in Rust: the window and its pin, the replica, the credential, the
                files' scheme and cache, the updater, the menus and the menu-bar icon; it
                embeds @repo/workspace's build (`frontendDist`)
isolation/      the Isolation pattern's frame, through which every message to the shell passes
scripts/        the package step, its smoke and the release notes, TypeScript node runs as it stands
```

What the page and the shell say to each other lives on the page's side, in
`apps/workspace/src/shell/`: the command rows (`ipc-contract.ts`), the errors
they reject with (`shell-error.ts`) and the states they carry, parsed there.

## The window carries the page

The window opens `tauri://localhost/library/`, the page the bundle carries, its
files laid out under `library/` as the Worker serves them. The page's routes
ride the hash there, since its document never changes
(`apps/workspace/src/main.tsx`). Before it opens the library the page asks the
shell for its config (the cloud's origin, the files' origin, the Mac's name and
the build) and for the credential a sign-in kept
(`apps/workspace/src/app/cloud/shell-library.ts`):

- **No credential** is the first run: the page's sign-in, or a new account with
  an invite code (`apps/workspace/src/app/cloud/sign-in-page.tsx`). The answer
  is a device credential, which the shell keeps in the Keychain before the
  library opens; a Keychain that refuses it gives the device's slot back.
- **A credential** opens the replica engine (`@repo/library-replica`) over the
  shell's SQLite, its staged files in the shell, and every `/v1` call to the
  cloud's origin with the credential as its bearer and the build in its
  header. The Worker answers CORS for the app's origin alone
  (`apps/web/src/worker/cors.ts`); the socket opens on a ticket the credential
  mints.

A release reaches the production cloud alone, the origin `tauri.conf.json`'s
policy names. A debug build (`pnpm dev`, the scenario suite) reaches this
machine's Worker: `http://localhost:5174`, or the loopback origin
`INTELIGIR_CLOUD_ORIGIN` names, under `src-tauri/tauri.local.conf.json`, which
changes the policy's connect-src to this machine and makes the build an app of
its own, `com.inteligir.desktop.dev`: its replica, its files and its Keychain
item are never the installed app's, so signing it in to the local Worker or out
of it leaves the installed app's library as it was. A debug build under the
release's bundle id refuses to start (`src-tauri/src/cloud.rs`).

Sign out, or an account deleted, forgets the credential, the account's replica
file and every file the Mac holds of it, and the page opens on the sign-in
again; so does a credential the cloud no longer takes.

## The replica is one SQLite file

`src-tauri/src/replica.rs` holds the account's replica, one file in the app's
data dir (`library/<sha-256 of the user id>.sqlite`), on bundled rusqlite with
FTS5 compiled in, so the Mac's search is the cell's and the tab's. One
connection sits behind one mutex, and every command runs on a blocking thread.
The page sends its SQL whole, so the connection is held to its file: it
attaches no other database (`SQLITE_LIMIT_ATTACHED` is 0), and an authorizer
refuses `ATTACH` and `DETACH`, so neither they nor `VACUUM INTO` reach a file
outside the replica.

The page's port (`ReplicaSql` in `@repo/library-replica`) is three calls, and
the bridge carries each:

- `replica_all` and `replica_run`: one statement, its own `IMMEDIATE`
  transaction.
- `exclusive(work)`: `replica_begin` opens a transaction on a thread of its own
  and answers a token; `replica_tx_all` and `replica_tx_run` run under it, and
  `replica_commit` or `replica_rollback` ends it. That thread holds the
  connection, so a statement outside waits, and it rolls back and lets go when
  its token is dropped, a newer `begin` comes, the page starts loading again,
  or no statement comes for ten seconds. A page reloaded mid-transaction never
  wedges the file. The page runs one `exclusive` at a time
  (`apps/workspace/src/shell/shell-commands.ts`).

## The credential is in the Keychain

`src-tauri/src/credential.rs` keeps the credential and the account's id and
email as one Keychain item under the bundle id, through keyring-core over `apple-native-keyring-store`, and nowhere else on
disk. The page holds the credential in memory once it has it. On Linux, where
the shell runs only under the scenario suite, keyring-core's sample store, a
file in the app's data dir, stands in.

## The library's files ride the shell's scheme

The page draws a file from `inteligir-files://localhost/<sha>`
(`src-tauri/src/file_scheme.rs`), an asynchronous scheme handler:

- A file this Mac holds is served from disk, one range of it when asked.
- A miss is fetched from `/v1/blobs/<sha>` with the credential, checked against
  its sha, kept and served (`src-tauri/src/file_cache.rs`).
- Fetched files sit in the caches dir, under 5 GB, the least recently read let
  go first. A file the outbox has yet to upload sits staged in the data dir,
  never evicted, and moves into the cache once uploaded. Each file's type sits
  beside it and moves with it: the type the page staged it as (`files_stage`'s
  `x-file-type`, the one the outbox uploads it as), or the one the cloud served.
- Every file but a PDF is served under a script-less sandbox, as the cloud
  serves it; a PDF keeps WebKit's viewer under a policy that runs no script and
  that only the app's page may frame.

## The bridge

The page reaches the shell through Tauri's commands, one row each in
`apps/workspace/src/shell/ipc-contract.ts`, over
`apps/workspace/src/shell/shell-commands.ts`, the page's one door: a call per
row, typed from the row, parsing every answer and every event against it. Each
command (`src-tauri/src/commands.rs`) is `async` with owned arguments and
answers a `Result`: its `ShellError` (`src-tauri/src/error.rs`) crosses as the
call's rejection, `{ kind, message }`, with a kind the page reads. Bytes cross
raw: a staged file comes in as the request's body, its sha in a header, and
goes out as an `ipc::Response`.

The window's one capability, `src-tauri/capabilities/app-window.json`, is
static: the `main` window, the local origin alone, no remote URL, granting
every command the app manifest names (`src-tauri/build.rs`) and the window's
own drag and maximize. The suites answer those calls through Tauri's own IPC
mock (`apps/workspace/src/shell/test-support/mock-shell.ts`), so they run the
real command names and the answer parse, and
`tools/repo-guards/src/desktop-shell-wire.test.ts` holds what the two
languages share.

## The origin pin and the policy

`src-tauri/src/navigation.rs` is pure, unit-tested, and the policy the window
runs (`src-tauri/src/window.rs`):

- The window shows **the page's origin**, and lets the shell's files load
  inside it (a PDF's viewer is a frame of the page's). Tauri hands the hook a
  navigation's URL alone, never its frame, so the files' origin passes
  whichever frame asks; the page never sends the window there, since it saves
  a file by reading its bytes into a blob of its own origin
  (`apps/workspace/src/app/item/item-stages.tsx`), and a blob the page made
  loads too, as WebKitGTK asks the hook about its `download` link (WebKit on
  macOS saves one unasked). A navigation anywhere else
  is refused; an http(s) target is handed to the system browser instead, at
  most once a second, since WebKit tells the shell nothing of a user gesture.
- **No second window.** `window.open` and `target="_blank"` are refused; a web
  URL among them goes to the browser.
- **Every permission request is refused**: dictation is the operating
  system's, so the page needs no microphone, camera or location.
- **A download** (a file item's Download, an export's zip) lands in the
  Downloads folder under its own name.

Origins are compared **by their parts**, and a URL that carries a login is
never one. Closing the window hides it: the app lives on in the menu bar, and
Show brings the same page back.

The window's content policy is `src-tauri/tauri.conf.json`'s: the bundle's
scripts alone, the page's own origin, Tauri's IPC and the cloud's exact origin
and socket to call, the files' scheme to draw from, and no frame policy, since
Tauri adds the isolation frame's per-launch origin to default-src alone. Every
message to the shell passes the Isolation pattern's frame
(`isolation/index.html`, a classic script).

## Updates

`src-tauri/src/updater.rs` drives Tauri's updater against the GitHub release's
`latest.json`, whose archive is signed with the updater key in `.release/`
(minisign; the app carries the public half). A check runs 15 seconds after
launch and every 4 minutes after; one that finds an update downloads it in the
background, the plugin verifying its signature, and the verified download
installs when the app quits, so the next launch is the new version. Restart to
Update, in the app menu (where Check for Updates… stands until one is ready)
and in Settings › About, installs it and relaunches at once. A failed download
says so, and the next check tries again. A shell outside a bundle, or a pack
with no updater key, reports itself off with the reason. The page holds no
updater permission: the state is one value, a union by status reduced in the
shell (`src-tauri/src/update_state.rs`), pushed as `update-state` and parsed by
the page (`apps/workspace/src/shell/update-state.ts`).

## The way out

Quit (the app menu's ⌘Q, the menu-bar icon's, a SIGTERM) and Restart to
Update go through `src-tauri/src/leaving.rs`: the shell tells the page it is
leaving (`leaving`), the page writes what it holds, the open item's edit still
waiting out its pause, into the outbox on disk, and answers (`leaving_ready`),
and the shell goes, after three seconds without an answer at the latest. Quit
is the app's own menu item, since the predefined one ends the app before the
page can answer. A quit macOS sends itself (the Dock's Quit, a log out) ends
the app with no word to the page.

## Running it

```bash
pnpm dev:web          # the local Worker, which the debug shell's page calls
pnpm dev              # tauri dev: the shell compiled and launched over the page's last build
```

`pnpm dev` embeds the page's last build, which `^build` makes first, so an edit
to the page reaches the window once the page is rebuilt and the shell
relaunches; the page's own loop is the tab's, `pnpm dev:web`. An edit to the
shell's Rust rebuilds and relaunches it. A debug build's window has WebKit's
inspector (right click, Inspect Element).

The shell's unit tests (`cargo test`, this workspace's whole `pnpm test`) cover
the policies: the replica's transactions and their rollbacks, the scheme's
hits, misses, ranges and eviction, the credential over keyring-core's mock
store, the updater's states and the pin. `pnpm e2e`'s shell scenarios are the
glue (`tools/e2e/README.md`): they launch the checkout's unbundled debug shell
(`pnpm turbo run build:shell --filter=@repo/desktop`) on a scratch home through
`tauri-driver` and WebKitGTK's WebDriver, against a booted Worker reached
through a relay the scenario can cut. `desktop-onboarding` signs in through the
window, finds the account's replica file, relaunches into the library, and
signs out, leaving no replica file; `desktop-shell` reads the library from the
shell's replica, sees another device's write reach the open editor, draws a
picture and a PDF over the files' scheme, is refused `window.open` and every
permission, relaunches with the cloud cut and opens the item from the replica,
draws a PDF dropped offline from its staged bytes, saves a dropped file's
Download to Downloads with the window left on it, quits within the editor's
pause and finds the edit after the next launch, and sees that edit land once
the cloud is back. They run on Linux, under `xvfb-run` in CI: WebKit's
WebDriver is WebKitGTK's alone.

## Packaging

```bash
pnpm package:desktop      # → src-tauri/target/release/bundle/macos/Inteligir.app,
                          #   and the release's assets in .output/bin
pnpm smoke:desktop        # boot the packaged app and quit it
```

Every script is TypeScript that node runs as it stands, stripping the types,
and `scripts/tsconfig.json` checks it as node resolves it, so `pnpm typecheck`
refuses an import node could not load.

`scripts/package.ts` runs on a Mac:

1. `scripts/rust-notices.ts` writes `.output/notices/rust-crates.txt`: every
   crate the shell's binary links on the Mac, read from cargo's own resolve,
   with its version, licence and source, and each licence text the crates ship,
   once, since their licences ask that the notices travel with the binary.
2. `tauri build` with a config of the script's own that names the notices as
   the bundle's resources, the signing and, with the updater's key, the feed:
   they live there and never in `src-tauri/tauri.conf.json`, because
   tauri-build copies resources on every cargo build, and a checkout that never
   packaged could not typecheck.

The identity is the Developer ID the keychain holds, signed with the hardened
runtime and no entitlement; with none, or with `INTELIGIR_PACK_UNSIGNED=1`
(CI's), the pack is signed ad-hoc, without the runtime, and opens only on the
Mac that built it. It is notarized with the App Store Connect key in
`<repo>/.release/` (gitignored): `notary.env` carries Tauri's own names:
`APPLE_API_ISSUER`, `APPLE_API_KEY` (the key's id) and `APPLE_API_KEY_PATH`
(the `.p8`'s filename, resolved against that directory). The script reads it
inside the task, since turbo's strict env mode strips an undeclared variable
before the task begins, and drops every notary variable the task inherits, so
a stale export in the shell never notarizes a pack. The updater's private key
reaches the bundler as `TAURI_SIGNING_PRIVATE_KEY` in its environment alone.
The minimum macOS is 13.5, whose WebKit runs the page's ES2023.

The smoke (`scripts/smoke-packaged.ts`) checks that the bundle runs the shell
alone and carries nothing runnable among its resources, with the Rust crates'
notices; that its signature holds and asks for no JIT, no unsigned memory and
no network grant; and then launches it on a home of its own until its window
has loaded the page it carries, and quits it with a SIGTERM, which must exit 0.
It refuses to start while an Inteligir answers on the single-instance socket,
which is machine-wide and would take the launch over. CI's `test-macos` job
runs it on every push and pull request, on an ad-hoc pack.

### The release path

`docs/releasing.md`: the version the artifacts share, the gates, the signed
and notarized pack, the GitHub release with its assets, and the owner's checks
on the packaged app.
