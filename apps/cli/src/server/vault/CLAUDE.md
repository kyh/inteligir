# Decisions: the vault service

Vault writes, the git engine underneath them, sync and containment. `AGENTS.md`
§ Decisions says how a bullet is written and cited.

## Vault: writes, git and containment

- **THE AUTO-COMMIT IS SESSION-SHAPED (15s quiet / 60s max) AND STAGES WHAT THE
  WINDOW'S WRITERS NAMED**, so the log is answerable: a single-file commit names
  its file and a fifteen-second pause ends an editing session. A scheduler that
  names no paths (the boot sweep, the post-sync drain), a window past the scoped
  cap and the flush after a failed one are unscoped; a change nobody announced
  waits for one. Staging is an explicit list on stdin
  (`--pathspec-from-file`), which no argument limit bounds, so every commit, a
  turn's start included, stages exactly the paths it names: a turn's start lists
  the dirty tree less the claimed paths, and each untracked file is listed and
  measured on its own. A commit stages at most 32 MiB of new bytes, with the
  rest following at once, so no push the engine makes is past what the hosted
  library takes in steps. Rejected: an unscoped `add -A`, which stages what
  nobody named and hashes a file before its size is known, and an argv
  pathspec, which a first commit overflows.
  `apps/cli/src/server/vault/git-stage.ts`; `git-commits.ts` says why the max
  wait is the sync interval.

- **NOTE HISTORY IS LOCAL, AND A RESTORE IS A WRITE.** History reads the vault's
  own git repo, so it works offline. A restore writes the revision's bytes
  through the ordinary guarded write, never `git checkout` or `git revert`,
  which would bypass the CAS, the re-index, the `/ws` notification and the open
  buffer's convergence; there is no restore procedure, since a second server
  write path is a second CAS. A CAS refusal is reported, not diff3-merged,
  because the user named exact bytes. A deleted note comes back the same way,
  from the log's deletions plus the worktree's uncommitted ones. A file that is
  not text comes back byte-exact the same way, through `vault.revisionBytes`
  and `vault.createFile`, the byte twin of a write's `absent` guard, so a
  restore never writes over what stands there now. Deleted lists every file,
  not only docs, and a file deleted in one change set with a doc that embedded
  or linked it is `heldBy` that doc, listed under it and restored with it
  (`apps/cli/src/server/vault/held-files.ts`,
  `@repo/contract/local/vault/restore-held-files`), which every client runs
  after the doc's own restore. There is no trash folder and no purge.
  `apps/cli/src/server/vault/git-history.ts`.

- **A WRITE CARRIES THE BASE IT WAS COMPUTED FROM AND NAMES ITS GUARD, AND A
  CREATE IS NOT A WRITE WITH AN EMPTY BASE.** The guard is one required union:
  the hash the write was computed from, a create, or last-writer-wins spelled
  out. One required field rather than two optional ones, which would make
  last-writer-wins the silent default and let a hash and a create travel
  together. The hash is compared under the repo lock; a mismatch answers 409
  with the current content and the client diff3-merges and retries, rather than
  active-user-wins, which discards concurrent body edits wholesale. A write
  ANSWERS THE BYTES THAT LANDED and the open buffer rebases onto them, because a
  buffer kept over a merged base passes the next CAS without the external edit.
  Hashing bytes not yet on disk is a refusal every time, so a create carries no
  hash; a guarded write with no recorded base throws rather than infer one,
  because an inferred base lets a concurrent edit win silently. A path already
  taken is an outcome, not a throw, and that is the one existence check. The
  diff3-on-409 policy is the editor's, run by every host over its own port,
  because two write policies are two answers to what a stale save does; a host's
  adapter only turns the base into its store's CAS token. Every error a vault
  row declares has a producer, since a code no handler raises is a client branch
  that never runs. `packages/contract/src/local/vault/vault-schema.ts`,
  `apps/cli/src/server/vault/vault-router.ts`,
  `packages/editor/src/guarded-vault-io.ts`.

- **CONTAINMENT IS PHYSICAL, NOT LEXICAL, IN THE SERVER AND IN THE SHELL.** The
  vault realpaths the deepest existing ancestor and refuses symlinked leaves in
  the one step every surface that takes a path runs, a stat and a listing
  answering a refused path as absent: a lexical check passes a `notes.md` that
  is a symlink to a private key, and a `git pull` from a hostile remote can
  plant one. The vault dir and the data dir must be disjoint, refused at boot: a
  data dir inside the vault gets committed and pushed. The OS sees a vault entry
  through the shell alone, which takes a vault-relative path only as plain
  relative components and checks it over both realpaths, so a `..`, an absolute
  path or a planted symlink reaches no opener call. That is the one rule the
  Rust shell spells a second time, because asking the CLI would cost a node
  process per click; it is the realpath alone, since the vault grammar's other
  refusals guard writes and a Finder window harms nothing. A browser tab has no
  bridge and draws no row. `apps/cli/src/server/vault/vault-service.ts`,
  `apps/desktop/src-tauri/src/paths.rs`.

- **THE ENGINE'S GIT IGNORES THE VAULT'S OWN GIT HABITS, AND A PASS REPORTS ONE
  OUTCOME.** Every invocation turns off what a vault's own config could do to
  it: a pathspec is a glob, so `[a].md` names `a.md` too and a commit scoped to
  one note would stage its neighbour; a user's hook can refuse, stall or rewrite
  an engine commit, rebase or push, where `--no-verify` reaches only pre-commit
  and commit-msg; a signing policy stalls or refuses an engine commit; and a
  recorded resolution replays over a verdict. Untracked files are a status
  read's own flag: each names its `--untracked-files` mode (`all` where a commit
  is planned), because `status.showUntrackedFiles=no` would hide an engine
  commit's paths and hold every sync behind it. Residual: a git-lfs vault's upload is a pre-push hook
  too, so it does not run. Before the listen the bootstrap stages only the
  starter notes it seeded into a folder it created, and an opened folder's first
  commit is empty, since staging a large folder there outran the shell's
  readiness wait. A pass concludes one outcome, and a path two devices changed
  is never one of them: a detached HEAD says `detached`, never `clean`; a
  refused push says `rejected`, never `offline`, and a build below the floor
  runs no network step again in that process; a pass that fails with no verdict
  says it stalled, never `clean` or `dirty`. Each verdict carries its own
  message, so the error shown is the verdict's and the two cannot drift; a push
  that lost a race to another device's reports no error, since the tree already
  says unpushed and the next pass rebases. Every git the vault runs goes through
  one injected runner, which a suite builds over a hermetic config, never an env
  threaded through each layer.
  `apps/cli/src/server/vault/git-run.ts`, `git-porcelain.ts`,
  `git-bootstrap.ts`.

- **WHERE A PASTE LANDS IS A STORED VAULT CHOICE, and the host resolves it, not
  the editor.** The choice (the root, beside the note, or one folder, default
  `assets/`) is read per paste, so a Settings or CLI change reaches the next
  one; the editor hands the host a base name and the host answers the folder. A
  folder that is a file is refused, since it would refuse every paste. The bytes
  ride as a multipart Blob rather than base64 inside the json. The phone's
  photos take the same free name and land in the default folder, spelled once,
  since the choice never reaches the phone. A file item's original lands where
  a paste beside its wrapper would, under its own name
  (`apps/cli/src/server/items/save-file.ts`).
  `apps/cli/src/server/vault/vault-prefs-store.ts`,
  `@repo/contract/local/vault/attachment-location`.

- **NO FILE OVER 10 MiB ENTERS HISTORY.** It is planned out before staging
  and never hashed, so the object store and every push stay free of it. A
  tracked file that grows past the cap leaves the index and stays on this Mac's
  disk, and the commit that takes it out ("<name> is over 10 MB, so it stays on
  this Mac") is a deletion every other device takes, where the file shows in
  Deleted as its last version. The status counts and names what stays here
  (`tooLarge`), Info says "Only on this Mac", and such a file leaves nothing
  dirty, since no commit ever takes it. A rebase that would check out another
  device's version over it is refused before it starts, so the pass merges
  instead, which keeps this side's deletion and never writes that path.
  Rejected: `info/exclude`, since a checkout overwrites an ignored file;
  add-then-reset, which re-hashes the file on every flush; and `skip-worktree`
  or `assume-unchanged` to keep the last version tracked, which wedges a
  rebase. `apps/cli/src/server/vault/git-stage.ts`, `git-commits.ts`.

- **THE ASSET ROUTE ANSWERS BYTE RANGES AND A POLICY PER KIND.** A player asks
  for its file in pieces, and AVFoundation plays nothing until its `bytes=0-1`
  probe answers 206, so one range is answered 206 with its `content-range`, a
  range past the end 416, a HEAD with the length and no body, and a list of
  ranges or a stale `if-range` whole, read off a handle rather than the whole
  file. A ranged request is answered its range even when its `if-none-match`
  matches, because a media loader sends the etag it holds with every range it
  reads and a 304 there leaves it holding the probe's two bytes; only a
  request with no range revalidates to 304. What is served is the shared media table's (images, PDF, video,
  audio), never what a file may be stored as: an archive is an item's original
  and is never served, and an `.html` is a page copy, served only by its own
  route under a script-less sandbox. A PDF alone has no sandbox, because one
  blanks WebKit's viewer; every other kind is sandboxed, which is what keeps an
  svg's script from running when its url is opened as a document. A thumbnail
  is a data-dir cache, never a second file in the library, bounded and shared
  per key. Rejected: pdf.js, which needs `worker-src` and about 2 MB, and a
  srcdoc page copy, which inherits the window's origin.
  `apps/cli/src/server/vault/asset-route.ts`, `byte-range.ts`,
  `page-copy-route.ts`, `thumb-route.ts`.

- **A DELETE TAKES THE FILES ONLY IT LINKS.** An item's original, its cover
  and its page copy leave with the item, and a file another doc still embeds or
  links stays, by one rule the server's delete and the phone's both run
  (`@repo/notes/knowledge/attachment-removal`): a file goes when every doc that
  links it is being removed, and one whose linkers the caller's graph has not
  read is kept, so a delete never takes more than it named. The linkers are the
  index's, read before the entry goes, and the files leave after it, as the
  annotation stores do, in the same change set, so Deleted lists them under the
  doc and a restore brings them back with it. Rejected: leaving the files (every
  deleted item would strand its original and cover, which no card shows), and
  asking the person file by file. `apps/cli/src/server/vault/remove-entry.ts`.

- **A SYNC PASS HOLDS THE REPO LOCK ONLY FOR ITS LOCAL STEPS.** The fetch and
  the push run unlocked between locked local steps: held across the network, the
  lock made every save and every turn start wait out a dropped connection's
  timeout. The price is that the world moves during the fetch, so the
  integration step re-checks first. Only a merge that fails outright is
  remembered, by the two tips it failed between, so a pass where neither moved
  skips it, and says the merge's own words again, rather than failing the same
  way every minute. Network git gives up on a stalled transfer or connect
  (`apps/cli/src/server/vault/git-run.ts`). The split is
  `apps/cli/src/server/vault/git-engine.ts`.

- **CONCURRENT EDITS NEVER STOP SYNC** (owner direction: diff3 auto-merge, and a
  true overlap makes a conflict copy). A pass rebases first, which keeps the
  history a line; a rebase that stops on a path both devices changed is aborted
  and the pass merges instead, and a branch holding an unpushed merge merges
  again, since a rebase drops a merge commit. Each path git cannot merge gets
  the verdict the phone's queue lands for the same inputs
  (`@repo/notes/sync/reconcile-file`): an overlap keeps this device's lines and
  copies the other's aside, named after the committer of the newest commit that
  touched the path. Every verdict lands through the index, never a JS write into
  the vault, so the merge commits exactly the tree on disk; whatever throws
  aborts the merge, and a merge or rebase a crash left is aborted before the
  engine's first commit. Every engine commit's committer is this device's name,
  because that is how another device names its version; the author still says
  who made the change. Every surface words a conflict through one function
  (`@repo/notes/sync/conflict-copy`), and the desktop says each once, as a toast
  that stays until dismissed and opens the version set aside; there is no
  lasting conflict list, because Recent shows the copy and the copies are the
  record. Rejected: a `conflict` state that stopped sync until someone ran git,
  which a knowledge worker cannot, and a rebase through the conflict, which
  replays every local commit and has nowhere to keep the other version. Two
  versions of one saved link (two Macs filling one stub, a Refresh racing a
  tag) settle by `urlItemVerdict` inside that verdict, with no copy, so both
  repos and the remote end on one text whichever device merges.
  `apps/cli/src/server/vault/git-merge.ts`,
  `apps/cli/src/server/vault/__tests__/git-merge-items.test.ts`.

- **AN UNTOUCHED STARTER VAULT YIELDS TO A REMOTE THAT HAS HISTORY**, so a
  second Mac signing in never merges its seed into the account's notes: the two
  histories are unrelated, so a starter the user edited elsewhere is added on
  both sides with no base, the fresh seed keeps the path, the user's version
  becomes the conflict copy, and every starter they deleted comes back. The
  bootstrap records the commit that seeds a folder it created; a pass that meets
  a remote branch it does not contain while HEAD is still that commit moves the
  branch to the remote's tip with git's own checkout, and nothing is a conflict.
  It reads local history alone, so it holds for every remote. Rejected: `reset
  --hard`, which would overwrite a change landed after the pass's commit, where
  the checkout refuses it and the next pass merges it.
  `apps/cli/src/server/vault/git-engine.ts`.

- **A WATCHER EVENT IS A MUTATION'S ECHO ONLY WHILE THE ENTRY IS THE ONE IT
  LEFT, AND A PULL NAMES ITS PATHS.** An event is dropped only when a fresh
  lstat matches the one its mutation recorded: keyed on the path and a window
  alone, a foreign write landing behind a save (an agent editing the open note)
  would be dropped with the echo. A pass whose rebase moved HEAD reports the
  diff's paths, because a pass that names nothing makes every push from another
  device re-read the whole vault. Every change, the service's own, a watched
  batch and a pass's drain, reaches the bus, the index and the commit scheduler
  through one delivery; the service only reports a typed mutation, so what a
  change announces is decided in one layer.
  `apps/cli/src/server/vault/vault-runtime.ts`, `vault-changes.ts`.

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
  machine's. Rejected: a hardcoded skip list, which misses the next tool's
  folder and contradicts what the user already wrote down. Residual: a folder
  moved in whole with its own `.gitignore` is read at the next reload, and the
  hosted vault's listing honours only the floor.
  `apps/cli/src/server/vault/vault-ignore-files.ts`.

- **AN OPENED FOLDER'S OWN ORIGIN IS ITS BYO REMOTE, AND A FOLDER ANOTHER
  SERVICE SYNCS NEVER TAKES THE HOSTED VAULT.** Where a vault syncs has one
  record, its repo's own `origin`, read every pass under the repo lock, so a
  remote the user had, or sets later, is the next pass's with no restart. The
  app marks the origin it manages, and the order is the pin
  (`INTELIGIR_VAULT_REMOTE`), an unmarked origin, outside sync, then the
  account; an account pass that meets an unmarked origin pushes nothing, since
  its set-url would push the user's repo into the hosted vault. OUTSIDE SYNC is
  judged once at boot from where the folder physically sits, never stored and
  never asked of the service: two sync engines over one tree fight, so the
  folder keeps its service and the hosted vault stays off, while an origin of
  the user's own still syncs. Rejected: a stored per-vault sync choice, a second
  record a user's own `git remote set-url` would contradict, and a config.json
  remote, which pinned one remote for every vault. A folder picker and a boot
  read the same facts, so they agree.
  `apps/cli/src/server/vault/folder-facts.ts`,
  `apps/cli/src/server/cloud/vault-remote.ts`,
  `apps/cli/src/server/vault/external-sync.ts`.

- **ONE WRITE PATH EDITS THAT ORIGIN**, which Settings › Advanced and `inteligir
  vault remote` both call, under the repo lock. Every move of the origin, this
  one's and a pass's, forgets the old remote's tips, so no status calls the
  vault synced before a pass reached the new one, and drops a hand-set push url,
  which `set-url` leaves and git would keep pushing to. The url grammar is one
  (`@repo/contract/local/vault/remote-url`), which the pin, the wire and the
  field all run. A pinned vault refuses a change, since every pass writes the
  pin over the origin. No "off" choice: a folder another service syncs is
  already the derived off. `apps/cli/src/server/vault/git-engine.ts`.

- **THE ACCOUNT REMOTE IS REACHED WHEN THERE IS NEWS, NOT EVERY MINUTE.** The
  hosted vault bills each fetch and push as an operation, and the minute tick
  fetched from every open Mac whether anything moved. Another device's push
  already pings this one over the account socket, so a tick leaves the account
  remote alone while that socket is up, the last pass that reached it ended
  clean, the commit it just made is already there and that pass is under 15
  minutes old; a ping, a sign-in, a socket reconnect, the boot pass and Sync now
  always reach it, and the tick still pushes a commit within the minute. A pass
  whose fetched tip already holds HEAD sends no push, since an empty push still
  asks for the refs. A tick joining a pass already running asks for no second
  one. Rejected: dropping the tick for the account remote, which leaves a lost
  ping unanswered until the next edit. A BYO remote pings nobody, so every tick
  fetches it as before. `apps/cli/src/server/vault/git-engine.ts`.
