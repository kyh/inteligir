# @repo/sync

Desktop vault-sync adapters: the node bindings that turn `@repo/notes`' pure
`SyncEngine` into the running desktop sync — plus the account (Better Auth
client) and lifecycle around it.

## Why it exists

The sync ENGINE (reconcile, base advancement, conflict copies) is
platform-neutral and lives in `@repo/notes/sync`; mobile runs the same engine
over expo bindings. This package is the desktop half: node crypto, VaultManager
IO, and `~/.inteligir` stores. It sits BELOW `@repo/server` in the dep DAG —
it never imports server or electron code (that would be a package cycle);
upward needs cross the install seams below. Deps: vault, storage, notes, bridge.

## Layout

```
src/
  sync-manager.ts      # Node ports → SyncEngine: createNodeHasher (sha-256),
                       # createVaultSyncIo (live VaultManager as SyncIo),
                       # createJsonBaseStore (base manifest), createNodeBlobStore
                       # (content-addressed base bytes), nodeStamp, createSyncManager.
                       # Package-private — not in the exports map.
  sync-account.ts      # SyncAccount: three versioned JsonStores under ~/.inteligir
                       # (sync-config / sync-auth / sync-vault-id), Better Auth
                       # email+password + sign-up, social OAuth initiate/complete
                       # (state nonce), password reset, capabilities probe.
  sync-coordinator.ts  # SyncCoordinator: runtime gate → engine build/rebuild/
                       # teardown, conflict tracking (derived, never persisted),
                       # 5-min periodic reconcile backstop, onSyncStateChanged emit.
```

Exports map: `./sync-account`, `./sync-coordinator` only.

## Invariants

- **Off by default.** The coordinator constructs an engine only when config
  says `enabled` AND a bearer token AND a coordinator URL exist; any of the
  three missing → no engine, `syncNow` refuses as a value.
- **Vault FILES only.** The knowledge index and AI/editor state live under
  `~/.inteligir`, outside the vault, and are never listed into the protocol.
- **Sync-applied remote deletes are permanent** (`SyncIo.remove` →
  `vault.delete`, not trash) — CLAUDE.md § Decisions "Delete = OS trash": the
  originating device already trashed; reconcile preserves conflicting local
  edits as sibling copies.
- **Base manifest + blob store are pure caches.** Legacy/corrupt/foreign base
  → re-sync from empty; a missing/corrupt blob (get re-hashes, mismatch →
  null) only downgrades a merge to a conflict copy. Never data loss.
- **Conflicts are derived, never persisted**: seeded from a vault scan on
  start, appended per pass, pruned against the live listing — deleting the
  copy file IS resolving the conflict.
- **No recursive watcher** (vault-liveness decision): remote pushes wake the
  engine via subscription; a 5-minute interval is the local backstop.
- **Social sign-in is nonce-bound**: one in-memory pending (128-bit state,
  10-min TTL, single-use); a mismatched state is refused WITHOUT burning the
  pending; the deep-link `code` is opaque, exchanged over HTTPS — never a raw
  token. No installed browser opener → refuse as `{ok:false}`.
- **Stable per-install vaultId** minted on first use; the coordinator's
  first-writer claim ties it to the signed-in user.

## Seams

Module-scoped install seams, filled once by the composition root
(`packages/server/src/boot/create-host.ts`); all survive a logout/login reset:

- `setSyncEventSink` — registry-typed event emission (createHost passes its
  `emitEvent`). Uninstalled = drop, so the coordinator stays test-constructible.
- `setSyncVaultAccessor` — the live `VaultManager` accessor (`getVaultManager`).
  An accessor, not an instance: the vault singleton rebuilds on logout/login.
- `setSyncBrowserOpener` — system-browser opener for social sign-in (createHost
  passes the guarded `openExternalHttpUrl`). Uninstalled = refuse, never a
  package-owned launcher.

Tests inject narrower: `SyncCoordinator` takes `listVaultPaths` + a
`SyncEngineFactory`; `createSyncManager` takes `SyncIo` + fs/path overrides.

## Testing

```bash
pnpm --filter @repo/sync test
```

Notable pins: `createVaultSyncIo` lists every file uncapped (a capped listing
reads as deletions and propagates them); blob `get` integrity-checks (corrupt
→ null, never merged as base); state nonce is single-use and a wrong state
does not burn the pending;
guest→account upgrade adopts the existing vault (pushes, never wipes); a
debounced background pass surfaces conflicts without an explicit `syncNow`.
