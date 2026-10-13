# Decisions: inteligir (apps/cli)

The server process, its credential and boot, and the binary around it.
`AGENTS.md` § Decisions says how a bullet is written and cited.

## Shape

`serve` is the whole local process, built by the ONE composition root
(`apps/cli/src/server/compose.ts`); every other verb but `vault open` is a citty
leaf that is a client of a running one. Every leaf takes `--json` and is
EXECUTED by the fitness test against the refusal path, except the rows in
`EXCLUDED_COMMANDS` (`apps/cli/src/__tests__/json-flag-enforcement.test.ts`),
each with its reason. Every app-written file in the data dir is a
`json-file-store.ts` over `staged-write.ts`; `config.json` is read at boot and
never written by the app except its `vaultDir`, the selector a switch rewrites
(`apps/cli/src/server/vault-switch.ts`). The build inlines every workspace
package (they export TS source) and stages as content the migrations, the
dialect skills, the licence texts and `@repo/workspace`'s app page as `dist/ui`.

## Vault: writes, git and containment

- **EVERY VAULT GETS ITS OWN DATA DIR, AND A SWITCH IS A NEW CHILD, A NEW
  SESSION AND A NEW WINDOW.** Every vault, the default included, lives in
  `<root>/vaults/<sha256(physical path)[:16]>/`, derived once in `config.ts`
  unless `INTELIGIR_DATA_DIR` pins one; the root holds only `config.json`, the
  selector the shell and `inteligir serve` both read. A folder is ONE vault
  however it is spelled, because the key is `physicalVaultDir`: every symlink
  followed through the nearest existing ancestor, so a vault not made yet keys
  the dir it keeps once it is, and "is the default", "already open", "inside the
  app's data" and "synced by another service" judge that one spelling. A
  selection stores it too (`resolveVaultCandidate`). Only case escapes it: a
  name not made yet keeps the case it was typed in, so where the volume folds
  case the default's name in another case is the default (`isDefaultVault` in
  `apps/cli/src/desktop/first-run.ts`). Rejected: the default keeping the root
  and the rest keyed by the stored spelling, which took a second resolve, a
  scope the page branched on, and still let one folder key two dirs. The vault
  service's containment guard stays its own (CONTAINMENT IS PHYSICAL, in
  `apps/cli/src/server/vault/CLAUDE.md`): it is async and compares against its
  own non-native root. Cost accepted: the credential and the agent default live
  in the data dir, so every vault starts signed out, which also keeps it off the
  account's hosted remote until it signs in; connectors belong to the agent, so
  every vault shares them. The shell switches only a child it started and opens
  a new window, since a webview's data store is fixed at creation and each vault
  has its own; any failure puts the previous vault back, and a rollback that
  cannot write the selector back quits rather than leave `config.json` naming
  the vault that failed (`switch_vault` in
  `apps/desktop/src-tauri/src/shell.rs`). A first run writes the selector before
  the first child exists unless it chose the default, and a failed first boot
  removes it (the door's `select --default`, which is
  `writeManagedVaultDir(root, null)`), so the next launch asks again. The folder
  is picked in the shell, so the page never names a path it was not handed, and
  a picked switch to a folder another service syncs asks first, in the first
  run's words. Every rule of that plan is the CLI's, asked through the desktop
  door (`apps/cli/src/desktop/desktop-door.ts` over
  `apps/cli/src/desktop/vaults.ts`); the shell only orders the moves. `inteligir
  vault open <dir>` runs the same plan (`apps/cli/src/server/vault-switch.ts`)
  and restarts nothing. `apps/workspace/src/shell/vaults-state.ts`.

## Server process and the desktop shell

- **ONE BINARY, TWO MODES: `inteligir serve` IS the server, and `npx` is a
  verb**. `npx inteligir serve --open` is the developer's and the agent's
  zero-install path, with one exit code; a user installs the signed dmg and
  never meets it. The desktop shell is Rust, so the server is its one child, on
  the node the .app carries, supervised with the deliberate absence of a
  restart, since a fresh child mints a session the window's cookie does not
  hold. A quit sends SIGTERM and waits the teardown budget the child announced
  before SIGKILL, inside `RunEvent::Exit`, since Cmd+Q leaves no later step to
  wait in; the child holds a pipe the shell never writes, so a shell that
  crashes or is killed closes it and the server shuts down rather than hold the
  data dir, and runs in a process group of its own, so a signal to the shell's
  group reaches the server once, through the shell, since a second one skips the
  flush (`apps/desktop/src-tauri/src/server.rs`, the `lifeline` `runServe`
  watches once its signals are, in `apps/cli/src/server/serve.ts`). Whether
  `server.json`'s owner still serves has ONE reading,
  `apps/cli/src/server/server-probe.ts`, which the boot's guard and the shell's
  adoption both project; the shell refuses a server of another version, because
  `/local`'s two ends may break freely only while they ship together.

- **A DATA DIR HAS ONE SERVER, AND THE LOCK, NOT THE ROW, DECIDES IT.**
  `server.json` is published only after listen, so two boots started together
  would both find no row and open one db. `serve` takes `<dataDir>/serve.lock`
  (O_EXCL, holding its pid) before anything is composed; a live pid holds it
  unless its published row is judged gone, because a crash's pid can be reused
  and must not block boot forever. A server removes `server.json` only when the
  row carries its own token, so a shutdown never retracts another boot's
  address. `apps/cli/src/server/serve-lock.ts` and `claimDataDir` in `serve.ts`.

- **ONE COMPOSITION ROOT, AND THE SERVER IS SPLIT ALONG ONE-RESPONSIBILITY
  SEAMS.** `apps/cli/src/server/compose.ts` builds every service in boot order
  and returns `{ context, teardown }`; `createApp` is route wiring, `serve.ts`
  is the data-dir claim + listen + `server.json` + signals + exit code, and the
  booted suites call the same composition. `ThreadService.boot()` is called from
  it because crash recovery writes. The seams: `vault/git-run` / `git-porcelain`
  / `git-refs` / `git-bootstrap` / `git-engine`; `cloud/sync-pass` /
  `sync-cadence` (the socket link is the client core's, shared with the phone);
  `agents/interaction-waiters` beside a watchdog that sweeps per-turn timestamps
  rather than re-arming a timer per frame; `writeTransaction` in
  `@repo/db/connection` as the one spelling of `BEGIN IMMEDIATE`. `serve.ts`
  injects node's socket dial and the agent driver because compose is reachable
  from the workspace UI's suites, a DOM program
  (`apps/cli/src/workspace/tsconfig.json`). `dev-instance.ts` owns the
  per-checkout derivation; `config.ts` stays the parser.

- **THE BIN EXITS 128+n WHEN THE SERVER DIES BY SIGNAL, NEVER 0**
  (`apps/cli/bin/inteligir`). Re-raising the signal at the wrapper exited 0.

- **THE CREDENTIAL IS A FILE, NOT A CHALLENGE**. The server writes
  `<dataDir>/server.json` at 0600 and removes it on ordered shutdown; every
  caller reads it and sends the bearer. No port scan and no challenge: the
  address is the row's, never a guess, and whether its owner still serves is one
  authenticated status call (`server-probe.ts`). The bound is the honest one: it
  proves the caller can read the data dir, not that it is this code. A BROWSER
  CANNOT SEND A HEADER, so it holds its own per-boot secret in an HttpOnly
  SameSite=Strict cookie, set only by trading a single-use handoff nonce a
  bearer holder minted (`system.browserHandoff`), and the desktop window is such
  a browser (THE APP WINDOW IS THE SERVER'S OWN PAGE, in
  `apps/desktop/CLAUDE.md`); a request with neither gets a 401 page that runs
  nothing and names the ways in, never the workspace, which would fail every
  call with nothing saying why (`apps/workspace/src/app/signed-out-state.ts`).
  The cookie, being ambient, must also prove same-origin, because loopback
  "site" ignores the port, and EVERY REQUEST MUST NAME 127.0.0.1 OR localhost AS
  ITS HOST, so a rebinding page gets nothing. Residual: a cookie is
  port-agnostic, which is why it is not the bearer and dies with the boot.
  `apps/cli/src/server/server-file.ts`, `browser-session.ts`,
  `browser-request.ts` and the guard in `app.ts`.

- **Shutdown is ORDERED, per-step TIME-BOXED, and its exit code is the truth.**
  Writers stop, the vault flush runs, handles close; each step has its own
  budget because one wedged step under a single budget starves the flush. The
  listener step closes websockets by name (`wss.clients`), because an upgraded
  socket is detached from the HTTP server's tracking and one open tab can stall
  the teardown. The step list is re-read before every step, so a boot still
  composing when the signal lands adds what it brings up.
  `apps/cli/src/server/shutdown.ts` and `listen.ts`.

- **THE CSP IS STATIC, and a plain Vite SPA is what buys it.** The page injects
  no inline script, so `script-src` is `'self'` and one fixed header serves
  every page the server answers, the desktop window's included; `connect-src`
  earns the most, since a script that cannot reach a third-party origin cannot
  exfiltrate the vault (`apps/cli/src/server/csp.ts`). The first run is the
  shell's own page, so its policy is the shell's config
  (`apps/desktop/src-tauri/tauri.conf.json`), held to the server's for a page
  with no socket, plus Tauri's IPC origins, by
  `tools/repo-guards/src/desktop-shell-wire.test.ts`; the phone's editor page
  loads from disk, so its policy is a meta tag held to the same one, each
  departure (`connect-src 'none'`, no `frame-ancestors`) a reasoned row of
  `tools/repo-guards/src/phone-page-csp.test.ts`. NOTHING REMOTE LOADS IN A
  NOTE: a remote embed is a beacon on every open, so it draws as a card
  (`packages/editor/src/nodes/remote-content-card.tsx`); widening the policy is
  a privacy decision. AN HTML BLOCK'S RUN IS A FRAME WITH A POLICY OF ITS OWN,
  `sandbox allow-scripts; default-src 'none'`
  (`apps/cli/src/server/html-block-frame.ts`); dropping Run was the rejected
  alternative, since interaction is what the block is for. `pnpm dev` stamps no
  CSP, so only `tools/e2e/src/scenarios/remote-content-browser.ts` sees either
  regress.

- **THE LOCAL DATABASE MOVES BY COMMITTED MIGRATIONS, AND A FILE ON A HISTORY
  THIS BUILD LACKS IS REPLACED AT BOOT.** `inteligir.db` lives on the user's
  disk and the app ships no drizzle-kit, so its schema changes only through the
  SQL in `packages/db/drizzle`, applied on boot: the exception to the push-based
  rule the D1 auth schema follows (`apps/web/CLAUDE.md`) and the
  `sync-conventions` skill applies, which must not delete that folder. While
  nobody but the owner runs the app, the history is one baseline rather than
  every generation, so the CHECKs `ALTER TABLE` cannot add are declared and the
  columns sit in order (`packages/db/src/schema.ts`). A file whose ledger names
  a migration this build does not carry is refused before the migrator runs
  (`UnknownMigrationHistoryError` in `packages/db/src/migrate.ts`), and the
  server signs the install out, then replaces it, because the cloud log holds
  the positions a fresh file would hand out again; in that order, a boot stopped
  between the two finds the old file and replaces it again, never a fresh one
  beside the old sign-in. The next sign-in pulls the account's threads back
  (`apps/cli/src/server/open-database.ts`). Once anyone else holds a database,
  squashing is the loss of their threads, and a migration is appended instead.

## Repo guards, vendoring and tooling

- **A CLIENT VERB LOADS THE CLIENT, AND THE BUILD REFUSES A STATIC IMPORT PAST
  IT.** The CLI bundle splits on dynamic imports, so what every verb parses
  before it reads argv is the entry's static closure; the server and the
  frontmatter parser (yaml, 72 modules) sit behind `await import()` in the verbs
  that need them. A static import that reaches yaml passes every test and every
  review, so `apps/cli/scripts/build.ts` walks the metafile's static closure and
  fails naming the importer (`LOADED_ON_EVERY_VERB_REFUSED`).
