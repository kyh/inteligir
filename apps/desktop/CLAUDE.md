# Decisions: @repo/desktop

The Tauri shell: one window on the library tab the site serves, its pin, its menu, what the .app
carries, and updates.

## The shell

- **Dictation is the operating system's** (owner decision). macOS dictation types as a keyboard
  does, so the app holds no entitlement, usage description, model or socket, and the window denies
  every permission request. `apps/desktop/src-tauri/src/window.rs`.
- **The window is the library tab the site serves** (owner decision). A release loads
  `https://inteligir.com/library` and bundles only the shell, since offline copies would be most of the
  code; its site is compiled in from the config, so nothing at launch moves it.
  `apps/desktop/src-tauri/tauri.conf.json`.
- **A debug build is an app of its own.** `pnpm dev` loads `http://localhost:5174/library` as
  `com.inteligir.desktop.dev`, so its WebKit store and cookie are never the release's.
  `apps/desktop/src-tauri/tauri.local.conf.json`.
- **The window is pinned to its site's origin, compared by its parts.** A prefix compare lets
  `https://inteligir.com.evil.example` in; any other web page opens in the browser, `window.open`
  opens nothing, and a download lands in Downloads. `apps/desktop/src-tauri/src/navigation.rs`.
- **A quit is the system's, and the shell asks the tab nothing** (owner decision). Quit is the
  predefined menu item with no quit hook, since a window that is a tab needs no message from Rust.
  `apps/desktop/src-tauri/src/menu.rs`.
- **The .app is signed with the hardened runtime and no entitlement.** The shell runs no JavaScript
  of its own, loads no unsigned code and is not sandboxed, so it asks for no JIT, unsigned memory or
  network grant, which the owner's Mac smoke checks. `apps/desktop/src-tauri/tauri.package.conf.json`.
- **A pack is `tauri build` on a committed config, and is a release or fails.** Tauri stops one with
  no updater key and the assets step one with no notarization ticket, since a half-release differs
  from a release only by a log line. `apps/desktop/scripts/release-assets.ts`.
- **What only a release has is the pack's config, never `tauri.conf.json`.** tauri-build copies
  `bundle.resources` on every cargo build, so a checkout that never packed would fail its typecheck
  for want of the notices, and a build with no update feed reports its updates off.
  `apps/desktop/src-tauri/tauri.package.conf.json`.
- **The .app asks for macOS 13.5, the oldest the owner's smoke opens it on.** Its WebKit runs the
  page's ES2023, and a floor nobody opened the app on is a promise nobody checked.
  `apps/desktop/src-tauri/tauri.package.conf.json`.
- **An update waits for a click to download and another to restart** (owner decision). Rust drives
  Tauri's updater behind three commands and one event, its session one phase moved by one pure step,
  so an ask that does not fit the phase is a no-op. `apps/desktop/src-tauri/src/updater.rs`.
- **A check, a download and an install that failed are each a state of their own.** The page checks
  each time it loads, so a feed it could not read is no update to act on, and puts no toast up over
  nothing. `apps/desktop/src-tauri/src/updater.rs`.
- **A failed download keeps its release, and a failed install its verified bytes too.** Try again
  reruns that step, since a new check after a download cut off offline fails as well and leaves
  nothing to retry. `apps/desktop/src-tauri/src/updater.rs`.
- **Only the page asks for a check, and the menu holds no update item** (owner decision). Settings
  words every answer a check gives, and a menu item's commonest one, up to date, has no screen of
  its own to say it. `apps/desktop/src-tauri/src/menu.rs`.
- **The release notes are the changelog, written for the person using the app.** A release's body is
  `CHANGELOG.md`'s top section, refused unless titled for the version, since a list of commit
  subjects says only that something changed. `apps/desktop/scripts/release-notes.ts`.
- **The shell is proved by `cargo test`, its engine by Playwright's WebKit, and the packaged app by
  the owner's Mac smoke.** WebKitGTK is not the Mac's engine, `pnpm e2e:webkit` runs the tab's own
  flows in WebKit, and only the window opens a browser, saves a download or hides on close.
  `docs/releasing.md`.
- **The shell's plumbing is copied between repos and diverges on purpose.** The window, pin and
  updater are shared with kyh/init and the pin and packaging with kyh/idlebiz, each shaped to its
  product, so a fix is ported by hand. `apps/desktop/rust-toolchain.toml`.
