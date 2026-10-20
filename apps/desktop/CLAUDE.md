# Decisions: @repo/desktop

The Tauri shell: its window and bridge, what the .app carries, first run,
updates and diagnostics. `AGENTS.md` § Decisions says how a bullet is written
and cited.

## Dictation

- **DICTATION IS THE OPERATING SYSTEM'S** (owner decision). macOS dictation (fn
  twice, Edit › Start Dictation) and the phone keyboard's mic type as a keyboard
  does, so the app holds no microphone entitlement (absent on purpose from
  `apps/desktop/resources/entitlements.mac.plist`), usage description, web
  permission, model or socket, and every window denies every permission request
  (`apps/desktop/src-tauri/src/window.rs`), which the shell's scenario reads
  back. The ⌘K composer's "fn fn to dictate" beside Send is the app's one hint.
  A dictated phrase lands as one IME-style commit, so the field carries no caret
  repair (`tools/e2e/src/scenarios/os-dictation-browser.ts`). Rejected: an
  in-app recognizer (live partials on a native addon in a worker, a ~100 MB
  third-party download behind a sha gate, a dictation socket, the app's only
  device grant).

## Server process and the desktop shell

- **THE APP WINDOW IS THE SERVER'S OWN PAGE, AND HOLDS NO BEARER** (#889). A
  WKWebView scheme handler can neither carry the socket's upgrade nor stream a
  body, so no custom scheme serves the page: the window opens on the server's
  one-time handoff link and signs in as a browser tab does (THE CREDENTIAL IS A
  FILE, in `apps/cli/CLAUDE.md`): same-origin, no CORS, no token in the page.
  Rejected: a Rust proxy on a custom scheme and a socket relay over IPC (the
  browser path rebuilt in a second language). Residual: the page holds the
  per-boot cookie (HttpOnly, SameSite=Strict, dead with the boot); Tauri's IPC
  from that origin falls back to `postMessage` under its CSP (one console line).
  `apps/desktop/src-tauri/src/window.rs`.

- **THE WINDOW IS PINNED TO ITS SERVER'S ORIGIN, AND EACH VAULT'S WINDOW KEEPS
  A WEB STORE OF ITS OWN.** The origin is compared by its parts, never by prefix
  or by an origin type that answers opaque for a non-special scheme. Any other
  web page opens in the browser, at most once a second, since WebKit says
  nothing of the click behind a navigation; anything else is refused, and
  `window.open` opens no window (`apps/desktop/src-tauri/src/navigation.rs`).
  Every vault's server answers on one port and the page's prefs are the
  origin's, so each vault's window has its own store; that needs macOS 14,
  below which every vault shares one.

- **THE BRIDGE CARRIES ONLY WHAT THE SHELL OWNS** (the updater, the vault
  switch, Reveal/Open, printing, the diagnostics), because no server can answer
  for any of them. Each command is one row of
  `apps/workspace/src/shell/ipc-contract.ts`, parsed by zod in the page and by
  serde in the shell, and granted at runtime to that window on the server's
  exact origin alone; a command no capability names is dropped from the build.
  `tools/repo-guards/src/desktop-shell-wire.test.ts` holds the names, and the
  desktop door's answers, equal across the two languages. A refusal crosses as
  a value in one envelope, never a rejection, which the page reads as a fault
  (`apps/desktop/src-tauri/src/answer.rs`); a command that can fail only by a
  fault answers its value bare, and its error rejects.

- **UPDATES ARE TAURI'S UPDATER OVER THE GITHUB RELEASE, and nothing moves
  without a click**. The pack writes the signed update and its feed beside the
  dmg, and the owner's release step uploads them (`docs/releasing.md`); the
  signing key is the owner's release secret, and a pack without it makes no
  feed. A check runs soon after launch and then periodically; the download and
  the restart are each a click. Install stops the server child first, so the
  vault's pending commit flushes before the bundle is replaced.
  `apps/desktop/src-tauri/src/updater.rs`, `apps/desktop/scripts/package.ts`.

- **SPELL CHECK IS THE PAGE'S ATTRIBUTE, AND EXPORT AS PDF IS THE SHELL'S
  PRINT** (#889), since WKWebView has no session-wide spell-check switch and
  does nothing on `window.print()`. Spell check is a page pref like the theme,
  set on the document root before the first paint and inherited by every field
  but the note's title and body; macOS picks the languages, so the row names
  none (`apps/workspace/src/app/spellcheck.ts`). Export as PDF has the shell
  print the window, the note's title its file name, always light: the dark
  theme steps aside between the print events WebKit fires around it
  (`apps/workspace/src/app/note/export-pdf.ts`). Rejected: #889's print
  stylesheet (a screen-only theme needs an at-rule in
  `packages/editor/src/styles.css`, which its guard keeps flat).

- **THE SHELL ASKS THE LOGIN SHELL FOR PATH BEFORE THE FIRST CHILD.** A Finder
  or Dock launch inherits launchd's bare PATH; the agent's runtime is bundled,
  but the agent's bash and the vendor's stdio MCP servers run the user's own
  commands by name. A packaged launch asks the login shell once, under a cap,
  and prepends its PATH for every node child after it. Rejected: a fixed list
  of bin dirs alone, and an `LSEnvironment` PATH in the bundle (neither can know
  a version manager's directory). `apps/cli/src/desktop/login-shell-path.ts`.

- **NODE SHIPS BESIDE THE SHELL, SIGNED, AND THE SHELL HANDS IT NO CODE-LOADING
  ENVIRONMENT** (#889). The Tauri binary runs no JavaScript, so the server and
  every child it forks run on the official darwin-arm64 node, a sidecar fetched
  by a pinned sha-256 beside the CLI and its production `node_modules`
  (`apps/desktop/scripts/fetch-node.ts`). The shell finds both only in its
  bundle, never by a variable, and strips every `NODE_*` but `NODE_ENV` from
  each node child, so an `open --env` runs no code in a process TCC counts as
  Inteligir (`apps/desktop/src-tauri/src/runtime.rs`). Rejected: `bun build
  --compile` (better-sqlite3 does not load); Node's single-executable apps (no
  native addon, no split ESM entry).

- **EVERY MACH-O THE .APP CARRIES IS SIGNED WITH THE HARDENED RUNTIME** before
  bundling, the git, which runs no JIT, with no entitlements
  (`apps/desktop/scripts/sign-resources.ts`). Residual: the bundled node is a
  signed interpreter any local process can run; it carries the JIT entitlements
  and no other grant.

- **AN AGENT'S `inteligir` AND THE BROWSER'S NATIVE HOST RUN ON THE BUNDLED
  NODE**, since a Mac may have no node of its own. The host's launcher starts it
  under `env -i` with HOME and `NODE_ENV=production` alone, because the
  browser's environment is whatever it was launched with, and a `NODE_OPTIONS`
  or `NODE_ENV` there would run code, or another mode, inside the app's node (`apps/cli/src/desktop/native-hosts.ts`).

- **THE APP WRITES EVERY CHROMIUM BROWSER'S NATIVE-MESSAGING MANIFEST AT EACH
  BOOT, AND ARC'S TWICE.** A browser finds the extension's host by a manifest
  in its folder naming a launcher and the one extension origin it lets start
  it; since the app may have moved or updated, the server's desktop entry
  rewrites the launcher
  (`~/.inteligir/native-host/inteligir-native-host`, beside the agent's) and a
  manifest for every Chrome, Chromium, Edge, Brave and Vivaldi channel whose
  folder exists, Arc's in Chrome's folder too, since Arc reads both
  (`apps/cli/src/desktop/native-hosts.ts`). A folder it cannot write costs that
  browser alone. Rejected: Rust writing them (a second language beside
  desktop-serve's rule; the shell owns only ordering); a launcher inside the
  bundle (lost once the app moves).

- **NO MANIFEST IS WRITTEN FOR A LAUNCH WHOSE DATA DIR AN ENV PINS, OR FOR A
  TRANSLOCATED APP.** A pinned data dir (a harness, the smoke's first launch)
  is a server the browser's door, which finds one through the root, could not
  find; the shell pins every child's vault and never its data dir, so a vault
  pin is no reason to skip. A translocated app's node is gone once it quits.
  The packaged smoke reads both browsers' manifests from the default vault's
  launch, drives the launcher with frames, and finds no launcher after its
  pinned first launch.

- **DIAGNOSTICS ARE `INTELIGIR_DEBUG`'S NAMED TRACES, SHIPPED IN EVERY BUILD,
  AND IN THE PACKAGED APP A SWITCH AND A FILE, BOTH THE SHELL'S.** The watcher,
  the index, the sign-in check and the ACP adapter drop, skip and fence
  silently, and a user's "it didn't update" cannot wait for a build. An off
  namespace's log is `undefined`, so an untraced site costs one read. A line
  names paths, ids and protocol words, never a note's content or a credential,
  being written to be pasted into a report; the ACP tap drops any non-protocol
  field. An unknown name is refused at boot (a misspelt one reads as "nothing
  happened"). Rejected: a levelled logger (the value is these few decisions,
  not volume). `apps/cli/src/server/debug-log.ts`.

- **THE PACKAGED APP'S DEBUG SWITCH AND LOG ARE THE SHELL'S.** A Finder-launched
  app has no env and drops the shell's stdout, so the switch is a Settings row
  in the shell's own folder, read before the start it changes (the page's prefs
  load later; config.json the shell reads but never writes); on, the next child
  traces every namespace, as a report cannot know which decision went wrong. The
  child's output goes to a rotated log in the data dir; a failed write costs the
  log, never the shell. An adopted server is nobody's child here, so the switch
  refuses, saying why. Rejected: the server writing its own file (a crash before
  its logger is up is the line a report most needs).
  `apps/desktop/src-tauri/src/diagnostics.rs`, `server_log.rs`.

- **THE RELEASE NOTES ARE THE CHANGELOG, WRITTEN FOR THE PERSON USING THE APP.**
  A release's GitHub body is `CHANGELOG.md`'s top section, so the release, the
  update it ships and the file say one thing. The release-notes script refuses a
  section not titled for the package's version, and
  `tools/repo-guards/src/changelog.test.ts` holds the file's shape. Rejected: a
  list generated from commit subjects or issue titles (written for whoever
  builds the thing, they describe an update as "something changed").
  `apps/desktop/scripts/release-notes.ts`.

- **FIRST RUN IS DECIDED BEFORE ANY SERVER EXISTS**, since a server is bound to
  one vault and data dir, and a knowledge worker picks a new vault or a folder
  they have. It asks only when nothing chose a vault and the default vault's
  folder does not exist, so an upgrade, `inteligir serve` and a pinned harness
  never meet it. Every folder the page names back is one the shell handed out,
  resolved exactly as a boot would before anything is written; an existing
  folder stays plain markdown where it is, shown with the server's inspection of
  it. Rejected: booting the default vault unasked (it created, seeded and
  committed `~/Inteligir` before the user spoke, and left it when they opened a
  folder). `apps/cli/src/desktop/first-run.ts`.

- **THE FIRST-RUN WINDOW IS ITS OWN, AND THE AGENT AND THE ACCOUNT FOLLOW IN THE
  APP'S.** It is a page the bundle carries, pinned and locked down like a
  vault's, with no server behind it and a capability granting its own commands
  alone (`apps/desktop/src-tauri/capabilities/first-run.json`). It keeps the
  default web store, since the scenario suite's WebDriver cannot drive a
  non-persistent one, and every vault's window has a store of its own, so
  nothing the first run keeps reaches one. The agent and the account follow as
  skippable steps in the app window, composing the shared sign-in and account
  form rather than spelling either flow again.

- **THE .APP SHIPS ITS OWN GIT, AND RUNS IT WHERE THE MAC HAS NONE.** Every
  vault write, sync and history read is git, as is an agent's own `git status`,
  but a Mac without Xcode or its command-line tools, which is most people's, has
  only `/usr/bin/git`'s stub, which fails and offers the install. So the pack
  carries a pinned, signed and notarized git, set on the env of every node child
  the shell starts, though a dev or e2e launch keeps the host's. Never
  `GIT_CONFIG_COUNT`: the hosted remote's bearer rides those rows per
  invocation. `apps/cli/src/desktop/bundled-git.ts`; the smoke's first launch
  plays such a Mac and proves the host's git never ran.

- **A MAC WITH THE DEVELOPER TOOLS KEEPS ITS OWN GIT, UNLESS IT IS OLDER THAN
  2.45** (owner decision: a user with the tools and an https remote of their own
  keeps the Keychain helper, which the bundled build lacks). The bundled git
  is used when the git the login PATH finds is older than 2.45 or will not say
  its version: an older git sets its own `Transfer-Encoding` header, which
  libcurl 8.7.0 and 8.7.1 mishandle, so a push past 1 MiB goes out as its first
  4 bytes (Homebrew's 2.39.0 does). `apps/cli/src/desktop/bundled-git.ts`.

- **THE BUNDLED GIT CARRIES ONLY WHAT A TRANSPORT RUNS.** The fetch drops Git
  Credential Manager and Git LFS, which no config names and which are
  five-sixths of the payload, and every dashed built-in's link a transport does
  not run, since Tauri copies a link as the file it names (140-odd whole gits,
  near 500 MB). Rejected: the dugite npm package (a JS API nothing calls, and a
  postinstall download on every install). `apps/desktop/scripts/fetch-git.ts`.

## Repo guards, vendoring and tooling

- **THE SHELL'S GLUE RUNS IN E2E OVER WEBDRIVER, AND ITS WIRE IS A GUARD.** The
  shell's policies are pure and unit-tested (`cargo test`; the desktop door's
  vitest); what joins them (sign-in, the pin, every command, the vault switch,
  quit) runs in the desktop scenarios: the built shell on Linux through
  `tauri-driver` and WebKitGTK's WebDriver, the page's one WebKit run, never
  under the env pins, which make the shell refuse a switch. Only the first
  window is driveable, so a later one is read through its server and the shell's
  log. The packaged `.app` (bundle, signatures, sidecar; minutes to pack) stays
  `pnpm smoke:desktop`'s, on the macOS job. The static half,
  `tools/repo-guards/src/desktop-shell-wire.test.ts`, also holds the bundle id
  the browser's door opens (`apps/cli/src/desktop/app-identity.ts`) to
  `tauri.conf.json`'s `identifier`. `tools/e2e/src/scenarios/desktop-shell.ts`.

- **THE SHELL'S PLUMBING IS COPIED BETWEEN REPOS AND DIVERGES ON PURPOSE.** The
  shell's log, origin pin and runtime and the packaging scripts in
  `apps/desktop/scripts` are copied from or to kyh/idlebiz, and the origin pin
  from or to kyh/init too. Each copy is its own repo's code, shaped to the child
  it runs and the product it ships, so there is no shared package and a fix is
  ported by hand. The Rust toolchain (`apps/desktop/rust-toolchain.toml`) and
  the bundled node (`apps/desktop/scripts/fetch-node.ts`) are the same in every
  repo that carries them, and move together.
  `apps/desktop/src-tauri/src/server_log.rs`, `navigation.rs`, `runtime.rs`.
