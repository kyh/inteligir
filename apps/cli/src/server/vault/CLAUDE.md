# Decisions: the vault service

Vault writes, the git engine underneath them, sync and containment. `AGENTS.md`
§ Decisions says how a bullet is written and cited.

## Vault: writes, git and containment

- **THE AUTO-COMMIT IS SESSION-SHAPED (15s quiet / 60s max) AND STAGES WHAT THE
  WINDOW'S WRITERS NAMED**, so the log is answerable: a single-file commit names
  its file and a fifteen-second pause ends an editing session. A scheduler that
  names no paths (the boot sweep, the post-sync drain), a window past
  `MAX_SCOPED_COMMIT_PATHS` and the flush after a failed one are unscoped; a
  change nobody announced waits for one. A turn's start stages the whole tree
  less every path a live turn claimed (`checkpointUnclaimed`), because
  `--literal-pathspecs` rules out an `:(exclude)` and naming every other path is
  an argv a first commit overflows; unscoped `add -A` survives for that same
  ARG_MAX. `apps/cli/src/server/vault/git-engine.ts` says why the max wait is
  the sync interval.

- **NOTE HISTORY IS LOCAL, AND A RESTORE IS A WRITE.** History reads the vault's
  own git repo, so it works offline. A restore writes the revision's bytes
  through the ordinary guarded write, never `git checkout` or `git revert`,
  which would bypass the CAS, the re-index, the `/ws` notification and the open
  buffer's convergence; there is no `vault.restore` procedure, since a second
  server write path is a second CAS. A CAS refusal is reported, not
  diff3-merged, because the user named exact bytes
  (`apps/cli/src/server/vault/git-history.ts`,
  `apps/workspace/src/app/actions/history-tab.tsx`, `vault restore` in
  `apps/cli/src/commands/vault.ts`). A deleted note comes back the same way,
  from the log's deletions plus the worktree's uncommitted ones. There is no
  trash folder and no purge.

- **A WRITE CARRIES THE BASE IT WAS COMPUTED FROM AND NAMES ITS GUARD, AND A
  CREATE IS NOT A WRITE WITH AN EMPTY BASE.** `vault.write`'s `guard` is a
  required union (`packages/contract/src/local/vault/vault-schema.ts`):
  `expected` carries the hash the write was computed from, `absent` is a create,
  `overwrite` is last-writer-wins spelled out. One required field rather than
  two optional ones, which would make last-writer-wins the silent default and
  let a hash and a create travel together. `expected` is compared under the repo
  lock (`apps/cli/src/server/vault/vault-router.ts`); a mismatch answers 409
  with the current content and the client diff3-merges and retries, rather than
  active-user-wins, which discards concurrent body edits wholesale. A write
  ANSWERS THE BYTES THAT LANDED and the open buffer rebases onto them, because a
  buffer kept over a merged base passes the next CAS without the external edit.
  Hashing bytes not yet on disk is a refusal every time, so a create carries no
  hash; a guarded write with no recorded base throws rather than infer one,
  because an inferred base lets a concurrent edit win silently. A path already
  taken answers `exists`, a `CreateOutcome` rather than a throw, and that is the
  one existence check: `createFileAt` reuses the file, `createNewFileAt` hands
  it back to step past (`packages/editor/src/note/vault-session.ts`). The
  diff3-on-409 policy is the editor's, run by every host over its own
  `GuardedVaultPort`, because two write policies are two answers to what a stale
  save does; a host's adapter only turns the base into its store's CAS token
  (the desktop's hashes it, `apps/workspace/src/app/note/guarded-vault-io.ts`).
  Every error a vault row declares has a producer
  (`apps/cli/src/server/vault/__tests__/vault-contract-errors.test.ts`), since a
  code no handler raises is a client branch that never runs.
  `packages/editor/src/guarded-vault-io.ts`,
  `packages/editor/src/vault-editor.ts` and `@repo/notes/text/diff3`.

- **CONTAINMENT IS PHYSICAL, NOT LEXICAL, IN THE SERVER AND IN THE SHELL.** The
  vault realpaths the deepest existing ancestor and refuses symlinked leaves, in
  the one `contained` step every surface that takes a path runs, the stat and
  the listing included, which answer a refused path as absent; a lexical check
  passes a `notes.md` that is a symlink to a private key, and a `git pull` from
  a hostile remote can plant one (`apps/cli/src/server/vault/vault-service.ts`
  over `path-containment.ts`). The vault dir and the data dir must be disjoint,
  refused at boot: a data dir inside the vault gets committed and pushed. The OS
  sees a vault entry through the shell alone: Reveal in Finder and Open with
  default app send a vault-relative path, which the shell takes only as plain
  relative components, joins under the current vault and checks over both
  realpaths, never the vault itself, so a `..`, an absolute path or a planted
  symlink reaches no opener call (`resolve_vault_entry` in
  `apps/desktop/src-tauri/src/paths.rs`). That is the one rule the Rust shell
  spells a second time, because asking the CLI would cost a node process per
  click; it is the realpath alone, since the vault grammar's other refusals
  (`.git`, a staging file) guard writes and a Finder window harms nothing. A
  browser tab has no bridge and draws no row; Copy path needs no shell.

- **THE ENGINE'S GIT IGNORES THE VAULT'S OWN GIT HABITS, AND A PASS REPORTS ONE
  OUTCOME.** `runGit` prepends `--literal-pathspecs`,
  `core.hooksPath=/dev/null`, `commit.gpgsign=false`, `rerere.enabled=false` and
  `merge.verifySignatures=false` to every invocation
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
  `detached`, never `clean`; a refused push says `rejected` (a 413 `too-large`,
  a 507 `full`, the hosted vault's 426 `outdated`, which runs no network step
  again in that process), never `offline` (`classifyNetworkFailure`); and a pass
  that fails with no verdict (a merge that fails outright, a save the engine
  could not record, an unclassified failure) says it stalled, which the rail
  shows as "Sync paused" and hands to Settings › Advanced, never `clean` or
  `dirty`. Each verdict carries its own message, so `lastError` is the verdict's
  (a failed auto-commit's ahead of it) and the two cannot drift; a fetch that
  answers starts the verdict over, and a push that lost a race to another
  device's reports no error, since the tree already says unpushed and the next
  pass rebases. Every git the vault runs goes through one injected `GitRunner`
  (`processGit` in `git-run.ts`), which a suite builds over a hermetic config
  (`hermeticGit`), never an env threaded through each layer.

- **WHERE A PASTE LANDS IS A STORED VAULT CHOICE, and the host resolves it, not
  the editor.** `<dataDir>/vault-prefs.json` holds `attachments` (the root,
  beside the note, or one folder, default `assets/`), read per paste so a
  Settings or CLI change reaches the next one; the editor hands the host a base
  name and the host answers the folder through `attachmentDir`
  (`@repo/contract/local/vault/attachment-location`). `setPrefs` refuses only a
  path that is a file, which would refuse every paste. The bytes ride as a
  multipart Blob rather than base64 inside the json.
  `apps/cli/src/server/vault/vault-prefs-store.ts`. The name is `freeAssetPath`
  (`@repo/notes/knowledge/asset-name`), which the phone's photos run too; they
  land in the default folder, spelled once as `DEFAULT_ATTACHMENTS_FOLDER` in
  `@repo/notes/templates/folders`, since `vault-prefs.json` never reaches the
  phone.

- **A SYNC PASS HOLDS THE REPO LOCK ONLY FOR ITS LOCAL STEPS.** The fetch and
  the push run unlocked between locked local steps: held across the network, the
  lock made every save and every turn start wait out a dropped connection's
  timeout. The price is that the world moves during the fetch, so the
  integration step re-checks first. Only a merge that fails outright is
  remembered, by the two tips it failed between, so a pass where neither moved
  skips it, and says the merge's own words again, rather than failing the same
  way every minute. Network git gives up under 1KB/s for 30s, or an ssh connect
  past 20s (`apps/cli/src/server/vault/git-run.ts`). The split is
  `apps/cli/src/server/vault/git-engine.ts`.

- **CONCURRENT EDITS NEVER STOP SYNC** (owner direction: diff3 auto-merge, and a
  true overlap makes a conflict copy). A pass rebases first, which keeps the
  history a line; a rebase that stops on a path both devices changed is aborted
  and the pass merges instead (`apps/cli/src/server/vault/git-merge.ts`), and a
  branch holding an unpushed merge merges again, since a rebase drops a merge
  commit. Each path git cannot merge gets `reconcileFile`'s verdict
  (`@repo/notes/sync/reconcile-file`), the one the phone's queue lands for the
  same inputs: an overlap keeps this device's lines and copies the other's
  aside, named after the committer of the newest commit that touched the path.
  Every verdict lands through the index, never a JS write into the vault, so the
  merge commits exactly the tree on disk; whatever throws aborts the merge, and
  a merge or rebase a crash left is aborted before the engine's first commit.
  Every engine commit's committer is this device's name
  (`apps/cli/src/server/device-name.ts`: its sign-in name, else the Mac's own),
  because that is how another device names its version; the author still says
  who made the change. Every surface words a report through
  `describeSyncConflict`, and the desktop says each once, as a toast that stays
  until dismissed and opens the version set aside, remembered in the page's
  prefs so a reload says nothing again
  (`apps/workspace/src/app/sync-conflict-notices.ts`); there is no lasting
  conflict list, because Recent shows the copy and the copies are the record.
  Rejected: a `conflict` state that stopped sync until someone ran git, which a
  knowledge worker cannot, and a rebase through the conflict, which replays
  every local commit and has nowhere to keep the other version.

- **`Inbox.md` MERGES BY UNION.** Two desktops each appending a phone
  capture to the root `Inbox.md` between syncs overlap on a file the app wrote
  itself, and without union the merge would copy the inbox aside over a conflict
  nobody made. Every boot makes sure `info/attributes` holds `/Inbox.md
merge=union`: local, never a committed `.gitattributes`, because the vault's
  files are the user's. Residual: a bullet one device deleted beside the other's
  append comes back. `apps/cli/src/server/vault/git-bootstrap.ts`, over
  `CAPTURE_INBOX_PATH` in `@repo/notes/sync/reconcile-file`, whose verdict
  unions the same file for a writer that runs no git.

- **AN UNTOUCHED STARTER VAULT YIELDS TO A REMOTE THAT HAS HISTORY**, so a
  second Mac signing in never merges its seed into the account's notes: the two
  histories are unrelated, so a starter the user edited elsewhere is added on
  both sides with no base, the fresh seed keeps the path, the user's version
  becomes the conflict copy, and every starter they deleted comes back. The
  bootstrap records the commit that seeds a folder it created
  (`inteligir.seedCommit`, `apps/cli/src/server/vault/git-bootstrap.ts`); a pass
  that meets a remote branch it does not contain while HEAD is still that commit
  moves the branch to the remote's tip with git's own checkout, announces the
  paths that moved and drops the record, and nothing is a conflict
  (`yieldSeededHistory` in `apps/cli/src/server/vault/git-engine.ts`). It reads
  local history alone, so it holds for every remote. Rejected: `reset --hard`,
  which would overwrite a change landed after the pass's commit, where the
  checkout refuses it and the next pass merges it.

- **A WATCHER EVENT IS A MUTATION'S ECHO ONLY WHILE THE ENTRY IS THE ONE IT
  LEFT, AND A PULL NAMES ITS PATHS.** The runtime drops a watcher event only
  when a fresh lstat matches the one its mutation recorded: keyed on the path
  and a window alone, a foreign write landing behind a save (an agent editing
  the open note) would be dropped with the echo. A pass whose rebase moved HEAD
  reports the diff's paths, because a pass that names nothing makes every push
  from another device re-read the whole vault. Every change, the service's own,
  a watched batch and a pass's drain, reaches the bus, the index and the commit
  scheduler through the runtime's one `deliver`; the service holds no notifier
  and only reports a typed mutation, `content` or `entry` (the listing row
  moved), so what a change announces is decided in one layer.
  `apps/cli/src/server/vault/vault-changes.ts`,
  `apps/cli/src/server/vault/vault-runtime.ts`.

- **WHAT THE FILESYSTEM REFUSES COSTS THAT ENTRY, NEVER THE CALL.** A subfolder
  the walk cannot open lists empty, logged once, because one such folder would
  fail the listing and the boot; the root still throws. A move where the
  filesystem refuses a hard link (exFAT, some SMB mounts) falls back to the
  check-then-rename a folder move already accepts. A compare-and-swap read
  failing for any reason but absence is a fault, never "the file is gone".
  `apps/cli/src/server/vault/vault-service.ts`.

- **THE VAULT LISTS WHAT GIT WOULD KEEP.** The listing, the stat, the watcher
  and the boot's staging sweep honour every `.gitignore` in the vault, so a docs
  repo's `node_modules/` and build output take no tree row, no index row, no
  wake and no walk. One matcher per file, scoped to its own folder and asked
  deepest-first (`@repo/notes/knowledge/vault-ignore`), because one rooted at
  the vault re-scopes a nested `*` to `**/*` and hides the whole tree; `.git`
  and the staging prefix stay the unconditional floor. Only `.gitignore` files,
  which travel with the vault: `info/exclude` and a global excludes file are one
  machine's. A change naming a `.gitignore`, or naming nothing, reloads the
  rules (`apps/cli/src/server/vault/vault-runtime.ts` over
  `vault-ignore-files.ts`). Rejected: a hardcoded skip list, which misses the
  next tool's folder and contradicts what the user already wrote down. Residual:
  a folder moved in whole with its own `.gitignore` is read at the next reload,
  and the hosted vault's listing honours only the floor.

- **AN OPENED FOLDER'S OWN ORIGIN IS ITS BYO REMOTE, AND A FOLDER ANOTHER
  SERVICE SYNCS NEVER TAKES THE HOSTED VAULT.** Where a vault syncs has one
  record, its repo's own `origin`, read every pass under the repo lock
  (`readOriginConfig` in `apps/cli/src/server/vault/folder-facts.ts`), so a
  remote the user had, or sets later, is the next pass's with no restart. The
  app marks the origin it manages (`inteligir.remote=account`; an origin at the
  hosted url counts as marked), and the order is the pin
  (`INTELIGIR_VAULT_REMOTE`), an unmarked origin, outside sync, then the account
  (`apps/cli/src/server/cloud/vault-remote.ts`); an account pass that meets an
  unmarked origin pushes nothing, since its set-url would push the user's repo
  into the hosted vault. OUTSIDE SYNC is judged once at boot from where the
  folder physically sits, never stored and never asked of the service
  (`apps/cli/src/server/vault/external-sync.ts`): two sync engines over one tree
  fight, so the folder keeps its service and the hosted vault stays off, while
  an origin of the user's own still syncs. Rejected: a stored per-vault sync
  choice, a second record a user's own `git remote set-url` would contradict,
  and config.json's `vaultRemote`, which pinned one remote for every vault.
  `inspectVaultFolder` answers the same facts before a folder is a vault, so a
  picker and a boot agree. ONE WRITE PATH EDITS THAT ORIGIN: `vault.setRemote`,
  which Settings › Advanced
  (`apps/workspace/src/app/settings/sync-remote-row.tsx`) and `inteligir vault
remote` both call, running `setOrigin` in
  `apps/cli/src/server/vault/git-engine.ts` under the repo lock. Every move of
  the origin, this one's and a pass's (the pin, the account's url), is
  `pointOrigin`: it forgets the old remote's tips, so no status calls the vault
  synced before a pass reached the new one, and a hand-set
  `remote.origin.pushurl`, which `set-url` leaves and git would keep pushing to.
  The url grammar is one, `@repo/contract/local/vault/remote-url`, which the
  pin, the wire and the field all run. A pinned vault refuses a change
  (`CONFLICT`), since every pass writes the pin over the origin. No "off"
  choice: a folder another service syncs is already the derived off.

- **THE ACCOUNT REMOTE IS REACHED WHEN THERE IS NEWS, NOT EVERY MINUTE.** The
  hosted vault bills each fetch and push as an operation, and the minute tick
  fetched from every open Mac whether anything moved. Another device's push
  already pings this one over the account socket, so a tick leaves the account
  remote alone while that socket is up, the last pass that reached it ended
  clean, the commit it just made is already there and that pass is under 15
  minutes old (`quietTickCanWait` in `apps/cli/src/server/vault/git-engine.ts`);
  a ping, a sign-in, a socket reconnect, the boot pass and Sync now always
  reach it, and the tick still pushes a commit within the minute. A pass whose
  fetched tip already holds HEAD sends no push, since an empty push still asks
  for the refs. A tick joining a pass already running asks for no second one.
  Rejected: dropping the tick for the account remote, which leaves a lost ping
  unanswered until the next edit. A BYO remote pings nobody, so every tick
  fetches it as before.
