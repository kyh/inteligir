# @repo/e2e — the end-to-end suite

Boots REAL servers (`inteligir serve`, the same binary a packaged install
runs) on scratch instance dirs, drives them over the typed oRPC client and a
headless browser, and asserts on the wire AND on disk. It is orchestration
plus plain assertions on purpose — no test framework; the runner exits
non-zero on any failure with a readable transcript.

ONE mode: the workspace is a plain SPA, built once and served as files, so the
suite drives the same bytes and the same policy a user gets.

## Run it

```sh
pnpm e2e                      # every scenario (the runner builds the CLI first)
pnpm e2e --only vault-sync    # one scenario (comma-separated, repeatable)
pnpm e2e --keep               # keep the scratch dirs for post-mortem
pnpm e2e --list               # names + descriptions
pnpm e2e --no-skip            # every SKIP FAILS: for a provisioned browser and display
```

Before the first scenario the runner builds the CLI bundle and the workspace
UI it stages, through turbo (`--filter=inteligir`): a cache hit when nothing
changed, and never a stale `dist/` booted as if it were this checkout.

Every scenario runs under a deadline (`timeoutMs`, default 180s; a scenario
that builds or boots a Worker, or the desktop shell, declares more). A run
still going past it FAILS with its instances' output tails and is torn down,
so a hang costs one scenario, not the whole job.

Deliberately OUTSIDE `pnpm verify`: the package typechecks/lints/formats in
the gate (it has a `typecheck` script and lives under the root oxlint/oxfmt
sweep), but its scenarios boot processes and a browser, so they run only via
`pnpm e2e`.

## What a scenario gets

Each scenario receives a context (`src/harness/scenario.ts`) that owns its
scratch dir and tears everything down afterwards:

- `boot({ name, mode?, vaultRemote?, extraEnv?, seedVault?, seedData? })` — a
  fresh instance. `mode` is `source` (the default: `bin/inteligir`, which runs
  `src/` under tsx in a checkout) or `built` (`dist/index.js` under
  `NODE_ENV=production`, what npm and the .app run). Scratch `data/` + `vault/`
  siblings, empty vendor stores of its own (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`,
  so no instance runs the agent or asks its sign-in on the host's account), a
  reserved free port (bind races retry with a fresh port,
  bounded), health-gated on `/health` answering `{ok:true}`. Registered for
  teardown at SPAWN, before the health wait, and torn down as a process group
  that is polled to verified-dead (SIGTERM →
  SIGKILL → ESRCH) before its scratch is removed; Ctrl-C kills every live
  group. `extraEnv` may not touch harness-owned keys (paths, vendor stores,
  port, NODE_ENV, `GIT_*`) — collisions are refused loudly. `seedVault` writes fixture files
  before boot; the app's repo init commits them. `seedData` does the same for
  the data dir — a device credential, so the instance boots already signed in.
- `bareRemote()` — a scratch bare git repo, returned as the `file://` URL for
  `INTELIGIR_VAULT_REMOTE`.
- `cloudWorker()` — the product Worker (apps/web) under `wrangler dev` on a
  scratch persist dir, its D1 carrying apps/web's own `db:export` schema plus
  one invite row. Registered for teardown exactly like an instance.
- `instance.api` — the oRPC client over `@repo/api/local`, carrying the device
  token this instance published in `<dataDir>/server.json`;
  `instance.vaultDir` / `dataDir` for on-disk assertions.
- `desktopShell({ seedVault?, seedUserData?, firstRun? })` — the checkout's
  built Electron shell. It makes the default vault's folder before launch, as a
  launch before first run left it, so the shell boots it; `firstRun: true`
  makes nothing, so the shell opens its first-run page and boots no server
  until a vault is chosen, and a relaunch over the same scratch finds the vault
  that run made. Launched with `--remote-debugging-port` on a scratch `HOME` and
  `--user-data-dir` (never `INTELIGIR_DATA_DIR`/`INTELIGIR_VAULT_DIR`, which
  would make it refuse a vault switch), a pinned server port and
  `INTELIGIR_AGENT=scripted`. Its `cdpPort` is what an agent-browser session
  `connect`s to; `api` is the oRPC client over whichever server it runs now;
  `target()` is the data and vault dir it resolves now, derived as main derives
  them; `quit()` sends main alone the SIGTERM an OS quit would. The Electron
  binary is fetched by electron's own installer on first use (pnpm runs no
  install script). Registered for teardown like an instance. On Linux with no
  display it skips: run the suite under `xvfb-run -a`.
- `browser(label)` — an agent-browser session registered for teardown like an
  instance, so a failed or abandoned scenario still closes it. It is callable
  with any agent-browser command, and `openWorkspace(app, { path? })`
  signs it in through a fresh handoff and returns once the rail and the editor
  mounted. It skips the scenario when no headless browser can launch (see CI).

Beside the context, `src/harness/` carries what the scenarios would otherwise
each re-spell: `pollUntil` (`poll.ts`), which returns the value it waited for
and fails with what the last read held; `untilThreadIdle` (`threads.ts`);
`modChord` for the platform's modifier key (`agent-browser.ts`); the workspace
selectors (`selectors.ts`); the account's sign-up and device routes against
a dev Worker (`cloud-account.ts`); and a signed-in instance's explicit sync
against the hosted vault (`hosted-vault.ts`).

## The scenarios

`pnpm e2e --list` prints this table from the registry itself; what follows is
what each one is FOR.

| name                      | proves                                                                    |
| ------------------------- | ------------------------------------------------------------------------- |
| vault-crud                | write/read/rename/delete over the wire, bytes verified on disk; refused   |
|                           | ops verified to leave the disk untouched                                  |
| slow-storage              | a doc whose read stalls 30s (`INTELIGIR_SLOW_READS`): the reconcile       |
|                           | finishes and search answers without it, the boot line counts it deferred, |
|                           | and it is indexed once its read lands                                     |
| vault-sync                | two instances + one bare remote (auto-sync off, every sync explicit):     |
|                           | propagation, then a same-line edit merged with a copy aside, both repos   |
|                           | converged byte-identical and left mid-nothing                             |
| hosted-vault-sync         | the hosted loop for real: a wrangler-dev Worker, production login,        |
|                           | convergence through the derived remote, boot clone, a same-line edit      |
|                           | copied aside under the signed-in device's name, revoke → unauthorized     |
| hosted-vault-phone-write  | a second login plays the phone against a wrangler-dev Worker: its change  |
|                           | set lands and A syncs its bytes, history naming the phone; a stale set    |
|                           | gets A's bytes back as a conflict, and a recommit on them converges       |
| phone-offline-edit        | the phone's own runtime (`composeRuntime` under node, over node's sqlite) |
|                           | edits a note offline while A edits it too; reconnected, a far edit lands  |
|                           | merged with A's, and a same-line one keeps the phone's version with A's   |
|                           | as the copy the phone named, both on A's disk after A syncs               |
| phone-file-ops-hosted     | the phone's own runtime creates a note, renames one another note links    |
|                           | to, deletes one with a comment and adds a photo; after A syncs, A holds   |
|                           | the rewritten link, the old name as the note's alias, no comment store    |
|                           | and the photo's bytes                                                     |
| phone-editor-page         | the phone's editor page, built through turbo, loads from `file://` at     |
|                           | 390×844 with a scripted phone on its bridge: a typed paragraph writes     |
|                           | exactly the note's new bytes under its read base, typing in a tab panel   |
|                           | or on a chart writes nothing, a nonce-less frame is ignored, an announced |
|                           | change reloads the buffer, a write the phone finds changed lands merged   |
|                           | and shows, and Ask agent and a wiki link tap reach the native end         |
| thread-sync-hosted        | a thread sent on A reaches B through a wrangler-dev Worker: B's real      |
|                           | socket opens, and B holds A's timeline before its poll timer could run,   |
|                           | so the Durable Object's ping is what delivered it                         |
| phone-dispatch-hosted     | a second login plays the phone: its request waits with no desktop online  |
|                           | until A signs in and runs it over the note it named, the reply naming the |
|                           | note and the phone's pull holding the request; with A and B both          |
|                           | listening, exactly one runs the next, before a poll could                 |
| account-hosted            | an account created in the app (`cloud.signUp`) against a wrangler-dev     |
|                           | Worker signs that instance in as it; the invite is spent, so a second     |
|                           | sign-up with it is FORBIDDEN; a second instance signs in with the same    |
|                           | email and password                                                        |
| built-worker-boot         | the vite-built bundle — what `wrangler deploy` ships — boots under        |
|                           | wrangler dev and answers; built through turbo on every run, so it is the  |
|                           | current source, and the one place a module-scope crash of the emitted     |
|                           | module can show                                                           |
| built-cli-boot            | the esbuild bundle — what npm and the .app run — boots in production      |
|                           | mode, serves `dist/ui`'s shell byte for byte, migrates and indexes a      |
|                           | write, hears an on-disk write through its forked watcher, and answers a   |
|                           | client verb run from the same split bundle                                |
| desktop-shell             | the built Electron shell over DevTools: the window is on `inteligir://`,  |
|                           | the rail and a note ride the protocol handler's bearer, an API write      |
|                           | reaches the open editor through the socket, `window.open` is denied, the  |
|                           | microphone reads denied, Reveal refuses a symlink out of the vault, a     |
|                           | switch boots a new child on the new vault, and a SIGTERM quit stops it    |
|                           | and retracts `server.json`                                                |
| desktop-diagnostics       | the shell's debug-logging choice, seeded in its own userData, reaches the |
|                           | server it forks, whose output always lands in the data dir's              |
|                           | `logs/server.log`: off, the boot line and no trace; on, an external write |
|                           | traced there, the bridge reports the choice, and turning it off asks for  |
|                           | a restart                                                                 |
| desktop-onboarding        | the built shell on a fresh home opens only its first-run page and boots   |
|                           | nothing; Create with the defaults boots the default vault, and the app    |
|                           | window replaces the page on `/welcome` over the seeded vault; finishing   |
|                           | shows Welcome.md, and a relaunch goes straight to the app                 |
| threads-scripted          | a turn through the scripted driver: send, settle, timeline, and the note  |
|                           | its changes name under the turn's own id                                  |
| action-scripted           | an action attaches to its note; a scripted turn writes the vault; the     |
|                           | CAS write guards the save (typed conflict, current bytes in the body);    |
|                           | a rename drags the attachment along — all verified on disk                |
| undo-scripted             | undoing the second of two scripted turns leaves the first turn's text     |
|                           | and a line the user added since, on disk and through `vault.read`; the    |
|                           | first turn's note is then kept as edited since, and an untouched turn's   |
|                           | undo removes the note it made                                             |
| cli-drive                 | the CLI drives a real instance, and the env an agent's shell would get    |
|                           | resolves against this checkout; a byte copy's shared id is listed, and    |
|                           | `vault new-id` gives it its own on the same line with a copy of the store |
| debug-log                 | `INTELIGIR_DEBUG` traces what the watcher kept and dropped and the        |
|                           | index's verdict, by path and never by content or credential; an instance  |
|                           | without it writes no debug line                                           |
| browser-smoke             | headless page load: the REAL policy on the served document, SPA mount,    |
|                           | API reached, the palette chord safe, clean console after a settle window  |
| note-create-browser       | a note created through the session — the sidebar's New note, the inline   |
|                           | name, Enter — lands on disk as the file a user would go looking for       |
| editor-constructs-browser | every live-preview construct renders in a real browser (jsdom has no      |
|                           | layout, so the unit suite cannot prove a widget survived the bundle and   |
|                           | a measure pass), and the file is re-read to prove rendering wrote no      |
|                           | bytes                                                                     |
| slash-menu-browser        | a typed slash opens the menu, and the picked construct lands in the file  |
| external-edit-browser     | a clean buffer adopts an agent write; a dirty buffer merges instead of    |
|                           | clobbering                                                                |
| view-context-browser      | the agent is told which note the message left from, and at what revision  |
| os-dictation-browser      | words the OS dictates (CDP's `Input.insertText`, the IME-style commit     |
|                           | macOS dictation makes) and words typed after them land in order and       |
|                           | once: in the ⌘K composer's field, sending nothing, and in the note focus  |
|                           | returns to, on disk                                                       |
| undo-browser              | a ⌘K action's finish toast offers Undo, which removes the note it made    |
|                           | and the reply says Changes undone; a reply's Undo changes, clicked inside |
|                           | the autosave debounce, takes its turn back and keeps a line typed since,  |
|                           | on disk and in the editor                                                 |
| settings-browser          | /settings hosts the window-level surfaces: Sign out opens its confirm     |
|                           | dialog on that route, and a refused connector add toasts there; signed    |
|                           | out, Create an account asks for an invite code, and a sign-up the cloud   |
|                           | cannot answer says so and keeps what was typed                            |
| agent-sign-in-browser     | signed out, ⌘K offers Sign in with Claude in place of the field; the      |
|                           | login (a fake claude, `tools/e2e/src/fixtures/fake-claude.mjs`) takes the |
|                           | code pasted from its page and the field opens; Settings shows Claude      |
|                           | signed in and ChatGPT under Other; a send on the real bundled codex,      |
|                           | signed out under the instance's empty store, puts ChatGPT's sign-in above |
|                           | the reply                                                                 |
| vault-search-browser      | the palette's vault search lists every match; Enter lands the find bar on |
|                           | one; Replace all rewrites the notes on disk                               |
| tree-ops-browser          | the tree's row menu pins a note into its frontmatter, and a drag moves it |
| extract-note-browser      | the selection toolbar extracts the selected block to a new note and       |
|                           | leaves a link                                                             |
| remote-content-browser    | under the built bundle's CSP a remote embed is an unloaded card, and an   |
|                           | html block's Run executes its script under its own policy                 |

## Adding a scenario

1. `src/scenarios/<name>.ts` exporting a `Scenario` (`name`, `description`,
   `run(ctx)`, and `timeoutMs` only when a green run can near the default);
   assert with `expect`/`expectEq`, bail with `skip(reason)` for a capability
   this environment/branch does not have yet.
2. Register it in `SCENARIOS` in `src/run.ts` (a static import — knip reads
   reachability from there).
3. Give it a row in the table above, at its place in `SCENARIOS`;
   `tools/repo-guards/src/e2e-scenario-table.test.ts` fails until it has one.

Each feature issue lands with its scenario here.

## The env contract the harness drives

| var                          | effect                                                 |
| ---------------------------- | ------------------------------------------------------ |
| `INTELIGIR_DATA_DIR`         | absolute data dir (SQLite + config.json)               |
| `INTELIGIR_VAULT_DIR`        | absolute vault dir; must be disjoint from the data dir |
| `INTELIGIR_PORT`             | exact port (env-configured ports are never probed)     |
| `INTELIGIR_VAULT_REMOTE`     | git remote URL pinned over the vault's own origin;     |
|                              | unset = that origin, else the signed-in account's      |
| `INTELIGIR_CLOUD_URL`        | the cloud origin; hosted-vault-sync points it at its   |
|                              | own scratch wrangler-dev Worker                        |
| `INTELIGIR_SYNC_INTERVAL_MS` | vault auto-sync cadence; `0` disables the loop AND the |
|                              | boot sync (the sync scenarios set it for determinism)  |
| `INTELIGIR_AGENT`            | `scripted` — the deterministic in-process driver the   |
|                              | thread and action scenarios run against                |
| `INTELIGIR_SLOW_READS`       | `<ms>:<vault path>` — every read of that path, and     |
|                              | everything under it, answers that late (an empty path  |
|                              | is the whole vault); slow-storage's stand-in for       |
|                              | storage that fetches or wakes                          |
| `INTELIGIR_DEBUG`            | the diagnostics debug-log reads off an instance's      |
|                              | stderr; unset on every other instance                  |

Instances run with every host `GIT_*` variable stripped, `GIT_CONFIG_GLOBAL`
/`GIT_CONFIG_SYSTEM` pinned to `/dev/null` and an explicit harness git
identity, so no commit or fixture depends on the host's git configuration —
the same env every git the harness itself runs gets.

## CI

Headless by construction: no interactive auth, no pinned ports, and no
accounts on any EXTERNAL service — hosted-vault-sync signs up a real account,
but against its own scratch wrangler-dev Worker (apps/web's wrangler, local
mode, state under the scenario's scratch dir; secrets ride `--var`, so no
`.dev.vars` is needed). The one setup step beyond `pnpm install` is the
browser binary every browser scenario needs: `npm i -g agent-browser@X.Y.Z &&
agent-browser install` (Linux: `--with-deps`), at the version
`.github/workflows/ci.yml` pins so a local run drives the browser CI drives.
The desktop shell opens a real window, so CI runs the suite under `xvfb-run -a`,
after a sysctl that lets Chromium's namespace sandbox run under Ubuntu's
AppArmor (the shell is never launched with `--no-sandbox`); with no display on
Linux, `desktop-shell` skips. The first browser a run asks for probes the
environment with `about:blank`, once per run and in a session of its own, so
every scenario's session still launches with its own flags. Only a failure THERE (the browser cannot launch at all)
reports SKIP, for that scenario and every browser scenario after it, with the
exact launcher error; opening the app and everything after is a real assertion.
A SKIP still exits 0, which is right on a machine with no browser or no display
and wrong on one provisioned for both: there a failed install or a missing
display passes as skipped scenarios behind a green step. So a run whose
environment was provisioned passes `--no-skip`, and every skip, the browser's
and the display's alike, becomes a FAIL carrying the reason it would have
skipped with.

The runner's suite-start build is what stages `apps/cli/dist/ui`; the harness
still refuses to boot without it, because a server with no workspace UI
answers the API and serves a 404 to the browser — a green API run beside a
page that never loads. built-worker-boot builds apps/web for itself, through
turbo, because the bundle it boots is the thing under test and no other
scenario needs it.
