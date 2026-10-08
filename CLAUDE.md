# Agent Instructions

## Project Overview

**inteligir** is Obsidian where an agent edits your notes with you. It is for
general knowledge workers, not developers: a small invited cohort, on macOS
Apple silicon only. The vault is a folder of markdown files on the user's own
disk; one local Node process owns that vault, indexes it, answers one API, and
drives the agent that edits those same files. The only hosted piece is a
Cloudflare Worker carrying the marketing site, accounts, cross-device sync, the
capture inbox, the dispatch inbox a phone asks a Mac through, and the account's
hosted vault.

The premises every change builds from, each with its reason:

- **The agent runs on the user's own Claude or ChatGPT plan, on their Mac,**
  through the runtimes bundled inside the .app, because the owner never pays
  for model usage and a knowledge worker has no agent to install.
- **Signing the agent in is the vendor's own sign-in, into the vendor's shared
  store** (`~/.claude`, `~/.codex`), so a Mac already signed in stays signed in
  and the app never holds a model credential of its own.
- **There is no API-key fallback**: a key is a bill the user never chose and a
  secret the app would have to keep.
- **No model call goes through the Worker or the phone**, because a model call
  there is one the owner pays for.
- **Git is the engine, never the vocabulary.** History, undo and sync ride git,
  and no product surface says git, commit, remote, repo, terminal, CLI, PATH or
  MCP, because none of those words is the user's. Settings › Advanced is the one
  exception, for the user who brings their own sync server.
- **The phone follows the Mac's threads and answers them.** It reads the
  synced log and asks a Mac to run the agent through the dispatch inbox,
  because a phone holds neither git nor a model.
- **Connectors are the default agent's own MCP config**, because one registry,
  the vendor's, with the vendor's own sign-in, beats a second one beside it.
- **Dictation is the operating system's**, because the Mac's and the phone
  keyboard's are already there and cost the app no speech model.
- **Every feature is core.** Nothing sits behind a tier or a flag, and nothing
  already built is cut for the persona: the persona changes the words.
- **An account is optional, and offered.** Without one the app is a local notes
  app that makes no cloud request; with one it syncs, and the hosted vault is
  free up to about 1 GB.

**TWO PROGRAMS.** `apps/desktop` is the shipped product — the window, and the
SPA inside it — and the user installs it as the signed dmg. `apps/cli` is the
`inteligir` binary: `serve` IS that local server, and every other verb but
`vault open` is a client of a running one. The CLI is the agent's door and
the developer's; nothing the user does needs a terminal. `apps/mobile` is the
iPhone app: the synced threads, and the requests and answers it sends a Mac.

**The architecture's decision record is GitHub issues
[#542](https://github.com/kyh/inteligir/issues/542) and
[#611](https://github.com/kyh/inteligir/issues/611)** — what was chosen, and
what was rejected and why. #611 is the v4 consolidation, and it REVERSES four
of #542's lines deliberately; where the two disagree, #611 wins.
[#889](https://github.com/kyh/inteligir/issues/889) moves the desktop shell
from Electron to Tauri and reverses three of #611's lines (the Electron shell,
`utilityProcess` as the supervisor, the `inteligir://` door); where they
disagree, #889 wins. Where any of them, or a Decisions bullet below, assumes a
developer at the keyboard, this overview wins, and the issue that changes that
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
                 the vault, the knowledge index (its scan on a worker thread),
                 the agent runtime, the oRPC handler at /rpc, the /ws
                 invalidation bus and the db, built by the ONE composition root
                 (`compose.ts`); every other verb but `vault open` is a citty
                 leaf that is a CLIENT of a running one, with consola for the
                 human path (raw writes for anything verbatim — consola
                 rewrites `backtick` spans). Every leaf takes --json and is
                 EXECUTED by the fitness test against the refusal path, except
                 the rows in `EXCLUDED_COMMANDS`
                 (`apps/cli/src/__tests__/json-flag-enforcement.test.ts`), each
                 with its reason. src/server/ splits by domain (vault/,
                 knowledge/, threads/, comments/; agents/, which runs the
                 vendor binaries bundled beside their adapters through one
                 spawn policy and signs a vendor in from the app;
                 connectors/, the default agent's own MCP config edited
                 through that same binary; cloud/, the sync client and the
                 dispatch claim). Every app-written file in the data
                 dir is a `json-file-store.ts` over `staged-write.ts`;
                 `config.json` is read at boot and never written by the app
                 except its `vaultDir`, the selector a switch rewrites
                 (`vault-switch.ts`). Discovery is ONE FILE:
                 `<dataDir>/server.json` carries the bound port and the bearer
                 together, so the address and the credential cannot disagree
                 and no port is scanned. The ACP runtime injects
                 INTELIGIR_DATA_DIR + a PATH carrying this bin dir into agent
                 shells, so a model drives the product by typing
                 `inteligir …` in bash. src/desktop/ is the desktop shell's
                 door, a second entry over the same chunks (dist/desktop.js):
                 every rule the Rust shell acts by that is the server's own
                 (the environment a launch runs with, the data dir it serves,
                 a browser's sign-in) is asked of it, one JSON answer per
                 process, and its `serve` is the server the shell runs. The build inlines every workspace
                 package (they export TS source) and stages as CONTENT the
                 migrations, the dialect skills, the vendored licence texts,
                 and the desktop renderer's bundle as dist/ui, which
                 `serve --open` answers over plain HTTP.
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
                 the account through Better Auth's one purge path), the
                 per-user ThreadSyncDO (merged thread log + capture inbox +
                 dispatch inbox + ws invalidation), and the hosted vault git
                 remote (issue #618): durable-git repo
                 cells behind src/worker/vault/git-remote.ts, one per user,
                 device-authed, which the Worker commits to itself through
                 the cell's own receive-pack
                 (src/worker/vault/commit-changes.ts) when a phone posts a
                 change set to /v1/vault/commit
                 (src/worker/vault/commit-route.ts).
                 src/worker/ is its own tsconfig program (no DOM —
                 workerd's globals must win).
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
  domain/        @repo/domain — zod-only leaf vocabulary (view context,
                 provider events, the thread-title rule), vendored-from-bb
                 shapes; every package may reach it, it reaches nothing.
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
                 dispatches, and never pushes a thread event, claims a
                 dispatch or speaks git, because the desktop runs the turns. Two entries rather than one router because their
                 compatibility obligations are OPPOSITE: /local's ends ship in
                 one bundle and may break freely (a CLI installed apart refuses
                 another release's server as `SERVER_VERSION_MISMATCH`),
                 /cloud is a deployed Worker answering installs that may be
                 months stale and may never break. A dep-dag table
                 (`CLOUD_ONLY_CLIENTS`) pins apps/web and apps/mobile to /cloud
                 alone, and a dep-dag row refuses a third bucket in src/, since
                 the cloud-never-reaches-local guard populates itself from
                 src/cloud. /cloud stays zod + REST paths (NOT oRPC, diverging
                 from #611 phase 6 deliberately): oRPC addresses procedures by
                 router position, so moving the deployed wire to it would break
                 exactly the stale installs /cloud may never break.
  db/            @repo/db — drizzle + better-sqlite3 (WAL, sync=NORMAL),
                 committed SQL migrations applied on boot, the DbNotifier
                 seam, prefixed-nanoid ids.
  notes/         @repo/notes — PURE platform-neutral domain: the knowledge
                 engine (link graph, FTS5 search over an injected SqlDriver,
                 the literal text scan behind matches and unlinked mentions,
                 the resolver's problems report, tags and tag families,
                 the rename and tag-rename byte-surgery) over ONE markdown scan
                 (scan-parse + wiki-links), frontmatter (the pin and id line
                 cuts included), `templates/` (the three placeholders and the
                 convention folders), the dialect's own modules
                 (markdown/remark-*, comments/, formulas/),
                 `text/` — ONE Myers diff under diff3 — and `sync/`, the one
                 verdict a path two writers changed gets and the conflict
                 copy's name and words. No node/react/ui
                 imports — lint-enforced. `markdown/mdast-nodes.ts` is the
                 mdast NARROWING boundary: a walk asks it what a node is
                 rather than discriminating structurally at each visit.
  agent-runtime/ @repo/agent-runtime — the ACP runtime (#588): one adapter
                 speaks the Agent Client Protocol (@agentclientprotocol/sdk)
                 to claude-agent-acp and codex-acp children; harnesses are
                 data rows (the bundled vendor binary, its status probe, its
                 sign-in method, what keeps the vault's own config out of a
                 session); the provider-event vocabulary is the one internal
                 grammar, exactly what the ACP mapper emits.
  agent-skills/  @repo/agent-skills — product skill files: the
                 dialect's first-party spec, served to agents as files.
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
written for someone who takes notes, not someone who reads code; a change to
the command line goes under `### On the command line` in that section, the one
place the CLI's own words stay. A release's notes are that section (THE
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

- [Vault: writes, git and containment](#vault-writes-git-and-containment)
- [Knowledge: index, search and links](#knowledge-index-search-and-links)
- [Agents and threads](#agents-and-threads)
- [Dictation](#dictation)
- [Cloud, sync and accounts](#cloud-sync-and-accounts)
- [Server process and the desktop shell](#server-process-and-the-desktop-shell)
- [Desktop workspace surfaces](#desktop-workspace-surfaces)
- [Repo guards, vendoring and tooling](#repo-guards-vendoring-and-tooling)

### Vault: writes, git and containment

- **THE AUTO-COMMIT IS SESSION-SHAPED (15s quiet / 60s max) AND STAGES WHAT THE
  WINDOW'S WRITERS NAMED**, so the log is answerable: a single-file commit names
  its file and a fifteen-second pause ends an editing session. A scheduler that
  names no paths (the boot sweep, the post-sync drain), a window past
  `MAX_SCOPED_COMMIT_PATHS` and the flush after a failed one are unscoped; a
  change nobody announced waits for one. A turn's start stages the whole tree
  less every path a live turn claimed (`checkpointUnclaimed`), because
  `--literal-pathspecs` rules out an `:(exclude)` and naming every other path
  is an argv a first commit overflows; unscoped `add -A` survives for that same
  ARG_MAX. `apps/cli/src/server/vault/git-engine.ts` says why the max wait is
  the sync interval.

- **NOTE HISTORY IS LOCAL, AND A RESTORE IS A WRITE.** History reads the
  vault's own git repo, so it works offline. A restore writes the revision's
  bytes through the ordinary guarded write, never `git checkout` or
  `git revert`, which would bypass the CAS, the re-index, the `/ws`
  notification and the open buffer's convergence; there is no `vault.restore`
  procedure, since a second server write path is a second CAS. A CAS refusal is
  reported, not diff3-merged, because the user named exact bytes
  (`apps/cli/src/server/vault/git-history.ts`, `vault restore` in
  `apps/cli/src/commands/vault.ts`). A deleted note comes back the same way,
  from the log's deletions plus the worktree's uncommitted ones. There is no
  trash folder and no purge.

- **A WRITE CARRIES THE BASE IT WAS COMPUTED FROM AND NAMES ITS GUARD, AND A
  CREATE IS NOT A WRITE WITH AN EMPTY BASE.** `vault.write`'s `guard` is a
  required union (`packages/contract/src/local/vault/vault-schema.ts`): `expected`
  carries the hash the write was computed from, `absent` is a create,
  `overwrite` is last-writer-wins spelled out. One required field rather than
  two optional ones, which would make last-writer-wins the silent default and
  let a hash and a create travel together. `expected` is compared under the
  repo lock (`apps/cli/src/server/vault/vault-router.ts`); a mismatch answers
  409 with the current content, rather than active-user-wins, which discards
  concurrent body edits wholesale. A write ANSWERS THE BYTES THAT LANDED.
  Hashing bytes not yet on disk is a refusal every time, so a create carries
  no hash. A path already taken answers `exists`, a refusal rather than a
  silent reuse. Every error a vault row declares has a producer
  (`apps/cli/src/server/vault/__tests__/vault-contract-errors.test.ts`), since a
  code no handler raises is a client branch that never runs.

- **CONTAINMENT IS PHYSICAL, NOT LEXICAL.**
  The vault realpaths the deepest existing ancestor and refuses symlinked
  leaves; a lexical check passes a `notes.md` that is a symlink to a private
  key, and a `git pull` from a hostile remote can plant one
  (`apps/cli/src/server/vault/vault-service.ts` over `path-containment.ts`).
  The vault dir and the data dir must be disjoint, refused at boot: a data dir
  inside the vault gets committed and pushed.

- **THE ENGINE'S GIT IGNORES THE VAULT'S OWN GIT HABITS, AND A PASS REPORTS ONE
  OUTCOME.** `runGit` prepends `--literal-pathspecs`,
  `core.hooksPath=/dev/null`, `commit.gpgsign=false`, `rerere.enabled=false`
  and `merge.verifySignatures=false` to every invocation
  (`apps/cli/src/server/vault/git-run.ts`, the one argv builder): a pathspec is
  a glob, so `[a].md` names `a.md` too and a commit scoped to one note would
  stage its neighbour; a user's hook can refuse, stall or rewrite an engine
  commit, rebase or push, where `--no-verify` reaches only pre-commit and
  commit-msg; a signing policy stalls or refuses an engine commit; and a
  recorded resolution replays over a verdict. Every status read passes
  `--untracked-files=normal`, because `status.showUntrackedFiles=no` would hide
  an engine commit's paths and hold every sync behind it. Residual: a git-lfs
  vault's upload is a pre-push hook too, so it does not run. Before the listen
  the bootstrap stages only the starter notes it seeded into a folder it
  created, and an opened folder's first commit is empty
  (`apps/cli/src/server/vault/git-bootstrap.ts`), since staging a large folder
  there outran the shell's readiness wait. A pass concludes one `SyncOutcome`,
  and a path two devices changed is never one of them: a detached HEAD says
  `detached`, never `clean`; a refused push says `rejected` (a 413
  `too-large`, a 507 `full`), never `offline` (`classifyNetworkFailure`); and
  a pass that fails with no verdict (a merge that fails outright, a save the
  engine could not record, an unclassified failure) says it stalled, never
  `clean` or `dirty`.

- **WHERE A PASTE LANDS IS A STORED VAULT CHOICE, and the host resolves it, not
  the editor.** `<dataDir>/vault-prefs.json` holds `attachments` (the root,
  beside the note, or one folder, default `assets/`), read per paste so a
  Settings or CLI change reaches the next one; the editor hands the host a base
  name and the host answers the folder through `attachmentDir`
  (`@repo/contract/local/vault/attachment-location`). `setPrefs` refuses only a path
  that is a file, which would refuse every paste. The bytes ride as a multipart
  Blob rather than base64 inside the json.
  `apps/cli/src/server/vault/vault-prefs-store.ts`. The name is
  `freeAssetPath` (`@repo/notes/knowledge/asset-name`), which the phone's
  photos run too; they land in the default folder, spelled once as
  `DEFAULT_ATTACHMENTS_FOLDER` in `@repo/notes/templates/placeholders`, since
  `vault-prefs.json` never reaches the phone.

- **A SECOND VAULT GETS ITS OWN DATA DIR.** The default vault keeps the root
  data dir; any other lives in `<root>/vaults/<sha256(path)[:16]>/`, derived
  once in `config.ts`, and the root's `config.json` is the selector
  `inteligir serve` reads. A folder is ONE vault however it is spelled: a
  selection stores its physical spelling (`physicalVaultDir`) unless the given
  spelling alone already keys a data dir (`resolveVaultCandidate`), so a
  symlinked spelling never mints a signed-out twin; the hash stays over the
  stored spelling, since re-deriving it would move every selector written.
  Cost accepted: the credential and the agent default live in the data dir, so
  a second vault starts signed out, which also keeps it off the account's
  hosted remote. `inteligir vault open <dir>` writes the selector
  (`apps/cli/src/server/vault-switch.ts`) and restarts nothing.

- **A SYNC PASS HOLDS THE REPO LOCK ONLY FOR ITS LOCAL STEPS.** The fetch and
  the push run unlocked between locked local steps: held across the network,
  the lock made every save and every turn start wait out a dropped connection's
  timeout. The price is that the world moves during the fetch, so the
  integration step re-checks first. Only a merge that fails outright is
  remembered, by the two tips it failed between, so a pass where neither moved
  skips it rather than failing the same way every minute. Network git gives up
  under 1KB/s for 30s, or an ssh connect past 20s
  (`apps/cli/src/server/vault/git-run.ts`). The split is
  `apps/cli/src/server/vault/git-engine.ts`.

- **CONCURRENT EDITS NEVER STOP SYNC** (owner direction: diff3 auto-merge, and
  a true overlap makes a conflict copy). A pass rebases first, which keeps the
  history a line; a rebase that stops on a path both devices changed is aborted
  and the pass merges instead (`apps/cli/src/server/vault/git-merge.ts`), and a
  branch holding an unpushed merge merges again, since a rebase drops a merge
  commit. Each path git cannot merge gets `reconcileFile`'s verdict
  (`@repo/notes/sync/reconcile-file`), the one the phone's queue lands for the
  same inputs: an overlap keeps this device's lines and copies the other's
  aside, named after the committer of the newest commit that touched the path.
  Every verdict lands through the index, never a JS write into the vault, so
  the merge commits exactly the tree on disk; whatever throws aborts the merge,
  and a merge or rebase a crash left is aborted before the engine's first
  commit. Every engine commit's committer is this device's name
  (`apps/cli/src/server/device-name.ts`: its sign-in name, else the Mac's own),
  because that is how another device names its version; the author still says
  who made the change. Every surface words a report through
  `describeSyncConflict`; there is no lasting conflict list, because the
  copies are the record. Rejected: a `conflict` state that stopped sync until someone ran git,
  which a knowledge worker cannot, and a rebase through the conflict, which
  replays every local commit and has nowhere to keep the other version.

- **THE CAPTURE INBOX MERGES BY UNION.** Two desktops each appending a phone
  capture to the root `Inbox.md` between syncs overlap on a file the app wrote
  itself, and without union the merge would copy the inbox aside over a
  conflict nobody made. Every boot makes sure `info/attributes` holds
  `/Inbox.md merge=union`: local, never a committed `.gitattributes`, because
  the vault's files are the user's. Residual: a bullet one device deleted
  beside the other's append comes back.
  `apps/cli/src/server/vault/git-bootstrap.ts`, over `CAPTURE_INBOX_PATH` in
  `@repo/notes/sync/reconcile-file`, whose verdict unions the same file for a
  writer that runs no git.

- **AN UNTOUCHED STARTER VAULT YIELDS TO A REMOTE THAT HAS HISTORY**, so a
  second Mac signing in never merges its seed into the account's notes: the two
  histories are unrelated, so a starter the user edited elsewhere is added on
  both sides with no base, the fresh seed keeps the path, the user's version
  becomes the conflict copy, and every starter they deleted comes back. The
  bootstrap records the commit that seeds a folder it created
  (`inteligir.seedCommit`, `apps/cli/src/server/vault/git-bootstrap.ts`); a
  pass that meets a remote branch it does not contain while HEAD is still that
  commit moves the branch to the remote's tip with git's own checkout,
  announces the paths that moved and drops the record, and nothing is a
  conflict (`yieldSeededHistory` in `apps/cli/src/server/vault/git-engine.ts`).
  It reads local history alone, so it holds for every remote. Rejected:
  `reset --hard`, which would overwrite a change landed after the pass's
  commit, where the checkout refuses it and the next pass merges it. Residual:
  a vault an older build seeded has no record, and merges.

- **A WATCHER EVENT IS A MUTATION'S ECHO ONLY WHILE THE ENTRY IS THE ONE IT
  LEFT, AND A PULL NAMES ITS PATHS.** The runtime drops a watcher event only
  when a fresh lstat matches the one its mutation recorded: keyed on the path
  and a window alone, a foreign write landing behind a save (an agent editing
  the open note) would be dropped with the echo. A pass whose rebase moved HEAD
  reports the diff's paths, because a pass that names nothing makes every push
  from another device re-read the whole vault.
  `apps/cli/src/server/vault/vault-changes.ts`,
  `apps/cli/src/server/vault/vault-runtime.ts`.

- **WHAT THE FILESYSTEM REFUSES COSTS THAT ENTRY, NEVER THE CALL.** A
  subfolder the walk cannot open lists empty, logged once, because one such
  folder would fail the listing and the boot; the root still throws. A move
  where the filesystem refuses a hard link (exFAT, some SMB mounts) falls back
  to the check-then-rename a folder move already accepts. A compare-and-swap
  read failing for any reason but absence is a fault, never "the file is
  gone". `apps/cli/src/server/vault/vault-service.ts`.

- **THE VAULT LISTS WHAT GIT WOULD KEEP.** The listing, the stat and the
  watcher honour every `.gitignore` in the vault, so a docs repo's
  `node_modules/` and build output take no tree row, no index row and no wake.
  One matcher per file, scoped to its own folder and asked deepest-first
  (`@repo/notes/knowledge/vault-ignore`), because one rooted at the vault
  re-scopes a nested `*` to `**/*` and hides the whole tree; `.git` and the
  staging prefix stay the unconditional floor. Only `.gitignore` files, which
  travel with the vault: `info/exclude` and a global excludes file are one
  machine's. A change naming a `.gitignore`, or naming nothing, reloads the
  rules (`apps/cli/src/server/vault/vault-runtime.ts` over
  `vault-ignore-files.ts`). Rejected: a hardcoded skip list, which misses the
  next tool's folder and contradicts what the user already wrote down.
  Residual: a folder moved in whole with its own `.gitignore` is read at the
  next reload, and the hosted vault's listing honours only the floor.

- **GIT IS THE ENGINE, NEVER THE VOCABULARY.** History names a version by
  when and who, never by its subject or sha: the server reads `authorKind` off
  the author (the user's own edits, the agent, or `external`, which keeps its
  name and subject), so no client matches an email
  (`apps/cli/src/server/vault/git-history.ts`); a phone's edit, which the
  Worker commits under the device's own address, reads as the user's own,
  never `external`, and the commit vocabulary both ends read is spelled once in
  `@repo/contract/cloud/vault/vault-git`.

- **AN OPENED FOLDER'S OWN ORIGIN IS ITS BYO REMOTE, AND A FOLDER ANOTHER
  SERVICE SYNCS NEVER TAKES THE HOSTED VAULT.** Where a vault syncs has one
  record, its repo's own `origin`, read every pass under the repo lock
  (`readOriginConfig` in `apps/cli/src/server/vault/folder-facts.ts`), so a
  remote the user had, or sets later, is the next pass's with no restart. The
  app marks the origin it manages (`inteligir.remote=account`; an origin at the
  hosted url counts as marked), and the order is the pin
  (`INTELIGIR_VAULT_REMOTE`), an unmarked origin, outside sync, then the
  account (`apps/cli/src/server/cloud/vault-remote.ts`); an account pass that
  meets an unmarked origin pushes nothing, since its set-url would push the
  user's repo into the hosted vault. OUTSIDE SYNC is judged once at boot from
  where the folder physically sits, never stored and never asked of the
  service (`apps/cli/src/server/vault/external-sync.ts`): two sync engines over
  one tree fight, so the folder keeps its service and the hosted vault stays
  off, while an origin of the user's own still syncs. Rejected: a stored
  per-vault sync choice, a second record a user's own `git remote set-url`
  would contradict, and config.json's `vaultRemote`, which pinned one remote
  for every vault and is now a boot warning. `inspectVaultFolder` answers the
  same facts before a folder is a vault, so a picker and a boot agree. ONE
  WRITE PATH EDITS THAT ORIGIN: `vault.setRemote`, which
  `inteligir vault remote` calls, running `setOrigin` in
  `apps/cli/src/server/vault/git-engine.ts` under the repo lock. Every move of
  the origin, this one's and a pass's (the pin, the account's url), is
  `pointOrigin`: it forgets the old remote's tips, so no status calls the
  vault synced before a pass reached the new one, and a hand-set
  `remote.origin.pushurl`, which `set-url` leaves and git would keep pushing
  to. The url grammar is one,
  `@repo/contract/local/vault/remote-url`, which the pin and the wire both
  run. A pinned vault refuses a change (`CONFLICT`), since every pass writes
  the pin over the origin. No "off" choice: a folder another service syncs is
  already the derived off.

### Knowledge: index, search and links

- **The knowledge index persists no stat fingerprint.** A warm reconcile over
  2000 notes reads and hashes every doc in ~200ms on a local disk, off the
  critical path, and a second persisted table in a cache whose recovery
  primitive is deleting the file is a crash waiting for a missed re-create. On
  storage that fetches or wakes, the read deadline (A DOC WHOSE READ HAS NOT
  ANSWERED, below) keeps the reconcile to ~2s whether one read stalls or all
  do, so the fingerprint is not what makes slow storage usable. What only
  size+mtime buys is not opening the file, so THE TRIGGER is a report of a
  vault whose notes the OS evicts to placeholders being fetched again on every
  boot; the walk already stats every file. `KnowledgeIndex` in `@repo/notes` is
  not dead code: the package carries no sqlite (`SqlDriver` is injected), so
  that in-memory composition is how it tests its own engine.

- **Stemming is a SHADOW of the indexed text, never a rewrite of it.** Literal
  and stem columns at equal bm25 weight; `@repo/notes/knowledge/search-query`
  owns the one policy both engines run. FTS5's `porter` tokenizer is rejected
  for a measured reason: it stems the index, so a prefix query for a half-typed
  word stops retrieving (86 of 1,555 prefixes over the labelled corpus), and it
  puts half a shared policy inside SQLite's C. Every term asks both halves, and
  that OR is the exact tier: a doc holding the literal word scores about twice a
  stem-only hit. Residual: the title/body gap is 10x, so a title collision still
  beats a body exact match. `search-query.ts` and `knowledge/search-excerpt.ts`.

- **THE CLIENT DOES NOT DECIDE WHAT A DOC IS.** `@repo/notes/knowledge/doc-file`
  is the one answer: `isDocPath` (`.md`, `.markdown`, `.mdx`, `.txt`) and
  `docStem`. A private `.md` rule in a client hides every `.txt` note and
  disagrees on display the moment a name is not lowercase.

- **THE SCAN READS AS PROSE WHAT THE EDITOR DRAWS AS PROSE, BUT ITS GRAMMAR IS
  NOT THE EDITOR'S, and `verbatim-spans` is the one bridge.** The scan disables
  `codeIndented` and `htmlFlow` (`@repo/notes/markdown/scan-parse`) because the
  editor's plugin list does, pinned in
  `packages/notes/src/__tests__/link-extract.test.ts`. The scan is total, so a
  malformed tag cannot cost a note its index row, where the editor's MDX
  tokenizer throws; unifying the grammars is rejected for exactly that. A
  rename's span is a licence to rewrite bytes, so a rename's scan runs the
  editor's plugin list as a bare parse (`@repo/notes/markdown/verbatim-spans`)
  and withholds spans inside those ranges (`@repo/notes/knowledge/link-extract`);
  the index path emits no spans and never pays for that parse on every save.

- **A TAG'S NOTES ARE A LISTING, NOT A SEARCH, AND A TAG RENAME IS THE LINK
  RENAME'S SURGERY.** `knowledge.tagNotes` answers the tag's family with the whole count, paged,
  from the index alone, because the search route stops at its ceiling with no
  sign of a cut; the family is one predicate, `notesInTagFamily`
  (`@repo/notes/knowledge/tag-notes`). `knowledge.renameTag` splices a
  frontmatter entry over its own yaml scalar (`@repo/notes/markdown/frontmatter`),
  because re-serializing restyles a flow list and rewrites every line of a CRLF
  one, and every write is `writeIfUnchanged`, so a note that changed
  mid-rename is reported, never overwritten. The one name grammar is
  `isTagName` (`@repo/notes/knowledge/tag-grammar`, import-free so the
  contract loads no markdown parser). `@repo/notes/knowledge/rename-tags.ts`,
  `apps/cli/src/server/knowledge/rename-tag.ts`.

- **VAULT SEARCH IS A LITERAL SCAN BESIDE THE RANKED INDEX.** FTS5 cannot say
  where inside a line a hit sits, so `knowledge.matches` (`inteligir matches`)
  scans bodies with ONE matcher, `@repo/notes/knowledge/text-matches`; the
  store only pre-narrows by ascii substrings (`docTexts`), because LIKE folds
  ascii case alone.

- **AN UNLINKED MENTION IS THE STEM OR AN ALIAS IN PROSE.** `knowledge.unlinkedMentions` (`inteligir unlinked`)
  runs the literal matcher over the target's names as whole words, longest
  first; one row per note, excluding notes already linking here. A hit inside
  code, math, a link, a url, frontmatter, an html tag or a comment marker is
  withheld by the scan's own regexes as well as the editor's verbatim ranges,
  because those come back empty for a doc the editor refuses. Not the H1:
  `[[H1 text]]` resolves to nothing. Each row names its `linkTarget`, because
  the bare stem may be another note's.
  `@repo/notes/knowledge/unlinked-mentions.ts`.

- **A PROBLEM IS THE RESOLVER'S VERDICT, never a scan's.** `knowledge.problems`
  (`inteligir problems`) reads the resolved graph
  alone: unresolved links, missing embeds, orphans, and a link name
  (`wikiLinkName`) or frontmatter `id` two docs share, a tie the resolver is
  quietly breaking. Every row disappears with the sweep that fixes it, so none
  is stale. Daily notes and templates are orphans by design and left out
  unless asked (`@repo/notes/templates/placeholders` spells the folders).
  `@repo/notes/knowledge/vault-problems.ts`.

- **A DOC THE INDEX CANNOT READ OR PROJECT COSTS THAT DOC, NEVER THE INDEX.**
  A refused read (EACCES, EIO) keeps the doc's last row and is retried every
  pass, since a permission fix announces nothing. A doc whose projection throws
  is indexed as an other with its hash kept, so it is not re-projected every
  reconcile nor after a restart (a build that could project it bumps
  `PROJECTION_VERSION`). Rebuilding on either is rejected: the rebuild re-reads
  the same vault and fails the same way, so it loops. For the same reason only
  the store's own failure rebuilds: the driver throws `KnowledgeStoreError`
  (`@repo/notes/knowledge/sql-knowledge-store`) for every database failure, and
  any other throw fails that pass and reconciles on the next.
  `apps/cli/src/server/knowledge/knowledge-runtime.ts`.

- **THE SCAN RUNS ON A WORKER; THE SERVER'S LOOP READS BYTES AND WRITES ROWS.**
  Projecting a 20k-line note is seconds of synchronous CPU (2.9s measured),
  every autosave re-projects it, and the server's thread also answers every
  request, the ws bus and the watcher's liveness ping. So projection, the stem
  shadow (`@repo/notes/knowledge/search-columns`) and both rewrite sets' byte
  surgery run on one warm worker
  (`apps/cli/src/server/knowledge/projection-worker.ts`). No projection cap
  below the vault's 10 MiB read cap (a doc over it indexes as an other:
  resolvable, never searched): by owner decision a lower one is added only if
  the worker cannot keep up. Most suites run the jobs inline
  (`apps/cli/src/server/knowledge/__tests__/inline-projector.ts`), because a
  worker booted from source (`apps/cli/src/server/worker-entry.ts`) costs
  seconds. Pinned over a 20k-line note in
  `apps/cli/src/server/knowledge/__tests__/knowledge-runtime.test.ts`.

- **A WIKI LINK NAMES WHAT THE RESOLVER ANSWERS TO, AND ONE FUNCTION BESIDE THE
  PARSER WRITES IT.** `.md` is the one extension a link leaves off
  (`wikiLinkName` in `@repo/notes/knowledge/doc-file`), and the resolver keys
  that same name, so a `.txt` note links as `[[todo.txt]]`; letting every doc
  extension go was rejected to keep Obsidian's reading and the pinned resolver.
  A rename takes its target from `wikiTargetForPath` (`@repo/notes/knowledge/link-resolve`: the name when it
  resolves back, else the path), but a rename's candidate predicate refuses the
  bare name unless no other file answers to it (`answersOnly` in
  `packages/notes/src/knowledge/rename-links.ts`), because a rename rewrites
  links the user did not type and must not lean on the resolver's tie-break.
  Every writer takes its bytes from `serializeWikiBody`
  (`@repo/notes/markdown/remark-wiki-link`), and a null from it writes nothing.
  Pinned by the round trip
  in `packages/notes/src/__tests__/link-resolve.test.ts`.

- **A DOC WHOSE READ HAS NOT ANSWERED IN 2S IS DEFERRED, NOT AWAITED, AND READS
  OUT STAY BELOW NODE'S FS POOL.** On storage that fetches or wakes (an
  on-demand placeholder, a sleeping disk, a network mount) one open can block
  for minutes, and every query settles the pass first. So the pass moves on,
  the doc answers from its last entry, and the read lands in a later pass. A
  read left running still holds a slot of `READ_CONCURRENCY` (3): a stalled
  open holds one of node's four fs threads, and a fourth stalls every fs call
  in the process, saves included, which no deadline can free. Rejected:
  re-reading every path once its late read lands, which loops on storage that
  is always slow, and a wider cap, which the pool cannot afford. No provider
  path, bundle id or mount type appears anywhere; the scenario suite stalls a
  path through `INTELIGIR_SLOW_READS` (`apps/cli/src/server/vault/slow-reads.ts`),
  and the boot's timing line (`apps/cli/src/server/boot-report.ts`) counts what
  was deferred. Residual: the listing's walk has no deadline, and a rename run
  before a deferred doc lands misses a link the doc gained offline.
  `apps/cli/src/server/knowledge/deferred-reads.ts`,
  `tools/e2e/src/scenarios/slow-storage.ts`.

### Agents and threads

- **Ingest is ONE transaction.** Append, lifecycle projection and queue touch
  happen in one immediate transaction; notifications flush after commit.
  Lifecycle CAS predicates include the turn identity so a late completion for
  turn A cannot settle turn B (`apps/cli/src/server/threads/service.ts`).

- **AN AGENT COMMIT STAGES THE TURN'S OWN WRITE SET, AND A TURN IS FOUND BY
  ITS TRAILERS, NEVER BY ITS SHA.** The set is the fileChange events of edits
  that landed (a failed or declined edit stays out, so Undo never takes the
  user's typing), plus the vault writes the agent makes through `inteligir`
  itself, under a counted commit hold that defers the vault debounce and
  blocks a sync, because committing the whole dirty tree attributes a
  concurrent turn's writes to whoever settles first
  (`apps/cli/src/server/agents/agent-commits.ts`). Under `INTELIGIR_THREAD_ID`
  the CLI names its thread on every call
  (`apps/cli/src/server/agent-thread-header.ts`) and the write handlers hand
  what they wrote to its running turn (`attributeWrites` in
  `apps/cli/src/server/orpc.ts`), a delete's comment stores and a minted note
  id included; the header is attribution, not authority. A rebase onto another
  device's push rewrites a sha, so the commit carries `Thread:` and `Turn:`
  (an undo `Undoes-Turn:`), spelled once in
  `apps/cli/src/server/vault/turn-trailers.ts` and read back by
  `threads.turnChanges` (`apps/cli/src/server/agents/turn-changes.ts`). Undo
  needs the bytes from just before the turn, so the turn starts with a
  checkpoint of the unclaimed dirty tree: the note the user was typing in
  lands as the engine's, never inside the turn. Undo covers reported edits
  alone (owner decision). Residuals: lines typed into a note WHILE the agent
  edits it belong to the turn, since the canonicalizing save-back leaves no
  sound per-writer split; a crash mid-turn leaves its writes to the boot
  sweep, so that turn cannot be undone; a thread pulled from another device
  lists only what was committed after it arrived.

- **THE AGENT SURFACE IS THE ⌘K ACTION COMPOSER AND THE RIGHT PANEL** (what it
  retired is the register on #645; do not bring any of it back). An action is an
  ordinary thread; the composer is a non-modal dialog over the workspace's
  centre column, and the panel's one Actions tab is the transcript, its
  approvals answered in place. A send the server refuses keeps the thread it
  created, so a retry sends into it rather than leaving one empty action a try.
  `apps/desktop/src/renderer/app/actions/actions-panel.tsx` and
  `action-composer.tsx`.

- **A COMMENT STORE IS ONE DOT-FOLDER KEYED BY THE NOTE'S ID, ITS WRITE IS A
  CAS, AND EVERY ENTRY CARRIES ITS AUTHOR'S `source`; the cloud was rejected
  for it.** `.inteligir/comments/<note-id>.json`, keyed by the note's
  frontmatter `id`, so a rename or move anywhere (Finder, a pull, an agent's
  `mv`) strands nothing and one commit carries a note's anchors and bodies
  together; bodies in a cloud table would drift from the anchors in the note's
  bytes and need an account. The store write retries once on a base mismatch,
  then answers `CONFLICT`; the server signs `user` when a caller says nothing
  and the CLI signs `agent` under `INTELIGIR_THREAD_ID`
  (`apps/cli/src/server/comments/comments-service.ts`,
  `apps/cli/src/commands/comment.ts`). The comment-id grammar has one spelling,
  `COMMENT_ID_PATTERN` in `@repo/notes/comments/sidecar-schema`. A comment on a
  note without an id mints one (`withFrontmatterId`) through a guarded note
  write; a read mints nothing, and an `id` that is not text is refused, never
  overwritten. A legacy `<note>.comments.json` is folded in on first touch and
  over the whole tree once the server listens (`comments-migration.ts`, kicked
  from `serve.ts`, so it neither delays nor fails the boot). A deleted note's
  store goes with it unless a byte copy still carries that id, one rule
  (`@repo/notes/comments/store-removal`) the server's delete
  (`remove-with-comments.ts`) and the phone's both ask, and a restore brings
  both back through `@repo/contract/local/vault/restore-comment-store`, reporting a
  store it could not restore. A BYTE COPY IS RE-KEYED AND ITS STORE FORKED,
  never stripped of its id: `@repo/contract/local/vault/give-note-own-id` (the
  Problems page's Give its own id, `inteligir vault new-id`) copies the store
  under a new id first, then moves the copy's `id:` line under the CAS, so both
  notes keep every thread and the one keeping the old id keeps its
  `[[Title|uuid]]` links and actions. Deleting the copy's `id:` line was
  rejected: its anchors' bodies live only under that id.

- **A VIEW CONTEXT RIDES THE MESSAGE, and it is a statement about the past.**
  What the user was looking at travels on the send (`@repo/domain/view-context`),
  never as a thread column or a server-side "current view" that has no owner,
  so navigating away mid-turn changes nothing. There is no tool: the agent can
  already read the file, and the one thing a tool could add, a live selection,
  cannot be made honest. A queued send carries none.
  `apps/cli/src/server/agents/view-context-prompt.ts`.

- **AN @-MENTION RIDES THE SEND AS `contextPaths`, NEVER AS TEXT.** The stored
  `client/turn/requested.text` is exactly what the user typed, so the
  timeline, the phone and a thread's title read the message rather than a
  prefix the desktop glued on; the server names the notes in a block of its
  own (`composeContextPathsBlock`). UNLIKE the view context, a queued send
  KEEPS them (`queued_thread_messages.context_paths`): a mention is part of
  what the user asked, not a statement about a screen since left.
  `@repo/contract/local/threads/threads-schema`.

- **THE DEFAULT HARNESS IS A STORED CHOICE, read per thread start.**
  `<dataDir>/agent-prefs.json`, not config.json, which is read once at boot and
  never written by the app; unset, claude, whatever PATH holds (reversing "the
  first harness on PATH": both runtimes ship in the app, so PATH says nothing
  about which one can run). A thread keeps the harness it started on. A model
  is per harness, because a model id is vendor-specific; a one-model spelling
  (`INTELIGIR_AGENT_MODEL`, config.json's `agentModel`) is named in a boot
  warning, never refused, since config a build does not act on must not brick
  it (`legacyModelWarnings` in `apps/cli/src/server/config.ts`).
  `apps/cli/src/server/agents/agent-prefs-store.ts`, `defaultHarnessId` in
  `agent-driver.ts`, `harnessReadiness` in
  `@repo/contract/local/agents/agents-schema`.

- **CONNECTORS ARE THE DEFAULT AGENT'S OWN MCP CONFIG** (reversing the
  app-owned registry and its hand-built OAuth: one registry, the vendor's, with
  the vendor's own sign-in). The `connectors` routes list, add and remove the
  servers in the default agent's user-level config through its bundled binary and the one
  vendor spawn policy, resolved per call from `agent-prefs.json`, so a change
  of agent moves the list and every vault shares it. Add and remove only: no
  toggle, and no header field, since Codex keeps no static header. A session
  is handed no servers of the app's (`mcpServers: []`,
  `packages/agent-runtime/src/acp/acp-runtime.ts`), so the config those routes
  edit is the one a session loads. Each vendor's CLI quirks are its adapter's
  to state (`claude-mcp-config.ts`, `codex-mcp-config.ts`), run through the one
  spawn policy (`vendor-process.ts`, whose pty option is claude's connector
  login under `script(1)`). A sign-in is one per agent and name, polled by
  its caller, and ended by its five-minute window, its row's removal or shutdown
  (`mcp-sign-ins.ts`). A plain list answers from
  the last read for ten seconds, because reading codex's spawns it and runs
  OAuth discovery against every URL row, which a poll would do every 1.5s;
  every edit and every sign-in's end reads again (`connectors-service.ts`).
  The retired registry is deleted at boot, never
  imported (`retired-connectors-file.ts`). A booted suite runs the vendors over
  stores under its own temp dir (`apps/cli/src/server/__tests__/boot-app.ts`).
  `apps/cli/src/server/connectors/vendor-mcp-config.ts`.

- **AGENT MEMORY IS REMOVED** (reversing #575). Claude Code and Codex carry
  their own; a third beside them was two answers to one question. What survived
  is the pattern: content the agent consumes lives in files it reads with its
  own shell. The dialect skills ride `INTELIGIR_SKILLS_DIR` with a
  three-sentence pointer on the first turn, never the spec inlined.

- **ONE SET OF SESSION FACTS, TWO PROJECTIONS, AND A LOADED SESSION IS HANDED
  ONLY THE INSTRUCTIONS IT DOES NOT HOLD.** The shell env and the prompt are
  pure functions of one `AgentSessionFacts`, and `shellEnv` is a getter read at
  every spawn, because read once `INTELIGIR_CONNECTED_DIRS` freezes at the first
  turn (`apps/cli/src/server/agents/agent-shell-env.ts`). ACP's `session/new`
  carries no instructions, so they ride a turn's prompt, and a loaded session
  gets them again only when their hash differs from the last set its thread was
  handed. Claude's `_meta.systemPrompt` is not used: it is one harness's
  channel. `apps/cli/src/server/agents/runtime-manager.ts`.

- **THE HOST CLOSES A PROVIDER SESSION IT GIVES UP ON, AND A CHILD'S DEATH
  FAILS ITS TURN THROUGH THE PROMPT.** The watchdog and a failed dispatch call
  `closeThread` first, so the next send resumes on a fresh child rather than a
  session holding the abandoned prompt. The child's exit closes the ACP
  connection with its status and last stderr lines, so the SDK rejects every
  pending request and a crash fails like a refused prompt. Rejected: an exit
  callback beside it, and per-thread exit generations, which fit a process
  shared by threads and would be a second answer to "did this turn fail?". A
  CLOSE counts, though: every host close bumps the thread's close generation,
  and an open that sees it move throws `ThreadClosedError` rather than spawn an
  orphan. `packages/agent-runtime/src/acp/acp-runtime.ts` and
  `apps/cli/src/server/agents/runtime-manager.ts`.

- **THE PROVIDER GRAMMAR IS WHAT THE ACP MAPPER EMITS, AND THE MAPPER IS PINNED
  TO THE ADAPTERS' REAL WIRE** (owner decision, reversing the kept-wide bb
  vocabulary). `ProviderEvent` carries exactly what `AcpTurnMapper` constructs,
  since a kind nothing produces is a branch every consumer carries. The mapper
  is tested against turns the pinned adapters really sent
  (`packages/agent-runtime/src/acp/__tests__/fixtures/<adapter>@<version>/`),
  because a fake agent encodes what the adapters were believed to send. The
  adapter and SDK pins are exact and move together, and a bump re-records
  (`packages/agent-runtime/scripts/record-acp-transcripts.ts`).

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

- **A STOP IS A CANCEL WITH A CLOSE BEHIND IT, AND THE TURN STILL ENDS THROUGH
  ITS OWN PROMPT** (owner decision: an agent writing the vault the wrong way
  needs a brake; deleting the unreachable `stopping` state was the rejected
  alternative). `threads.interrupt` sends ACP's `session/cancel`, and the turn
  settles through its prompt's `cancelled` end like any turn; one silent past
  `stopGraceMs` has its session closed and is settled by the host. Archiving a
  running thread stops it. A turn another device runs is refused (`CONFLICT`):
  only its own process can reach its provider, and the wire thread says so
  (`runsElsewhere`), so the panel draws no Stop there
  (`apps/desktop/src/renderer/app/thread-activity.ts`).
  `apps/cli/src/server/agents/runtime-manager.ts`,
  `apps/cli/src/server/threads/service.ts`.

- **AN ACTION'S ORIGIN IS ITS NOTE'S ID, and the path is only the fallback.**
  Rebinding the stored path on the rename route was rejected: Finder, an
  agent's `mv` and a pull never reach that route. The create stores the note's
  frontmatter `id` (`threads.origin_note_id`) beside the path, minting one
  through the comment store's guarded step
  (`apps/cli/src/server/vault/ensure-note-id.ts`); threads recorded by path
  alone are backfilled once after boot (`compose.ts`). A read resolves the id
  through the index (`pathForNoteId`), preferring the stored path while it
  still carries the id, so a byte copy never takes the binding.
  `apps/cli/src/server/threads/thread-origins.ts`.

- **THE THREAD LIST IS A KEYSET PAGE, AND A QUESTION A PAGE CANNOT ANSWER IS
  ASKED OF THE SERVER.** `threads.list` answers `limit` threads (default 50)
  after an opaque `cursor`, live before archived and newest first. An offset
  was rejected because a thread touched between two reads would shift every
  row behind it. A page is a window, so what must be whole is its own query:
  a note's actions (`originDocPath`), the rail's agent spinner (one
  `running` thread, archived ones included), and the palette's Actions search
  (`query`, a LIKE over the title and the stored origin path).
  `packages/db/src/threads.ts`,
  `apps/desktop/src/renderer/app/actions/thread-hooks.ts`,
  `apps/desktop/src/renderer/app/palette/threads-page.tsx`.

- **NO CONFIGURATION INSIDE THE VAULT RUNS ON THE AGENT'S HOST.** The vault is
  synced content (the hosted remote, a BYO remote, another device's pull).
  Claude sessions open with `settingSources: ["user"]`, the claude row's
  `sessionMeta` (`packages/agent-runtime/src/acp/harness-registry.ts`),
  because `project` and `local` read the vault's `.claude` settings and
  `.mcp.json`; CLAUDE.md and the vault-keyed MCP servers in `~/.claude.json`
  sit behind the same two gates, so they go too. codex-acp marks the session
  root trusted and takes no per-session option, so a pnpm patch marks it
  untrusted (`pnpm-workspace.yaml` names it), which also stops Codex reading
  the vault's AGENTS.md itself; the server's instructions already carry that
  file to both harnesses (`apps/cli/src/server/agents/agent-instructions.ts`).
  npm applies no pnpm patch, so a Codex session also refuses to open on a vault
  holding `.codex` (the row's `refusedVaultEntries`). Rejected: keeping a vault
  source and refusing its executing keys one by one, a list every vendor
  release can outgrow. User-level vendor config stays.
  `packages/agent-runtime/src/acp/__tests__/vault-config-isolation.test.ts`
  runs each pinned adapter against a fake vendor and reads what it was handed.

- **AN AGENT IS READY WHEN ITS VENDOR SAYS SO, THROUGH THE BUNDLED BINARY, OVER
  THE SHARED STORE, AND PATH IS NEVER CONSULTED** (reversing the PATH gate and
  the credential-file probe). Both runtimes ship inside the app, so a user with
  no vendor CLI installed is not an agent-less user: a harness row names its
  vendor executable, the override the adapter itself honours
  (`CLAUDE_CODE_EXECUTABLE`, `CODEX_PATH`) else the binary bundled beside the
  adapter, never PATH's. Signed-in is the vendor's own status command, read
  over `~/.claude` and `~/.codex`, so a Mac already signed in stays signed in;
  a file or keychain entry existing said nothing about whether the vendor still
  accepts it. Every vendor run goes through one spawn policy
  (`apps/cli/src/server/agents/vendor-process.ts`: the bundled binary alone,
  the data dir as cwd since a vendor reads project config from its cwd, the
  harness's `envOmit`, a deadline that kills the process group), and the answer
  is shared and kept 10s (`vendor-accounts.ts`), built in `serve.ts` so
  `compose.ts` spawns nothing. A send is refused up front only when the
  thread's own runtime is missing from the install; a signed-out vendor is not
  pre-gated, because the adapter's `authRequired` is the refusal and it names
  the vendor. `packages/agent-runtime/src/acp/harness-registry.ts`.

- **UNDO IS A THREE-WAY REVERT OF ONE TURN'S COMMIT, THROUGH THE VAULT'S OWN
  CAS.** `threads.undoTurn` (`inteligir action undo`) reads each path the
  turn's commit changed at its parent and at the commit, and merges the turn's
  change out of the bytes on disk now (`@repo/notes/text/revert-edit`), so an
  edit made since survives. A note whose later edits overlap or touch the
  turn's is kept whole and named, never half undone (owner decision); no Redo,
  since History restores. Rejected: `git revert` or `git checkout`, which
  bypass the CAS, the re-index, the `/ws` notification and the open buffer's
  convergence, and a byte restore to the parent, which discards every later
  edit, the user's included — the loss undo exists to remove. Every write is
  the vault's `writeIfUnchanged` / `removeIfUnchanged` / `absent` guard, so
  there is no second CAS and a write racing the undo is kept and named. A path
  a running turn claimed is `busy`, and a turn still running or already undone
  is refused (`CONFLICT`). The undo commits as the engine under
  `Undoes-Turn:`, holding commits while it writes, and never through
  `attributeWrites`, so an agent undoing an earlier turn from inside a later
  one does not commit the undo as its own. A COMMENT STORE IS TAKEN BACK ENTRY
  BY ENTRY, never as lines, which can break its json
  (`@repo/notes/comments/revert-entries`), after the notes: an entry goes or
  comes back only while it is as the turn left it, and a store that keeps an
  entry the turn touched is named `edited-since` and still loses the rest.
  `apps/cli/src/server/agents/turn-changes.ts`.

- **SIGNING AN AGENT IN IS THE METHOD ITS ADAPTER ADVERTISES, RUN BY THIS
  SERVER, ONE AT A TIME, AND A SIGNED-OUT AGENT IS ANSWERED BY ITS SIGN-IN, NOT
  BY A REFUSED SEND.** `agents.signIn` runs the harness row's `signIn`:
  claude's is an ACP terminal method, which the client runs, so the server runs
  the bundled claude's own login through the one vendor spawn policy, piped
  (the header of `agent-sign-in.ts` says why no pty), and the code its page
  shows reaches the login's stdin through `agents.submitSignInCode`, so a
  sign-in whose browser never opened still finishes; codex's is an agent
  method, so its adapter is started for the sign-in alone, on the env a session
  gets, and asked through `authenticate`
  (`packages/agent-runtime/src/acp/acp-sign-in.ts`). A login counts only once
  the vendor's own status says signed in. One sign-in per server, because two
  browser logins would race for one callback (`CONFLICT`), and a refused one is
  a `failed` outcome, never a refusal. The agent just signed in takes the
  default only from one a new thread could not run on, so a second sign-in
  never moves the user off the agent they use (`agents-service.ts`). Rejected:
  a pty (a native dependency, or `script`), which the login does not need; an
  API-key method, since there is no API-key fallback; and claude through the
  adapter's `--cli`, a node process in front of the same binary.
  `apps/cli/src/server/agents/agent-sign-in.ts`.

- **A TURN THE VENDOR REFUSED FOR THE PLAN'S USAGE LIMIT OR A SIGN-IN LEAVES THE
  QUEUE WHERE IT IS.** A refused prompt is read once, into its words and a class
  (`auth | usage-limit | overloaded | context | other`, `providerFailureSchema`
  in `@repo/domain/provider-event`), from what the adapter attaches: claude's
  `errorKind`, codex's `codexErrorInfo`, the reserved -32000, and claude's own
  limit text when no kind came with it (`readProviderError` in
  `packages/agent-runtime/src/acp/provider-error.ts`). `authentication_failed`
  reads as signed out whatever its code, so the panel says so rather than the
  adapter's text. The class rides `provider/error` as an optional field, which
  a log written before it parses without and a stale install strips. A
  settle whose turn failed `usage-limit` or `auth` does not drain
  (`failureHoldsQueue` in `apps/cli/src/server/threads/service.ts`): the next
  send starts the oldest queued message first. Rejected: draining as for any
  failure, which spends every queued message on the same refusal and leaves
  nothing for after the limit resets or the sign-in.

### Dictation

- **DICTATION IS THE OPERATING SYSTEM'S** (owner decision, reversing streaming
  Parakeet; do not bring an in-app recognizer back). macOS dictation (fn twice,
  Edit › Start Dictation) and the phone keyboard's mic type into a field like a
  keyboard, so the app holds no microphone entitlement (`device.audio-input`,
  deliberately absent from `apps/desktop/resources/entitlements.mac.plist`), no
  `NSMicrophoneUsageDescription`, no web permission, no model and no socket.
  Rejected: an in-app recognizer, whose live partials cost a native addon on a
  worker, a ~100 MB third-party download behind a sha gate, a dictation socket
  and the app's only device grant. Every window denies every permission
  request (`on_permission_request` in `apps/desktop/src-tauri/src/window.rs`),
  which `tools/e2e/src/scenarios/desktop-shell.ts` reads back as a denied
  location and notification request, since a runner has no microphone to ask
  for; the model folder an install already holds is removed after listen
  (`apps/cli/src/server/retired-model-dir.ts`). A Mac's ⌘K composer says "fn
  fn to dictate" beside Send, the app's one hint
  (`apps/desktop/src/renderer/app/actions/action-composer.tsx`). A dictated
  phrase lands as one IME-style commit; the composer's field carries no caret
  repair, and `tools/e2e/src/scenarios/os-dictation-browser.ts` lands dictated
  and typed words in order.

### Cloud, sync and accounts

- **THE DEVICE CREDENTIAL IS THE SYNC SWITCH AND THE ENTITLEMENT, and it lives
  in the data dir.** `<dataDir>/device-credential` at 0600: not in
  `inteligir.db` (the thread log it uploads) and not in the vault (a git repo
  pushed to a remote). No separate "sync enabled" flag, since two values that
  must agree can disagree: signed out, the sync client opens no socket, arms no
  timer and makes no request (asserted in
  `apps/cli/src/server/cloud/__tests__/sync-runtime.test.ts`), and the app
  sends this project's cloud nothing; what does leave the machine (the update
  checks, the agent's own provider) is `docs/privacy.md`'s to list. Signed in,
  the credential alone entitles threads, captures and the hosted vault, except
  that a folder with an origin of its own, or one another service syncs, never
  takes the hosted vault (AN OPENED FOLDER'S OWN ORIGIN, in the Vault group);
  its threads sync either way. The hosted vault's ceiling is a size, not a flag
  (THE HOSTED VAULT IS CAPPED, below), and the invite gate is account-creation
  policy. The BYO remote is the vault's own origin and stays accountless;
  `INTELIGIR_VAULT_REMOTE` only pins one over it. Cost accepted: "pause sync"
  is signing out, which discards the queue.
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
  and the loopback callback, a ceremony whose point was keeping the password
  out of the app. Residual: the password passes through the app once over
  HTTPS. No social providers: a login that must work inside the app can only be
  a password. A device can also CREATE the account (owner decision: sign up in
  the app, with the invite code): `POST /v1/device/sign-up` answers the same
  credential and deletes the session the sign-up created, so a person never
  signs in twice in a row. The site's sign-up page stays, the phone stays sign-in
  only, and the CLI has no sign-up verb, since creating an account is a
  person's act. `@repo/contract/cloud/device/login-flow.ts`,
  `apps/web/src/worker/device/login.ts`, `apps/web/src/worker/device/sign-up.ts`,
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

- **AN ACCOUNT IS DELETED FROM THE APP, THE PASSWORD ASKED AGAIN, THROUGH
  BETTER AUTH'S `deleteUser`** (owner decision: someone who lost their Mac signs
  in on any Mac to delete). The app holds a device credential and no session,
  so `POST /v1/account/delete` takes the credential, spends a per-device
  window, checks the password through `signInEmail` and runs `deleteUser` under
  the session that sign-in minted: its `beforeDelete` order and tombstone stay
  the ONE purge path, where a second purge beside it would drift. The
  credential alone deletes nothing, since whoever holds a stolen one could end
  the account. The local server asks on a client of its own, because the purge
  revokes this very credential first; success forgets the sign-in as a sign-out
  does, minus the revoke, and leaves the vault alone. A deletion whose answer
  never came back may have happened, so the server keeps its credential, and a
  retry that meets only that credential's refusal, or finds the session
  already ended by it, is read as the account gone and signs this Mac out; any
  other refusal proves the account is there. No CLI verb: the password is a
  person's to type. `apps/web/src/worker/device/account.ts`,
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
  (`apps/cli/src/server/browser-opener.ts`). The cloud vault-path grammar is
  `parseVaultPath` with the parse required to be the identity. The
  `[[Title|uuid]]` tier lives in `buildResolver` (tier 0), reached through the
  `id` the wiki-targets rows carry, and on the phone through the id and aliases
  its mirror reads from each note's frontmatter.

- **A /CLOUD CLIENT IGNORES WHAT IT DOES NOT KNOW, and the Worker is held to
  exactly what it declares** (owner decision, reversing "final at birth").
  Every response schema under `@repo/contract/cloud` strips an undeclared field, and
  an unknown refusal code reads as `internal`, a fault to retry, never a
  verdict on the credential. Strict readers made every additive change a new
  route and turned a stale client's `unauthorized` into `malformed`, so a
  revoked device kept retrying; for the same reason a 5xx, 408 or 429 with no
  error envelope reads as `unreachable`. Requests stay `.strict()`, since only
  the always-newest Worker parses them, and the Worker's tests parse every
  answer through `emitted` (`apps/web/src/worker/__tests__/cloud-helpers.ts`),
  because a stripping client would let a leaked column through. Two things
  still close the wire: 0.4.0 and older parse strictly, and a field that
  changes what a row MEANS reaches only a client whose request declares it.
  `packages/contract/src/cloud/cloud-client.ts`,
  `packages/contract/src/cloud/cloud-errors.ts`.

- **Say the delivery guarantee you implement.** Captures are at-least-once
  delivery with exactly-once deletion by the owning claim, so the apply must be
  idempotent on the capture id (`@repo/contract/cloud/captures/captures-schema`).

- **The THREAD channel carries thread events alone, and a thread's own facts
  are events on it** (owner decision). A thread with no events never reaches
  another device; vault bytes ride the git remote. A thread states its title,
  origin note (path and `id`, so no move is ever stated), harness and archive
  as rows on its log (`thread/meta`, `thread/archived` in
  `@repo/domain/provider-event`); a fact about a thread that never made a
  request stays local, since alone it would arrive as an empty action. A stale
  install skips a type it cannot read, so a new event type needs no new route.
  The Worker keeps no per-thread row beside the log (owner decision): the
  push's `threads` half and the `thread_meta` lane it filled are gone, the
  dispatch inbox carrying what the lane was for, and a 0.4.0 install's
  `threads` is still accepted and dropped, since refusing the key would refuse
  its every push. `apps/cli/src/server/threads/service.ts`,
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

- **A SYNC PASS IS CAPPED, A CAPPED PASS IS FOLLOWED AT ONCE, AND "SYNCED"
  MEANS EVERY STEP REACHED THE CLOUD AND LEFT NOTHING.** Each step answers
  where it stopped (`SyncOutcome` in `@repo/contract/cloud/sync/sync-session`). The
  cap stays because a teardown waits out the pass in flight; on `more` the
  next pass runs at once, so a backlog drains in one sync. Only a pass whose
  every step caught up stamps `lastSyncedAt`. A throw other than a row the log
  refuses fails the pass with the cursor unmoved, because moving past it would
  lose the row for good. The status reaches the renderer on the bus's
  `sync-status-changed`, so nothing polls it; the socket drops itself after two
  silent keepalives, since a half-open connection neither answers nor closes.
  `apps/cli/src/server/cloud/sync-pass.ts`, `sync-runtime.ts` and
  `packages/contract/src/cloud/sync/cloud-socket.ts`.

- **The outbox stores the bytes it will send, once, at enqueue.** The log calls
  a position replayed with a different body `sync-conflict`; `deviceSeq` is its
  own counter, not `MAX()` over a shrinking queue. A body over the row cap is
  CLIPPED before it is frozen, never dropped, because a dropped
  `item/completed` leaves its item pending on every other device forever:
  `clipThreadEventForSync` (`@repo/contract/cloud/sync/fit-sync-event`) elides the
  middle of the largest texts and never a type, an id, a status or a scope. An
  event the contract still refuses is dropped rather than stranding every event
  behind it, and so is every row a log refusal names; each drop is COUNTED in
  the delete's own transaction (`sync_state.dropped_events`) and shown until
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
  a request to a Mac stands are shown; a refused request keeps its words and
  the Mac's reason until dismissed. A sign-in is ONE session: every runtime reads under
  `SyncRuntime`'s, so a revocation any request hears ends the sign-in for all,
  and each checks its fence before recording a refusal, so one heard under an
  earlier sign-in never ends the next (`apps/mobile/src/lib/compose-runtime.ts`).
  Which screens exist is the route guard's answer (`Stack.Protected` in
  `apps/mobile/src/app/_layout.tsx`), never a per-screen branch.
  `apps/mobile/src/sync/sync-runtime.ts`,
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

- **THE HOSTED VAULT'S PATHS ARE BUDGETED PER DEVICE, and the budget buys
  time, not prevention.** The `/v1/vault/*` reads, `/v1/vault/commit` and
  `/v1/git/*` each consume a window keyed on the device, never the address: a
  stolen credential moves between addresses and the device row is what
  `/app/devices` revokes. Three families so a drained budget never takes
  another down, a looping phone writer included; each ceiling is set from the
  worst legitimate minute (a phone's first mirror for reads, a queue draining
  one change set at a time for writes), and revocation is the control
  (`apps/web/src/worker/rate-limit.ts`). A read-scoped credential is the
  deeper answer and is not built; the trigger is a second party holding a
  credential for someone else's account.

- **THE HOSTED TREE IS WALKED ONCE PER HEAD INTO ONE SLOT PER REPO, AND A
  MIRROR READ IS PINNED AND BATCHED.** Every directory is a call into the repo
  cell a push also waits on, so a head's listing, each blob's `oid` included,
  is kept in R2 tagged with its commit: one slot, not a key per commit, which
  would keep an object for every head any device ever listed, and a cache
  failure is a miss, never a refusal (`apps/web/src/worker/vault/tree-walk.ts`,
  pure over a `listTree` port, and `tree-listing.ts`); a slot in an older shape
  fails its parse and is walked again. A phone holds every note's text, so it
  fetches only what changed, forty paths to a `POST /v1/vault/files` that
  spends one read unit; one `/v1/vault/file` per note made a 5,000-note first
  mirror 5,000 requests against the device's budget. `ref` is REQUIRED on the
  batch, because a batch read at a head a push moved would hand the mirror
  bytes its listing never named. Forty because each path is a cell call and a
  Free invocation makes at most 50 subrequests; past the byte budget the rest
  is `deferred`, never the first file.
  `packages/contract/src/cloud/vault/vault-schema.ts`,
  `apps/web/src/worker/vault/read-routes.ts`.

- **A PHONE WRITE IS ONE CHANGE SET OF BLOB-CAS'D CHANGES, AND THE WORKER
  COMMITS IT THROUGH THE CELL'S OWN RECEIVE-PACK.** `POST /v1/vault/commit`
  takes puts, deletes and moves, each naming the blob it was computed from
  (null: the path must be absent), so a rename's link rewrites, a photo and the
  note embedding it, or a merge and its conflict copy land together, on the
  head they were checked against or not at all. A stale base answers 409
  `vault-conflict` with what the head holds and the device that last wrote it,
  beside the ordinary envelope so an envelope-only reader still names the
  refusal; the Worker never merges. A change whose target the head already
  holds is satisfied, which makes an offline queue's resend harmless with no
  idempotency key, a second store the Worker would have to keep and expire. The
  base is a blob oid, not a commit, so a desktop push of another note between
  the phone's read and its write does not refuse it. An account with no hosted
  vault yet is refused, never created: the Mac's first push creates it.
  durable-git's `RepoCell` answers reads alone, and its one write path, a push,
  already guards each ref with a CAS on a serialized chain, so the Worker builds
  the git objects itself (`apps/web/src/worker/vault/git-objects.ts`) and
  pushes them through the one door every push takes (`receive-pack.ts`).
  Rejected: patching a write RPC into durable-git, a second writer with its own
  locking beside the push chain. A tree whose listing does not hash back to its
  own oid, and a name a sibling holds in another case or normalization, are
  refused rather than guessed, since the cell decodes names leniently and a
  Mac cannot hold both. Author and committer name the device (the committer's
  email marking the Worker), because a conflict copy names the other device
  from the committer. `packages/contract/src/cloud/vault/vault-commit-schema.ts`,
  `apps/web/src/worker/vault/commit-route.ts`,
  `apps/web/src/worker/vault/commit-changes.ts`.

- **THE HOSTED VAULT IS CAPPED ON WHAT THE CELL STORES, AND TAKES A PUSH OF AT
  MOST 90 MiB** (owner decision: free, about 1 GB an account, every stored
  version counted, so deleting notes frees nothing, and no compaction in 0.6;
  a stated push cap now, large files later). `VAULT_STORAGE_CAP_BYTES` in
  `apps/web/cloudflare.config.ts` is the ceiling and `RepoCell.usage()`, a pnpm patch
  over durable-git (`patches/durable-git@0.0.8.patch`), the cell's own size:
  its SQLite file plus the packs it keeps in R2, not the gc guard's sum, which
  counts a SQLite-held pack twice. `VAULT_GIT_MAX_PUSH_BYTES`
  (`packages/contract/src/cloud/vault/vault-git.ts`) sits under the edge's 100 MB
  request body, so the 413 is always the Worker's own. ONE gate, in
  `apps/web/src/worker/vault/receive-pack.ts`, meets every pack headed for a
  cell, a desktop's push and a phone's commit alike, so the two cannot
  disagree: a full vault is refused before the body is read, a declared length
  past the room left is refused, and a streamed body is cut at the tighter of
  the room and the push cap; reads are never refused for size. The engine reads
  a 507 as `full`, not the offline a 5xx would be, and skips a push while the
  tips a refusal named still stand, since each retry would upload the cap's
  worth again, while commits land and pulls go on
  (`apps/cli/src/server/vault/git-engine.ts`); the phone keeps the refused
  edits queued. The first refusal costs no upload either: a push to the account
  remote is measured first (`packExceeds` in
  `apps/cli/src/server/vault/git-run.ts`). Rejected: splitting the push into commit-sized steps, since
  a vault's first commit is the whole tree; a Worker-side meter, which counts
  bytes offered, not kept; and the head tree's size, which ignores the history
  that grows.

- **A PHONE ASKS A MAC THROUGH A CLAIMABLE DISPATCH INBOX, THE REQUEST LANDS
  THROUGH THE MAC'S OWN SEND, AND THE THREAD IS ITS LEDGER** (owner decision).
  The phone never pushes to the log, so a request cannot ride it: a `turn` row
  waits beside the captures in the account's `ThreadSyncDO`, any Mac may claim
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
  would wait on a queue a remote settle never drains; a signed-out agent is
  delivered, and its `provider/error` is what the phone reads. A new thread
  binds its note by `noteIdOf`, read and never minted, because a mint waits on
  the vault's lock and a claim held past its lapse runs on a second Mac. A
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
  it an outbox and a `deviceSeq` of its own. Residual: a follow-up one Mac
  claims on a thread another Mac ran opens a fresh provider session there.
  `apps/cli/src/server/cloud/dispatches.ts`,
  `apps/cli/src/server/cloud/sync-pass.ts`,
  `apps/cli/src/server/threads/service.ts`.

- **A VAULT READ CARRIES ITS PATH IN THE BODY, NEVER THE URL.** Cloudflare
  keeps each request's URL in the Worker's request log and in its sampled
  traces for up to seven days, and a vault path names a user's file, so the
  tree, file and asset reads POST their query to the routes they always had
  (`packages/contract/src/cloud/cloud-client.ts`); the Worker parses the body, or a
  GET's search params for the installs that still send those, with one schema
  per read (`parseRead` in `apps/web/src/worker/vault/read-routes.ts`).
  Rejected: turning the invocation log off, which leaves the traces' URLs and
  takes the operator's one view of a failing route, and reads addressed by
  blob oid, which the asset route cannot type or size-gate without the path.
  `docs/privacy.md` says what the log keeps.

- **A PR PREVIEW IS A WORKER PREVIEW DRIVEN BY ACTIONS, not Workers Builds**, and
  it binds preview-only resources. Workers Builds would deploy on push and could
  not wait for CI or keep Deploy's environment gate, so previews ride
  `workflow_run` after CI like Deploy does (which also keeps them out of the
  CI-parity sweep), limited to this repo's branches because that trigger holds
  secrets. A preview inherits no binding, so `apps/web/cloudflare.config.ts` binds
  each, when `isPreview`, against `inteligir-auth-preview` / `inteligir-vault-preview`; pointing a
  preview at the production D1 was rejected, since PR code would write real
  accounts. The status is one sticky comment plus a GitHub deployment on the
  head commit (`.github/scripts/worker-preview.mjs`), created by the script
  because a job's `environment:` under `workflow_run` records the default
  branch. `.github/workflows/preview.yml`, `apps/web/README.md` § Previews.

### Server process and the desktop shell

- **ONE BINARY, TWO MODES: `inteligir serve` IS the server, and `npx` is a verb**
  (reversing the launcher-boots-in-process line). `npx inteligir serve --open`
  is the developer's and the agent's zero-install path, with one exit code; a
  user installs the signed dmg and never meets it. The desktop shell is Rust,
  so the server is its one child, on the node the .app carries, supervised
  with the deliberate absence of a restart, since a fresh child mints a
  session the window's cookie does not hold. A quit sends SIGTERM and waits
  the teardown budget the child announced before SIGKILL, inside
  `RunEvent::Exit`, since Cmd+Q leaves no later step to wait in; the child
  holds a pipe the shell never writes, so a shell that crashes or is killed
  closes it and the server shuts down rather than hold the data dir, and runs
  in a process group of its own, so a signal to the shell's group reaches the
  server once, through the shell, since a second one skips the flush
  (`apps/desktop/src-tauri/src/server.rs`, the `lifeline` `runServe` watches
  once its signals are, in `apps/cli/src/server/serve.ts`). Whether
  `server.json`'s owner still serves has ONE reading,
  `apps/cli/src/server/server-probe.ts`, which the boot's guard and the shell's
  adoption both project; the shell refuses a server of another version,
  because `/local`'s two ends may break freely only while they ship together.

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
  from it because crash recovery writes. The seams: `vault/git-run` /
  `git-porcelain` / `git-bootstrap` / `git-engine`; `cloud/sync-pass` /
  `sync-cadence` (the socket link is the client core's, shared with the phone);
  `agents/interaction-waiters` beside a watchdog that sweeps per-turn
  timestamps rather than re-arming a timer per frame; `writeTransaction` in
  `@repo/db/connection` as the one spelling of `BEGIN IMMEDIATE`. `serve.ts`
  injects node's socket dial and the agent driver because compose is reachable
  from the renderer's test program.
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
  Writers stop, the vault flush runs, handles close; each step has its own
  budget because one wedged step under a single budget starves the flush. The
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
  vault (`apps/cli/src/server/csp.ts`). The shell's own config
  (`apps/desktop/src-tauri/tauri.conf.json`) carries a policy for a page it
  would serve itself, held to the server's for a page with no socket, plus
  Tauri's IPC origins, by `tools/repo-guards/src/desktop-shell-wire.test.ts`.
  AN HTML BLOCK'S RUN IS A FRAME WITH A POLICY OF ITS OWN,
  `sandbox allow-scripts; default-src 'none'`
  (`apps/cli/src/server/html-block-frame.ts`). `pnpm dev` stamps no CSP.

- **THE APP WINDOW IS THE SERVER'S OWN PAGE, AND HOLDS NO BEARER** (#889,
  reversing the `inteligir://` protocol door: a WKWebView scheme handler can
  neither carry the socket's upgrade nor stream a body). The shell opens the
  window on the one-time handoff link the server announces, so the page signs
  in as a browser tab does (THE CREDENTIAL IS A FILE) and is same-origin with
  `/rpc`, `/ws` and `/vault/asset`, with no CORS and no token in the page. The
  window is pinned to that origin, compared by its parts, never by prefix or
  `Url::origin`, which answers an opaque origin for a non-special scheme: any
  other web page opens in the browser, at most once a second since WebKit says
  nothing of the click behind a navigation, anything else is refused,
  `window.open` opens no window, and every permission is denied
  (`apps/desktop/src-tauri/src/navigation.rs`, `window.rs`). The window keeps
  a web store keyed by its data dir, because every data dir's server answers
  on one port and the page's prefs are the origin's; that needs macOS 14,
  below which every data dir shares one. Rejected: a Rust
  proxy on a custom scheme and a socket relay over IPC, which rebuild in a
  second language what the browser path already is. THE BRIDGE CARRIES ONLY
  WHAT THE SHELL OWNS (the updater and the diagnostics), because no server can
  answer for either. Each command
  is one row of `apps/desktop/src/ipc-contract.ts`, parsed by zod in the page
  (`apps/desktop/src/renderer/shell-commands.ts`) and by serde in the shell
  (`apps/desktop/src-tauri/src/commands.rs`), and granted at runtime to that
  window on the server's exact origin alone (`grant_app_window`), and
  `removeUnusedCommands` drops every command no capability names. `tools/repo-guards/src/desktop-shell-wire.test.ts`
  holds the names equal across the two languages, which no compiler sees
  together. A refusal crosses as a value (`{ ok: false, reason }`), never a
  rejection, which the page reads as a fault. Residual: the page holds the
  per-boot cookie (HttpOnly, SameSite=Strict, dead with the boot), and Tauri's
  IPC from the server's origin falls back to `postMessage` under its CSP, at
  the cost of one console line.

- **UPDATES ARE TAURI'S UPDATER OVER THE GITHUB RELEASE, and nothing moves
  without a click** (reversing "no update feed"; electron-updater until #889).
  The release carries the dmg, `Inteligir.app.tar.gz` with its minisign
  signature and `latest.json`, written by the pack
  (`apps/desktop/scripts/package.mjs`) and uploaded by the owner's release step
  (`docs/releasing.md`); the signing key is the owner's release secret, and a
  pack without it makes no feed. A check 15s after launch and every 4 minutes,
  the download and the restart each a click. Install stops the server child
  first, so the vault's pending commit flushes before the bundle is replaced.
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
  or Dock launch inherits launchd's bare PATH. The agent's runtime needs none
  (it is bundled), but the agent's bash and the vendor's stdio MCP servers run
  the user's own commands by name. A packaged launch runs `$SHELL -ilc` once,
  capped at 5s, through the desktop door's `launch`, and prepends its PATH to
  the shell's own for every node child after it: the server and each door
  question. Rejected: a fixed list of bin dirs alone, and an `LSEnvironment`
  PATH in the bundle, since neither can know a version manager's directory.
  `apps/cli/src/desktop/login-shell-path.ts`.

- **NODE SHIPS BESIDE THE SHELL, SIGNED, AND THE SHELL HANDS IT NO
  CODE-LOADING ENVIRONMENT** (#889, reversing the fuses and their "Rejected: a
  bundled node binary"). The Tauri binary runs no JavaScript, so the server,
  the watcher and each ACP adapter run on the official darwin-arm64 node, a
  `bundle.externalBin` sidecar fetched against a pinned sha-256
  (`apps/desktop/scripts/fetch-node.mjs`), with the CLI and its production
  `node_modules` as a resource (`apps/desktop/scripts/stage-server.mjs`); the
  server forks its children with `child_process`, as under `npx`. Every Mach-O
  in the resources is signed with the hardened runtime and the one
  entitlements file before bundling (`apps/desktop/scripts/sign-resources.mjs`).
  The shell finds node and the CLI only where its bundle carries them, never
  through a variable, and starts every node child with `NODE_OPTIONS` and
  every other `NODE_*` but `NODE_ENV` removed (`scrubbed_env` in
  `apps/desktop/src-tauri/src/runtime.rs`), so an `open --env` runs no code
  inside a process TCC counts as Inteligir: the job two fuses did. Rejected: `bun build --compile`, under which better-sqlite3 does not
  load, and Node's single-executable apps, whose blob holds no native addon and
  no split ESM entry. Residual: that node is a signed interpreter any local
  process can run, as the `runAsNode` fuse had ruled out for the Electron
  binary; it carries the JIT entitlements and no other grant.

- **DIAGNOSTICS ARE `INTELIGIR_DEBUG`'S NAMED TRACES, SHIPPED IN EVERY BUILD,
  AND IN THE PACKAGED APP A SWITCH AND A FILE, BOTH THE SHELL'S.** The watcher,
  the index, the sync pass and the ACP adapter drop, skip and fence without a
  trace, and a user's "it didn't update" cannot wait for a build. So each
  decision calls its namespace's log, `undefined` while the namespace is off,
  so an untraced site costs one read. A line names paths, ids and protocol
  words, never a note's content or a credential, because it is written to be
  pasted into a report; the ACP tap drops any field that is not a protocol word
  (`packages/agent-runtime/src/acp/frame-trace.ts`). An unknown name is refused
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
  highlight is the one proximity pill every other popup draws; cmdk's filter
  was already off on every page, and its keyboard beside the pill was two
  answers to "which row is live?". ROWS ARE CHILDREN, NOT DATA, diverging from
  Fluid's `items` array deliberately: several row shapes in a data array would
  be a second answer to what a row is. The panel KEEPS the top edge a panel at its
  cap height would have, so the field never moves as rows filter down. A chord
  draws one box per key from the one modifier table
  (`@repo/ui/lib/hotkey-spelling`). ONE DIALOG FOR EVERY PAGE, so a page switch
  never re-animates the backdrop; a page is a union member, so a page cannot
  exist without what it needs to draw.
  `packages/ui/src/components/command.tsx`,
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

- **SETTINGS COVERS A WORKSPACE THAT STAYS MOUNTED** (owner decision).
  Settings is a layer over the workspace in the pathless `_workspace` layout,
  not a sibling route, which unmounted the composer and what it held. Covered,
  the workspace is `inert` and its `GLOBAL_SHORTCUTS` listener detached, since
  inert does not stop a window listener.
  `apps/desktop/src/renderer/routes/_workspace.tsx`,
  `apps/desktop/src/renderer/app/__tests__/workspace-runtime-mount.test.tsx`
  and `apps/desktop/src/renderer/app/__tests__/workspace-routing.booted.test.tsx`.

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
  platform rules, ws change-kind reachability (`tools/repo-guards`),
  route-table completeness (`apps/cli/src/server/__tests__/http-surface.test.ts`),
  migration↔schema agreement
  (`packages/db/src/__tests__/schema-agreement.test.ts`), the per-export orphan
  guard and the type-role guard over `@repo/ui`, the CLI guide and its `--json`
  flags. If coverage is ever added,
  `coverage.include` is mandatory in Vitest 4, and gate only `@repo/notes`. A
  guard states its own rule in the failure, names the file, and derives every
  value it can; what it cannot is a row carrying its reason
  (`AWAITING_CONSUMER`, `CLOUD_ONLY_CLIENTS`, `DECLARED_CI_EXTRAS`,
  `EXCLUDED_COMMANDS`, `PROSE_SIZES`), and `dep-dag.test.ts`'s
  `DECLARED_EDGES` is the pin itself.

- **VENDORED CODE IS THIS REPO'S CODE, except for the attribution.** Rename,
  restructure and delete freely; "the next re-pull becomes a conflict" is not a
  reason. Every vendored file keeps its `// Vendored from X, MIT.` header and the
  licence texts live under `tools/licenses`, staged into the artifact as
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
  why neither a file guard nor knip can ask this). Base UI's `render` prop is the
  polymorphism channel; there is no Slot.

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
  tauri-driver are pinned by hand in `.github/workflows/ci.yml` because a
  global install rides no lockfile, and the Rust toolchain by
  `apps/desktop/rust-toolchain.toml`, beside the `Cargo.lock` every cargo step
  runs `--locked` against. The arguments are `pnpm-workspace.yaml`'s comments. AN UPDATE
  SWEEP SKIPS THE EXPO SDK'S NAMES, NOT ITS `expo:` CATALOG: `update.ignoreDeps`
  holds `expo`, `expo-*`, `@expo/*`, `react-native`, `react-native-*` and
  `@react-native/*` under `pnpm up --latest -r`. It matches by name, so `react`
  and `typescript`, which web shares, cannot be listed without freezing web
  too: after a sweep, revert the `expo:` catalog rows by hand, then
  `npx expo install --check` in `apps/mobile`. An SDK upgrade moves all of them
  together.

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

- **A DEPENDENCY'S COST WE CANNOT WAIT OUT UPSTREAM IS A pnpm PATCH, AND A TEST
  FAILS WITHOUT IT.** micromark merges a paragraph's text with one splice per
  line, and GFM's email autolink splits it at every word, so one long paragraph
  parsed in time quadratic in its lines. `patches/micromark@4.0.2.patch` is
  upstream's own open fix (micromark/micromark#233), applied through
  `patchedDependencies` in `pnpm-workspace.yaml`; a bump fails the install
  until the patch is re-cut or dropped. A workaround in `@repo/notes` was
  rejected: splitting the paragraph changes what it parses to.
  `packages/notes/src/__tests__/projection-cost.test.ts` compares a 20k-line
  paragraph's projection with an eighth of it. Residual: a paragraph dense with
  emphasis or inline nodes is still superlinear upstream, and not patched.

- **THE SHELL'S GLUE RUNS IN E2E OVER WEBDRIVER, AND ITS WIRE IS A GUARD.**
  The shell's policies are pure and unit-tested (`cargo test`, and the CLI's
  desktop door under vitest); what joins them (the window's sign-in, the pin,
  every command, the quit) is `tools/e2e/src/scenarios/desktop-shell.ts`, with
  `desktop-diagnostics.ts`: the built shell on Linux, driven through
  `tauri-driver` and WebKitGTK's WebDriver (`tools/e2e/src/harness/webdriver.ts`),
  which also gives the renderer its one WebKit run. Not the packaged `.app`: packing is minutes, and
  the bundle, the signatures and the sidecar stay `pnpm smoke:desktop`'s, on
  the macOS job. The static half is
  `tools/repo-guards/src/desktop-shell-wire.test.ts` (THE APP WINDOW IS THE
  SERVER'S OWN PAGE).

- **NO TYPE ASSERTION, AND NO ESCAPE COMMENT** (owner decision).
  `typescript/consistent-type-assertions` at `assertionStyle: "never"` refuses
  every `as T` and `<T>x`, tests included; `as const` and `satisfies` stay
  legal. anti-slop's `require-safety-comment-for-type-assertion` is off: it
  admitted a cast behind a `// SAFETY:` comment, so a green lint read as
  permission; documenting that escape was the rejected alternative. A
  library's wide type is narrowed by its own guard or parsed by the schema
  that names it. `oxlint.config.ts`.

- **A CLIENT VERB LOADS THE CLIENT, AND THE BUILD REFUSES A STATIC IMPORT
  PAST IT.** The CLI bundle splits on dynamic imports, so what every verb
  parses before it reads argv is the entry's static closure; the server and
  the frontmatter parser (yaml, 72 modules) sit behind `await import()` in the
  verbs that need them. A static import that reaches yaml passes every test and
  every review, so `apps/cli/scripts/build.mjs` walks the metafile's static
  closure and fails naming the importer (`LOADED_ON_EVERY_VERB_REFUSED`).

- **THE PHONE SHIPS THROUGH EAS TO TESTFLIGHT, AND AN UNSET CLOUD URL IS THE
  PRODUCTION ORIGIN ON BOTH CLIENTS.** `pnpm testflight:mobile` builds on EAS
  and submits, iPhone only (owner decision); the signing credentials live on
  EAS, never in the repo, and build numbers are EAS's
  (`appVersionSource: remote` in `apps/mobile/eas.json`), so no commit bumps
  one. The marketing version is `apps/mobile/package.json`'s, one product
  version with the CLI and the desktop, and EAS builds with the repo's node and
  pnpm (`tools/repo-guards/src/release-versions.test.ts`). A JS-only fix is an
  EAS Update to builds of the same native fingerprint, a native change a new
  build (owner decision). `PRODUCTION_CLOUD_ORIGIN` (`@repo/contract/cloud/origin`)
  is the one spelling the CLI's config and the phone's `getCloudUrl` fall back
  to; the phone reads `EXPO_PUBLIC_CLOUD_URL` at bundle time and refuses a
  malformed one. Rejected: per-profile env in `eas.json`, a second spelling of
  the origin, and a fallback to a dead host, which made a misconfigured build
  one that could only fail. `apps/mobile/src/__tests__/app-config.test.ts`
  holds the store config to what App Store Connect judges.

**Before raising a "new" finding, read
[#542](https://github.com/kyh/inteligir/issues/542)**: the decision record
carries what was rejected as well as what was chosen. The `note` issues are
the declines register: #877 (0.6's settled non-work), #881 (the 0.6 landed
review's refuted findings), #788 (the 2026-09-22 architecture review's refuted
findings), #645 (the 2026-09-01 review), #674
(the 2026-09-05 simplify pass), #603 (Moss parity) and #705 (the CodeMirror
trade); the older ones (#446, #453, #472, #474) catalogue findings declined
against the hosted Durable-Object architecture this rewrite replaced.
