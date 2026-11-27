# Decisions: @repo/desktop

The Electron shell: one window on the library tab the site serves, its pin, its menu, what the .app
carries, and updates.

## The shell

- **The shell is Electron, as kyh/init's is** (owner decision). A main process, a sandboxed
  preload and what the two share, bundled by electron-vite and packed by electron-builder. Why: one
  engine (Chromium) on every Mac, and one shell layout across the repos.
  `apps/desktop/src/main/index.ts`.
- **Dictation is the operating system's** (owner decision). macOS dictation types as a keyboard
  does, so the app holds no entitlement, usage description, model or socket, and every session
  denies every permission request and check. `apps/desktop/src/main/window.ts`.
- **The window is the library tab the site serves** (owner decision). A release loads
  `https://www.inteligir.com/library` and bundles only the shell, since offline copies would be most of
  the code; the site is compiled into main, so nothing at launch moves it.
  `apps/desktop/src/main/index.ts`.
- **A dev launch is an app of its own.** `pnpm dev` loads `http://localhost:5174/library` as
  "Inteligir (Dev)", with its own user data folder, so its cookie and storage are never the
  release's. `apps/desktop/src/main/index.ts`.
- **The renderer is a web page and nothing more**: `contextIsolation`, `sandbox`, no node, no
  webview, no second window. The preload exposes `window.desktopBridge`, one function per command and event, only on the site's origin,
  and main answers a command only from the window's top frame on that origin.
  `apps/desktop/src/preload/index.ts`, `apps/desktop/src/main/index.ts`.
- **Every web contents is pinned to the site's origin, compared by its parts.** A prefix compare lets
  `https://www.inteligir.com.evil.example` in; any other web page opens in the browser, `window.open`
  opens nothing in the app, a frame loads only the site, and a download lands in Downloads.
  `apps/desktop/src/main/navigation.ts`.
- **A quit is the system's, and the shell asks the tab nothing** (owner decision). Quit is the
  menu's `quit` role with no hook, since a window that is a tab needs no message from main. Closing
  the window hides it; ⌘Q and the dock quit. On Windows, with no dock, closing it quits.
  `apps/desktop/src/main/window.ts`.
- **The .app is signed with the hardened runtime and electron-builder's default entitlements, and
  notarized.** Those are the JIT grants V8 needs and nothing more; electron-builder signs and
  notarizes the app, and the pack script notarizes and staples the dmg.
  `apps/desktop/electron-builder.yml`, `apps/desktop/scripts/package.ts`.
- **The app targets macOS and Windows, never Linux** (owner decision), as kyh/init's and
  dataembed's do. Windows packs with NSIS and draws no menu, since a menu there is a bar across the
  library; it is packed but not published. `apps/desktop/electron-builder.yml`,
  `apps/desktop/src/main/menu.ts`.
- **A macOS and a Windows runner pack the app only on a release and by hand**
  (`.github/workflows/desktop-release.yml`): unsigned, with no Developer ID, and never on a push or
  a PR. Why: a macOS runner bills about ten times a Linux one and a Windows runner twice, which
  spent the account's Actions budget, and the shell's tests already run under node in CI's
  `verify`. `.github/workflows/desktop-release.yml`.
- **The .app's fuses are off for anything that runs other code as it**: running as plain Node,
  `NODE_OPTIONS`, `--inspect`, any app code but the `app.asar` whose integrity the bundle
  records, and `file://`'s extra privileges, since no page loads from a file, as Electron's
  security checklist asks. `apps/desktop/electron-builder.yml`.
- **A pack is a release or fails.** It refuses to start without the signing identity and the
  notary key, and refuses to finish without a stapled app, a notarized dmg and every asset a
  release carries, since a half-release differs from a release only by a log line.
  `apps/desktop/scripts/package.ts`.
- **The icon is a committed `Assets.car` compiled from the phone's `app.icon`, beside the `.icns`.**
  macOS 26 reads the catalog's `app` icon (`CFBundleIconName`) and older Macs the `.icns`; compile
  it beside an empty `.xcassets` with `--app-icon app`, macOS 13.5 as the minimum deployment
  target. `apps/desktop/resources/Assets.car`.
- **The .app asks for macOS 13.5, the oldest the owner's smoke opens it on.** A floor nobody opened
  the app on is a promise nobody checked. `apps/desktop/electron-builder.yml`.
- **The feed is GitHub's latest release, through electron-updater**: `latest-mac.yml` and the zip.
  A build with no `app-update.yml` (a dev launch, an unpacked build) reports its updates off.
  `apps/desktop/src/main/updater.ts`.
- **An update waits for a click to download and another to restart** (owner decision). Main drives
  electron-updater behind three commands and one event, its session one phase moved by one pure
  step, so an ask that does not fit the phase is a no-op. `apps/desktop/src/main/update-session.ts`.
- **A check, a download and an install that failed are each a state of their own.** The page checks
  each time it loads, so a feed it could not read is no update to act on, and puts no toast up over
  nothing. `apps/desktop/src/main/update-session.ts`.
- **A failed download keeps its release, and a failed install its downloaded bytes too.** Try again
  reruns that step, since a new check after a download cut off offline fails as well and leaves
  nothing to retry. `apps/desktop/src/main/update-session.ts`.
- **A download reads as under way only once its first bytes arrive.** Until then the page goes on
  showing the step it was asked from, since a retry offline fails at once and a progress bar
  between two failures is a flash. `apps/desktop/src/main/update-session.ts`.
- **Only the page asks for a check, and the menu holds no update item** (owner decision). Settings
  words every answer a check gives, and a menu item's commonest one, up to date, has no screen of
  its own to say it. `apps/desktop/src/main/menu.ts`.
- **The release notes are the changelog, written for the person using the app.** A release's body is
  `CHANGELOG.md`'s top section, refused unless titled for the version, since a list of commit
  subjects says only that something changed. `apps/desktop/scripts/release-notes.ts`.
- **The shell's logic is proved by its vitest suites, and the packaged app by the owner's Mac
  smoke.** The pin, the save path and the update session are pure; only the window opens a
  browser, saves a download or hides on close. `docs/releasing.md`.
- **The shell's plumbing is copied between repos and diverges on purpose.** The window, pin and
  updater are shared with kyh/init and the pin and packaging with kyh/idlebiz, each shaped to its
  product, so a fix is ported by hand. `apps/desktop/src/main/navigation.ts`.
