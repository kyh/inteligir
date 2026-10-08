# Agent Instructions

## Project Overview

**inteligir** is being rebuilt as an open-source One: a Mac app, an iPhone
remote and a Linux connector that WATCH the coding agents a developer already
runs in their own terminals (Claude Code and Codex first, then OpenCode, Pi,
Omp and Grok), show each one's state at a glance (dots on the screen edge, an
Inbox of what needs you), and answer, message, start and stop them. It is for
developers. The notes app this repo used to be is gone: the vault, the editor,
the knowledge index, the bundled agent runtime and the hosted vault were
deleted outright, with no migration, because nobody uses them. What remains is
the skeleton the rebuild grows from: the local server and its thread log, the
desktop shell and its window, accounts, the Worker's thread sync and dispatch
inbox, and the phone's sign-in and synced threads.

The premises every change builds from, each with its reason:

- **We watch the agents the user already runs, and bundle none.** No hosted
  model and no agent runtime inside the app: Claude Code and Codex run in the
  user's own terminals, on the user's own plans, because the owner never pays
  for model usage and the user already chose their agent. A bundled
  third-party runtime was a terms-of-service risk as well as a second copy of
  the vendor's own. Until the observer lands, this build runs no agent at all,
  and a send is refused, typed (THIS BUILD RUNS NO AGENT, below).
- **tmux is the control layer.** Answer, message, stop, start and kill act
  only on agents in tmux panes, through guarded keystrokes (the pane's
  identity and the screen's fingerprint checked before each one), because a
  pane is the one write path every vendor and every terminal share. Outside
  tmux, Claude's approvals and questions are answered through its own hook
  decision, and every other agent is read-only, with a jump to its window.
- **One node process per machine.** `inteligir serve` owns the machine's
  state; the window, the Toolbar helper, the hooks, the CLI and the Linux
  connector are each a client of it, because two owners of one agent's state
  are two answers to whether it needs you.
- **Model use is the user's own.** No model call goes through the Worker or
  the phone, because a model call there is one the owner pays for; Talk's
  router runs on the user's own ChatGPT sign-in or their own key, and routes
  deterministically with neither.
- **Speech stays on the device.** Talk's speech-to-text is Parakeet, run on
  the Mac and restored from this repo's history; until it is, dictation is the
  operating system's (the Dictation group).
- **The Worker is a relay, never a brain.** It carries accounts, each
  account's thread log, the dispatch inbox and live frames between a user's
  devices, because a relay that runs nothing holds nothing worth taking; the
  rebuild seals what it carries (`/v2`).
- **The phone is a remote, and Linux is a connector.** The phone reads a
  machine's agents and answers them through the Worker, because it holds
  neither the agents nor a model. A Linux box runs the same server headless,
  over the same tmux layer, with outbound connections only.
- **Every feature is core.** Nothing sits behind a tier or a flag.
- **An account is optional, and offered.** Without one the app is local and
  makes no cloud request; the phone, the web remote and Linux need one.
- **Nothing of One's is taken**: no code, copy, name or branding. What is
  ported from open-source projects keeps its licence and its header (VENDORED
  CODE IS THIS REPO'S CODE, below).

**TWO PROGRAMS.** `apps/desktop` is the shipped product — the window, and the
SPA inside it — installed as the signed dmg. `apps/cli` is the `inteligir`
binary: `serve` IS that local server, and every other verb is a client of a
running one. `apps/mobile` is the iPhone app: the synced threads, and the
requests and answers it sends a Mac.

**The decision record.** GitHub issues
[#542](https://github.com/kyh/inteligir/issues/542) and
[#611](https://github.com/kyh/inteligir/issues/611) recorded the notes
product, and the rebuild supersedes their product premises;
[#889](https://github.com/kyh/inteligir/issues/889), which moved the desktop
shell from Electron to Tauri, stands. Until the rebuild's own charter issue is
filed, this overview is the record: where any issue or a Decisions bullet
below disagrees with it, this overview wins, and the change that touches that
code rewrites the bullet in the same commit.

Turborepo + pnpm monorepo.

## Workspace Structure

```
apps/
  desktop/       @repo/desktop — THE SHIPPED PRODUCT (issues #611, #889). A
                 Tauri 2 shell over the system WebKit: src-tauri/ (Rust: the
                 window and its pin, the server it starts and stops, the
                 updater, the menus and the menu-bar icon), and src/renderer/
                 (the SPA, which the server answers and the window loads from
                 that server's own origin: TanStack Router file routes over
                 @repo/contract/local; `app/workspace.tsx` owns the rail, the
                 composer, the palette and the panel; `app/palette/` the ⌘P
                 pages; `app/sidebar/` the rail; `app/actions/` the composer
                 and the panel's threads; `app/settings/` the Settings layer,
                 Account and Advanced included; `app/onboarding/` the account
                 step `/welcome` draws). The page asks the shell only what its
                 server cannot answer (the updater and the diagnostics), one
                 Tauri command per row of `src/ipc-contract.ts`, every answer
                 parsed on the page's side and mirrored through one
                 `bridge-store.ts`, and nothing that holds a token: the window
                 signs in by the server's one-time handoff, as a tab does.
                 The whole security surface is the ORIGIN PIN
                 (src-tauri/src/navigation.rs, pure + unit-tested): one origin,
                 top-level navigation away goes to the system browser, no
                 second window, every permission request denied. The shell
                 asks the CLI's desktop entry every rule the server owns and
                 runs `serve` on the node the .app ships beside it; a server
                 already listening is ADOPTED once it answers this instance's
                 token at the bundled version, and only a child the shell
                 started is stopped on quit.
  cli/           inteligir — THE PUBLISHED BINARY, and THE SERVER (issues #553,
                 #611). `serve` is the whole local process — src/server/ owns
                 the thread log and its service (threads/), the turn-driver
                 seam a send runs through (agents/), the sync client and the
                 dispatch claim (cloud/), the oRPC handler at /rpc, the /ws
                 invalidation bus and the db, built by the ONE composition root
                 (`compose.ts`); every other verb is a citty leaf that is a
                 CLIENT of a running one, with consola for the human path (raw
                 writes for anything verbatim — consola rewrites `backtick`
                 spans). Every leaf takes --json and is EXECUTED by the fitness
                 test against the refusal path, except the rows in
                 `EXCLUDED_COMMANDS`
                 (`apps/cli/src/__tests__/json-flag-enforcement.test.ts`), each
                 with its reason. Every app-written file in the data dir is a
                 `json-file-store.ts` over `staged-write.ts`; `config.json` is
                 read at boot and never written by the app. Discovery is ONE
                 FILE: `<dataDir>/server.json` carries the bound port and the
                 bearer together, so the address and the credential cannot
                 disagree and no port is scanned. src/desktop/ is the desktop
                 shell's door, a second entry over the same chunks
                 (dist/desktop.js): every rule the Rust shell acts by that is
                 the server's own (the environment a launch runs with, the
                 data dir it serves, a browser's sign-in) is asked of it, one
                 JSON answer per process, and its `serve` is the server the
                 shell runs. The build inlines every workspace package (they
                 export TS source) and stages as CONTENT the migrations, the
                 vendored licence texts, and the desktop renderer's bundle as
                 dist/ui, which `serve --open` answers over plain HTTP.
  web/           @repo/web — ONE Cloudflare Worker: the TanStack Start
                 marketing site, the auth pages, the @repo/ui gallery
                 (src/components/gallery: `pnpm dev:gallery`, a dev-only
                 page the Worker never ships), Better Auth on D1
                 (invite-gated sign-up), and the v3 cloud (issue #554):
                 device login (POST /v1/device/login mints the device
                 credential from email + password, POST /v1/device/sign-up
                 creates the account and mints it; /app/devices, and any
                 signed-in Mac's Settings › Account with its own device
                 credential, list and revoke; POST /v1/account/delete ends
                 the account through Better Auth's one purge path), and the
                 per-user ThreadSyncDO (merged thread log + dispatch inbox +
                 ws invalidation). src/worker/ is its own tsconfig program
                 (no DOM — workerd's globals must win).
  mobile/        @repo/mobile — the Expo RN client (#576): synced threads,
                 held in its SQLite file and read offline
                 (src/sync/sqlite-sync-store.ts), kept current over the
                 account's socket while the app is in the foreground, with a
                 running turn's streamed text folded in memory alone
                 (src/sync/live-turns.ts), that it
                 asks a Mac's agent in through the dispatch inbox, from a
                 durable queue of its own (src/dispatch/dispatch-runtime.ts),
                 whose replies and approvals it answers there; reaches
                 @repo/contract/cloud and @repo/domain only.
packages/
  domain/        @repo/domain — zod-only leaf vocabulary (provider events,
                 thread status and lifecycle, the thread-title rule),
                 vendored-from-bb shapes; every package may reach it, it
                 reaches nothing.
  contract/      @repo/contract — ONE contract package, TWO entry points (#611),
                 named as in kyh/init's contract-first layout but with no
                 service package, since `apps/cli/src/server` implements /local.
                 `./local/*` is the oRPC contract the renderer and the CLI
                 compile against and `inteligir serve` implements: ONE folder
                 per domain, each a `<domain>-contract.ts` +
                 `<domain>-schema.ts`, plus the ws notification protocol, the
                 paths that are NOT procedures, and `build-thread-timeline`,
                 the pure fold the delta algebra beside it diffs. `./cloud/*`
                 is the cloud wire, the ONE page planner every reader of the
                 merged log runs (`cloud/sync/plan-page`) — two copies would be
                 two answers to "did this row move the cursor?", and a mis-set
                 cursor is a duplicated conversation — and, for the same
                 reason, the CLIENT RUNTIME CORE both consumers run. apps/web
                 SERVES every row; apps/mobile pulls threads and produces
                 dispatches, and never pushes a thread event or claims a
                 dispatch, because the desktop runs the turns. Two entries
                 rather than one router because their compatibility
                 obligations are OPPOSITE: /local's ends ship in one bundle
                 and may break freely (a CLI installed apart refuses another
                 release's server as `SERVER_VERSION_MISMATCH`), /cloud is a
                 deployed Worker answering installs that may be months stale.
                 A dep-dag table (`CLOUD_ONLY_CLIENTS`) pins apps/web and
                 apps/mobile to /cloud alone, and a dep-dag row refuses a third
                 bucket in src/, since the cloud-never-reaches-local guard
                 populates itself from src/cloud. /cloud stays zod + REST
                 paths (NOT oRPC, diverging from #611 phase 6 deliberately):
                 oRPC addresses procedures by router position, so moving the
                 deployed wire to it would break exactly the stale installs
                 /cloud must answer.
  db/            @repo/db — drizzle + better-sqlite3 (WAL, sync=NORMAL),
                 committed SQL migrations applied on boot, the DbNotifier
                 seam, prefixed-nanoid ids.
  ui/            @repo/ui — the shared component vocabulary on Base UI:
                 shadcn in components/, the Fluid Functionalism sidebar and
                 system helpers beside it, and the Beautiful UI surfaces in
                 ai/, all vendored and now this repo's own (see VENDORED CODE).
                 A LIBRARY AHEAD OF ITS CONSUMERS: `src/ai` holds fifteen
                 components no surface draws on yet, kept by owner decision,
                 and three in components/ lost their one consumer with the
                 notes editor; each is listed one by one in
                 `AWAITING_CONSUMER` (`tools/repo-guards/src/ui-package.ts`),
                 which the PER-EXPORT orphan guard
                 (`tools/repo-guards/src/ui-orphan-exports.test.ts`) reads, so
                 a nineteenth still fails. Leaf.
tools/
  repo-guards/   @repo/repo-guards — derived fitness tests over the REPO: the
                 package dependency DAG + its platform-purity rules, ws
                 change-kind reachability, and the dangling-reference sweep
                 over every path and @repo/* name the repo writes down. The
                 invariants that span workspaces and belong to none of them.
  e2e/           @repo/e2e — the scenario suite `pnpm e2e` runs: it boots real
                 instances and drives them over the wire, which is why it sits
                 outside `verify` (every unit passes while the composition
                 fails).
```

The rebuild adds a Swift Toolbar helper app (the dots, the Inbox and the Talk
pill) and a pure observer package (the hook schemas, transcript mappers,
screen-detection manifests and vendor table) when the work that needs them
lands; neither exists yet.

## Tech Stack

- **Monorepo**: Turborepo + pnpm workspaces, oxlint/oxfmt, vitest, knip
- **Web**: TanStack Start + React 19 + Tailwind CSS 4 on a Cloudflare Worker
- **Phone**: Expo + expo-router (React Native), shipped to TestFlight by EAS
- **Auth**: Better Auth on D1 via Drizzle — email+password, bearer tokens,
  invite-gated sign-up from the site or the app; no social providers

## Commands and gates

`docs/development.md` owns the commands, the ports, where state lives and the
gate. What every session keeps regardless:

```bash
pnpm format:fix && pnpm verify   # before committing — format FIRST, never after
```

`verify` is the STATIC gate (`typecheck && lint && knip && format && test &&
build`, check-only on purpose). CI runs those six and then the scenario suite,
and a macOS job runs `test` where the app ships and `pnpm smoke:desktop` on an
unsigned pack, so a green `verify` is not a green CI — run `pnpm e2e` too
before claiming one. `tools/repo-guards/src/ci-verify-parity.test.ts` keeps
that "plus a few more" an honest claim: every step on top of `verify` is a row
in `DECLARED_CI_EXTRAS` with its reason.

**A change a user can notice updates `CHANGELOG.md` in the same task**: a line
under `## Unreleased`, in the user's words rather than a commit subject, and a
behaviour that changed or went away says what to do about it. The line is
written for the person using the app, not someone reading its code; a change
to the command line goes under `### On the command line` in that section, the
one place the CLI's own words stay. A release's notes are that section (THE
RELEASE NOTES ARE THE CHANGELOG, below).

**There is no seeded login, and sign-up is invite-only.** `AGENTS.md` has the
recipe. Never run `db:push:remote` or `db:studio:remote`: both hit production
D1. The bare `db:push` and `db:studio` are the local ones.

`apps/web/README.md` is the product Worker's own guide — routes, auth, the
local loop and the owner-only deploy. `AGENTS.md` is the runnable quickstart;
`CONTEXT.md` glosses the carried domain vocabulary and the words the user sees.

## Decisions

Each bullet is the decision, what it rejected and why, and the file that
carries the mechanism. The mechanism itself is the code's and its tests' to
state; a bullet names where it lives. The dangling-reference guard keeps the
pointers honest.

The list is grouped by the part of the system a decision governs; append a new bullet
to the END of its group.

- [Agents and threads](#agents-and-threads)
- [Dictation](#dictation)
- [Cloud, sync and accounts](#cloud-sync-and-accounts)
- [Server process and the desktop shell](#server-process-and-the-desktop-shell)
- [Desktop workspace surfaces](#desktop-workspace-surfaces)
- [Repo guards, vendoring and tooling](#repo-guards-vendoring-and-tooling)

### Agents and threads

- **Ingest is ONE transaction.** Append, lifecycle projection and queue touch
  happen in one immediate transaction; notifications flush after commit.
  Lifecycle CAS predicates include the turn identity so a late completion for
  turn A cannot settle turn B (`apps/cli/src/server/threads/service.ts`).

- **THE AGENT SURFACE IS THE ⌘K ACTION COMPOSER AND THE RIGHT PANEL** (what it
  retired is the register on #645; do not bring any of it back). An action is an
  ordinary thread; the composer is a non-modal dialog over the workspace's
  centre column, and the panel's one Actions tab is the transcript, its
  approvals answered in place. A send the server refuses keeps the thread it
  created, so a retry sends into it rather than leaving one empty action a try.
  `apps/desktop/src/renderer/app/actions/actions-panel.tsx` and
  `action-composer.tsx`.

- **THIS BUILD RUNS NO AGENT, AND A SEND SAYS SO, TYPED.** The ACP runtime
  and the vendor binaries bundled beside it were deleted with the notes app,
  and the observer that replaces them watches agents rather than running them.
  Until it lands, a send still goes through the one seam every turn takes, a
  `TurnDriver` (`apps/cli/src/server/threads/turn-driver.ts`), and the default
  `auto` driver refuses it at once with `PROVIDER_UNAVAILABLE` and its words
  ("No agent runtime yet"), so a thread is never left waiting on a turn
  nothing will run. `INTELIGIR_AGENT=scripted` is the in-process fake the
  booted suites and the scenario suite drive: every turn answers
  `Noted: <text>` and completes. Rejected: keeping the ACP runtime until the
  observer could replace it, which kept a terms-of-service risk and every
  vault dependency it carried. `apps/cli/src/server/agents/agent-driver.ts`,
  `scripted-driver.ts`.

- **A TIMELINE DELTA MOVES A HELD TURN AS A PATCH, AND A ROW CARRIES WHAT THE
  PANEL DRAWS.** Upserting a turn whole resends every command, tool call and
  thought for one streamed token, so a held turn travels in `turnPatches` as
  its status and only the children past the base, and a row whose text only
  grew travels as a `textAppends` entry, since resending it whole costs bytes
  quadratic in its tokens. A turn row's `sourceSeqEnd` names its own
  contributors, not every turn-scoped event: a streaming assistant message
  lands as a top-level row, and counting it would move the turn row on every
  token. A command row carries its first `COMMAND_OUTPUT_LINES` lines; the event
  log keeps every byte. Residual: a tool row's result still rides whole.
  `packages/contract/src/local/thread-timeline.ts`.

- **A THREAD IS NAMED BY ITS FIRST MESSAGE, ON THE SERVER**, in the
  transaction that appends it, local or synced; an explicit title stays.
  Naming it in the desktop left every action the CLI, an agent or another
  device started as "Untitled action". The rule is `deriveThreadTitle`
  (`@repo/domain/thread-title`), which the phone runs too, and a title the log
  states in a `thread/meta` row outranks it on every device.
  `apps/cli/src/server/threads/service.ts`.

- **A STOP ASKS THE TURN'S DRIVER, AND A TURN NO DRIVER IS RUNNING SETTLES
  HERE** (owner decision: an agent going the wrong way needs a brake; deleting
  the `stopping` state was the rejected alternative). `threads.interrupt` marks
  the stop in one transaction and asks the driver: one that answers `settling`
  ends the turn through its own completion, like any turn, and one that answers
  `not-running` has the stop settled by the service at once, since nothing will
  ever report that turn's end. Archiving a running thread stops it. A turn
  another device runs is refused (`CONFLICT`): only its own process can reach
  it, and the wire thread says so (`runsElsewhere`), so the panel draws no Stop
  there (`apps/desktop/src/renderer/app/thread-activity.ts`).
  `apps/cli/src/server/threads/service.ts`.

- **THE THREAD LIST IS A KEYSET PAGE, AND A QUESTION A PAGE CANNOT ANSWER IS
  ASKED OF THE SERVER.** `threads.list` answers `limit` threads (default 50)
  after an opaque `cursor`, live before archived and newest first. An offset
  was rejected because a thread touched between two reads would shift every
  row behind it. A page is a window, so what must be whole is its own query:
  the rail's agent spinner (one `running` thread, archived ones included), and
  the palette's Actions search (`query`, a LIKE over the title and the origin
  path a synced thread may still carry).
  `packages/db/src/threads.ts`,
  `apps/desktop/src/renderer/app/actions/thread-hooks.ts`,
  `apps/desktop/src/renderer/app/palette/threads-page.tsx`.

- **A TURN THE VENDOR REFUSED FOR THE PLAN'S USAGE LIMIT OR A SIGN-IN LEAVES THE
  QUEUE WHERE IT IS.** A refused turn carries its words and a class
  (`auth | usage-limit | overloaded | context | other`, `providerFailureSchema`
  in `@repo/domain/provider-event`), read once by whatever ran it, so the panel
  says signed out or out of usage rather than a vendor's raw text. The class
  rides `provider/error` as an optional field, which a log written before it
  parses without and a stale install strips. A settle whose turn failed
  `usage-limit` or `auth` does not drain (`failureHoldsQueue` in
  `apps/cli/src/server/threads/service.ts`): the next send starts the oldest
  queued message first. Rejected: draining as for any failure, which spends
  every queued message on the same refusal and leaves nothing for after the
  limit resets or the sign-in.

### Dictation

- **UNTIL VOICE IS RESTORED, DICTATION IS THE OPERATING SYSTEM'S.** macOS
  dictation (fn twice, Edit › Start Dictation) and the phone keyboard's mic
  type into a field like a keyboard, so the app holds no microphone
  entitlement (`device.audio-input`, deliberately absent from
  `apps/desktop/resources/entitlements.mac.plist`), no
  `NSMicrophoneUsageDescription`, no web permission, no model and no socket.
  The rebuild restores Parakeet for Talk, with the microphone held by the
  Toolbar helper under its own identity, so this window keeps denying: every
  window denies every permission request (`on_permission_request` in
  `apps/desktop/src-tauri/src/window.rs`), which
  `tools/e2e/src/scenarios/desktop-shell.ts` reads back as a denied location
  and notification request, since a runner has no microphone to ask for. A
  Mac's ⌘K composer says "fn fn to dictate" beside Send, the app's one hint
  (`apps/desktop/src/renderer/app/actions/action-composer.tsx`). A dictated
  phrase lands as one IME-style commit; the composer's field carries no caret
  repair, and `tools/e2e/src/scenarios/os-dictation-browser.ts` lands dictated
  and typed words in order.

### Cloud, sync and accounts

- **THE DEVICE CREDENTIAL IS THE SYNC SWITCH AND THE ENTITLEMENT, and it lives
  in the data dir.** `<dataDir>/device-credential` at 0600, not in
  `inteligir.db`, the thread log it uploads. No separate "sync enabled" flag,
  since two values that must agree can disagree: signed out, the sync client
  opens no socket, arms no timer and makes no request (asserted in
  `apps/cli/src/server/cloud/__tests__/sync-runtime.test.ts`), and the app sends
  this project's cloud nothing; what does leave the machine (the update checks)
  is `docs/privacy.md`'s to list. Signed in, the credential alone entitles the
  thread sync and the dispatch inbox, and the invite gate is account-creation
  policy. Cost accepted: "pause sync" is signing out, which discards the queue.
  `apps/cli/src/server/cloud/credential-store.ts` and `sync-runtime.ts`.

- **A DEVICE SIGNS IN, OR SIGNS UP, WITH EMAIL + PASSWORD, and gets the same
  device credential** (owner decision, the Obsidian model, reversing the
  browser-approved pairing line). `POST /v1/device/login` verifies the password
  through Better Auth, mints the device credential and deletes the session the
  sign-in created, so a device holds exactly one secret. That secret also lists
  and revokes the account's devices (`GET /v1/device/list` and
  `POST /v1/device/revoke` take a session or a live device credential of the
  same account, the `igd_` prefix deciding which), so any signed-in Mac's
  Settings › Account removes a lost phone with no password asked, as a sign-out
  asks none; the web's devices page stays as the fallback. A Mac's own row
  offers no Revoke and `cloud.revokeDevice` refuses its own id: this device
  leaves through a sign-out, which also forgets its queue. The login route is
  throttled per caller address, because a login route with no throttle is a
  password oracle. Rejected: the browser approve page, the one-time code, PKCE
  and the loopback callback, a ceremony whose point was keeping the password out
  of the app. Residual: the password passes through the app once over HTTPS. No
  social providers: a login that must work inside the app can only be a
  password. A device can also CREATE the account (owner decision: sign up in the
  app, with the invite code): `POST /v1/device/sign-up` answers the same
  credential and deletes the session the sign-up created, so a person never
  signs in twice in a row. The site's sign-up page stays, the phone stays
  sign-in only, and the CLI has no sign-up verb, since creating an account is a
  person's act. `@repo/contract/cloud/device/login-flow.ts`,
  `apps/web/src/worker/device/login.ts`,
  `apps/web/src/worker/device/sign-up.ts`,
  `apps/web/src/worker/device/routes.ts`,
  `apps/desktop/src/renderer/app/account-form.tsx`,
  `apps/desktop/src/renderer/app/settings/account-section.tsx`.

- **A CREDENTIAL THIS DEVICE DROPS IS REVOKED BY THIS DEVICE, best-effort and
  never waited on.** Forgetting the file alone leaves the row active, and the
  twenty-device cap counts active rows, so repeated sign-ins would lock the
  account out. `POST /v1/device/sign-out` is the dashboard's revoke asked with
  the device's own credential. A sign-out (Settings or the rail; the CLI has no
  logout verb), a login that replaces a live credential, and the phone's
  credential drop send it on a client of their own, since closing the session
  aborts its client's requests, and clear local state without waiting: an
  unreachable cloud must not hold a sign-out open. A revoke the cloud did not
  take is said on the desktop's signed-out status (`revokeError`) until the
  next login or restart; one refused as unauthorized says nothing, since that
  credential is already dead. `apps/web/src/worker/device/routes.ts`,
  `apps/cli/src/server/cloud/sync-runtime.ts`,
  `apps/mobile/src/sync/sync-runtime.ts`,
  `packages/contract/src/cloud/device/login-flow.ts`.

- **AN ACCOUNT IS DELETED FROM THE APP, THE PASSWORD ASKED AGAIN, THROUGH BETTER
  AUTH'S `deleteUser`** (owner decision: someone who lost their Mac signs in on
  any Mac to delete). The app holds a device credential and no session, so
  `POST /v1/account/delete` takes the credential, spends a per-device window,
  checks the password through `signInEmail` and runs `deleteUser` under the
  session that sign-in minted: its `beforeDelete` order and tombstone stay the
  ONE purge path, where a second purge beside it would drift. The credential
  alone deletes nothing, since whoever holds a stolen one could end the account.
  The local server asks on a client of its own, because the purge revokes this
  very credential first; success forgets the sign-in as a sign-out does, minus
  the revoke, and leaves the local thread log alone. A deletion whose answer
  never came back may have happened, so the server keeps its credential, and a
  retry that meets only that credential's refusal, or finds the session already
  ended by it, is read as the account gone and signs this Mac out; any other
  refusal proves the account is there. No CLI verb: the password is a person's
  to type. `apps/web/src/worker/device/account.ts`,
  `apps/cli/src/server/cloud/sync-runtime.ts`,
  `apps/desktop/src/renderer/app/settings/delete-account-dialog.tsx`.

- **Cloud state names its Durable Object from a VERIFIED credential.** Account
  deletion revokes credentials first, then purges, then writes a tombstone every
  route refuses, because the reorder alone leaves an in-flight request able to
  recreate state. The Worker calls the object by RPC with the verified deviceId
  as an argument, so no forwarded header carries identity; the socket upgrade,
  which only fetch can carry, is the one exception, and its identity lands in
  hibernation tags (`apps/web/src/worker/sync/routes.ts`, `thread-sync-do.ts`).

- **Better Auth's `baseURL` is derived per-request from the request origin, and
  sign-up is invite-gated by a Worker route in front of it.** Every hostname
  reaching this Worker is one the deployment owns, and a fixed fallback would
  mint reset links at the wrong deployment; revisit if a hostname the
  deployment does not control reaches it (`apps/web/src/worker/auth/auth.ts`).
  The gate has two front doors over one atomic claim (`claimInvite` in
  `apps/web/src/worker/auth/invite.ts`): the site's page forwards into the one
  instance with `disableSignUp` off, so the browser keeps Better Auth's cookie;
  the app's (`apps/web/src/worker/device/sign-up.ts`) calls `signUpEmail` on
  that same instance and mints a device credential. Either door releases the
  claim when no account came of it, and both spend one per-address window;
  every other instance carries the flag. `apps/web/README.md` § Auth.

- **The D1 auth schema ships via `drizzle-kit push`; there are no migration
  files.** One deployer and an additive schema; `apps/web/vitest.config.ts`
  derives the test DDL by `drizzle-kit export`. A second deployer or a
  destructive column change is the trigger for migrations. Never flip the
  timestamp mode in place: both modes read the same INTEGER column, so a
  redeploy without `UPDATE <table> SET <col> = <col> * 1000` reads every date as
  1970 and expires every session.

- **Declare D1 uniques as named unique indexes, never `.unique()`**
  (`apps/web/src/worker/db/schema.ts`). Production D1 was pushed by drizzle-kit
  0.31, which spelled every `.unique()` as `CREATE UNIQUE INDEX
  <table>_<column>_unique`. drizzle-kit 1.0 spells it as an inline `UNIQUE`
  constraint and treats the difference as a table recreate: `PRAGMA
  foreign_keys=OFF; CREATE __new; INSERT; DROP; RENAME`. D1 ignores that PRAGMA,
  so the `DROP` cascades through every `ON DELETE CASCADE` child (`session`,
  `account`, `device`), and `push` applies a recreate without asking. With
  `uniqueIndex("<table>_<column>_unique")` in the table's extra config,
  `drizzle-kit push --explain` against a 0.31-shaped database reports no
  changes; refuse any plan that recreates a table.

- **`@repo/contract/cloud` IS THE CLIENT RUNTIME CORE, not only the wire**:
  `bytes.ts`, `device/login-flow.ts`, `sync/sync-session.ts`,
  `sync/socket-link.ts` and `sync/cloud-socket.ts`. The CLI and the phone
  inject only stores, timers and a socket dial (node's `{ headers }`, React
  Native's third argument: `apps/mobile/src/sync/rn-socket-dial.ts`), because a
  security discipline with two spellings is two to audit, and the socket's
  keepalive and reconnect are one too. The core is what BOTH clients run, so
  the CLI-only browser opener sits beside its consumer
  (`apps/cli/src/server/browser-opener.ts`).

- **A /CLOUD CLIENT IGNORES WHAT IT DOES NOT KNOW, and the Worker is held to
  exactly what it declares** (owner decision, reversing "final at birth"). Every
  response schema under `@repo/contract/cloud` strips an undeclared field, and
  an unknown refusal code reads as `internal`, a fault to retry, never a verdict
  on the credential. Strict readers made every additive change a new route and
  turned a stale client's `unauthorized` into `malformed`, so a revoked device
  kept retrying; for the same reason a 5xx, 408 or 429 with no error envelope
  reads as `unreachable`. Requests stay `.strict()`, since only the
  always-newest Worker parses them, and the Worker's tests parse every answer
  through `emitted` (`apps/web/src/worker/__tests__/cloud-helpers.ts`), because
  a stripping client would let a leaked column through. Two things still close
  the wire: 0.4.0 and older parse strictly, and a field that changes what a row
  MEANS reaches only a client whose request declares it. THE CUT BROKE THE WIRE
  ON PURPOSE (owner decision: nobody uses the notes app): the hosted vault's and
  the capture inbox's routes, their two ping frames, three refusal codes and a
  dispatch's note fields are gone, so an install from before it gets not-found
  or a refused request for each. `packages/contract/src/cloud/cloud-client.ts`,
  `packages/contract/src/cloud/cloud-errors.ts`.

- **Say the delivery guarantee you implement.** A dispatch is at-least-once
  delivery to a claimant with exactly-once settlement by the owning claim, so
  the apply must be idempotent on the dispatch id
  (`@repo/contract/cloud/dispatch/dispatch-schema`).

- **The THREAD channel carries thread events alone, and a thread's own facts are
  events on it** (owner decision). A thread with no events never reaches another
  device. A thread states its title, harness and archive as rows on its log
  (`thread/meta`, `thread/archived` in `@repo/domain/provider-event`), and the
  origin note a log written before the cut states still parses; a fact about a
  thread that never made a request stays local, since alone it would arrive as
  an empty action. A stale install skips a type it cannot read, so a new event
  type needs no new route. The Worker keeps no per-thread row beside the log
  (owner decision): the push's `threads` half and the `thread_meta` lane it
  filled are gone, the dispatch inbox carrying what the lane was for, and a
  0.4.0 install's `threads` is still accepted and dropped, since refusing the
  key would refuse its every push. `apps/cli/src/server/threads/service.ts`,
  `packages/contract/src/cloud/sync/sync-schema.ts`.

- **A pulled event lands through the SAME ingest, marked with its origin**
  (`ThreadService.applySyncedEvents`): the thread row takes the log's id,
  nothing is re-enqueued, and a settle does not drain this device's queue. The
  cursor moves inside that transaction, which makes the apply exactly-once. A
  synced row carries its origin `(device, position)` under a unique index,
  since signing in again resets the cursor, and the planner skips every device
  id the install has signed in as (`sync_own_devices`), because each sign-in
  mints a new id and its own rows carry no origin (`@repo/db/own-synced-copies`
  removes copies an older install pulled back). Lifecycle projects over what
  landed, never what arrived. `apps/cli/src/server/cloud/sync-pass.ts`.

- **Only the process that owns a provider may declare it dead.** Crash recovery
  reads the `turn/started` row's provenance and leaves a remote turn alone; a
  fabricated failure would sync back to the machine still doing the work. A
  device that never returns leaves the thread active here.

- **CONVERGENCE MEANS THE SAME SET, NOT THE SAME ORDER.** `events.sequence` is
  an arrival order per device under a UNIQUE(thread, sequence), so no
  renumbering exists. Pinned: both devices hold the same set and each writer's
  turn stays contiguous. Projecting the account log's global `seq` instead is
  the change if a shared interleave is ever needed.

- **A SYNC PASS IS FENCED BY SESSION IDENTITY, not by "is a session live?".**
  Every step re-checks the id after every await, because the dangerous case is
  a different sign-in: an old ack deletes rows a later sign-in queued. `dispose`
  aborts too. The fence is `@repo/contract/cloud/sync/sync-session.ts`.

- **A SYNC PASS IS CAPPED, A CAPPED PASS IS FOLLOWED AT ONCE, AND "SYNCED" MEANS
  EVERY STEP REACHED THE CLOUD AND LEFT NOTHING.** Each step answers where it
  stopped (`SyncOutcome` in `@repo/contract/cloud/sync/sync-session`). The cap
  stays because a teardown waits out the pass in flight; on `more` the next pass
  runs at once, so a backlog drains in one sync. Only a pass whose every step
  caught up stamps `lastSyncedAt`. A throw other than a row the log refuses
  fails the pass with the cursor unmoved, because moving past it would lose the
  row for good. The status reaches the renderer on the bus's
  `sync-status-changed`, so nothing polls it; the socket drops itself after two
  silent keepalives, since a half-open connection neither answers nor closes.
  `apps/cli/src/server/cloud/sync-pass.ts`, `sync-runtime.ts` and
  `packages/contract/src/cloud/sync/cloud-socket.ts`.

- **The outbox stores the bytes it will send, once, at enqueue.** The log calls
  a position replayed with a different body `sync-conflict`; `deviceSeq` is its
  own counter, not `MAX()` over a shrinking queue. A body over the row cap is
  CLIPPED before it is frozen, never dropped, because a dropped `item/completed`
  leaves its item pending on every other device forever:
  `clipThreadEventForSync` (`@repo/contract/cloud/sync/fit-sync-event`) elides
  the middle of the largest texts and never a type, an id, a status or a scope.
  An event the contract still refuses is dropped rather than stranding every
  event behind it, and so is every row a log refusal names; each drop is COUNTED
  in the delete's own transaction (`sync_state.dropped_events`) and shown until
  sign-out, because the last error it raises is cleared by the next good pass
  while the loss is not (`apps/cli/src/server/cloud/outbox.ts`,
  `packages/db/src/sync-outbox.ts`).

- **A PULLED ROW THIS BUILD CANNOT READ IS PULLED AGAIN BY THE NEXT BUILD.** The
  planner moves the cursor past a foreign row its grammar refuses, because the
  rows behind it must still land; the pass records the lowest such row with the
  running build, and a session opened under a different build rewinds to it
  (`takeRewindIfBuildChanged` in `packages/db/src/sync-outbox.ts`, from
  `apps/cli/src/server/cloud/sync-runtime.ts`). Rejected: `meta.schema_version`
  as the trigger, which counts migrations while a new event type ships without
  one, and a table of raw skipped rows, a second store beside the log. The
  phone keeps its threads in its database with the digest of the event grammar
  that parsed them, and a build whose grammar differs pulls from 0, since its
  held events lost what the old grammar did not name; each pulled page is one
  transaction with the cursor, so a cold launch lists the threads offline and
  pulls on from its cursor (`apps/mobile/src/sync/sqlite-sync-store.ts`).

- **ON THE PHONE, THE RUNTIME THAT MOVES A VALUE IS THE ONE THAT NOTIFIES.**
  `SyncRuntime`, the login flow and the dispatch runtime publish stores the
  screens subscribe to, so a poll pass, a revocation, a refused login and where
  a request to a Mac stands are shown; a refused request keeps its words and the
  Mac's reason until dismissed. A sign-in is ONE session: every runtime reads
  under `SyncRuntime`'s, so a revocation any request hears ends the sign-in for
  all, and each checks its fence before recording a refusal, so one heard under
  an earlier sign-in never ends the next
  (`apps/mobile/src/lib/compose-runtime.ts`). Which screens exist is the route
  guard's answer (`Stack.Protected` in `apps/mobile/src/app/_layout.tsx`), never
  a per-screen branch. `apps/mobile/src/sync/sync-runtime.ts`,
  `apps/mobile/src/login/login-store.ts`,
  `apps/mobile/src/dispatch/dispatch-runtime.ts`.

- **THE PHONE HOLDS THE ACCOUNT'S SOCKET ONLY IN THE FOREGROUND, AND A RUNNING
  TURN'S TEXT IS NEVER STORED.** A desktop pushes a running turn every second
  and a half and the cloud pings every other socket on each push, so a phone
  with the socket reads a reply as it grows; the background closes it, since
  iOS suspends the app anyway, and the poll stays for a missed ping. The deltas
  the store drops are folded in memory until each item's `item/completed`
  (`apps/mobile/src/sync/live-turns.ts`), fed only what a page landed, so a
  page pulled twice folds once. Rejected: holding the deltas in the phone's
  database, which a long turn fills with tokens its settled items already
  carry, and folding an item this launch never saw start, which would draw the
  tail as the reply. `apps/mobile/src/sync/sync-runtime.ts`.

- **A PHONE ASKS A MAC THROUGH A CLAIMABLE DISPATCH INBOX, THE REQUEST LANDS
  THROUGH THE MAC'S OWN SEND, AND THE THREAD IS ITS LEDGER** (owner decision).
  The phone never pushes to the log, so a request cannot ride it: a `turn` row
  waits in the account's `ThreadSyncDO`, any Mac may claim
  it and the first claim wins, and it pings the sockets of the Macs that take a
  phone's requests with the `dispatch` frame 0.4.0 already parses. Delivery is
  at-least-once to a claimant and a Mac's apply exactly-once on the dispatch
  id, which the phone mints so a resend is one row
  (`packages/contract/src/cloud/dispatch/dispatch-schema.ts`,
  `apps/web/src/worker/sync/dispatch-inbox.ts`). The Mac hands each claimed row
  to `ThreadService.acceptDispatch`, which runs the send's own decision, so a
  request starts, queues or is refused as a message typed here would. No table
  records a claim: the request row or the queued message carrying the
  `dispatchId` is the ledger (`threadHoldsDispatch` in `@repo/db/events`), so a
  lapsed claim handed over again, or one another Mac ran, acks with no second
  turn. A thread whose turn another device runs is refused, since the request
  would wait on a queue a remote settle never drains; a request this Mac
  cannot run is delivered, and its `provider/error` is what the phone reads. A
  PHONE-STARTED TURN'S APPROVAL is answered on the phone (owner decision): the
  Mac holding its waiter opens it in the inbox, and the phone's `answer` is a
  row only that Mac may claim. Let my phone ask this Mac (Settings › Account,
  `<dataDir>/cloud-prefs.json`, on unless turned off, owner decision) is read
  per pass and said on the socket's upgrade (`SYNC_WS_PHONE_REQUESTS_PARAM`),
  so the phone's "a Mac is listening" counts only Macs that would claim, the
  status counting the open Macs with it off beside them (`desktopsDeclining`),
  so the phone's waiting caption names the switch rather than asking for a Mac
  to be opened. Rejected: the `thread_meta` lane, which
  carried no message and no claim, so two Macs would both run it, and which
  every desktop push overwrote; and the phone as a log pusher, which would give
  it an outbox and a `deviceSeq` of its own.
  `apps/cli/src/server/cloud/dispatches.ts`,
  `apps/cli/src/server/cloud/sync-pass.ts`,
  `apps/cli/src/server/threads/service.ts`.

- **A PR PREVIEW IS A WORKER PREVIEW DRIVEN BY ACTIONS, not Workers Builds**,
  and it binds preview-only resources. Workers Builds would deploy on push and
  could not wait for CI or keep Deploy's environment gate, so previews ride
  `workflow_run` after CI like Deploy does (which also keeps them out of the
  CI-parity sweep), limited to this repo's branches because that trigger holds
  secrets. A preview inherits no binding, so `apps/web/cloudflare.config.ts`
  binds each, when `isPreview`, against `inteligir-auth-preview`; pointing a
  preview at the production D1 was rejected, since PR code would write real
  accounts. The status is one sticky comment plus a GitHub deployment on the
  head commit (`.github/scripts/worker-preview.mjs`), created by the script
  because a job's `environment:` under `workflow_run` records the default
  branch. `.github/workflows/preview.yml`, `apps/web/README.md` § Previews.

- **THE HOSTED VAULT'S DURABLE OBJECTS ARE DECLARED DELETED, AND A DEPLOY
  ERASES THEM** (owner decision: delete outright, no sunset date). Its classes,
  `RepoCell` and `Registry`, stay in `apps/web/cloudflare.config.ts` as
  `state: "deleted"` exports, the migration that removes a namespace and every
  object's storage with it; the rows go once a deploy has run with them, as
  the earlier tombstones did. Nothing binds the R2 buckets that held the
  packs, which keep their bytes until the owner deletes them by hand. The
  account's `ThreadSyncDO` drops the capture inbox's table on wake, beside the
  `thread_meta` lane before it
  (`apps/web/src/worker/sync/thread-sync-do.ts`).

### Server process and the desktop shell

- **ONE BINARY, TWO MODES: `inteligir serve` IS the server, and `npx` is a
  verb** (reversing the launcher-boots-in-process line).
  `npx inteligir serve --open` is the developer's and the agent's zero-install
  path, with one exit code; a user installs the signed dmg and never meets it.
  The desktop shell is Rust, so the server is its one child, on the node the
  .app carries, supervised with the deliberate absence of a restart, since a
  fresh child mints a session the window's cookie does not hold. A quit sends
  SIGTERM and waits the teardown budget the child announced before SIGKILL,
  inside `RunEvent::Exit`, since Cmd+Q leaves no later step to wait in; the
  child holds a pipe the shell never writes, so a shell that crashes or is
  killed closes it and the server shuts down rather than hold the data dir, and
  runs in a process group of its own, so a signal to the shell's group reaches
  the server once, through the shell, since a second one skips the flush
  (`apps/desktop/src-tauri/src/server.rs`, the `lifeline` `runServe` watches
  once its signals are, in `apps/cli/src/server/serve.ts`). Whether
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
  booted suites call the same composition. `ThreadService.boot()` is called
  from it because crash recovery writes. The seams: `cloud/sync-pass` /
  `sync-cadence` (the socket link is the client core's, shared with the phone);
  `threads/turn-driver`, the one shape every turn runs through;
  `writeTransaction` in `@repo/db/connection` as the one spelling of
  `BEGIN IMMEDIATE`. `serve.ts` injects node's socket dial and the agent driver
  because compose is reachable from the renderer's test program.
  `dev-instance.ts` owns the per-checkout derivation; `config.ts` stays the
  parser.

- **THE BIN EXITS 128+n WHEN THE SERVER DIES BY SIGNAL, NEVER 0**
  (`apps/cli/bin/inteligir`). Re-raising the signal at the wrapper exited 0.

- **THE CREDENTIAL IS A FILE, NOT A CHALLENGE** (reversing the
  loopback-adoption-is-earned line). The server writes `<dataDir>/server.json`
  at 0600 and removes it on ordered shutdown; every caller reads it and sends
  the bearer. No port scan and no challenge: the address is the row's, never a
  guess, and whether its owner still serves is one authenticated status call
  (`server-probe.ts`). The bound is the honest one: it proves the caller can
  read the data dir, not that it is this code. A BROWSER CANNOT SEND A HEADER,
  so it holds its own per-boot secret in an HttpOnly SameSite=Strict cookie,
  set only by trading a single-use handoff nonce a bearer holder minted
  (`system.browserHandoff`), and the desktop window is such a browser (THE APP
  WINDOW IS THE SERVER'S OWN PAGE, below); a request with neither gets a 401
  page that runs nothing and names the ways in, never the workspace, which
  would fail every call with nothing saying why
  (`apps/desktop/src/renderer/app/signed-out-state.ts`).
  The cookie, being ambient, must also prove same-origin, because loopback
  "site" ignores the port, and EVERY REQUEST MUST NAME 127.0.0.1 OR localhost
  AS ITS HOST, so a rebinding page gets nothing. Residual: a cookie is
  port-agnostic, which is why it is not the bearer and dies with the boot.
  `apps/cli/src/server/server-file.ts`, `browser-session.ts`,
  `browser-request.ts` and the guard in `app.ts`.

- **Shutdown is ORDERED, per-step TIME-BOXED, and its exit code is the truth.**
  The listener stops, the sync client and the agent driver wind down, handles
  close; each step has its own budget because one wedged step under a single
  budget starves the rest. The
  listener step closes websockets by name (`wss.clients`), because an upgraded
  socket is detached from the HTTP server's tracking and one open tab can stall
  the teardown. The step list is re-read before every step, so a boot still
  composing when the signal lands adds what it brings up.
  `apps/cli/src/server/shutdown.ts` and `listen.ts`.

- **THE CSP IS STATIC, and deleting TanStack Start from the product bought
  that** (reversing the nonce CSP). A plain Vite SPA injects no inline script,
  so `script-src` is `'self'` and one fixed header serves every page the
  server answers, the desktop window's included; `connect-src` earns the most,
  since a script that cannot reach a third-party origin cannot exfiltrate the
  thread log (`apps/cli/src/server/csp.ts`). The shell's own config
  (`apps/desktop/src-tauri/tauri.conf.json`) carries a policy for a page it
  would serve itself, held to the server's for a page with no socket, plus
  Tauri's IPC origins, by `tools/repo-guards/src/desktop-shell-wire.test.ts`.
  `pnpm dev` stamps no CSP.

- **THE APP WINDOW IS THE SERVER'S OWN PAGE, AND HOLDS NO BEARER** (#889,
  reversing the `inteligir://` protocol door: a WKWebView scheme handler can
  neither carry the socket's upgrade nor stream a body). The shell opens the
  window on the one-time handoff link the server announces, so the page signs in
  as a browser tab does (THE CREDENTIAL IS A FILE) and is same-origin with
  `/rpc` and `/ws`, with no CORS and no token in the page. The window is pinned
  to that origin, compared by its parts, never by prefix or `Url::origin`, which
  answers an opaque origin for a non-special scheme: any other web page opens in
  the browser, at most once a second since WebKit says nothing of the click
  behind a navigation, anything else is refused, `window.open` opens no window,
  and every permission is denied (`apps/desktop/src-tauri/src/navigation.rs`,
  `window.rs`). The window keeps a web store keyed by its data dir, because
  every data dir's server answers on one port and the page's prefs are the
  origin's; that needs macOS 14, below which every data dir shares one.
  Rejected: a Rust proxy on a custom scheme and a socket relay over IPC, which
  rebuild in a second language what the browser path already is. THE BRIDGE
  CARRIES ONLY WHAT THE SHELL OWNS (the updater and the diagnostics), because no
  server can answer for either. Each command is one row of
  `apps/desktop/src/ipc-contract.ts`, parsed by zod in the page
  (`apps/desktop/src/renderer/shell-commands.ts`) and by serde in the shell
  (`apps/desktop/src-tauri/src/commands.rs`), and granted at runtime to that
  window on the server's exact origin alone (`grant_app_window`), and
  `removeUnusedCommands` drops every command no capability names.
  `tools/repo-guards/src/desktop-shell-wire.test.ts` holds the names equal
  across the two languages, which no compiler sees together. A refusal crosses
  as a value (`{ ok: false, reason }`), never a rejection, which the page reads
  as a fault. Residual: the page holds the per-boot cookie (HttpOnly,
  SameSite=Strict, dead with the boot), and Tauri's IPC from the server's origin
  falls back to `postMessage` under its CSP, at the cost of one console line.

- **UPDATES ARE TAURI'S UPDATER OVER THE GITHUB RELEASE, and nothing moves
  without a click** (reversing "no update feed"; electron-updater until #889).
  The release carries the dmg, `Inteligir.app.tar.gz` with its minisign
  signature and `latest.json`, written by the pack
  (`apps/desktop/scripts/package.mjs`) and uploaded by the owner's release step
  (`docs/releasing.md`); the signing key is the owner's release secret, and a
  pack without it makes no feed. A check 15s after launch and every 4 minutes,
  the download and the restart each a click. Install stops the server child
  first, so its ordered teardown runs before the bundle is replaced.
  The same release still carries electron-updater's zip and `latest-mac.yml`,
  so an Electron install updates into the Tauri app, which keeps the bundle id
  and the Developer ID that Squirrel's designated-requirement check needs; the
  manifest names node 24's floor, macOS 13.5, as the Darwin release
  electron-updater compares, so an older Mac is offered nothing it cannot
  open. Drop the pair once no supported install runs Electron.
  `apps/desktop/src-tauri/src/updater.rs` (the policy) over `update_state.rs`
  (a union by status, which `apps/desktop/src/update-state.ts` parses from the
  `update-state` event).

- **SPELL CHECK IS THE PAGE'S ATTRIBUTE** (#889, reversing the session's
  switch, which WKWebView has no counterpart for). The choice is a page pref
  like the theme, set as `spellcheck` on the document root before the first
  paint and inherited by every field; macOS picks the languages, so the row
  names none (`apps/desktop/src/renderer/app/spellcheck.ts`).

- **THE SHELL ASKS THE LOGIN SHELL FOR PATH BEFORE THE FIRST CHILD.** A Finder
  or Dock launch inherits launchd's bare PATH, and the rebuild's server finds
  the user's own tmux and agent binaries by name, and hands that PATH to the
  agents it starts. A packaged launch runs `$SHELL -ilc` once,
  capped at 5s, through the desktop door's `launch`, and prepends its PATH to
  the shell's own for every node child after it: the server and each door
  question. Rejected: a fixed list of bin dirs alone, and an `LSEnvironment`
  PATH in the bundle, since neither can know a version manager's directory.
  `apps/cli/src/desktop/login-shell-path.ts`.

- **NODE SHIPS BESIDE THE SHELL, SIGNED, AND THE SHELL HANDS IT NO CODE-LOADING
  ENVIRONMENT** (#889, reversing the fuses and their "Rejected: a bundled node
  binary"). The Tauri binary runs no JavaScript, so the server runs on the
  official darwin-arm64 node, a `bundle.externalBin` sidecar fetched against a
  pinned sha-256 (`apps/desktop/scripts/fetch-node.mjs`), with the CLI and its
  production `node_modules` as a resource
  (`apps/desktop/scripts/stage-server.mjs`); the server forks its children with
  `child_process`, as under `npx`. Every Mach-O in the resources is signed with
  the hardened runtime and the one entitlements file before bundling
  (`apps/desktop/scripts/sign-resources.mjs`). The shell finds node and the CLI
  only where its bundle carries them, never through a variable, and starts every
  node child with `NODE_OPTIONS` and every other `NODE_*` but `NODE_ENV` removed
  (`scrubbed_env` in `apps/desktop/src-tauri/src/runtime.rs`), so an
  `open --env` runs no code inside a process TCC counts as Inteligir: the job
  two fuses did. Rejected: `bun build --compile`, under which better-sqlite3
  does not load, and Node's single-executable apps, whose blob holds no native
  addon and no split ESM entry. Residual: that node is a signed interpreter any
  local process can run, as the `runAsNode` fuse had ruled out for the Electron
  binary; it carries the JIT entitlements and no other grant.

- **DIAGNOSTICS ARE `INTELIGIR_DEBUG`'S NAMED TRACES, SHIPPED IN EVERY BUILD,
  AND IN THE PACKAGED APP A SWITCH AND A FILE, BOTH THE SHELL'S.** The sync
  pass drops, skips and fences without a trace, and a user's "it didn't
  update" cannot wait for a build; `sync` is the one namespace today, and the
  observer and the tmux layer add theirs. So each
  decision calls its namespace's log, `undefined` while the namespace is off,
  so an untraced site costs one read. A line names ids and verdicts, never a
  message's content or a credential, because it is written to be pasted into
  a report. An unknown name is refused
  at boot, since a misspelt one reads as "nothing happened". A levelled logger
  was rejected: the value is these few decisions, not more volume
  (`apps/cli/src/server/debug-log.ts`, `tools/e2e/src/scenarios/debug-log.ts`).
  A Finder-launched app has no env and drops the shell's stdout, so debug
  logging is Settings › Advanced's switch, kept as `diagnostics.json` in the
  shell's own folder (Electron's userData, kept so an upgrade keeps the choice)
  because the shell reads it before the start it changes (the page's prefs load
  after that start, and config.json is the app's to read, never to write); on,
  the next child traces every namespace, since a report cannot know which
  decision went wrong, so a change asks for a Restart through the ordinary
  quit. Whatever the child prints is appended to `<dataDir>/logs/server.log`,
  rotated at 5 MiB, beside the shell's note of each window it loads, and a
  write that fails costs the log, never the shell; the server writing its own
  file was rejected, since a crash before its logger is up is the line a
  report most needs. An adopted server is nobody's child here, so the switch
  and the Restart are refused and say why.
  `apps/desktop/src-tauri/src/diagnostics.rs`, `server_log.rs`,
  `tools/e2e/src/scenarios/desktop-diagnostics.ts`.

- **THE RELEASE NOTES ARE THE CHANGELOG, WRITTEN FOR THE PERSON USING THE
  APP.** A release's GitHub body is `CHANGELOG.md`'s top section, so the
  release, the update it ships and the file say one thing. A list generated
  from commit subjects or issue titles was rejected: both are written for
  whoever builds the thing, and they describe an update as "something
  changed". `apps/desktop/scripts/release-notes.mjs` prints the section as the
  release's notes (`docs/releasing.md`) and refuses one not titled for the
  package's version; `tools/repo-guards/src/changelog.test.ts` holds the file's
  shape. Settings › About links the file on main
  (`apps/desktop/src/renderer/app/settings/version-row.tsx`).

### Desktop workspace surfaces

- **WINDOW-LEVEL HOSTS MOUNT AT THE ROOT ROUTE.** `ConfirmDialogHost`, `Toaster`
  and the one `TooltipProvider` live in
  `apps/desktop/src/renderer/routes/__root.tsx`; a host mounted by one route
  leaves another route's `confirm()` parked on a dialog that never opens.

- **THE RAIL IS FLUID'S SIDEBAR ANATOMY, AND AMBIENT STATE LIVES IN ITS
  FOOTER.** Header (the app's name, and Search, which opens the palette), one
  group of the recent actions drawn by `SidebarMenu` rows
  (`@repo/ui/components/sidebar-menu`), and a footer. The footer holds the
  sync state, the agent's spinner and Settings, because a strip across the
  whole window was a second bar under a rail that already had a bottom; its
  account row runs the one `useCloudSession` (`app/cloud-session.ts`) Settings
  › Account runs too, and offers Sync now. Under the macOS shell the rail
  reserves the traffic-light corner
  (`apps/desktop/src/renderer/app/title-bar.ts`).
  `apps/desktop/src/renderer/app/sidebar/sidebar.tsx`.

- **THERE IS ONE SEARCH SURFACE, AND IT IS ⌘P.** The palette lists every
  command and every action in one field. There is no rail search field: two
  ways to type one question is a second set of rows for it. The rail's Search
  button's tooltip spells ⌘P from the table (`app/global-shortcuts.ts`), never
  as a literal.

- **THE PANEL STARTS CLOSED, IS FLAT-TABBED, AND IS DRAGGED LIKE THE RAIL.**
  `panelOpen` defaults off, and every entry that shows a thread in it opens it
  through one `openThread` (`app/workspace.tsx`), because an entry that only
  picks its thread shows nothing in a closed panel. Its tabs are the
  flat underline row of `@repo/ui/components/tabs`. Its width persists through
  the rail's own Fluid resize handle (`panelWidth` beside `sidebarWidth` in
  `app/prefs.ts`), because a second resize mechanism would be a second answer
  to one drag, and is reported once a drag lets go, never per frame. Closed, a
  sidebar is slid off-screen rather than unmounted, so it is `inert`
  (`SidebarPanel` in `packages/ui/src/components/sidebar-core.tsx`): otherwise
  its controls answer Tab and share their names with the surface that is open.

- **THE PALETTE IS FLUID'S COMMAND MENU, AND IT HAS NO PRIMITIVE UNDER IT**
  (reversing the cmdk line; the dependency is gone). The field keeps DOM focus
  and names the highlighted row through `aria-activedescendant`, and the
  highlight is the one proximity pill every other popup draws; cmdk's filter was
  already off on every page, and its keyboard beside the pill was two answers to
  "which row is live?". ROWS ARE CHILDREN, NOT DATA, diverging from Fluid's
  `items` array deliberately: several row shapes in a data array would be a
  second answer to what a row is. The panel KEEPS the top edge a panel at its
  cap height would have, so the field never moves as rows filter down. A chord
  draws one box per key from the one modifier table
  (`@repo/ui/lib/hotkey-spelling`). ONE DIALOG FOR EVERY PAGE, so a page switch
  never re-animates the backdrop; a page is a union member, so a page cannot
  exist without what it needs to draw. `packages/ui/src/components/command.tsx`,
  `apps/desktop/src/renderer/app/palette/command-palette.tsx` and
  `apps/desktop/src/renderer/app/palette/palette-page.tsx`.

- **THE BUS IS APPLIED ONCE PER FRAME, AND A KIND REFETCHES ONLY WHAT IT
  MOVES.** `ChangeBatch` folds every ws frame since the last animation frame
  and flushes once. Thread kinds are weighed in total tables
  (`MOVES_THE_LIST`, `MOVES_THE_DETAIL`, `MOVES_THE_TIMELINE`), so a streamed
  turn never refetches the thread list. A reconnect sweeps every family the bus
  reaches, which is why no window-focus re-walk backs it up.
  `apps/desktop/src/renderer/app/workspace-context.tsx` and
  `apps/desktop/src/renderer/app/__tests__/changed-message.test.ts`.

- **SETTINGS COVERS A WORKSPACE THAT STAYS MOUNTED** (owner decision). Settings
  is a layer over the workspace in the pathless `_workspace` layout, not a
  sibling route, which unmounted the composer and what it held. Covered, the
  workspace is `inert` and its `GLOBAL_SHORTCUTS` listener detached, since inert
  does not stop a window listener.
  `apps/desktop/src/renderer/routes/_workspace.tsx`,
  `apps/desktop/src/renderer/app/__tests__/workspace-runtime-mount.test.tsx` and
  `apps/desktop/src/renderer/app/__tests__/workspace-routing.booted.test.tsx`.

- **A PAGE PREFERENCE IS A ROW.** What the window remembers across a reload is
  one `PREFS` row (key, a zod schema that decodes the stored string and
  encodes the value back, fallback), read and written only through
  `readPref` / `writePref` / `usePref`, so a key's reader and its writer cannot
  disagree on its bytes, and bytes a row cannot decode read as its fallback
  (`apps/desktop/src/renderer/app/prefs.ts`). One table shared with the data
  dir was rejected: no preference is read by both programs, a data-dir
  preference reaches the page through its `@repo/contract/local` contract, and
  a data-dir file's shape must stay readable, so it is not derived from a
  contract that may break freely. Labels and layout stay out of the rows,
  because Settings is laid out by hand. A keyed storage read outside the table
  fails `tools/repo-guards/src/page-prefs.test.ts`.

- **AN ICON BESIDE A LABEL IS A SIBLING OF THE LABEL, NEVER INSIDE IT.**
  `Button` trims its text with `text-box`, which only a block container
  honours, so an inline svg inside the label's span is pushed above it.
  `labelChildren` (`packages/ui/src/components/button.tsx`) lifts every element
  child out beside the trimmed text, however the icon was passed; "which
  children are text" is spelled once, in `@repo/ui/lib/text-children`.

- **EVERY FLOATING SURFACE IS A BASE UI PRIMITIVE THROUGH `@repo/ui`, never a
  hand-positioned div**, which owns no dismissal, flipping, layering or focus
  and drifts on scroll. Base UI is reached only through `@repo/ui`, and a
  missing primitive is added there first, with a gallery demo. The ⌘K composer
  is a non-modal `Dialog` over the workspace's centre column
  (`apps/desktop/src/renderer/app/actions/action-composer.tsx`).

- **THE CHROME HAS FIVE TYPE ROLES, AND THEY ARE FLUID'S LADDER.** caption 11,
  body 12, subtitle 13, title 15, display 24 — the compact column of
  `typeScale` (`packages/ui/src/lib/size-context.tsx`), drawn as the
  `text-caption | body | subtitle | title | display` utilities in
  `packages/ui/src/styles/globals.css`, whose numbers
  `lib/__tests__/type-scale.test.ts` derives from the map. No `text-sm`,
  `text-xs` or px/rem literal in the chrome, because a role says what a line
  IS and a scale held by convention drifts:
  `tools/repo-guards/src/type-roles.test.ts` holds it, `packages/ui/src/ai`
  included less `AWAITING_CONSUMER` (owner decision); a fixed size a surface
  must draw is a reasoned `PROSE_SIZES` row in that guard. THE MERGE ENGINE HAS
  TO BE TOLD THEY ARE SIZES: an unknown value after `text-` reads as a colour,
  so `cn("text-body", "text-muted-foreground")` drops the size. `cn` is
  configured once (`packages/ui/src/lib/cn.ts`) and imported from there,
  reversing the drop-the-pass-through cleanup: a second, unconfigured `cn`
  would be the bug again.

- **A BINDING IS SPELLED FROM THE TABLE ITS LISTENER READS, never as a
  literal.** `GLOBAL_SHORTCUTS`
  (`apps/desktop/src/renderer/app/global-shortcuts.ts`) owns every chord the
  window listens for, and every label is derived from its rows through
  `@repo/ui/lib/hotkey-spelling`, so a rebinding leaves no stale label. A row
  claims shift explicitly, so an unshifted row never fires on a shifted chord.
  The rail's `[` and the panel's `]` are BARE rows, answering only with focus
  outside a field, since a bare key is a character wherever text is typed.

- **A POPUP'S MOTION RIDES ITS POPUP ELEMENT, AND REDUCED MOTION IS ONE
  POLICY.** Base UI unmounts a closing popup once the Popup element's own
  animations finish, so a framer popup renders its Popup as the motion element,
  with no `actionsRef` hold or fallback timer, each exit wrapped in `PopupExit`
  (`packages/ui/src/lib/popup-exit.tsx`). Reduced motion is `MotionPolicy`
  (`packages/ui/src/lib/motion-policy.tsx`) at each app root, and tw-animate's
  classes collapse to 1ms in `packages/ui/src/styles/globals.css`, so no class
  carries a `motion-reduce:` suffix.

### Repo guards, vendoring and tooling

- **No coverage tooling, on purpose, and a structural guard states its own
  rule.** Targeted structural invariants instead: the dependency DAG and
  platform rules, ws change-kind reachability (`tools/repo-guards`), route-table
  completeness (`apps/cli/src/server/__tests__/http-surface.test.ts`),
  migration↔schema agreement
  (`packages/db/src/__tests__/schema-agreement.test.ts`), the per-export orphan
  guard and the type-role guard over `@repo/ui`, the CLI's `--json` flags. If
  coverage is ever added, `coverage.include` is mandatory in Vitest 4, and gate
  only the pure packages (`@repo/domain`, `@repo/contract`). A guard states its
  own rule in the failure, names the file, and derives every value it can; what
  it cannot is a row carrying its reason (`AWAITING_CONSUMER`,
  `CLOUD_ONLY_CLIENTS`, `DECLARED_CI_EXTRAS`, `EXCLUDED_COMMANDS`,
  `PROSE_SIZES`), and `dep-dag.test.ts`'s `DECLARED_EDGES` is the pin itself.

- **VENDORED CODE IS THIS REPO'S CODE, except for the attribution.** Rename,
  restructure and delete freely; "the next re-pull becomes a conflict" is not a
  reason. Every vendored file keeps its `// Vendored from X, MIT.` header (a
  port says `Ported from X, <licence>. Changed: …`) and the licence texts live
  under `tools/licenses`, staged into the artifact as
  `dist/licenses`, with `pnpm smoke:cli` deriving the expected set from the
  directory. The licences shipped elsewhere are the .app's own, since only the
  .app carries what they cover: the bundled node's beside it, and
  the notices of every Rust crate the shell links, written at package time from
  cargo's resolve (`apps/desktop/scripts/rust-notices.mjs`) and checked by the
  smoke. `packages/ui/components.json`
  declares `rsc: true` and it is inert: every consumer is a plain Vite build.

- **THE ORPHAN GUARD OVER `@repo/ui` IS PER EXPORT**: every named export under
  the wildcard-exported directories needs a consumer outside the gallery or a
  reasoned allowance row (`tools/repo-guards/src/ui-orphan-exports.test.ts` says
  why neither a file guard nor knip can ask this). Base UI's `render` prop is
  the polymorphism channel; there is no Slot.

- **A ROW DOES NOT ANSWER FOR ITS OWN POSITION; ITS CONTAINER DOES.** A
  conditional row changes where its siblings sit without re-rendering them, so
  a row deriving its index from the DOM needs an effect with no dependency
  array, and that rule suppression makes the compiler skip the whole
  component. The list keeps the set and reads document order itself, through
  one registry (`useRowOrder` in `packages/ui/src/hooks/use-row-order.ts`),
  syncing once per commit in the layout phase: a sync per row mounts a
  thousand-row tree in tens of seconds, and a microtask can render a frame
  late with the pills at the old rects. The lit row rides a store, so a hover
  step re-renders two rows, not the list
  (`packages/ui/src/components/__tests__/row-registry.test.tsx`).
  `react/rule-suppression` refuses a new `exhaustive-deps` or `rules-of-hooks`
  suppression, the ones the compiler bails on.

- **THE REACT COMPILER IS ON FOR EVERY BUNDLE**: `compiler: true` on
  `@vitejs/plugin-react` in the desktop's and the web's vite configs, and
  `reactCompiler: true` in `apps/mobile/app.config.js`. The suites run what
  ships: the desktop's and `@repo/ui`'s DOM tests compile their sources the
  same way (test files excluded, because a fixture hook minted in a factory is
  hoisted with no diagnostic), and a `compiled-under-test` suite in each fails
  when the plugin goes. A node suite, and the desktop's booted ones, cannot run
  compiled: the plugin skips the ssr transform. The manual-memo sweep is #820.

- **TOOLING PINS, each with its reason beside it**: `vite` is a pnpm override
  because the catalog bound only the manifests that spell it; `@types/node`
  tracks `engines.node`; `compatibility_date` is the lockfile's oldest workerd,
  held by `tools/repo-guards/src/workerd-compat-date.test.ts`; `pnpm e2e` boots
  the built Worker bundle (`tools/e2e/src/scenarios/built-worker-boot.ts`), the
  built CLI bundle (`tools/e2e/src/scenarios/built-cli-boot.ts`) and the built
  desktop shell (`tools/e2e/src/scenarios/desktop-shell.ts`); agent-browser and
  tauri-driver are pinned by hand in `.github/workflows/ci.yml` because a global
  install rides no lockfile, and the Rust toolchain by
  `apps/desktop/rust-toolchain.toml`, beside the `Cargo.lock` every cargo step
  runs `--locked` against. The arguments are `pnpm-workspace.yaml`'s comments.
  AN UPDATE SWEEP SKIPS THE EXPO SDK'S NAMES, NOT ITS `expo:` CATALOG:
  `update.ignoreDeps` holds `expo`, `expo-*`, `@expo/*`, `react-native`,
  `react-native-*` and `@react-native/*` under `pnpm up --latest -r`. It matches
  by name, so `react` and `typescript`, which web shares, cannot be listed
  without freezing web too: after a sweep, revert the `expo:` catalog rows by
  hand, then `npx expo install --check` in `apps/mobile`. An SDK upgrade moves
  all of them together.

- **A TURBO CACHE KEY NAMES EVERYTHING ITS OUTPUT READS**, because a hit
  replays the output with no error, and the e2e suite and `package:*` ship what
  it replays. Another workspace's files enter a key only through a `^` edge
  (`tools/repo-guards/src/turbo-cache-keys.test.ts`); the desktop build takes
  `^topo`, since `^build` would cycle through the CLI build that stages its
  renderer (`apps/desktop/turbo.json`). A file in no workspace is a named input
  (`apps/cli/turbo.json`), which the same guard holds for a bundled import
  (`/privacy` renders `docs/privacy.md`); a followed file is a named output
  (`apps/web/turbo.json`), and `NODE_ENV` is hashed, not passed through: vite
  emits React's dev build under `development`.

- **A DESKTOP TEST THAT LOGS A console.error FAILS.** React reports a setState
  during another component's render, a missing key or an update outside `act`
  as a console.error and nothing else, so a suite that only logs it stays green
  over a real defect
  (`apps/desktop/src/renderer/app/__tests__/console-error-gate.ts`). A test
  that provokes one on purpose silences it with its own spy. The booted suites
  are not gated: the server they boot logs every refused call by design.

- **THE SHELL'S GLUE RUNS IN E2E OVER WEBDRIVER, AND ITS WIRE IS A GUARD.** The
  shell's policies are pure and unit-tested (`cargo test`, and the CLI's desktop
  door under vitest); what joins them (the window's sign-in, the pin, every
  command, the quit) is `tools/e2e/src/scenarios/desktop-shell.ts`, with
  `desktop-diagnostics.ts`: the built shell on Linux, driven through
  `tauri-driver` and WebKitGTK's WebDriver
  (`tools/e2e/src/harness/webdriver.ts`), which also gives the renderer its one
  WebKit run. Not the packaged `.app`: packing is minutes, and the bundle, the
  signatures and the sidecar stay `pnpm smoke:desktop`'s, on the macOS job. The
  static half is `tools/repo-guards/src/desktop-shell-wire.test.ts` (THE APP
  WINDOW IS THE SERVER'S OWN PAGE).

- **NO TYPE ASSERTION, AND NO ESCAPE COMMENT** (owner decision).
  `typescript/consistent-type-assertions` at `assertionStyle: "never"` refuses
  every `as T` and `<T>x`, tests included; `as const` and `satisfies` stay
  legal. anti-slop's `require-safety-comment-for-type-assertion` is off: it
  admitted a cast behind a `// SAFETY:` comment, so a green lint read as
  permission; documenting that escape was the rejected alternative. A
  library's wide type is narrowed by its own guard or parsed by the schema
  that names it. `oxlint.config.ts`.

- **A CLIENT VERB LOADS THE CLIENT, AND THE BUILD REFUSES A STATIC IMPORT PAST
  IT.** The CLI bundle splits on dynamic imports, so what every verb parses
  before it reads argv is the entry's static closure; the server (hono, drizzle)
  sits behind `await import()` in `serve`. A static import that reaches it
  passes every test and every review, so `apps/cli/scripts/build.mjs` walks the
  metafile's static closure and fails naming the importer
  (`LOADED_ON_EVERY_VERB_REFUSED`).

- **THE PHONE SHIPS THROUGH EAS TO TESTFLIGHT, AND AN UNSET CLOUD URL IS THE
  PRODUCTION ORIGIN ON BOTH CLIENTS.** `pnpm testflight:mobile` builds on EAS
  and submits, iPhone only (owner decision); the signing credentials live on
  EAS, never in the repo, and build numbers are EAS's
  (`appVersionSource: remote` in `apps/mobile/eas.json`), so no commit bumps
  one. The marketing version is `apps/mobile/package.json`'s, one product
  version with the CLI and the desktop, and EAS builds with the repo's node and
  pnpm (`tools/repo-guards/src/release-versions.test.ts`). A JS-only fix is an
  EAS Update to builds of the same native fingerprint, a native change a new
  build (owner decision). `PRODUCTION_CLOUD_ORIGIN`
  (`@repo/contract/cloud/origin`) is the one spelling the CLI's config and the
  phone's `getCloudUrl` fall back to; the phone reads `EXPO_PUBLIC_CLOUD_URL` at
  bundle time and refuses a malformed one. Rejected: per-profile env in
  `eas.json`, a second spelling of the origin, and a fallback to a dead host,
  which made a misconfigured build one that could only fail.
  `apps/mobile/src/__tests__/app-config.test.ts` holds the store config to what
  App Store Connect judges.

**Before raising a "new" finding about code that remains, read
[#542](https://github.com/kyh/inteligir/issues/542)**: the notes product's
decision record carries what was rejected as well as what was chosen, and its
reasons still bind the code the rebuild kept. The `note` issues are
the declines register: #877 (0.6's settled non-work), #881 (the 0.6 landed
review's refuted findings), #788 (the 2026-09-22 architecture review's refuted
findings), #645 (the 2026-09-01 review), #674
(the 2026-09-05 simplify pass), #603 (Moss parity) and #705 (the CodeMirror
trade); the older ones (#446, #453, #472, #474) catalogue findings declined
against the hosted Durable-Object architecture this rewrite replaced.
