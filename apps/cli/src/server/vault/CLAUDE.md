# Decisions: the vault service

Vault writes, the git engine underneath them, sync and containment. `AGENTS.md`
§ Decisions says how a bullet is written and cited.

## Vault: writes, git and containment

- **THE AUTO-COMMIT IS SESSION-SHAPED (15s quiet / 60s max) AND STAGES WHAT THE
  WINDOW'S WRITERS NAMED**, so a single-file commit names its file and a
  fifteen-second pause ends an editing session. A scheduler that names no paths
  (the boot sweep, the post-sync drain), a window past the scoped cap and the
  flush after a failed one are unscoped; a change nobody announced waits for
  one. Staging is an explicit list on stdin (`--pathspec-from-file`), each
  untracked file measured on its own. Rejected: `add -A` (stages what nobody
  named, hashes before it measures) and an argv pathspec (a first commit
  overflows it). `apps/cli/src/server/vault/git-stage.ts`; `git-commits.ts` says
  why the max wait is the sync interval.

- **A COMMIT STAGES AT MOST 32 MiB OF NEW BYTES**, the rest following at once,
  so no push the engine makes outgrows what the hosted library takes.
  `apps/cli/src/server/vault/git-stage.ts`.

- **NOTE HISTORY IS LOCAL, AND A RESTORE IS A WRITE.** History reads the vault's
  own repo, so it works offline. A restore, a deleted note's included, writes
  the revision's bytes through the ordinary guarded write, and a CAS refusal is
  reported, not merged, because the user named exact bytes. A file that is not
  text comes back byte-exact through `vault.revisionBytes` and
  `vault.createFile`, so a restore never writes over what stands there. There is
  no trash folder and no purge. Rejected: `git checkout` or `git revert` (they
  bypass the CAS, the re-index, `/ws` and the open buffer's convergence) and a
  restore procedure (a second write path is a second CAS).
  `apps/cli/src/server/vault/git-history.ts`.

- **DELETED LISTS EVERY FILE, AND A FILE COMES BACK WITH THE DOC THAT HELD IT.**
  A file deleted in one change set with a doc that embedded or linked it is
  `heldBy` that doc, listed under it, and restored with it by every client after
  the doc's own restore (`apps/cli/src/server/vault/held-files.ts`,
  `@repo/contract/local/vault/restore-held-files`).

- **A WRITE CARRIES THE BASE IT WAS COMPUTED FROM AND NAMES ITS GUARD, AND A
  CREATE IS NOT A WRITE WITH AN EMPTY BASE.** The guard is one required union:
  the base's hash, a create (no hash: bytes not yet on disk cannot be hashed),
  or last-writer-wins spelled out. A guarded write with no recorded base throws;
  a path already taken is an outcome, not a throw, and the one existence check;
  every error a vault row declares has a producer, since a code no handler
  raises is a client branch that never runs. Rejected: two optional fields
  (last-writer-wins the silent default, a hash and a create travelling together)
  and an inferred base (a concurrent edit wins silently).
  `packages/contract/src/local/vault/vault-schema.ts`.

- **A STALE WRITE ANSWERS 409 AND THE EDITOR DIFF3-MERGES IT, IN EVERY HOST.**
  The hash is compared under the repo lock; a mismatch answers 409 with the
  current content, and the client merges and retries. A write ANSWERS THE BYTES
  THAT LANDED and the open buffer rebases onto them, since a buffer kept over a
  merged base would pass the next CAS without the external edit. The policy is
  the editor's, run by every host over its own port, because two write policies
  are two answers to a stale save; a host's adapter only turns the base into its
  store's CAS token. Rejected: active-user-wins (discards concurrent body edits
  wholesale). `apps/cli/src/server/vault/vault-router.ts`,
  `packages/editor/src/guarded-vault-io.ts`.

- **CONTAINMENT IS PHYSICAL, NOT LEXICAL, IN THE SERVER AND IN THE SHELL.** The
  vault realpaths the deepest existing ancestor and refuses symlinked leaves in
  the one step every path-taking surface runs, a stat or a listing answering a
  refused path as absent. The OS sees a vault entry only through the shell,
  which checks plain relative components over both realpaths: the one rule the
  Rust shell spells again, as the realpath alone, since asking the CLI costs a
  node process per click and the grammar's other refusals guard writes. A
  browser tab has no bridge and draws no row. Rejected: a lexical check (passes
  a `notes.md` symlinked to a private key, which a hostile `git pull` can
  plant). `apps/cli/src/server/vault/vault-service.ts`,
  `apps/desktop/src-tauri/src/paths.rs`.

- **THE VAULT DIR AND THE DATA DIR ARE DISJOINT**, refused at boot, since a data
  dir inside the vault gets committed and pushed.
  `apps/cli/src/server/vault/vault-service.ts`.

- **THE ENGINE'S GIT IGNORES THE VAULT'S OWN GIT HABITS, AND A PASS REPORTS ONE
  OUTCOME.** Every invocation turns off what the vault's config could do to an
  engine commit, rebase or push: glob pathspecs, hooks (`--no-verify` reaches
  only pre-commit and commit-msg), signing, recorded resolutions; every status
  read names its untracked-files mode, since a config hiding untracked files
  would hold every sync. Every git the vault runs goes through one injected
  runner, which a suite builds over a hermetic config. Rejected: an env threaded
  through each layer. Residual: a git-lfs upload is a pre-push hook, so it does
  not run. `apps/cli/src/server/vault/git-run.ts`, `git-porcelain.ts`.

- **A PASS REPORTS ONE OUTCOME, AND EACH VERDICT CARRIES ITS OWN MESSAGE**, so
  the error shown cannot drift; a path two devices changed is never an outcome.
  A detached HEAD says `detached`, never `clean`; a refused push says
  `rejected`, never `offline`, and below the build floor no network step runs
  again in that process; a pass failing with no verdict says it stalled, never
  `clean` or `dirty`. A push that lost a race to another device's reports no
  error, since the tree says unpushed and the next pass rebases.
  `apps/cli/src/server/vault/git-engine.ts`.

- **THE BOOTSTRAP STAGES ONLY THE STARTER NOTES IT SEEDED**, into a folder it
  created, and an opened folder's first commit is empty, since staging a large
  folder before the listen outran the shell's readiness wait.
  `apps/cli/src/server/vault/git-bootstrap.ts`.

- **WHERE A PASTE LANDS IS A STORED VAULT CHOICE, and the host resolves it, not
  the editor.** The choice (the root, beside the note, or one folder, default
  `assets/`) is read per paste, and the editor hands the host only a base name;
  a folder that is a file is refused. The phone's photos take the same free name
  in the default folder, since the choice never reaches the phone, and a file
  item's original lands where a paste beside its wrapper would
  (`apps/cli/src/server/items/save-file.ts`). Rejected: base64 inside the json
  (a multipart Blob carries the bytes).
  `apps/cli/src/server/vault/vault-prefs-store.ts`,
  `@repo/contract/local/vault/attachment-location`.

- **NO FILE OVER 10 MiB ENTERS HISTORY.** It is planned out before staging and
  never hashed. A tracked file that grows past the cap leaves the index, not
  this Mac's disk, in a commit every other device takes as a deletion, Deleted
  showing its last version. Here it shows as "Only on this Mac" (`tooLarge`) and
  leaves nothing dirty, and a rebase that would check out another device's
  version over it is refused, so the pass merges. Rejected: `info/exclude` (a
  checkout overwrites an ignored file), add-then-reset (re-hashes on every
  flush), and `skip-worktree` or `assume-unchanged` (wedges a rebase).
  `apps/cli/src/server/vault/git-stage.ts`, `git-commits.ts`.

- **THE ASSET ROUTE ANSWERS BYTE RANGES AND A POLICY PER KIND.** A range is
  answered 206 even when its etag matches, because AVFoundation plays nothing
  until its two-byte probe does and a 304 leaves it holding those two bytes. It
  serves only the shared media table's kinds, never an archive original, and a
  page copy only through its own route under a script-less sandbox. A PDF alone
  has no sandbox, since one blanks WebKit's viewer; every other kind is
  sandboxed, which keeps an svg's script from running. A thumbnail is a bounded
  data-dir cache, never a library file. Rejected: pdf.js (`worker-src`, about 2
  MB) and a srcdoc page copy (inherits the window's origin).
  `apps/cli/src/server/vault/asset-route.ts`, `byte-range.ts`,
  `page-copy-route.ts`, `thumb-route.ts`.

- **A DELETE TAKES THE FILES ONLY IT LINKS.** An item's original, cover and page
  copy leave with it, by one rule the server and the phone both run
  (`@repo/notes/knowledge/attachment-removal`): a file goes only when every doc
  that embeds or links it is being removed, and one whose linkers the caller's
  graph has not read stays. The files leave in the same change set, so Deleted
  lists them under the doc and its restore brings them back. Rejected: leaving
  the files (every deleted item strands an original and a cover no card shows)
  and asking file by file. `apps/cli/src/server/vault/remove-entry.ts`.

- **A SYNC PASS HOLDS THE REPO LOCK ONLY FOR ITS LOCAL STEPS.** The fetch and
  the push run unlocked, so the integration step re-checks first. Only a merge
  that fails outright is remembered, by its two tips, and a pass where neither
  moved skips it and says its words again. Network git gives up on a stalled
  transfer or connect (`apps/cli/src/server/vault/git-run.ts`). Rejected: the
  lock held across the network (every save and turn start waited out a dropped
  connection's timeout). `apps/cli/src/server/vault/git-engine.ts`.

- **CONCURRENT EDITS NEVER STOP SYNC** (owner direction: diff3 auto-merge, and a
  true overlap makes a conflict copy). A pass rebases first and merges instead
  when the rebase stops on a path both devices changed, or when an unpushed
  merge is waiting, since a rebase drops it. Each path git cannot merge gets the
  verdict the phone's queue lands for the same inputs
  (`@repo/notes/sync/reconcile-file`): an overlap keeps this device's lines and
  copies the other's aside, named after the committer of the path's newest
  commit. Rejected: a `conflict` state that stopped sync (a knowledge worker
  cannot run git) and rebasing through it (replays every local commit, nowhere
  to keep the other version). `apps/cli/src/server/vault/git-merge.ts`.

- **TWO VERSIONS OF ONE SAVED LINK SETTLE WITH NO COPY.** A Refresh racing the
  saving device's fill, or racing a tag, settles by `urlItemVerdict` inside the
  path's verdict, so both repos and the remote end on one text whichever device
  merges. `apps/cli/src/server/vault/git-merge-items.test.ts`.

- **A MERGE'S VERDICTS LAND THROUGH THE INDEX, AND THE COMMITTER NAMES THE
  DEVICE.** Every verdict lands through the index, never a JS write into the
  vault, so the merge commits exactly the tree on disk; whatever throws aborts
  the merge, and a merge or rebase a crash left is aborted before the engine's
  first commit. Every engine commit's committer is this device's name, since
  that is how another device names its version, and its author still says who
  made the change. `apps/cli/src/server/vault/git-merge.ts`, `git-run.ts`.

- **A CONFLICT IS WORDED BY ONE FUNCTION AND KEPT AS AN ITEM, NOT A LIST.**
  Every surface words it through `@repo/notes/sync/conflict-copy`, and the
  desktop says each once, as a toast that stays until dismissed and opens the
  version set aside. There is no lasting conflict list: the copy is an item in
  the original's folder, listed like any other, and the copies are the record.

- **AN UNTOUCHED STARTER LIBRARY YIELDS TO A REMOTE THAT HAS HISTORY**, so a
  second Mac signing in never merges its seed into the account's library, where
  unrelated histories would turn the user's edits into conflict copies and bring
  back every starter they deleted. A pass that meets a remote branch it lacks
  while HEAD is still the recorded seed commit moves to the remote's tip with
  git's own checkout; it reads local history alone, so it holds for every
  remote. Rejected: `reset --hard` (overwrites a change landed after the pass's
  commit, which the checkout refuses).
  `apps/cli/src/server/vault/git-engine.ts`.

- **A WATCHER EVENT IS A MUTATION'S ECHO ONLY WHILE THE ENTRY IS THE ONE IT
  LEFT, AND A PULL NAMES ITS PATHS.** An event is dropped only when a fresh
  lstat matches the one its mutation recorded, and a pass whose rebase moved
  HEAD reports the diff's paths, so another device's push never re-reads the
  whole vault. Every change reaches the bus, the index and the commit scheduler
  through one delivery, and the service only reports a typed mutation, so one
  layer decides what a change announces. Rejected: keying on the path and a
  window (a foreign write behind a save, such as an agent editing the open note,
  is dropped with the echo). `apps/cli/src/server/vault/vault-runtime.ts`,
  `vault-changes.ts`.

- **WHAT THE FILESYSTEM REFUSES COSTS THAT ENTRY, NEVER THE CALL.** A subfolder
  the walk cannot open lists empty, logged once, while the root still throws; a
  move where the filesystem refuses a hard link (exFAT, some SMB mounts) falls
  back to check-then-rename; a compare-and-swap read failing for any reason but
  absence is a fault, never "the file is gone".
  `apps/cli/src/server/vault/vault-service.ts`.

- **THE VAULT LISTS WHAT GIT WOULD KEEP.** The listing, the stat, the watcher
  and the boot's staging sweep honour every `.gitignore` in the vault, one
  matcher per file scoped to its own folder
  (`@repo/notes/knowledge/vault-ignore`), above an unconditional floor of `.git`
  and the staging prefix. Only `.gitignore` files count, since they travel with
  the vault and `info/exclude` or a global excludes file is one machine's.
  Rejected: one matcher rooted at the vault (re-scopes a nested `*` to `**/*`)
  and a hardcoded skip list (misses the next tool's folder). Residual: a folder
  moved in whole is re-read at the next reload, and the hosted vault's listing
  honours only the floor. `apps/cli/src/server/vault/vault-ignore-files.ts`.

- **AN OPENED FOLDER'S OWN ORIGIN IS ITS BYO REMOTE, AND A FOLDER ANOTHER
  SERVICE SYNCS NEVER TAKES THE HOSTED VAULT.** Where a vault syncs has one
  record, its repo's `origin`, read every pass under the repo lock. The order is
  the pin (`INTELIGIR_VAULT_REMOTE`), an origin the app did not mark, outside
  sync, then the account; an account pass meeting an unmarked origin pushes
  nothing, since its set-url would push the user's repo into the hosted vault.
  Rejected: a stored per-vault sync choice (a second record `git remote set-url`
  would contradict) and a config.json remote (one remote for every vault).
  `apps/cli/src/server/cloud/vault-remote.ts`.

- **OUTSIDE SYNC IS JUDGED ONCE AT BOOT, FROM WHERE THE FOLDER PHYSICALLY
  SITS**, never stored or asked of the service, and the folder picker reads the
  same facts. Two sync engines over one tree fight, so the folder keeps its
  service and the hosted vault stays off, while an origin of the user's own
  still syncs. `apps/cli/src/server/vault/folder-facts.ts`,
  `apps/cli/src/server/vault/external-sync.ts`.

- **ONE WRITE PATH EDITS THAT ORIGIN**, which Settings › Advanced and
  `inteligir vault remote` both call under the repo lock. Every move of the
  origin, a pass's too, forgets the old remote's tips and drops a hand-set push
  url, so no status calls the vault synced before a pass reached the new one;
  the url grammar is one (`@repo/contract/local/vault/remote-url`), and a pinned
  vault refuses a change, since every pass writes the pin over it. Rejected: an
  "off" choice (a folder another service syncs is already the derived off).
  `apps/cli/src/server/vault/git-engine.ts`.

- **THE ACCOUNT REMOTE IS REACHED WHEN THERE IS NEWS, NOT EVERY MINUTE.** The
  hosted vault bills each fetch and push, and another device's push already
  pings this one. A tick skips it while the socket is up and the last pass to
  reach it, under 15 minutes old, ended clean with HEAD already there; a ping, a
  sign-in, a reconnect, the boot pass and Sync now always reach it, and a tick
  still pushes a commit within the minute. A pass sends no empty push, and a
  tick joins a pass already running. A BYO remote pings nobody, so every tick
  fetches it. Rejected: no tick for the account remote (a lost ping waits for
  the next edit). `apps/cli/src/server/vault/git-engine.ts`.
