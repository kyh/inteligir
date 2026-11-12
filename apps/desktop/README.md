# @repo/desktop — the Mac app

A window on the library tab the site serves at `/library`
([`apps/web/src/library`](../web/src/library/CLAUDE.md)), with a menu and the stock
updater. The shell is Tauri 2: Rust over the system's own WebKit (WKWebView on
the Mac). It bundles no page, runs no node and no server, and keeps nothing of
the library: the page signs in, reads and writes as a browser tab does, so the
app needs a connection. Its decisions are in [`CLAUDE.md`](CLAUDE.md).

```
src-tauri/      the shell, in Rust: the window and its pin, the menu, the updater
scripts/        the package step and the release notes, TypeScript node runs as it stands
```

## The window

A release opens `https://inteligir.com/library` (`frontendDist` in
`src-tauri/tauri.conf.json`); `pnpm dev` opens `http://localhost:5174/library`
(`devUrl`) under `src-tauri/tauri.local.conf.json`, which makes the build an
app of its own, `com.inteligir.desktop.dev`, so its WebKit store and cookie are
never the installed app's. Any build opens a Worker on this machine instead
when `INTELIGIR_CLOUD_ORIGIN` names a loopback origin (`http://localhost:…`,
`http://127.0.0.1:…`), keeping the configured path; any other value stops the
app before it opens (`src-tauri/src/window.rs`).

Signed out, the page sends the window to the site's sign-in, which brings it
back, as in a tab. Offline, the window shows WebKit's load error, and View ›
Reload tries the site again. The window keeps the system's title bar.

`src-tauri/src/navigation.rs` is the pin the window runs, pure and
unit-tested:

- The window shows **the site's origin**, compared by its parts, and the blank
  documents a frame starts on. A blob the page made loads too, the one a file
  item's Download saves through.
- **Any other web page** opens in the system browser; anything else is refused.
- **No second window.** `window.open` and `target="_blank"` are refused; a web
  URL among them goes to the browser.
- **Every permission request is refused**: dictation is the operating
  system's, so the page needs no microphone, camera or location.
- **A download** lands in the Downloads folder under its own name.

Closing the window hides it; the Dock's icon brings it back. Quit is the
system's: the page writes the open item's edit as it goes out of sight, as a
tab does.

## The menu

`src-tauri/src/menu.rs`: macOS's default menu, with View › Reload (⌘R), which
reloads the page or brings the window back to the site, and, when the app
updates itself, Check for Updates… in the app menu.

## Updates

`src-tauri/src/updater.rs` drives Tauri's updater against the GitHub release's
`latest.json`, whose archive is signed with the updater key in `.release/`
(minisign; the app carries the public half). The page checks when it loads,
and Check for Updates… checks again; a found update waits for Download, and a
verified download for Restart, in the page's card at the window's bottom
right (`apps/web/src/library/desktop-update-banner.tsx`) and Settings › About. The
page holds no updater permission: three commands (`check_for_updates`,
`download_update`, `install_update`) and one `update-state` event, which the
window's one capability grants (`src-tauri/capabilities/web-app.json`) and the
page parses (`apps/web/src/library/shell/desktop-bridge.ts`). A pack with no
updater key, and `pnpm dev`, have no feed, so their updater is off.

## Running it

```bash
pnpm dev:web          # the local Worker, which the debug window opens
pnpm dev              # tauri dev: the shell compiled and launched on localhost:5174/library
```

An edit to the page reaches the window once `pnpm dev:web` has rebuilt it and
the window reloads (⌘R); an edit to the shell's Rust rebuilds and relaunches
it. A debug build's window has WebKit's inspector (right click, Inspect
Element). The shell's unit tests (`cargo test`, this workspace's whole
`pnpm test`) cover the pin, the local-site override and the update states'
wire.

## Packaging

```bash
pnpm package:desktop      # → src-tauri/target/release/bundle/macos/Inteligir.app,
                          #   and the release's assets in .output/bin
```

Every script is TypeScript that node runs as it stands, stripping the types,
and `scripts/tsconfig.json` checks it as node resolves it, so `pnpm typecheck`
refuses an import node could not load.

`scripts/package.ts` runs on a Mac:

1. `cargo about` writes `.output/notices/rust-crates.txt` from
   `src-tauri/about.toml` and `about.hbs`: every crate the shell's binary is
   built from on the Mac, with its version, licence and source, and each licence
   text once, since their licences ask that the notices travel with the binary.
2. `tauri build` with a config of the script's own that names the notices as
   the bundle's resources, the signing and, with the updater's key, the feed:
   they live there and never in `src-tauri/tauri.conf.json`, because
   tauri-build copies resources on every cargo build, and a checkout that never
   packaged could not typecheck.

The identity is the Developer ID the keychain holds, signed with the hardened
runtime and no entitlement; with none, or with `INTELIGIR_PACK_UNSIGNED=1`,
the pack is signed ad-hoc, without the runtime, and opens only on the
Mac that built it. It is notarized with the App Store Connect key in
`<repo>/.release/` (gitignored): `notary.env` carries Tauri's own names:
`APPLE_API_ISSUER`, `APPLE_API_KEY` (the key's id) and `APPLE_API_KEY_PATH`
(the `.p8`'s filename, resolved against that directory). The script reads it
inside the task, since turbo's strict env mode strips an undeclared variable
before the task begins, and drops every notary variable the task inherits, so
a stale export in the shell never notarizes a pack. The updater's private key
reaches the bundler as `TAURI_SIGNING_PRIVATE_KEY` in its environment alone.
The minimum macOS is 13.5, whose WebKit runs the page's ES2023.

### The release path

`docs/releasing.md`: the version the artifacts share, the gates, the signed
and notarized pack, the GitHub release with its assets, and the owner's checks
on the packaged app.
