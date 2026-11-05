# Decisions: inteligir (apps/cli)

The server process, its credential and boot, and the binary around it.
`AGENTS.md` § Decisions says how a bullet is written and cited.

## Shape

`serve` is the whole local process, built by the ONE composition root
(`apps/cli/src/server/compose.ts`); every other verb but `vault open` is a citty
leaf that is a client of a running one. Every leaf takes `--json` and is
EXECUTED by the fitness test against the refusal path, except the reasoned rows
of `EXCLUDED_COMMANDS` (`apps/cli/src/json-flag-enforcement.test.ts`): `serve`
and `vault open`. Every app-written JSON file in the data dir is read through
`readJsonFile` in `json-file-store.ts` and written through `staged-write.ts`,
with `JsonFileStore` the per-use store over the two; the app reads
`config.json` at boot and writes only its `vaultDir`, the selector a switch
rewrites (`apps/cli/src/server/vault-switch.ts`). The build inlines every
workspace package (they export TS source) and stages the migrations, the
dialect skills and the licence texts.

## Vault: writes, git and containment

- **EVERY VAULT GETS ITS OWN DATA DIR, AND A SWITCH IS A NEW CHILD, A NEW
  SESSION AND A NEW WINDOW.** Every vault, the default included, lives in
  `<root>/vaults/<sha256(physical path)[:16]>/`, derived once in `config.ts`
  unless `INTELIGIR_DATA_DIR` pins one; the root holds the selector,
  `config.json`. Rejected: the default keeping the root and the rest keyed by
  stored spelling (a second resolve, a scope the page branched on, one folder
  keying two dirs).
  Cost accepted: the credential and agent default are per vault, so each starts
  signed out and off the hosted remote; connectors, the agent's, are shared.

- **A FOLDER IS ONE VAULT HOWEVER IT IS SPELLED.** The key is
  `physicalVaultDir`: every symlink followed through the nearest existing
  ancestor, so a vault not made yet keys the dir it keeps once it is, and "is
  the default", "already open", "inside the app's data" and "synced by another
  service" judge that one spelling, which a selection stores too
  (`resolveVaultCandidate`). Only case escapes it: a name not made yet keeps its
  typed case. The vault service's guard stays its own (CONTAINMENT IS PHYSICAL, in
  `apps/cli/src/server/vault/CLAUDE.md`): async, against its own non-native
  root.

- **A VAULT SWITCH IS THE CLI'S PLAN.** `inteligir vault open <dir>` resolves
  the folder as a boot would and writes the selector only once the folder
  passes every refusal a boot has, restarting nothing
  (`apps/cli/src/server/vault-switch.ts`).

## Server process and the desktop shell

- **ONE BINARY, TWO MODES: `inteligir serve` IS the server, and `npx` is a
  verb**. `npx inteligir serve --open` is the developer's and the agent's
  zero-install path, with one exit code; a user installs the signed dmg, which
  runs no server, and never meets it. Whether `server.json`'s owner still serves
  has ONE reading, `apps/cli/src/server/server-probe.ts`, which the boot's guard
  projects.

- **A DATA DIR HAS ONE SERVER, AND THE LOCK, NOT THE ROW, DECIDES IT.**
  `server.json` is published only after listen, so two boots started together
  would both find no row and open one db. `serve` takes `<dataDir>/serve.lock`
  (O_EXCL, holding its pid) before anything is composed; a live pid holds it
  unless its published row is judged gone, since a crash's pid can be reused. A
  server removes `server.json` only when the row carries its own token, so a
  shutdown never retracts another boot's address.
  `apps/cli/src/server/serve-lock.ts` and `claimDataDir` in `serve.ts`.

- **ONE COMPOSITION ROOT, AND THE SERVER IS SPLIT ALONG ONE-RESPONSIBILITY
  SEAMS.** `apps/cli/src/server/compose.ts` builds every service in boot order
  and returns `{ context, teardown }`, for `serve` and the booted suites alike;
  `createApp` is route wiring, `serve.ts` the data-dir claim, listen,
  `server.json`, signals and exit code, and compose calls
  `ThreadService.boot()`, as crash recovery writes. Seams: `vault/git-run`,
  `git-porcelain`, `git-refs`, `git-bootstrap`, `git-commits`, `git-engine`;
  `cloud/sync-runtime`, `account-calls` (the socket link and sign-in check are
  the client core's, shared with the phone); `agents/interaction-waiters` beside
  a watchdog sweeping per-turn timestamps, not a timer re-armed per frame;
  `writeTransaction` (`@repo/db/connection`), the one `BEGIN IMMEDIATE`.
  `serve.ts` injects node's socket dial and the agent driver, since the UI's DOM
  suites reach compose (`apps/cli/src/workspace/tsconfig.json`).
  `dev-instance.ts` derives the checkout's instance; `config.ts` parses.

- **THE BIN EXITS 128+n WHEN THE SERVER DIES BY SIGNAL, NEVER 0**
  (`apps/cli/bin/inteligir`). Rejected: re-raising the signal at the wrapper (it
  exited 0).

- **THE CREDENTIAL IS A FILE, NOT A CHALLENGE**. The server writes
  `<dataDir>/server.json` at 0600 and removes it on ordered shutdown; every
  caller reads it and sends the bearer. No port scan and no challenge: the
  address is the row's, never a guess, and whether its owner still serves is one
  authenticated status call (`server-probe.ts`). The bound is the honest one: it
  proves the caller can read the data dir, not that it is this code.
  `apps/cli/src/server/server-file.ts`.

- **A BROWSER CANNOT SEND A HEADER, SO IT HOLDS A PER-BOOT COOKIE**, HttpOnly
  and SameSite=Strict, set only by trading a single-use handoff nonce a bearer
  holder minted (`system.browserHandoff`). A request with
  neither gets a 401 page that runs nothing but names the ways in, not a
  workspace whose every call fails unexplained. The ambient cookie must also
  prove same-origin, as loopback "site" ignores the port, and EVERY REQUEST MUST
  NAME 127.0.0.1 OR localhost AS ITS HOST, so a rebinding page gets nothing.
  Residual: a cookie is port-agnostic, so it is not the bearer and dies with the
  boot. `apps/cli/src/server/browser-session.ts`, `browser-request.ts`,
  `app.ts`.

- **THE BYTE ROUTES ALONE TAKE THE BOOT'S MEDIA TOKEN.** An item's file, its
  thumbnail and its page copy also take a cookie request carrying neither
  `Sec-Fetch-Site` nor `Origin` when its `m` parameter is the media token
  `system.status` answers, because AVFoundation's loader inside WKWebView may
  send neither on a video's range requests. The token alone is no credential,
  and no other route reads it (`requireMediaRequest` in
  `apps/cli/src/server/app.ts`).

- **Shutdown is ORDERED, per-step TIME-BOXED, and its exit code is the truth.**
  Writers stop, the vault flush runs, handles close; each step has its own
  budget, since under one budget a wedged step starves the flush. The listener
  step closes websockets by name (`wss.clients`), since an upgraded socket
  leaves the HTTP server's tracking and one open tab would stall the teardown.
  The step list is re-read before every step, so a boot still composing adds
  what it brings up. Imports and items stop before knowledge and the vault
  flush, since an import hands fills to items and a fill writes the vault and
  settles knowledge; the rows of `TEARDOWN_BUDGETS_MS` are the teardown's order.
  `apps/cli/src/server/shutdown.ts`, `listen.ts`.

- **THE CSP IS STATIC, and a plain Vite SPA is what buys it.** The page injects
  no inline script, so `script-src` is `'self'` and one fixed header serves
  every page the server answers; `connect-src`
  earns the most, since a script that cannot reach a third-party origin cannot
  exfiltrate the vault (`apps/cli/src/server/csp.ts`). The phone's editor page loads
  from disk under a meta tag held to the same, each departure a reasoned row of
  `tools/repo-guards/src/phone-page-csp.test.ts`.

- **NOTHING REMOTE LOADS IN A NOTE, AND A LIBRARY FILE OR AN HTML BLOCK'S RUN
  GETS A POLICY OF ITS OWN.** A remote embed is a beacon on every open, so it
  draws as a card (`packages/editor/src/nodes/remote-content-card.tsx`), and
  widening the policy is a privacy decision. A library file's policy is its
  kind's (THE ASSET ROUTE ANSWERS BYTE RANGES AND A POLICY PER KIND, in
  `apps/cli/src/server/vault/CLAUDE.md`). An HTML block's Run is a frame under
  `sandbox allow-scripts; default-src 'none'`
  (`apps/cli/src/server/html-block-frame.ts`). Rejected: dropping Run
  (interaction is what the block is for). `pnpm dev` stamps no CSP.

- **THE LOCAL DATABASE MOVES BY COMMITTED MIGRATIONS, AND A FILE ON A HISTORY
  THIS BUILD LACKS IS REPLACED AT BOOT.** `inteligir.db` is on the user's disk
  and the app ships no drizzle-kit, so its schema changes only through the SQL
  in `packages/db/drizzle`, applied at boot: the exception to the push-based D1
  rule (`apps/web/CLAUDE.md`), and the `sync-conventions` skill must not delete
  that folder. A ledger naming a migration this build lacks is refused before
  the migrator runs (`UnknownMigrationHistoryError` in
  `packages/db/src/migrate.ts`) and the file replaced, its threads with it,
  since a thread lives on this Mac alone; the sign-in stays, since nothing in
  the file is the account's (`apps/cli/src/server/open-database.ts`).

- **WHILE NOBODY ELSE HOLDS A DATABASE, ITS HISTORY IS ONE BASELINE**, so the
  CHECKs `ALTER TABLE` cannot add are declared and the columns sit in order
  (`packages/db/src/schema.ts`). A regenerated baseline takes a new folder name,
  never its old one, because drizzle keys its ledger by the folder's name and a
  file listing the old one must read as a history this build lacks. Once anyone
  else holds a database, squashing loses their threads, so a migration is
  appended instead.

- **AN IMPORT IS A SERVER JOB OVER A COPY OF THE FILE: DEDUPED BY URL, ONE
  COMMIT PER 100 ITEMS, LINEAR IN ITS ROWS, RESUMED AT BOOT.** The plan keeps
  the file in the data dir and folds rows of one url key into the first. The
  job, a json file of its cursor and counts, is rewritten per batch and resumed
  at boot, where a url the library already holds counts as saved, so a resume
  adds nothing twice. Rejected: a job table in the database (url dedupe already
  makes a re-run a safe resume).
  `apps/cli/src/server/imports/import-service.ts`,
  `packages/notes/src/imports/raindrop.ts`,
  `apps/cli/src/server/imports/imports-router.ts`.

- **AN IMPORT BATCH SETTLES THE INDEX ONCE, COMMITS ONCE AND FETCHES NOTHING.**
  The plan and each batch settle the index once, through the items core, which
  then forgets the stubs it wrote, so an item deleted since never counts as
  saved. A batch lists each folder once, writes each item's highlights before
  it, queues its fill and commits once under a commit hold. Rejected: a settle
  and a listing per item (quadratic over one `Unsorted/`), and the import
  fetching covers (all network work is the one guarded fill, and a Raindrop
  cover is a hint it fetches). `apps/cli/src/server/imports/import-service.ts`.

- **AN AGENT'S SHELL MAY PLAN AN IMPORT BUT NOT START ONE** (`FORBIDDEN`),
  because the batches commit as the engine long after its turn, beyond Undo, and
  every change an agent makes is a turn with Undo. Rejected: carrying the turn
  into the job (an Undo of thousands of items, from a turn that reads finished
  while its job still writes). `apps/cli/src/server/imports/imports-router.ts`.

## Repo guards, vendoring and tooling

- **A CLIENT VERB LOADS THE CLIENT, AND THE BUILD REFUSES A STATIC IMPORT PAST
  IT.** The CLI bundle splits on dynamic imports, so what every verb parses
  before it reads argv is the entry's static closure; the server and the
  frontmatter parser (yaml, 72 modules) sit behind `await import()` in the verbs
  that need them. A static import reaching yaml passes every test and review, so
  `apps/cli/scripts/build.ts` walks the metafile's static closure and fails
  naming the importer (`LOADED_ON_EVERY_VERB_REFUSED`).

- **THE FILL WORKER'S BUNDLE IS THE ONLY HOME OF THE DOM, AND THE BUILD HOLDS
  BOTH SIDES OF IT.** The DOM, defuddle, turndown and the editor's headless kits
  live in `item-fill-worker.mjs` alone
  (`apps/cli/src/server/items/capture/item-fill-worker.ts`).
  `apps/cli/scripts/build.ts` refuses them anywhere in the main bundle, static
  or dynamic (`SERVER_REFUSED_ANYWHERE`); React, the renderers and `@repo/ui`
  among the worker's inputs (`FILL_WORKER_REFUSED`); and node's network and
  process modules among the worker bundle's imports
  (`FILL_WORKER_REFUSED_BUILTINS`).

- **A VERB'S SUITE DRIVES THE REAL SERVER.** Every CLI suite boots the
  composition in-process, runs the program against it over loopback with its
  bearer (`apps/cli/src/test-support/booted-cli.ts` resolves it from the data
  dir's `server.json`, as the binary does) and seeds what a case reads through
  the server's own services. The one state no server reaches, every route
  refusing at once, is the real router's handler refusing before any procedure
  runs (`apps/cli/src/json-flag-enforcement.test.ts`). Rejected: a fixture
  server implementing `/local` a second time (it passed verbs against answers
  the real one never gave, and moved with every contract change).
