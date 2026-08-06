# @repo/vault

`VaultManager` — the user's markdown folder: confined file IO, the ephemeral
listing, the single open-note watcher. The app's _data_, not `~/.inteligir` state.

## Why it exists

Node-only, electron-free — unit-testable against a temp dir. Sits BELOW
`@repo/server` (deps: storage + notes + bridge), never imports server, agent,
or electron code; host capabilities arrive through injected seams. Not
`JsonStore`: the vault is user-owned, edited out of band (their editor, git,
Dropbox, the agent), so reads go through to disk and a malformed file
surfaces as an error — never quarantined, never reset.

## Layout

```
src/
  vault.ts                  # VaultManager + singleton/seam installers: confined
                            # resolve, TTL crawl snapshot (list/listAllPaths/
                            # listWithStats), atomic text+byte IO, rename, delete/
                            # trash, open-note watcher, refresh(), logout write gate
  classify-file-change.ts   # pure change verdict (match|none|reload) + SelfSaveRegistry
  __tests__/                # vault.test.ts, classify-file-change.test.ts
```

Sole export: `@repo/vault/vault`.

## Invariants

- **Ephemeral listing, ONE watcher** (vault liveness — CLAUDE.md § Decisions).
  NO recursive filesystem watcher, ever. The listing is an
  on-demand crawl cached for 1s (`SNAPSHOT_TTL_MS`) so a refresh burst —
  renderer listing + knowledge diff + fingerprints — shares one walk;
  triggers: app structural writes, window focus, "Refresh vault", delegation
  completion. The only watcher is a non-recursive watch on the open note's
  parent dir filtered to its basename (single-file watches miss atomic-rename
  saves). External edits elsewhere wait for the next refresh — that trade is
  the design.
- **Autosaves are silent.** Content overwrites notify with kind `save` (no
  broadcast; knowledge stays live); `SelfSaveRegistry` filters the
  resulting watch event on the full `mtimeMs:size:ino` fingerprint so an
  mtime-colliding external edit still surfaces. A restore doesn't record —
  its write reloads the editor.
- **A crawl that could not be READ ≠ absence.** `listAllPaths()` — the
  COMPLETE listing, for callers that read an absent path as a lost file —
  THROWS `VaultListingIncompleteError` on a missing root or an unreadable
  subtree, because a truncated crawl is indistinguishable from a vault that
  lost those files. `list()`/`listWithStats()` stay lenient; failed-read
  snapshots are never cached, so recovery is immediate.
- **Unreadable single files are REPORTED, not refused.** An entry the crawl may
  not read (a symlink reports as neither file nor directory) and a cloud
  placeholder (`.note.md.icloud`, reported as the `note.md` it hides) come back
  from `unaccountedPaths()`, sorted, off the same snapshot. Only a caller
  holding a prior listing can tell a note it just lost sight of from a symlink
  that was never a note; refusing here instead would let one symlink anywhere
  under the vault wedge every listing, with no in-app remedy.
- **Delete = OS trash** (CLAUDE.md § Decisions). `trash()` is the ONLY removal
  path (injected `HostPlatform.trashItem`; permanent `fs.rm` fallback where the
  OS has none).
- **Confinement, two layers.** Every path resolves lexically under the root
  AND re-verifies after realpath, so a symlink planted inside the vault can't
  point IPC file ops outside. The agent's raw fs access is unconfined by
  design — its door is the `./vault` symlink maintained in the agent
  workspace (only ever replaces a symlink it manages).
- **Root guard.** `setRoot` rejects a folder inside (or symlinking into)
  `~/.inteligir` — wiped on logout. Between logout and re-login, writes throw
  (`suspendVaultWrites`) so a dirty autosave can't rebuild a default-root
  vault; reads stay allowed.
- **Crawl exclusions make a file UNREACHABLE.** The tool- and OS-owned trees
  (version control, `node_modules` and the build/dependency caches, editor
  state, volume metadata), atomicWrite's in-flight `*.tmp` siblings, `.DS_Store`
  and friends, and iCloud placeholder stubs live in
  `@repo/notes/knowledge/crawl-exclusions`; this crawl is pinned against the
  same fixture as that module's pure predicate. A name there is not hidden but
  absent, so it may only hold names no vault can hold as a real note.
- **Hiding filters the VIEW, not the crawl.** Files matched by the root
  `.gitignore`/`.ignore` AND dot-prefixed files/directories are withheld from
  `list()`/`listWithStats()`, but the crawl descends both and `listAllPaths()`
  returns every file on disk; a hidden file the user explicitly opens still
  reads/writes fine. Decluttering the sidebar — or dragging a folder into
  `.archive/` — must never make a file the vault no longer holds.
- **Rename is clobber-proof and case-aware.** Occupancy is case/NFC-
  insensitive over the real dir listing, decided by inode so a case-only
  self-rename passes through to one atomic `renameSync`.

## Seams

All bound by the composition root, `packages/server/src/boot/create-host.ts`:

- `setVaultChangeNotifier` — broadcast hookup (`onVaultChanged` + knowledge);
  module-scoped so it survives `resetVaultManager()` on logout.
- `setVaultWorkspaceLinkDir` — the agent workspace that receives the `vault`
  symlink (vault never imports agent/*).
- `setVaultTrashItem` — `HostPlatform.trashItem`; unset, `trash()` throws.
- Constructor options (`fs`, `settingsPath`, `defaultRoot`, `manageAgentLink`,
  `trashItem`, `workspaceLinkDir`) override each seam for tests.

## Testing

```bash
pnpm --filter @repo/vault test
```

`vault.test.ts` pins confinement (traversal + symlink escapes), snapshot
TTL/invalidation, the listing refusals (missing root, unreadable subtree), the
unaccounted-for reports (symlink, cloud placeholder) that replace a refusal,
the view/complete-listing split for hidden and ignore-matched paths, the crawl
fixture the pure predicate is pinned against too, rename occupancy, trash and
its fallback, the write-suspension gate, and real open-note watch events
against a temp dir;
`classify-file-change.test.ts` enumerates the verdict function +
`SelfSaveRegistry` TTL/fingerprint semantics.
