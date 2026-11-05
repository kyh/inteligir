# Decisions: @repo/desktop

The Tauri shell: its window and bridge, the Mac's replica, its credential and
its files, what the .app carries, and updates. `AGENTS.md` § Decisions says how
a bullet is written and cited.

## Dictation

- **DICTATION IS THE OPERATING SYSTEM'S** (owner decision). macOS dictation (fn
  twice, Edit › Start Dictation) and the phone keyboard's mic type as a keyboard
  does, so the app is signed with no entitlement at all, a microphone's among
  them (`apps/desktop/scripts/package.ts`), and holds no usage description, web
  permission, model or socket, and every window denies every permission request
  (`apps/desktop/src-tauri/src/window.rs`), which the shell's scenario reads
  back. A dictated phrase lands as one IME-style commit, so a field carries no
  caret repair. Rejected: an in-app recognizer (live partials on a native addon
  in a worker, a ~100 MB third-party download behind a sha gate, a dictation
  socket, the app's only device grant).

## The desktop shell

- **THE WINDOW IS THE PAGE THE BUNDLE CARRIES, OVER THE MAC'S OWN REPLICA.** The
  .app embeds `@repo/workspace`'s build and runs nothing beside the shell: no
  node, no server child, no local origin. The window loads the page from
  `tauri://localhost/library/`, and the page opens the replica engine
  (`@repo/library-replica`) over the shell's SQLite, so the Mac reads every item
  and queues every write offline, and its calls go to the cloud's `/v1` across
  origins (THE MAC'S PAGE CALLS `/v1` ACROSS ORIGINS, in `apps/web/CLAUDE.md`).
  The page's routes ride the hash there, since its document never changes. A
  release reaches the production cloud alone; a debug build reaches this
  machine's Worker, on the port `INTELIGIR_CLOUD_ORIGIN` names
  (`apps/desktop/src-tauri/src/cloud.rs`). Rejected: the server child and its
  page (a second writer beside the cell, and node and git in the bundle); the
  Worker's tab in the window (online only, and a capability over a remote
  origin). `apps/workspace/src/app/cloud/shell-library.ts`.

- **THE MAC'S REPLICA IS ONE SQLITE FILE IN RUST, AND A COMMAND IS ONE
  TRANSACTION.** Bundled rusqlite with FTS5 compiled in, so the Mac searches as
  the cell and the tab do; one file an account in the app's data dir, one
  connection behind one mutex, every command on a blocking thread. A statement
  the page sends alone is its own `IMMEDIATE` transaction. The engine's
  `exclusive`, whose results decide its next statement, is `begin`: a
  transaction on a thread of its own that holds the connection and answers what
  is sent under its token until `commit`, and rolls back when the token is
  dropped (a rollback, a newer `begin`, a page load starting) or no statement
  comes for ten seconds, so a page reloaded mid-transaction never wedges the
  file. Rejected: the page's own SQLite in WebKit's storage (out of the shell's
  reach on a sign-out, and the tab's in-memory one keeps nothing); a SQL
  plugin's pool under the page's calls (a transaction's statements may land on
  two connections); a transaction the page alone holds open across commands (a
  reload leaves it holding the lock). `apps/desktop/src-tauri/src/replica.rs`.

- **THE DEVICE CREDENTIAL IS IN THE KEYCHAIN, AND THE PAGE HOLDS IT IN MEMORY.**
  The Mac's sign-in mints a device credential, which the shell keeps in the
  Keychain under the bundle id (keyring-core over `apple-native-keyring-store`)
  and nowhere else on disk, and hands the page when it opens; the page sends it
  as the bearer of every `/v1` call, the socket opening on the short-lived
  ticket it mints. Leaving the account forgets the credential, the account's
  replica file and its files, and a credential the cloud no longer takes leaves
  it too. On Linux, where the shell runs only under the scenario suite,
  keyring-core's sample store in a file stands in. Rejected: the shell as the
  page's proxy so the page never holds it (a scheme handler carries neither the
  socket's upgrade nor a streamed body: the browser's path rebuilt in Rust); the
  credential in WebKit's storage (a file, where the Keychain is the store macOS
  guards). Residual: a script the page runs can read it, and the window's policy
  runs only the bundle's own. `apps/desktop/src-tauri/src/credential.rs`,
  `account.rs`.

- **THE WINDOW IS PINNED TO ITS OWN ORIGIN.** It shows the page's origin and
  frames the shell's files (a PDF's viewer), compared by their parts, never by
  prefix or by an origin type that answers opaque for a non-special scheme. Any
  other web page opens in the browser, at most once a second, since WebKit says
  nothing of the click behind a navigation; anything else is refused,
  `window.open` opens no window, and a download (an export) lands in Downloads
  (`apps/desktop/src-tauri/src/navigation.rs`). Closing the window hides it; the
  app lives on in the menu bar.

- **THE BRIDGE CARRIES ONLY WHAT A BROWSER CANNOT DO** (the replica, the
  credential, the staged files, the updater). Each command is one row of
  `apps/workspace/src/shell/ipc-contract.ts`, parsed by zod in the page and by
  serde in the shell: `async`, its arguments owned, answering a `Result` whose
  `ShellError` crosses as the rejection with a kind the page reads, and bytes
  raw both ways (a request's body, an `ipc::Response`). The capability is
  static (`apps/desktop/src-tauri/capabilities/app-window.json`): the one
  window, the local origin alone, no remote URL and no grant at runtime, and
  every command is in the app manifest (`apps/desktop/src-tauri/build.rs`), so
  one no capability names is dropped. Rejected: a refusal as a value in an
  envelope (every command here fails by a fault or a kind the page reads); a
  capability granted at runtime (it was for a server's port).
  `tools/repo-guards/src/desktop-shell-wire.test.ts` holds the names, the
  kinds, the event and the origins equal across the two languages.
  `apps/desktop/src-tauri/src/commands.rs`, `error.rs`.

- **THE LIBRARY'S FILES RIDE THE SHELL'S OWN SCHEME, KEPT BY THEIR SHA.** The
  page draws a file from `inteligir-files://localhost/<sha>`, a name of the
  app's own, never `blob`, which WebKit keeps. A file this Mac holds is served
  from disk, a range of it when asked; a miss is fetched from `/v1/blobs/<sha>`
  with the credential, checked against its sha, kept and served. Fetched files
  sit in the caches dir under 5 GB, the least recently read evicted first; a
  staged file, which the outbox has yet to upload, sits in the data dir, never
  evicted, until its upload moves it into the cache. Every file but a PDF is
  served under a script-less sandbox, as the cloud serves it; a PDF keeps
  WebKit's viewer under a policy that runs no script and that only the app's
  page may frame. Rejected: the cloud's route straight from the page (an
  `<img>` carries no bearer, and offline it draws nothing); the asset protocol
  over a scope of the disk (no fetch on a miss). Residual: WebKitGTK's player
  loads nothing from a custom scheme, so a recording's playback is the owner's
  check on a Mac (`docs/releasing.md`).
  `apps/desktop/src-tauri/src/file_scheme.rs`, `file_cache.rs`.

- **THE WINDOW'S POLICY IS STATIC, AND EVERY MESSAGE TO THE SHELL PASSES AN
  ISOLATION FRAME.** `tauri.conf.json`'s CSP runs the bundle's scripts alone,
  lets the page call its own origin, Tauri's IPC and the cloud's exact origin
  and socket, and draw the shell's files; a debug build's
  `tauri.local.conf.json` changes connect-src alone, to this machine. It names
  no frame-src or child-src: Tauri adds the isolation frame's origin, a scheme
  unique to each launch, to default-src alone, and a frame policy refuses it.
  The Isolation pattern runs every IPC message through `apps/desktop/isolation`,
  a classic script, since the frame cannot run a module. Rejected: a policy
  naming `isolation:` (it matches no launch's scheme, and every call hung).
  `tools/repo-guards/src/desktop-shell-wire.test.ts` holds the policy.

- **THE .APP IS SIGNED WITH THE HARDENED RUNTIME AND NO ENTITLEMENT.** The shell
  runs no JavaScript of its own (WebKit compiles the page in its own process),
  loads no unsigned code and is not sandboxed, so it asks for no JIT, no
  unsigned executable memory and no network grant. The packaged smoke refuses a
  bundle signed with one of them, or carrying a second executable or anything
  runnable among its resources (`apps/desktop/scripts/smoke-packaged.ts`). An
  ad-hoc pack carries no team, so it skips the runtime and opens only on the
  Mac that built it. `apps/desktop/scripts/package.ts`.

- **UPDATES DOWNLOAD BY THEMSELVES AND INSTALL ON QUIT, AND RESTART TO UPDATE
  INSTALLS AT ONCE.** Tauri's updater over the GitHub release: the pack writes
  the signed update and its feed beside the dmg, the owner's release step
  uploads them (`docs/releasing.md`), and the private key reaches the bundler as
  `TAURI_SIGNING_PRIVATE_KEY` in its environment alone, never a file a config
  names; a pack without it makes no feed and reports updates off. A check runs
  15 seconds after launch and every 4 minutes; one that finds an update
  downloads it in the background, the plugin verifying its signature, and a
  verified download installs when the app quits, so nothing restarts under the
  person. Restart to Update, in the app menu and in Settings, installs and
  relaunches. A failed download says so, and the next check tries again. Every
  write is already in the outbox on disk, so a quit to install loses none. Rust
  drives it all: the page holds no updater permission, mirrors the
  `update-state` event and asks through the shell's commands. Rejected: a click
  to download and another to restart (an update waits on a person who never
  opens About); installing under a running app (its window would change under
  the person). `apps/desktop/src-tauri/src/update_state.rs`, `updater.rs`.

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

- **THE SHELL'S GLUE RUNS IN E2E OVER WEBDRIVER, AND ITS WIRE IS A GUARD.** The
  shell's policies are pure and unit-tested (`cargo test`: the replica's
  transactions and their rollbacks, the scheme's hits, misses, ranges and
  eviction, the Keychain record over keyring-core's mock store, the updater's
  states); what joins them (the sign-in, the library read from the shell's
  replica, the socket, the pin, the files, an offline relaunch and its queued
  edit, sign-out, quit) runs in the desktop scenarios: the built debug shell on
  Linux through `tauri-driver` and WebKitGTK's WebDriver, the page's one WebKit
  run, against the local Worker through a relay the scenario cuts to go offline
  (`tools/e2e/src/harness/cloud-link.ts`), the replica's file read back off disk
  as the oracle. The packaged `.app` (bundle, signature, entitlements; minutes
  to pack) stays `pnpm smoke:desktop`'s, on the macOS job. The static half,
  `tools/repo-guards/src/desktop-shell-wire.test.ts`, also holds the bundle id
  the browser's door opens (`apps/cli/src/desktop/app-identity.ts`) to
  `tauri.conf.json`'s `identifier`. `tools/e2e/src/scenarios/desktop-shell.ts`.

- **THE SHELL'S PLUMBING IS COPIED BETWEEN REPOS AND DIVERGES ON PURPOSE.** The
  origin pin and the packaging scripts in `apps/desktop/scripts` are copied from
  or to kyh/idlebiz, and the origin pin from or to kyh/init too. Each copy is
  its own repo's code, shaped to the product it ships, so there is no shared
  package and a fix is ported by hand. The Rust toolchain
  (`apps/desktop/rust-toolchain.toml`) is the same in every repo that carries
  it, and moves with them. `apps/desktop/src-tauri/src/navigation.rs`.
