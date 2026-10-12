# Decisions: @repo/desktop

The Tauri shell: its window and bridge, what the .app carries, first run,
updates and diagnostics. `AGENTS.md` § Decisions says how a bullet is written
and cited.

## Dictation

- **DICTATION IS THE OPERATING SYSTEM'S** (owner decision). macOS dictation (fn
  twice, Edit › Start Dictation) and the phone keyboard's mic type into a field
  like a keyboard, so the app holds no microphone entitlement
  (`device.audio-input`, deliberately absent from
  `apps/desktop/resources/entitlements.mac.plist`), no
  `NSMicrophoneUsageDescription`, no web permission, no model and no socket.
  Rejected: an in-app recognizer, whose live partials cost a native addon on a
  worker, a ~100 MB third-party download behind a sha gate, a dictation socket
  and the app's only device grant. Every window denies every permission request
  (`on_permission_request` in `apps/desktop/src-tauri/src/window.rs`), which
  `tools/e2e/src/scenarios/desktop-shell.ts` reads back as a denied location and
  notification request, since a runner has no microphone to ask for. A Mac's ⌘K
  composer says "fn fn to dictate" beside Send, the app's one hint
  (`apps/workspace/src/app/actions/action-composer.tsx`). A dictated phrase
  lands as one IME-style commit; the composer's field carries no caret repair
  (the editor's combobox keeps `reconcileInsertionCaret`,
  `packages/editor/src/combobox-input.ts`) while
  `tools/e2e/src/scenarios/os-dictation-browser.ts` lands dictated and typed
  words in order.

## Server process and the desktop shell

- **THE APP WINDOW IS THE SERVER'S OWN PAGE, AND HOLDS NO BEARER** (#889). A
  WKWebView scheme handler can neither carry the socket's upgrade nor stream a
  body, so no custom scheme serves it. The shell opens the window on the
  one-time handoff link the server announces, so the page signs in as a browser
  tab does (THE CREDENTIAL IS A FILE, in `apps/cli/CLAUDE.md`) and is
  same-origin with `/rpc`, `/ws` and `/vault/asset`, with no CORS and no token
  in the page. The window is pinned to that origin, compared by its parts, never
  by prefix or `Url::origin`, which answers an opaque origin for a non-special
  scheme: any other web page opens in the browser, at most once a second since
  WebKit says nothing of the click behind a navigation, anything else is
  refused, `window.open` opens no window, and every permission is denied
  (`apps/desktop/src-tauri/src/navigation.rs`, `window.rs`). Each vault's window
  keeps a web store of its own, keyed by its data dir, because every vault's
  server answers on one port and the page's prefs are the origin's; that needs
  macOS 14, below which every vault shares one. Rejected: a Rust proxy on a
  custom scheme and a socket relay over IPC, which rebuild in a second language
  what the browser path already is. THE BRIDGE CARRIES ONLY WHAT THE SHELL OWNS
  (the updater, the vault switch, Reveal/Open, printing, the diagnostics),
  because no server can answer for any of them. Each command is one row of
  `apps/workspace/src/shell/ipc-contract.ts`, parsed by zod in the page
  (`apps/workspace/src/shell/shell-commands.ts`) and by serde in the shell
  (`apps/desktop/src-tauri/src/commands.rs`), and granted at runtime to that
  window on the server's exact origin alone (`grant_app_window`); the first
  run's own capability grants its four, and `removeUnusedCommands` drops every
  command no capability names.
  `tools/repo-guards/src/desktop-shell-wire.test.ts` holds the names equal
  across the two languages, which no compiler sees together, and the desktop
  door's answers too: each serde type in `apps/desktop/src-tauri/src/launch.rs`
  reads the fields of a zod schema typed against the door's `DoorAnswers`
  (`apps/cli/src/desktop/__tests__/door-answers.ts`), which also parses the
  fixtures the cargo tests read. A refusal crosses as a value, never a
  rejection, which the page reads as a fault: one envelope on both sides, `{ ok:
true, state? }` or `{ ok: false, reason }`
  (`apps/desktop/src-tauri/src/answer.rs`,
  `apps/workspace/src/shell/shell-answer.ts`). A command that can fail only by a
  fault (a read, a forget, a first run's pick) answers its value bare as a
  `Result`, whose `Err` rejects. Residual: the page holds the per-boot cookie
  (HttpOnly, SameSite=Strict, dead with the boot), and Tauri's IPC from the
  server's origin falls back to `postMessage` under its CSP, at the cost of one
  console line.

- **UPDATES ARE TAURI'S UPDATER OVER THE GITHUB RELEASE, and nothing moves
  without a click**. The release carries the dmg, `Inteligir.app.tar.gz` with
  its minisign signature and `latest.json`, written by the pack
  (`apps/desktop/scripts/package.ts`) and uploaded by the owner's release step
  (`docs/releasing.md`); the signing key is the owner's release secret, and a
  pack without it makes no feed. A check 15s after launch and every 4 minutes,
  the download and the restart each a click. Install stops the server child
  first, so the vault's pending commit flushes before the bundle is replaced.
  `apps/desktop/src-tauri/src/updater.rs` (the policy) over `update_state.rs` (a
  union by status, which `apps/workspace/src/shell/update-state.ts` parses from
  the `update-state` event).

- **SPELL CHECK IS THE PAGE'S ATTRIBUTE, AND EXPORT AS PDF IS THE SHELL'S
  PRINT** (#889), since WKWebView has no session-wide spell-check switch. The
  choice is a page pref like the theme, set as `spellcheck` on the document root
  before the first paint and inherited by every field; macOS picks the
  languages, so the row names none (`apps/workspace/src/app/spellcheck.ts`). The
  note's title and body keep theirs off. WKWebView does nothing on
  `window.print()`, so Export as PDF asks the shell to print the window
  (`print_page`) under the note's title, the suggested file name, which comes
  back on `afterprint`. A print is light whatever the window shows: `.dark`
  steps aside between `beforeprint` and `afterprint`, which WebKit fires around
  the shell's print as a browser does around its own. #889's print stylesheet
  was rejected, since a screen-only theme needs an at-rule in
  `packages/editor/src/styles.css`, which its guard keeps flat
  (`apps/workspace/src/app/note/export-pdf.ts`).

- **THE SHELL ASKS THE LOGIN SHELL FOR PATH BEFORE THE FIRST CHILD.** A Finder
  or Dock launch inherits launchd's bare PATH. The agent's runtime needs none
  (it is bundled), but the agent's bash and the vendor's stdio MCP servers run
  the user's own commands by name. A packaged launch runs `$SHELL -ilc` once,
  capped at 5s, through the desktop door's `launch`, and prepends its PATH to
  the shell's own for every node child after it: the server and each door
  question. Rejected: a fixed list of bin dirs alone, and an `LSEnvironment`
  PATH in the bundle, since neither can know a version manager's directory.
  `apps/cli/src/desktop/login-shell-path.ts`.

- **NODE SHIPS BESIDE THE SHELL, SIGNED, AND THE SHELL HANDS IT NO CODE-LOADING
  ENVIRONMENT** (#889). The Tauri binary runs no JavaScript, so the server, the
  watcher and each ACP adapter run on the official darwin-arm64 node, a
  `bundle.externalBin` sidecar fetched against a pinned sha-256
  (`apps/desktop/scripts/fetch-node.ts`), with the CLI and its production
  `node_modules` as a resource (`apps/desktop/scripts/stage-server.ts`); the
  server forks its children with `child_process`, as under `npx`. Every Mach-O
  in the resources is signed with the hardened runtime before bundling, the
  server's tree with the one entitlements file and the git, which runs no JIT,
  with none (`apps/desktop/scripts/sign-resources.ts`). The shell finds node and
  the CLI only where its bundle carries them, never through a variable, and
  starts every node child with `NODE_OPTIONS` and every other `NODE_*` but
  `NODE_ENV` removed (`scrubbed_env` in
  `apps/desktop/src-tauri/src/runtime.rs`), so an `open --env` runs no code
  inside a process TCC counts as Inteligir. An agent's `inteligir` runs on that
  node too, through a launcher on the agent's PATH
  (`apps/cli/src/desktop/agent-launcher.ts`), since a Mac may have no node of
  its own. Rejected: `bun build --compile`, under which better-sqlite3 does not
  load, and Node's single-executable apps, whose blob holds no native addon and
  no split ESM entry. Residual: that node is a signed interpreter any local
  process can run; it carries the JIT entitlements and no other grant.

- **DIAGNOSTICS ARE `INTELIGIR_DEBUG`'S NAMED TRACES, SHIPPED IN EVERY BUILD,
  AND IN THE PACKAGED APP A SWITCH AND A FILE, BOTH THE SHELL'S.** The watcher,
  the index, the sync pass and the ACP adapter drop, skip and fence without a
  trace, and a user's "it didn't update" cannot wait for a build. So each
  decision calls its namespace's log, `undefined` while the namespace is off, so
  an untraced site costs one read. A line names paths, ids and protocol words,
  never a note's content or a credential, because it is written to be pasted
  into a report; the ACP tap drops any field that is not a protocol word
  (`packages/agent-runtime/src/acp/frame-trace.ts`). An unknown name is refused
  at boot, since a misspelt one reads as "nothing happened". A levelled logger
  was rejected: the value is these few decisions, not more volume
  (`apps/cli/src/server/debug-log.ts`, `tools/e2e/src/scenarios/debug-log.ts`).
  A Finder-launched app has no env and drops the shell's stdout, so debug
  logging is Settings › Advanced's switch, kept as `diagnostics.json` in the
  shell's own folder (`desktop/` beside config.json, one per dev checkout)
  because the shell reads it before the start it changes (the page's prefs load
  after that start, and config.json is the app's to read, never to write); on,
  the next child traces every namespace, since a report cannot know which
  decision went wrong, so a change asks for a Restart through the ordinary quit.
  Whatever the child prints is appended to `<dataDir>/logs/server.log`, rotated
  at 5 MiB, beside the shell's note of each window it loads, and a write that
  fails costs the log, never the shell; the server writing its own file was
  rejected, since a crash before its logger is up is the line a report most
  needs. An adopted server is nobody's child here, so the switch and the Restart
  are refused and say why. `apps/desktop/src-tauri/src/diagnostics.rs`,
  `server_log.rs`, `tools/e2e/src/scenarios/desktop-diagnostics.ts`.

- **THE RELEASE NOTES ARE THE CHANGELOG, WRITTEN FOR THE PERSON USING THE APP.**
  A release's GitHub body is `CHANGELOG.md`'s top section, so the release, the
  update it ships and the file say one thing. A list generated from commit
  subjects or issue titles was rejected: both are written for whoever builds the
  thing, and they describe an update as "something changed".
  `apps/desktop/scripts/release-notes.ts` prints the section as the release's
  notes (`docs/releasing.md`) and refuses one not titled for the package's
  version; `tools/repo-guards/src/changelog.test.ts` holds the file's shape.
  Settings › About links the file on main
  (`apps/workspace/src/app/settings/version-row.tsx`).

- **FIRST RUN IS DECIDED BEFORE ANY SERVER EXISTS**, because a server is bound
  to one vault and one data dir and a knowledge worker chooses between a new
  vault and a folder they already have. `planLaunch` asks only when nothing
  chose a vault (no env pin, no `vaultDir` in config.json) and the default
  vault's folder does not exist, so an upgrade, `inteligir serve` and a pinned
  harness never meet it. Rejected: booting the default vault unasked, which
  created, seeded and committed `~/Inteligir` before the user said anything and
  left it behind when they opened a folder instead. The first-run window is its
  own: the bundle's page on `tauri://`, built apart
  (`apps/workspace/vite.config.ts`, `--mode first-run`), pinned and locked down
  like a vault's, with no server behind it and a capability granting its four
  commands alone (`apps/desktop/src-tauri/capabilities/first-run.json`). It
  keeps the default web store rather than a non-persistent one, which the
  scenario suite's WebDriver cannot drive; every vault's window has a store of
  its own, so nothing the first run keeps reaches one. Every folder the page
  names back is one the shell handed out, and a choice is resolved exactly as a
  boot would before anything is written (`planFirstRunChoice`, asked through the
  desktop door). An existing folder is plain markdown where it is, shown with
  what `inspectVaultFolder` says of it (its notes, a service that syncs it, an
  origin of its own). The agent and the account follow as steps in the app
  window on `/welcome`, a layer over the workspace like Settings, each
  skippable, composing the shared `AgentSignIn` and `AccountForm` rather than
  spelling either flow again. `apps/cli/src/desktop/first-run.ts`,
  `apps/workspace/src/shell/first-run-state.ts`,
  `apps/workspace/src/first-run/vault-step.tsx`,
  `apps/workspace/src/routes/_workspace/welcome.tsx`,
  `apps/workspace/src/app/onboarding/account-step.tsx`,
  `tools/e2e/src/scenarios/desktop-onboarding.ts`,
  `tools/e2e/src/scenarios/onboarding-account-browser.ts`.

- **THE .APP SHIPS ITS OWN GIT, AND RUNS IT WHERE THE MAC HAS NONE.** Every
  vault write, sync and history read is git, and so is an agent's own `git
status`, but a Mac without Xcode or its command-line tools, which is most
  people's, has only `/usr/bin/git`'s stub: it fails and offers the install, so
  the vault could not even initialize. The pack carries dugite-native's macOS
  arm64 build, fetched at package time against a pinned sha-256
  (`apps/desktop/scripts/fetch-git.ts`) and signed and notarized with the rest
  of the bundle. The desktop door's `launch` asks `xcode-select -p` once, before
  the first child: a developer dir holding `usr/bin/git` keeps the Mac's own git
  (owner decision: a user with the tools and an https remote of their own keeps
  the Keychain helper, which dugite-native does not build), unless the git a
  PATH lookup finds once PATH is the login shell's is older than 2.45 or will
  not say its version: an older git sets its own `Transfer-Encoding` header,
  which libcurl 8.7.0 and 8.7.1 mishandle, so a push past 1 MiB goes out as its
  first 4 bytes (Homebrew's 2.39.0 does). Any other Mac gets the bundled one on
  the env of every node child the shell starts, so the engine, the ACP adapters,
  every agent shell and the door's own folder reads run it. Never
  `GIT_CONFIG_COUNT`: the hosted remote's bearer rides those rows per
  invocation. A dev or e2e launch keeps the host's git. The fetch drops Git
  Credential Manager and Git LFS, which no config names and which were
  five-sixths of the payload, and every dashed built-in's link but the three a
  transport runs (git's own `SKIP_DASHED_BUILT_INS`) and `git-remote-https`,
  since Tauri copies a link as the file it names: 140-odd whole gits, near 500
  MB. Rejected: the dugite npm package, a JS API nothing calls and a postinstall
  download on every install. `apps/cli/src/desktop/bundled-git.ts`; the smoke's
  first launch plays such a Mac and proves the host's git never ran.

## Repo guards, vendoring and tooling

- **THE SHELL'S GLUE RUNS IN E2E OVER WEBDRIVER, AND ITS WIRE IS A GUARD.** The
  shell's policies are pure and unit-tested (`cargo test`, and the CLI's desktop
  door under vitest); what joins them (the window's sign-in, the pin, every
  command, the vault switch, the quit) is
  `tools/e2e/src/scenarios/desktop-shell.ts`, with `desktop-onboarding.ts` and
  `desktop-diagnostics.ts`: the built shell on Linux, driven through
  `tauri-driver` and WebKitGTK's WebDriver
  (`tools/e2e/src/harness/webdriver.ts`), which also gives the page its one
  WebKit run, never through the env pins, since the shell refuses a switch while
  either pins the launch. Only the first window is driveable, so a later one is
  read through its server and the shell's note in its log. Not the packaged
  `.app`: packing is minutes, and the bundle, the signatures and the sidecar
  stay `pnpm smoke:desktop`'s, on the macOS job. The static half is
  `tools/repo-guards/src/desktop-shell-wire.test.ts` (THE APP WINDOW IS THE
  SERVER'S OWN PAGE).

- **THE SHELL'S PLUMBING IS COPIED BETWEEN REPOS AND DIVERGES ON PURPOSE.** The
  shell's log (`apps/desktop/src-tauri/src/server_log.rs`), its origin pin
  (`apps/desktop/src-tauri/src/navigation.rs`), its runtime
  (`apps/desktop/src-tauri/src/runtime.rs`) and the packaging scripts in
  `apps/desktop/scripts` are copied from or to kyh/idlebiz, and the origin pin
  from or to kyh/init too. Each copy is its own repo's code, shaped to the child
  it runs and the product it ships, so there is no shared package and a fix is
  ported by hand. The Rust toolchain (`apps/desktop/rust-toolchain.toml`) and
  the bundled node (`VERSION` in `apps/desktop/scripts/fetch-node.ts`) are the
  same in every repo that carries them, and move together.
