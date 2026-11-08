# Decisions: @repo/desktop

The Tauri shell: one window on the library's page the site serves, its pin,
its menu, what the .app carries, and updates. `AGENTS.md` § Decisions says how
a bullet is written and cited.

## Dictation

- **DICTATION IS THE OPERATING SYSTEM'S** (owner decision). macOS dictation (fn
  twice, Edit › Start Dictation) and the phone keyboard's mic type as a keyboard
  does, so the app is signed with no entitlement at all, a microphone's among
  them (`apps/desktop/scripts/package.ts`), and holds no usage description, web
  permission, model or socket, and the window denies every permission request
  (`apps/desktop/src-tauri/src/window.rs`). A dictated phrase lands as one
  IME-style commit, so a field carries no caret repair. Rejected: an in-app
  recognizer (live partials on a native addon in a worker, a ~100 MB
  third-party download behind a sha gate, a dictation socket, the app's only
  device grant).

## The desktop shell

- **THE WINDOW IS THE LIBRARY'S PAGE THE SITE SERVES** (owner decision, kyh/init's
  model). A release loads `https://inteligir.com/library` (`frontendDist`) and
  bundles nothing but the shell: the page signs in, reads and writes as a
  browser tab does, over the site's cookie, so the app needs a connection, and
  launched offline it shows WebKit's own load error until View › Reload finds
  the site. It keeps the system's title bar, so the page draws the same in
  every host (THE MAC APP'S WINDOW KEEPS THE SYSTEM'S TITLE BAR, in
  `apps/workspace/CLAUDE.md`). A debug build (`pnpm dev`) loads
  `http://localhost:5174/library` (`devUrl`) as an app of its own:
  `tauri.local.conf.json` names it `com.inteligir.desktop.dev`, so its WebKit
  store and cookie are never the release's. Any build loads a Worker on this
  machine instead when `INTELIGIR_CLOUD_ORIGIN` names a loopback origin, which
  is how the smoke opens the packaged app without production, and refuses to
  start on any other value. Rejected: the page bundled into the app over a
  replica of its own (offline copies were most of the code and little of the
  product); an override that names any origin (a variable would point a
  release at any site); a native dialog for an offline launch (WebKit's error
  and Reload already say it). `apps/desktop/src-tauri/src/window.rs`,
  `apps/desktop/src-tauri/tauri.conf.json`.

- **THE WINDOW IS PINNED TO ITS SITE'S ORIGIN.** It shows the site's origin,
  compared by its parts, never by prefix or by an origin type that answers
  opaque for a non-special scheme, and the blank documents a frame starts on;
  a blob the page made loads too, the one a `download` link keeps its name on
  (`apps/workspace/src/app/item/item-stages.tsx`). Any other web page opens in
  the browser; anything else is refused, `window.open` opens no window, and a
  download lands in Downloads (`apps/desktop/src-tauri/src/navigation.rs`).
  Closing the window hides it, and the Dock's icon brings it back. Rejected: a
  prefix compare (`https://inteligir.com.evil.example` starts with the site).

- **A QUIT IS THE SYSTEM'S, AND THE PAGE WRITES ITS EDIT ON PAGEHIDE** (owner
  decision, until note bodies are live, #932). Quit is the predefined menu
  item; the shell keeps no quit hook and asks the page nothing, and the page
  writes the open item's edit as it goes out of sight, as a tab does. Residual:
  an edit typed in the moment before ⌘Q can be lost. Rejected: a quit that
  waits on the page (a hook in Rust and a message to the page for a window that
  is a tab). `apps/desktop/src-tauri/src/menu.rs`.

- **THE .APP IS SIGNED WITH THE HARDENED RUNTIME AND NO ENTITLEMENT.** The shell
  runs no JavaScript of its own (WebKit compiles the page in its own process),
  loads no unsigned code and is not sandboxed, so it asks for no JIT, no
  unsigned executable memory and no network grant. The packaged smoke refuses a
  bundle signed with one of them, or carrying a second executable or anything
  runnable among its resources (`apps/desktop/scripts/smoke-packaged.ts`). An
  ad-hoc pack carries no team, so it skips the runtime and opens only on the
  Mac that built it. `apps/desktop/scripts/package.ts`.

- **AN UPDATE WAITS FOR A CLICK TO DOWNLOAD AND ANOTHER TO RESTART** (owner
  decision, kyh/init's updater). Tauri's updater over the GitHub release: the
  pack writes the signed update and its feed beside the dmg, the owner's
  release step uploads them (`docs/releasing.md`), and the private key reaches
  the bundler as `TAURI_SIGNING_PRIVATE_KEY` in its environment alone, never a
  file a config names; a pack without it makes no feed, and its updater is off,
  as under `tauri dev`. The page checks once as it loads and the app menu's
  Check for Updates… checks again; a found update waits for Download and a
  verified download for Restart, in the page's notice and Settings › About.
  Rust drives it all behind three commands and one `update-state` event, which
  the page parses (`apps/workspace/src/shell/desktop-bridge.ts`); the window's
  one capability grants those alone (`apps/desktop/src-tauri/capabilities/web-app.json`),
  and the app manifest names them (`apps/desktop/src-tauri/build.rs`).
  Rejected: an update that downloads itself and installs on quit (a timer and a
  quit hook for what one click does); the plugin's own API in the page (the
  page deploys apart from the installed shell, so it speaks the shell's
  contract). `apps/desktop/src-tauri/src/updater.rs`.

- **SPELL CHECK IS THE PAGE'S ATTRIBUTE, AND A PRINT IS ALWAYS LIGHT** (#889),
  since WKWebView has no session-wide spell-check switch. Spell check is a page
  pref like the theme, set on the document root before the first paint and
  inherited by every field but the item's title and body; macOS picks the
  languages, so the row names none (`apps/workspace/src/app/spellcheck.ts`). A
  print, the browser tab's (the window offers none), is light whatever the page
  shows: the dark theme steps aside between the print events the browser fires
  around it (`apps/workspace/src/app/light-prints.ts`). Rejected: #889's print
  stylesheet (a screen-only theme needs an at-rule in
  `packages/editor/src/styles.css`, which its guard keeps flat).

- **THE RELEASE NOTES ARE THE CHANGELOG, WRITTEN FOR THE PERSON USING THE APP.**
  A release's GitHub body is `CHANGELOG.md`'s top section, so the release, the
  update it ships and the file say one thing. The release-notes script refuses a
  section not titled for the package's version, and
  `tools/repo-guards/src/changelog.test.ts` holds the file's shape. Rejected: a
  list generated from commit subjects or issue titles (written for whoever
  builds the thing, they describe an update as "something changed").
  `apps/desktop/scripts/release-notes.ts`.

## Repo guards, vendoring and tooling

- **THE SHELL IS PROVED BY ITS UNIT TESTS AND THE PACKAGED SMOKE, NEVER ON
  PRODUCTION.** `cargo test` covers the pin, the local-site override and the
  update states' wire; `pnpm smoke:desktop`, on CI's macOS job, packs the .app,
  checks its bundle and signature, and opens its window on a Worker the smoke
  boots on this machine (`tools/e2e/src/serve-worker.ts`) until the library's
  page has loaded from it. The page itself is the tab's scenarios' to drive.
  Rejected: desktop scenarios over WebDriver on Linux (WebKitGTK is not the
  Mac's engine, and the page they drove is the tab's); a smoke on the release's
  own site (a check of the app would load production).
  `apps/desktop/scripts/smoke-packaged.ts`.

- **THE SHELL'S PLUMBING IS COPIED BETWEEN REPOS AND DIVERGES ON PURPOSE.** The
  window, its origin pin and the updater are copied from or to kyh/init, and
  the pin and the packaging scripts in `apps/desktop/scripts` from or to
  kyh/idlebiz. Each copy is its own repo's code, shaped to the product it
  ships, so there is no shared package and a fix is ported by hand. The Rust
  toolchain (`apps/desktop/rust-toolchain.toml`) is the same in every repo that
  carries it, and moves with them. `apps/desktop/src-tauri/src/navigation.rs`.
