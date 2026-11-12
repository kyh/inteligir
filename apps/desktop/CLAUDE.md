# Decisions: @repo/desktop

The Tauri shell: one window on the library tab the site serves, its pin, its menu, what the .app
carries, and updates.

## The shell

- **Dictation is the operating system's** (owner decision). macOS dictation types as a keyboard
  does, so the app holds no entitlement, usage description, model or socket, and the window denies
  every permission request. `apps/desktop/src-tauri/src/window.rs`.
- **The window is the library tab the site serves** (owner decision). A release loads
  `https://inteligir.com/library` and bundles only the shell, since offline copies would be most of the
  code; `INTELIGIR_CLOUD_ORIGIN` may name only a loopback origin, so no variable points a release at
  any site. `apps/desktop/src-tauri/tauri.conf.json`.
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
  network grant, which the owner's Mac smoke checks. `apps/desktop/scripts/package.ts`.
- **An update waits for a click to download and another to restart** (owner decision). Rust drives
  Tauri's updater behind three commands and one event, its session one phase moved by one pure step,
  so an ask that does not fit the phase is a no-op. `apps/desktop/src-tauri/src/updater.rs`.
- **The release notes are the changelog, written for the person using the app.** A release's body is
  `CHANGELOG.md`'s top section, refused unless titled for the version, since a list of commit
  subjects says only that something changed. `apps/desktop/scripts/release-notes.ts`.
- **The shell is proved by `cargo test`, and the packaged app by the owner's Mac smoke.** WebKitGTK
  is not the Mac's engine, and the tab's own flows drive the page the window shows.
  `docs/releasing.md`.
- **The shell's plumbing is copied between repos and diverges on purpose.** The window, pin and
  updater are shared with kyh/init and the pin and packaging with kyh/idlebiz, each shaped to its
  product, so a fix is ported by hand. `apps/desktop/rust-toolchain.toml`.
