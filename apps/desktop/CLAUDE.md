# Decisions: @repo/desktop

The Tauri shell: its window and bridge, what the .app carries, first run,
updates and diagnostics. `AGENTS.md` § Decisions says how a bullet is written
and cited.

## Dictation

- **DICTATION IS THE OPERATING SYSTEM'S** (owner decision). macOS dictation (fn
  twice, Edit › Start Dictation) and the phone keyboard's mic type into a field
  like a keyboard, so the app holds no microphone entitlement (deliberately
  absent from `apps/desktop/resources/entitlements.mac.plist`), no usage
  description, no web permission, no model and no socket. Rejected: an in-app
  recognizer, whose live partials cost a native addon on a worker, a ~100 MB
  third-party download behind a sha gate, a dictation socket and the app's only
  device grant. Every window denies every permission request, which the shell's
  scenario reads back, since a runner has no microphone to ask for. A Mac's ⌘K
  composer says "fn fn to dictate" beside Send, the app's one hint. A dictated
  phrase lands as one IME-style commit, so the composer's field carries no caret
  repair, and `tools/e2e/src/scenarios/os-dictation-browser.ts` lands dictated
  and typed words in order. `apps/desktop/src-tauri/src/window.rs`.

## Server process and the desktop shell

- **THE APP WINDOW IS THE SERVER'S OWN PAGE, AND HOLDS NO BEARER** (#889). A
  WKWebView scheme handler can neither carry the socket's upgrade nor stream a
  body, so no custom scheme serves it. The shell opens the window on the
  one-time handoff link the server announces, so the page signs in as a browser
  tab does (THE CREDENTIAL IS A FILE, in `apps/cli/CLAUDE.md`) and is
  same-origin with the server, with no CORS and no token in the page. The window
  is pinned to that origin, compared by its parts, never by prefix or by an
  origin type that answers opaque for a non-special scheme: any other web page
  opens in the browser, at most once a second since WebKit says nothing of the
  click behind a navigation, anything else is refused, `window.open` opens no
  window, and every permission is denied. Each vault's window keeps a web store
  of its own, because every vault's server answers on one port and the page's
  prefs are the origin's; that needs macOS 14, below which every vault shares
  one. Rejected: a Rust proxy on a custom scheme and a socket relay over IPC,
  which rebuild in a second language what the browser path already is. Residual:
  the page holds the per-boot cookie (HttpOnly, SameSite=Strict, dead with the
  boot), and Tauri's IPC from the server's origin falls back to `postMessage`
  under its CSP, at the cost of one console line.
  `apps/desktop/src-tauri/src/navigation.rs`, `window.rs`.

- **THE BRIDGE CARRIES ONLY WHAT THE SHELL OWNS** (the updater, the vault
  switch, Reveal/Open, printing, the diagnostics), because no server can answer
  for any of them. Each command is one row of
  `apps/workspace/src/shell/ipc-contract.ts`, parsed by zod in the page and by
  serde in the shell, and granted at runtime to that window on the server's
  exact origin alone; a command no capability names is dropped from the build.
  `tools/repo-guards/src/desktop-shell-wire.test.ts` holds the names equal
  across the two languages, which no compiler sees together, and the desktop
  door's answers too. A refusal crosses as a value, never a rejection, which the
  page reads as a fault: one envelope on both sides
  (`apps/desktop/src-tauri/src/answer.rs`). A command that can fail only by a
  fault answers its value bare, and its error rejects.

- **UPDATES ARE TAURI'S UPDATER OVER THE GITHUB RELEASE, and nothing moves
  without a click**. The pack writes the signed update and its feed beside the
  dmg, and the owner's release step uploads them (`docs/releasing.md`); the
  signing key is the owner's release secret, and a pack without it makes no
  feed. A check runs soon after launch and then periodically, and the download
  and the restart are each a click. Install stops the server child first, so the
  vault's pending commit flushes before the bundle is replaced.
  `apps/desktop/src-tauri/src/updater.rs`, `apps/desktop/scripts/package.ts`.

- **SPELL CHECK IS THE PAGE'S ATTRIBUTE, AND EXPORT AS PDF IS THE SHELL'S
  PRINT** (#889), since WKWebView has no session-wide spell-check switch. The
  choice is a page pref like the theme, set on the document root before the
  first paint and inherited by every field; macOS picks the languages, so the
  row names none. The note's title and body keep theirs off. WKWebView does
  nothing on `window.print()`, so Export as PDF asks the shell to print the
  window under the note's title, the suggested file name. A print is light
  whatever the window shows: the dark theme steps aside between the print
  events, which WebKit fires around the shell's print as a browser does around
  its own. #889's print stylesheet was rejected, since a screen-only theme needs
  an at-rule in `packages/editor/src/styles.css`, which its guard keeps flat.
  `apps/workspace/src/app/spellcheck.ts`,
  `apps/workspace/src/app/note/export-pdf.ts`.

- **THE SHELL ASKS THE LOGIN SHELL FOR PATH BEFORE THE FIRST CHILD.** A Finder
  or Dock launch inherits launchd's bare PATH. The agent's runtime needs none
  (it is bundled), but the agent's bash and the vendor's stdio MCP servers run
  the user's own commands by name. A packaged launch asks the login shell once,
  under a cap, and prepends its PATH for every node child after it. Rejected: a
  fixed list of bin dirs alone, and an `LSEnvironment` PATH in the bundle, since
  neither can know a version manager's directory.
  `apps/cli/src/desktop/login-shell-path.ts`.

- **NODE SHIPS BESIDE THE SHELL, SIGNED, AND THE SHELL HANDS IT NO CODE-LOADING
  ENVIRONMENT** (#889). The Tauri binary runs no JavaScript, so the server, the
  watcher and each ACP adapter run on the official darwin-arm64 node, a sidecar
  fetched against a pinned sha-256, with the CLI and its production
  `node_modules` as a resource; the server forks its children as under `npx`.
  Every Mach-O in the resources is signed with the hardened runtime before
  bundling, the git, which runs no JIT, with no entitlements
  (`apps/desktop/scripts/sign-resources.ts`). The shell finds node and the CLI
  only where its bundle carries them, never through a variable, and starts every
  node child with every `NODE_*` but `NODE_ENV` removed, so an `open --env` runs
  no code inside a process TCC counts as Inteligir
  (`apps/desktop/src-tauri/src/runtime.rs`). An agent's `inteligir` runs on that
  node too, since a Mac may have no node of its own, and so does the browser's
  native-messaging host, whose launcher starts it under `env -i` with HOME
  alone, because the browser's environment is whatever it was launched with and
  a `NODE_OPTIONS` there would run code inside the app's node. Rejected: `bun build
  --compile`, under which better-sqlite3 does not load, and Node's
  single-executable apps, whose blob holds no native addon and no split ESM
  entry. Residual: that node is a signed interpreter any local process can run;
  it carries the JIT entitlements and no other grant.
  `apps/desktop/scripts/fetch-node.ts`.

- **THE APP WRITES EVERY CHROMIUM BROWSER'S NATIVE-MESSAGING MANIFEST AT EACH
  BOOT, AND ARC'S TWICE.** A browser finds the extension's host by a manifest in
  the person's own folder for that browser, naming a launcher and the one
  extension origin allowed to start it, and the app may have moved or updated
  since the last boot. So the server's desktop entry rewrites the launcher
  (`~/.inteligir/native-host/inteligir-native-host`) and a manifest for every
  Chrome, Chromium, Edge, Brave and Vivaldi channel whose folder exists, beside
  the agent's launcher; Arc reads Chrome's folder as well as its own, so its
  manifest goes in both. It never runs for a launch an env pins (a harness, the
  smoke), whose library the door could not find, nor for an app macOS
  translocated, whose node is gone once it quits, and a folder it cannot write
  costs that browser alone. The shell still owns nothing but ordering. Rejected:
  Rust writing them, a second language for a rule desktop-serve already sits
  beside, and a launcher inside the bundle, which a manifest naming a moved
  app's path would lose. `apps/cli/src/desktop/native-hosts.ts`; the packaged
  smoke reads both browsers' manifests and drives the launcher with frames.

- **DIAGNOSTICS ARE `INTELIGIR_DEBUG`'S NAMED TRACES, SHIPPED IN EVERY BUILD,
  AND IN THE PACKAGED APP A SWITCH AND A FILE, BOTH THE SHELL'S.** The watcher,
  the index, the sync pass and the ACP adapter drop, skip and fence without a
  trace, and a user's "it didn't update" cannot wait for a build. An off
  namespace's log is `undefined`, so an untraced site costs one read. A line
  names paths, ids and protocol words, never a note's content or a credential,
  because it is written to be pasted into a report, and the ACP tap drops any
  field that is not a protocol word. An unknown name is refused at boot, since a
  misspelt one reads as "nothing happened". A levelled logger was rejected: the
  value is these few decisions, not more volume
  (`apps/cli/src/server/debug-log.ts`). A Finder-launched app has no env and
  drops the shell's stdout, so debug logging is a Settings switch kept in the
  shell's own folder, because the shell reads it before the start it changes
  (the page's prefs load after that start, and config.json is the app's to read,
  never to write); on, the next child traces every namespace, since a report
  cannot know which decision went wrong. Whatever the child prints is appended
  to a rotated log in the data dir, and a write that fails costs the log, never
  the shell; the server writing its own file was rejected, since a crash before
  its logger is up is the line a report most needs. An adopted server is
  nobody's child here, so the switch is refused and says why.
  `apps/desktop/src-tauri/src/diagnostics.rs`, `server_log.rs`.

- **THE RELEASE NOTES ARE THE CHANGELOG, WRITTEN FOR THE PERSON USING THE APP.**
  A release's GitHub body is `CHANGELOG.md`'s top section, so the release, the
  update it ships and the file say one thing. A list generated from commit
  subjects or issue titles was rejected: both are written for whoever builds the
  thing, and they describe an update as "something changed". The release-notes
  script refuses a section not titled for the package's version, and
  `tools/repo-guards/src/changelog.test.ts` holds the file's shape.
  `apps/desktop/scripts/release-notes.ts`.

- **FIRST RUN IS DECIDED BEFORE ANY SERVER EXISTS**, because a server is bound
  to one vault and one data dir and a knowledge worker chooses between a new
  vault and a folder they already have. It asks only when nothing chose a vault
  and the default vault's folder does not exist, so an upgrade, `inteligir
  serve` and a pinned harness never meet it. Rejected: booting the default vault
  unasked, which created, seeded and committed `~/Inteligir` before the user
  said anything and left it behind when they opened a folder instead. The
  first-run window is its own, a page the bundle carries, pinned and locked down
  like a vault's, with no server behind it and a capability granting its own
  commands alone. It keeps the default web store rather than a non-persistent
  one, which the scenario suite's WebDriver cannot drive; every vault's window
  has a store of its own, so nothing the first run keeps reaches one. Every
  folder the page names back is one the shell handed out, and a choice is
  resolved exactly as a boot would before anything is written. An existing
  folder is plain markdown where it is, shown with what the server's inspection
  says of it. The agent and the account follow as skippable steps in the app
  window, composing the shared sign-in and account form rather than spelling
  either flow again. `apps/cli/src/desktop/first-run.ts`,
  `apps/desktop/src-tauri/capabilities/first-run.json`.

- **THE .APP SHIPS ITS OWN GIT, AND RUNS IT WHERE THE MAC HAS NONE.** Every
  vault write, sync and history read is git, and so is an agent's own `git
  status`, but a Mac without Xcode or its command-line tools, which is most
  people's, has only `/usr/bin/git`'s stub: it fails and offers the install, so
  the vault could not even initialize. The pack carries a pinned, signed and
  notarized git. A Mac with the developer tools keeps its own git (owner
  decision: a user with the tools and an https remote of their own keeps the
  Keychain helper, which the bundled build lacks), unless the git its login PATH
  finds is older than 2.45 or will not say its version: an older git sets its
  own `Transfer-Encoding` header, which libcurl 8.7.0 and 8.7.1 mishandle, so a
  push past 1 MiB goes out as its first 4 bytes (Homebrew's 2.39.0 does). Any
  other Mac gets the bundled one on the env of every node child the shell
  starts. Never `GIT_CONFIG_COUNT`: the hosted remote's bearer rides those rows
  per invocation. A dev or e2e launch keeps the host's git. The fetch drops Git
  Credential Manager and Git LFS, which no config names and which were
  five-sixths of the payload, and every dashed built-in's link a transport does
  not run, since Tauri copies a link as the file it names: 140-odd whole gits,
  near 500 MB. Rejected: the dugite npm package, a JS API nothing calls and a
  postinstall download on every install. `apps/desktop/scripts/fetch-git.ts`,
  `apps/cli/src/desktop/bundled-git.ts`; the smoke's first launch plays such a
  Mac and proves the host's git never ran.

## Repo guards, vendoring and tooling

- **THE SHELL'S GLUE RUNS IN E2E OVER WEBDRIVER, AND ITS WIRE IS A GUARD.** The
  shell's policies are pure and unit-tested (`cargo test`, and the CLI's desktop
  door under vitest); what joins them (the window's sign-in, the pin, every
  command, the vault switch, the quit) is the e2e suite's desktop scenarios: the
  built shell on Linux, driven through `tauri-driver` and WebKitGTK's WebDriver,
  which also gives the page its one WebKit run, never through the env pins,
  since the shell refuses a switch while either pins the launch. Only the first
  window is driveable, so a later one is read through its server and the shell's
  note in its log. Not the packaged `.app`: packing is minutes, and the bundle,
  the signatures and the sidecar stay `pnpm smoke:desktop`'s, on the macOS job.
  The static half is `tools/repo-guards/src/desktop-shell-wire.test.ts` (THE APP
  WINDOW IS THE SERVER'S OWN PAGE), which also holds the bundle id the browser's
  door opens the app by (`APP_BUNDLE_ID`, `apps/cli/src/desktop/app-identity.ts`)
  to `tauri.conf.json`'s `identifier`. `tools/e2e/src/scenarios/desktop-shell.ts`.

- **THE SHELL'S PLUMBING IS COPIED BETWEEN REPOS AND DIVERGES ON PURPOSE.** The
  shell's log, its origin pin, its runtime and the packaging scripts in
  `apps/desktop/scripts` are copied from or to kyh/idlebiz, and the origin pin
  from or to kyh/init too. Each copy is its own repo's code, shaped to the child
  it runs and the product it ships, so there is no shared package and a fix is
  ported by hand. The Rust toolchain (`apps/desktop/rust-toolchain.toml`) and
  the bundled node (`apps/desktop/scripts/fetch-node.ts`) are the same in every
  repo that carries them, and move together.
  `apps/desktop/src-tauri/src/server_log.rs`, `navigation.rs`, `runtime.rs`.
